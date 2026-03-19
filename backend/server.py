from __future__ import annotations
import asyncio, json, logging, time
from datetime import date
from typing import Optional, Set

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
from .scheduler    import scheduler, API_WINDOWS

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(name)s  %(message)s")
logger = logging.getLogger("macrofx.server")

app = FastAPI(title="MacroFX Terminal Plus", version="1.2.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

cfg             = cfg_load()
fetcher         = DataFetcher(cfg)
clients:         Set[WebSocket] = set()
last_state:      dict = {}
trend_overrides: dict = {}

# ── Scheduler polling interval (seconds) ─────────────────────────────────────
# The scheduler loop ticks on this cadence and calls only the sources
# whose window is due.  Keep it short enough not to miss a window.
SCHEDULER_TICK_S = 60   # check every minute


# ─────────────────────────────────────────────────────────────────────────────
# State builder
# ─────────────────────────────────────────────────────────────────────────────

def build_state() -> dict:
    month = date.today().month - 1

    factor_data = build_factor_data(
        month        = month,
        cb_rates     = fetcher.cb_rates,
        gdp_vals     = fetcher.gdp_vals,
        cpi_changes  = fetcher.cpi_changes,
        news_scores  = fetcher.news_scores,
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
        currencies_data.append({
            "code":            cur,
            "score":           score,
            "bias":            get_bias(score, comp),
            "factors":         fs.to_dict() if fs else {},
            "completeness":    comp,
            "is_partial":      comp < len(FACTORS),
            "missing_factors": [f for f in FACTORS if fs and getattr(fs, f) is None],
        })

    cb_table = []
    max_rate = max(fetcher.cb_rates.values()) if fetcher.cb_rates else None
    for cur in CURRENCIES:
        r    = fetcher.cb_rates.get(cur)
        meta = fetcher.cb_meta.get(cur, {})
        cb_table.append({
            "currency": cur,
            "bank":     meta.get("bank",   ""),
            "rate":     r,
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
        else None
    )

    corr = fetcher.compute_correlation_matrix()
    provenance = fetcher.get_data_provenance()

    # ── Scheduler window info (surfaced to config tab) ────────────────────
    sched_info = scheduler.window_info()

    return {
        "ts":               int(time.time()),
        "currencies":       currencies_data,
        "signals":          signals,
        "cb_rates":         cb_table,
        "rate_diffs":       rate_diffs,
        "correlation":      corr,
        "regime":           regime,
        "carry_env":        ("FAVORABLE (AUD/JPY+)" if carry_fav else "CAUTIOUS") if carry_fav is not None else "UNKNOWN",
        "top_spread_pair":  top_pair,
        "dxy_score":        cmsi.get("USD", None),
        "api_status":       fetcher.api_status,
        "api_errors":       fetcher.api_errors,
        "data_sources":     fetcher.data_sources,
        "provenance":       provenance,
        "config":           cfg,
        # Legacy key kept for backwards compat
        "refresh_interval_s": SCHEDULER_TICK_S,
        # New: per-source schedule info for the config/status tab
        "schedule":         sched_info,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Broadcast helpers
# ─────────────────────────────────────────────────────────────────────────────

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


# ─────────────────────────────────────────────────────────────────────────────
# Smart scheduler loop
# ─────────────────────────────────────────────────────────────────────────────

async def scheduler_loop():
    """Tick every SCHEDULER_TICK_S seconds.  Only call APIs whose window is due.

    Force-refreshes are picked up on the very next tick (within 60 s max).
    A full-state broadcast is sent whenever *any* source is fetched.
    """
    global last_state
    # Give the app a moment to finish startup before first check
    await asyncio.sleep(2)

    while True:
        try:
            fetched_any = False

            # ── Sources that need no key ──────────────────────────────────
            if scheduler.is_due("fx"):
                logger.info("[sched] fx: due — fetching")
                ok = await fetcher.fetch_fx_rates()
                scheduler.mark_called("fx", ok)
                fetched_any = True

            if scheduler.is_due("cb_rates"):
                logger.info("[sched] cb_rates: due — fetching ECB")
                ok = await fetcher.fetch_ecb_rate()
                scheduler.mark_called("cb_rates", ok)
                fetched_any = True

            if scheduler.is_due("gdp"):
                logger.info("[sched] gdp: due — fetching World Bank")
                ok = await fetcher.fetch_gdp()
                scheduler.mark_called("gdp", ok)
                fetched_any = True

            if scheduler.is_due("fx_history"):
                logger.info("[sched] fx_history: due — fetching Frankfurter history")
                ok = await fetcher.fetch_fx_history()
                scheduler.mark_called("fx_history", ok)
                fetched_any = True

            # ── Key-gated sources ─────────────────────────────────────────
            if scheduler.is_due("cpi"):
                logger.info("[sched] cpi: due — fetching FRED")
                ok = await fetcher.fetch_fred()
                scheduler.mark_called("cpi", ok)
                # FRED also updates cb_rates for USD — sync scheduler record
                if ok:
                    scheduler.mark_called("cb_rates", True)
                fetched_any = True

            if scheduler.is_due("news"):
                logger.info("[sched] news: due — fetching NewsAPI")
                ok = await fetcher.fetch_news_sentiment()
                scheduler.mark_called("news", ok)
                fetched_any = True

            if scheduler.is_due("av"):
                logger.info("[sched] av: due — fetching Alpha Vantage")
                ok = await fetcher.fetch_av_trends(trend_overrides)
                scheduler.mark_called("av", ok)
                fetched_any = True

            if fetched_any:
                last_state = build_state()
                await broadcast(last_state)
                logger.info(
                    "[sched] tick complete — sources fetched, broadcasting to %d clients",
                    len(clients),
                )
            else:
                # Nothing fetched; still push updated schedule times to clients
                # so the "next refresh" countdown stays accurate
                if last_state and clients:
                    last_state["schedule"] = scheduler.window_info()
                    last_state["ts"]       = int(time.time())
                    await broadcast(last_state)

        except Exception as e:
            logger.exception("[sched] Unhandled error in scheduler loop: %s", e)

        await asyncio.sleep(SCHEDULER_TICK_S)


# ─────────────────────────────────────────────────────────────────────────────
# Lifecycle
# ─────────────────────────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    # Immediately fetch FX spot so the heatmap isn't empty on first load
    asyncio.create_task(fetcher.fetch_fx_rates())
    asyncio.create_task(scheduler_loop())


@app.on_event("shutdown")
async def shutdown():
    await fetcher.close()


# ─────────────────────────────────────────────────────────────────────────────
# HTTP endpoints
# ─────────────────────────────────────────────────────────────────────────────

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
    global cfg, fetcher, last_state
    cfg.update(body.data)
    cfg_save(cfg)
    fetcher.cfg = cfg

    # Reset pending states for keys that just changed
    if body.data.get("alpha_vantage_key", "").strip():
        fetcher.api_status["av"]  = "pending"
        fetcher.api_errors.pop("av", None)
        scheduler.request_force_refresh("av")
        logger.info("[config] AV key updated — forcing refresh")

    if body.data.get("fred_key", "").strip() or body.data.get("fred_api_key", "").strip():
        fetcher.api_status["fred"] = "pending"
        fetcher.api_errors.pop("fred", None)
        scheduler.request_force_refresh("cpi")
        logger.info("[config] FRED key updated — forcing refresh")

    if body.data.get("news_api_key", "").strip():
        fetcher.api_status["news"] = "pending"
        fetcher.api_errors.pop("news", None)
        scheduler.request_force_refresh("news")
        logger.info("[config] NewsAPI key updated — forcing refresh")

    last_state = build_state()
    await broadcast(last_state)
    asyncio.create_task(_refresh_and_broadcast())
    return {"ok": True}


async def _refresh_and_broadcast():
    """Run full refresh (used after config changes) and broadcast."""
    global last_state
    try:
        await fetcher.refresh_all(trend_overrides)
        # Sync scheduler timestamps from fetcher
        for src in ("fx", "cb_rates", "gdp", "cpi", "news", "av", "fx_history"):
            ts = fetcher.fetch_ts.get(src, 0)
            if ts > 0:
                scheduler._records[src].last_called_ts = ts
                scheduler._records[src].force_pending  = False
        last_state = build_state()
        await broadcast(last_state)
        logger.info("[config/refresh] Full refresh complete")
    except Exception as e:
        logger.exception("[config/refresh] Error: %s", e)


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
async def manual_refresh(source: Optional[str] = None):
    """Force-refresh one source or all sources immediately.

    ?source=fx         — refresh only FX spot rates
    ?source=news       — refresh only news sentiment
    (no param)         — refresh everything

    This endpoint ALWAYS succeeds regardless of call windows.
    The actual fetch runs in the background; the scheduler tick
    will pick it up within SCHEDULER_TICK_S seconds at most.
    For an instant kick, we also fire the fetch directly here.
    """
    global last_state

    if source and source in API_WINDOWS:
        scheduler.request_force_refresh(source)
        logger.info("[refresh] Force-refresh requested for source: %s", source)
        # Fire immediately for instant feedback
        asyncio.create_task(_fetch_single_and_broadcast(source))
    else:
        scheduler.request_force_refresh()  # flag all sources
        logger.info("[refresh] Force-refresh requested for ALL sources")
        asyncio.create_task(_refresh_and_broadcast())

    return {"ok": True, "message": f"Force-refresh triggered for {'all sources' if not source else source}"}


async def _fetch_single_and_broadcast(source: str):
    """Fetch exactly one source and broadcast updated state."""
    global last_state
    try:
        ok = False
        if source == "fx":
            ok = await fetcher.fetch_fx_rates()
        elif source == "cb_rates":
            ok = await fetcher.fetch_ecb_rate()
            if ok:
                await fetcher.fetch_fred()  # USD rate lives in FRED
        elif source == "gdp":
            ok = await fetcher.fetch_gdp()
        elif source == "cpi":
            ok = await fetcher.fetch_fred()
        elif source == "news":
            ok = await fetcher.fetch_news_sentiment()
        elif source == "av":
            ok = await fetcher.fetch_av_trends(trend_overrides)
        elif source == "fx_history":
            ok = await fetcher.fetch_fx_history()
        scheduler.mark_called(source, ok)
        last_state = build_state()
        await broadcast(last_state)
        logger.info("[refresh/%s] Done — ok=%s", source, ok)
    except Exception as e:
        logger.exception("[refresh/%s] Error: %s", source, e)


@app.get("/schedule")
@app.get("/api/schedule")
async def get_schedule():
    """Return current scheduler window info for all sources."""
    return scheduler.window_info()


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
