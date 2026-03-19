from __future__ import annotations
import asyncio, json, logging, time
from datetime import date
from typing import Set

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .config_store import load as cfg_load, save as cfg_save
from .cmsi_engine  import (
    build_factor_data, compute_cmsi, generate_signals,
    get_bias, get_factor_completeness, CURRENCIES, FACTORS
)
from .data_fetcher import DataFetcher
from .backtest     import run_backtest

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(name)s  %(message)s")
logger = logging.getLogger("macrofx.server")

app = FastAPI(title="MacroFX Terminal Plus", version="1.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

cfg             = cfg_load()
fetcher         = DataFetcher(cfg)
clients:         Set[WebSocket] = set()
last_state:      dict = {}
trend_overrides: dict = {}

# Default refresh: 15 min. User can override in Config via refresh_interval_s.
DEFAULT_REFRESH_S = 900


def build_state() -> dict:
    month = date.today().month - 1  # 0-indexed

    # ── Data: use only what is actually in the live caches ───────────────
    # If a cache is empty (fetch failed), pass an empty dict to the engine.
    # The engine will leave those factor scores as None → frontend shows error.
    factor_data = build_factor_data(
        month        = month,
        cb_rates     = fetcher.cb_rates,    # {} if not yet fetched live
        gdp_vals     = fetcher.gdp_vals,    # {} if not yet fetched live
        cpi_changes  = fetcher.cpi_changes, # {} if not yet fetched live
        news_scores  = fetcher.news_scores, # {} if not yet fetched live
        pmi_data     = None,
        cot_data     = None,
        crowd_data   = None,
    )

    for cur, trend in trend_overrides.items():
        if cur in factor_data:
            factor_data[cur].trend = trend

    completeness = get_factor_completeness(factor_data)
    weights      = cfg.get("factor_weights", {})
    cmsi         = compute_cmsi(factor_data, weights)

    signals = generate_signals(
        cmsi         = cmsi,
        fx_rates     = fetcher.fx_rates,
        cb_rates     = fetcher.cb_rates,
        threshold    = cfg.get("signal_threshold", 3.0),
        active_pairs = cfg.get("active_pairs", []),
        completeness = completeness,
    )

    currencies_data = []
    for cur in CURRENCIES:
        fs    = factor_data.get(cur)
        score = cmsi.get(cur, 0.0)
        comp  = completeness.get(cur, 0)
        # Mark partial score with is_partial flag so frontend can show ~
        available_factors = [f for f in FACTORS if fs and getattr(fs, f) is not None]
        currencies_data.append({
            "code":             cur,
            "score":            score,
            "bias":             get_bias(score, comp),
            "factors":          fs.to_dict() if fs else {},
            "completeness":     comp,
            "is_partial":       comp < len(FACTORS),
            "missing_factors":  [f for f in FACTORS if fs and getattr(fs, f) is None],
        })

    # CB rates table — only populated from live fetches
    cb_table = []
    max_rate = max(fetcher.cb_rates.values()) if fetcher.cb_rates else None
    for cur in CURRENCIES:
        r    = fetcher.cb_rates.get(cur)       # None if not fetched
        meta = fetcher.cb_meta.get(cur, {})
        cb_table.append({
            "currency": cur,
            "bank":     meta.get("bank",   ""),
            "rate":     r,                      # None = no data
            "change":   meta.get("change", None),
            "next_mtg": meta.get("next",   "—"),
            "stance":   meta.get("stance", None),
            "relative": round(r / max_rate * 100, 1) if r is not None and max_rate else None,
            "is_live":  cur in fetcher.cb_rates,
        })

    key_pairs  = ["AUDJPY","EURUSD","GBPUSD","USDJPY","NZDJPY","USDCAD"]
    rate_diffs = [
        {
            "pair": p,
            "diff": round(fetcher.cb_rates.get(p[:3], 0) - fetcher.cb_rates.get(p[3:], 0), 2)
                    if fetcher.cb_rates else None,
        }
        for p in key_pairs
    ]

    scores = list(cmsi.values())
    spread = max(scores) - min(scores) if scores else 0
    regime = "RISK ON" if spread > 8 else "RISK OFF" if spread < 4 else "TRANSITION"

    top_pair = max(
        [p for p in cfg.get("active_pairs", []) if len(p) == 6 and
         fetcher.cb_rates.get(p[:3]) is not None and fetcher.cb_rates.get(p[3:]) is not None],
        key=lambda p: abs(fetcher.cb_rates.get(p[:3], 0) - fetcher.cb_rates.get(p[3:], 0)),
        default=None
    )

    carry_fav = (
        (fetcher.cb_rates.get("AUD", 0) - fetcher.cb_rates.get("JPY", 0)) > 3
        if "AUD" in fetcher.cb_rates and "JPY" in fetcher.cb_rates
        else None  # unknown if rates not loaded
    )

    corr = fetcher.compute_correlation_matrix()

    # ── Full provenance including structured errors ───────────────────────
    provenance = fetcher.get_data_provenance()

    return {
        "ts":              int(time.time()),
        "currencies":      currencies_data,
        "signals":         signals,
        "cb_rates":        cb_table,
        "rate_diffs":      rate_diffs,
        "correlation":     corr,
        "regime":          regime,
        "carry_env":       ("FAVORABLE (AUD/JPY+)" if carry_fav else "CAUTIOUS") if carry_fav is not None else "UNKNOWN",
        "top_spread_pair": top_pair,
        "dxy_score":       cmsi.get("USD", None),
        "api_status":      fetcher.api_status,
        "api_errors":      fetcher.api_errors,   # NEW: structured error details
        "data_sources":    fetcher.data_sources,
        "provenance":      provenance,
        "config":          cfg,
        "refresh_interval_s": cfg.get("refresh_interval_s", DEFAULT_REFRESH_S),
    }


async def broadcast(state: dict):
    if not clients:
        return
    msg  = json.dumps(state)
    dead: Set[WebSocket] = set()
    for ws in list(clients):
        try:
            await ws.send_text(msg)
        except Exception:
            dead.add(ws)
    clients.difference_update(dead)


async def refresh_loop():
    global last_state
    while True:
        interval = cfg.get("refresh_interval_s", DEFAULT_REFRESH_S)
        try:
            logger.info("[refresh] Starting data refresh cycle (interval=%ds)…", interval)
            await fetcher.refresh_all(trend_overrides)
            last_state = build_state()
            await broadcast(last_state)
            logger.info(
                "[refresh] Cycle complete — sources: fx=%s fred=%s gdp=%s news=%s av=%s — broadcasting to %d clients",
                fetcher.data_sources.get('fx'),
                fetcher.data_sources.get('cpi'),
                fetcher.data_sources.get('gdp'),
                fetcher.data_sources.get('news'),
                fetcher.data_sources.get('av'),
                len(clients),
            )
        except Exception as e:
            logger.exception("[refresh] Unhandled error: %s", e)
        await asyncio.sleep(interval)


@app.on_event("startup")
async def startup():
    asyncio.create_task(fetcher.fetch_fx_rates())
    asyncio.create_task(refresh_loop())


@app.on_event("shutdown")
async def shutdown():
    await fetcher.close()


@app.get("/health")
async def health():
    return {"status": "ok", "ts": int(time.time())}


@app.get("/state")
async def get_state():
    return last_state if last_state else build_state()


class ConfigUpdate(BaseModel):
    data: dict

@app.post("/config")
@app.post("/api/config")
async def update_config(body: ConfigUpdate):
    global cfg, fetcher
    cfg.update(body.data)
    cfg_save(cfg)
    fetcher.cfg = cfg
    logger.info("[config] Updated and saved — refresh_interval_s=%s",
                cfg.get('refresh_interval_s', DEFAULT_REFRESH_S))
    asyncio.create_task(fetcher.refresh_all(trend_overrides))
    return {"ok": True}


class BacktestRequest(BaseModel):
    pair:         str
    strategy:     str   = "cmsi"
    start:        str   = "2013-01-01"
    end:          str   = "2025-12-31"
    capital:      float = 10000.0
    position_pct: float = 10.0
    threshold:    float = 3.0

@app.post("/backtest")
@app.post("/api/backtest")
async def run_backtest_endpoint(req: BacktestRequest):
    try:
        return run_backtest(
            pair=req.pair, strategy=req.strategy,
            start_str=req.start, end_str=req.end,
            capital=req.capital, position_pct=req.position_pct,
            threshold=req.threshold,
        )
    except Exception as e:
        logger.exception("[backtest] %s", e)
        return {"error": str(e)}


@app.post("/refresh")
@app.post("/api/refresh")
@app.get("/api/refresh")
async def manual_refresh():
    asyncio.create_task(fetcher.refresh_all(trend_overrides))
    return {"ok": True, "message": "Refresh triggered"}


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    clients.add(ws)
    logger.info("[ws] Client connected — total: %d", len(clients))
    try:
        state = last_state if last_state else build_state()
        await ws.send_text(json.dumps(state))
    except Exception:
        pass
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        clients.discard(ws)
    except Exception:
        clients.discard(ws)
