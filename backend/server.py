from __future__ import annotations
import asyncio, json, logging, time
from datetime import datetime, date
from typing import Set

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .config_store import load as cfg_load, save as cfg_save
from .cmsi_engine  import (
    build_factor_data, compute_cmsi, generate_signals,
    get_bias, CURRENCIES, FACTORS, SEASONAL
)
from .data_fetcher import DataFetcher
from .backtest     import run_backtest

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(name)s  %(message)s")
logger = logging.getLogger("macrofx.server")

app = FastAPI(title="MacroFX Terminal Plus", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ── Global state ──────────────────────────────────────────────────────────────
cfg          = cfg_load()
fetcher      = DataFetcher(cfg)
clients:      Set[WebSocket] = set()
last_state:   dict = {}
trend_overrides: dict = {}


# ── Helpers ───────────────────────────────────────────────────────────────────

def build_state() -> dict:
    month = date.today().month - 1  # 0-indexed

    factor_data = build_factor_data(
        month        = month,
        cb_rates     = fetcher.cb_rates,
        gdp_vals     = fetcher.gdp_vals,
        cpi_changes  = fetcher.cpi_changes,
        news_scores  = fetcher.news_scores,
    )

    for cur, trend in trend_overrides.items():
        if cur in factor_data:
            factor_data[cur].trend = trend

    weights  = cfg.get("factor_weights", {})
    cmsi     = compute_cmsi(factor_data, weights)
    signals  = generate_signals(
        cmsi         = cmsi,
        fx_rates     = fetcher.fx_rates,
        cb_rates     = fetcher.cb_rates,
        threshold    = cfg.get("signal_threshold", 3.0),
        active_pairs = cfg.get("active_pairs", []),
    )

    currencies_data = []
    for cur in CURRENCIES:
        fs = factor_data.get(cur)
        currencies_data.append({
            "code":    cur,
            "score":   cmsi.get(cur, 0),
            "bias":    get_bias(cmsi.get(cur, 0)),
            "factors": fs.to_dict() if fs else {},
        })

    cb_table = []
    max_rate = max(fetcher.cb_rates.values()) if fetcher.cb_rates else 5.0
    for cur in CURRENCIES:
        r    = fetcher.cb_rates.get(cur, 0)
        meta = fetcher.cb_meta.get(cur, {})
        cb_table.append({
            "currency": cur,
            "bank":     meta.get("bank", ""),
            "rate":     r,
            "change":   meta.get("change", 0),
            "next_mtg": meta.get("next", "\u2014"),
            "stance":   meta.get("stance", "Neutral"),
            "relative": round(r / max_rate * 100, 1) if max_rate else 0,
        })

    key_pairs = ["AUDJPY","EURUSD","GBPUSD","USDJPY","NZDJPY","USDCAD"]
    rate_diffs = []
    for pair in key_pairs:
        b, q = pair[:3], pair[3:]
        diff = round(fetcher.cb_rates.get(b, 0) - fetcher.cb_rates.get(q, 0), 2)
        rate_diffs.append({"pair": pair, "diff": diff})

    scores   = list(cmsi.values())
    spread   = max(scores) - min(scores) if scores else 0
    regime   = "RISK ON" if spread > 8 else "RISK OFF" if spread < 4 else "TRANSITION"
    top_pair = max(
        [p for p in cfg.get("active_pairs", []) if len(p) == 6],
        key=lambda p: abs(fetcher.cb_rates.get(p[:3], 0) - fetcher.cb_rates.get(p[3:], 0)),
        default="AUDJPY"
    )
    carry_fav = (fetcher.cb_rates.get("AUD", 0) - fetcher.cb_rates.get("JPY", 0)) > 3

    corr = fetcher.compute_correlation_matrix()

    return {
        "ts":              int(time.time()),
        "currencies":      currencies_data,
        "signals":         signals,
        "cb_rates":        cb_table,
        "rate_diffs":      rate_diffs,
        "correlation":     corr,
        "regime":          regime,
        "carry_env":       "FAVORABLE (AUD/JPY+)" if carry_fav else "CAUTIOUS",
        "top_spread_pair": top_pair,
        "dxy_score":       cmsi.get("USD", 0),
        "api_status":      fetcher.api_status,
        "config":          cfg,
    }


async def broadcast(state: dict):
    # Use difference_update to avoid Python treating 'clients' as local
    # (clients -= dead would create an UnboundLocalError on the earlier check)
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


# ── Background refresh loop ───────────────────────────────────────────────────
async def refresh_loop():
    global last_state
    while True:
        try:
            logger.info("[refresh] Starting data refresh cycle\u2026")
            await fetcher.refresh_all(trend_overrides)
            last_state = build_state()
            await broadcast(last_state)
            logger.info("[refresh] Cycle complete \u2014 broadcasting to %d clients", len(clients))
        except Exception as e:
            logger.exception("[refresh] Error: %s", e)
        await asyncio.sleep(60)


@app.on_event("startup")
async def startup():
    asyncio.create_task(fetcher.fetch_fx_rates())
    asyncio.create_task(refresh_loop())


@app.on_event("shutdown")
async def shutdown():
    await fetcher.close()


# ── HTTP endpoints ─────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "ts": int(time.time())}


@app.get("/state")
async def get_state():
    return last_state if last_state else build_state()


class ConfigUpdate(BaseModel):
    data: dict

# Accept both /config and /api/config
@app.post("/config")
@app.post("/api/config")
async def update_config(body: ConfigUpdate):
    global cfg, fetcher
    cfg.update(body.data)
    cfg_save(cfg)
    fetcher.cfg = cfg
    logger.info("[config] Updated and saved")
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

# Accept both /backtest and /api/backtest
@app.post("/backtest")
@app.post("/api/backtest")
async def run_backtest_endpoint(req: BacktestRequest):
    try:
        result = run_backtest(
            pair         = req.pair,
            strategy     = req.strategy,
            start_str    = req.start,
            end_str      = req.end,
            capital      = req.capital,
            position_pct = req.position_pct,
            threshold    = req.threshold,
        )
        return result
    except Exception as e:
        logger.exception("[backtest] %s", e)
        return {"error": str(e)}


# Accept both /refresh and /api/refresh
@app.post("/refresh")
@app.post("/api/refresh")
@app.get("/api/refresh")
async def manual_refresh():
    asyncio.create_task(fetcher.refresh_all(trend_overrides))
    return {"ok": True, "message": "Refresh triggered"}


# ── WebSocket ─────────────────────────────────────────────────────────────────

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    clients.add(ws)
    logger.info("[ws] Client connected \u2014 total: %d", len(clients))
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
        logger.info("[ws] Client disconnected \u2014 total: %d", len(clients))
    except Exception:
        clients.discard(ws)
