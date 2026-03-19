"""MacroFX Smart Scheduler

Each data source has its own call window: how often it *should* be fetched
based on how fast the underlying data actually changes.  Windows are rounded
to the nearest human-friendly boundary (hour / half-hour / quarter-hour).

The user can always trigger a force-refresh regardless of the window — a
manual call never gets blocked.  Buffers are informational only: they tell
the frontend how long after a call results are considered "fresh" so it can
render a countdown / staleness badge.

Call-window design
──────────────────
  NOMINAL_S   – the ideal minimum gap between automated fetches (in seconds)
  BUFFER_S    – how long a response is considered "warm" after a successful
                fetch (may differ from NOMINAL_S — e.g. FX data is live but
                we only auto-fetch every 5 min, so the buffer is just 90s).
  ROUND_TO_S  – snap the computed "next call" timestamp to this boundary.
                Allowed values: 900 (15 min), 1800 (30 min), 3600 (1 h),
                7200 (2 h), 14400 (4 h), 86400 (1 day).

Rounding logic
──────────────
  next_call = last_called + NOMINAL_S
  rounded   = ceil(next_call / ROUND_TO_S) * ROUND_TO_S   (unix seconds)
  i.e. we snap *up* to the next boundary so we never call *earlier* than
  intended, only slightly later if needed.
"""
from __future__ import annotations

import math
import time
from dataclasses import dataclass, field
from typing import Dict, Optional

# ─────────────────────────────────────────────────────────────────────────────
# Per-source configuration
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class ApiWindow:
    """Immutable spec for one data source."""
    # Human-readable label shown in the frontend config table
    label:       str
    # Minimum automated fetch gap (seconds)
    nominal_s:   int
    # How long the data stays "fresh" after a successful fetch (seconds)
    buffer_s:    int
    # Snap next-call boundary to this resolution (seconds)
    round_to_s:  int
    # Whether a missing API key means this source is skipped entirely
    requires_key: bool = False
    # Short description of data update frequency
    note:        str = ""


# Each key matches a group name used in DataFetcher.fetch_ts / data_sources
API_WINDOWS: Dict[str, ApiWindow] = {
    "fx": ApiWindow(
        label       = "FX Spot Rates",
        nominal_s   = 5 * 60,          # auto-fetch every 5 min
        buffer_s    = 90,              # data valid for 90 s (live feed)
        round_to_s  = 5 * 60,         # no rounding needed at this frequency
        requires_key= False,
        note        = "Live via Frankfurter / open.er-api — updates every minute",
    ),
    "cb_rates": ApiWindow(
        label       = "Central Bank Rates",
        nominal_s   = 4 * 3600,        # auto every 4 h
        buffer_s    = 2 * 3600,        # fresh for 2 h
        round_to_s  = 3600,            # round to nearest hour
        requires_key= False,
        note        = "ECB & FRED; rates change only at policy meetings",
    ),
    "gdp": ApiWindow(
        label       = "GDP Growth",
        nominal_s   = 24 * 3600,       # auto once per day
        buffer_s    = 12 * 3600,       # fresh for 12 h
        round_to_s  = 3600,            # round to hour
        requires_key= False,
        note        = "World Bank annual/quarterly — rarely changes intraday",
    ),
    "cpi": ApiWindow(
        label       = "CPI / Inflation",
        nominal_s   = 12 * 3600,       # auto every 12 h
        buffer_s    = 6 * 3600,        # fresh for 6 h
        round_to_s  = 1800,            # round to half-hour
        requires_key= True,
        note        = "FRED monthly series; key required",
    ),
    "news": ApiWindow(
        label       = "News Sentiment",
        nominal_s   = 30 * 60,         # auto every 30 min
        buffer_s    = 15 * 60,         # fresh for 15 min
        round_to_s  = 1800,            # snap to half-hour
        requires_key= True,
        note        = "NewsAPI — 100 req/day on free tier; key required",
    ),
    "av": ApiWindow(
        label       = "FX Trend (AV)",
        nominal_s   = 60 * 60,         # auto every 1 h
        buffer_s    = 30 * 60,         # fresh for 30 min
        round_to_s  = 1800,            # snap to half-hour
        requires_key= True,
        note        = "Alpha Vantage weekly FX — 25 req/day free; key required",
    ),
    "fx_history": ApiWindow(
        label       = "FX History (Corr.)",
        nominal_s   = 6 * 3600,        # auto every 6 h
        buffer_s    = 3 * 3600,        # fresh for 3 h
        round_to_s  = 3600,            # round to hour
        requires_key= False,
        note        = "Frankfurter 90-day history for correlation matrix",
    ),
}


# ─────────────────────────────────────────────────────────────────────────────
# Runtime state
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class CallRecord:
    """Mutable per-source runtime record."""
    last_called_ts: float = 0.0        # unix ts of last successful call
    last_attempt_ts: float = 0.0       # unix ts of last attempt (incl. failed)
    call_count: int = 0
    force_pending: bool = False        # user requested a force-refresh


class SmartScheduler:
    """Decide when each API source is due for a refresh.

    Rules
    ─────
    1. A source is DUE if (now >= rounded_next_call_ts) OR force_pending.
    2. force_pending is set by the user hitting /api/refresh and is always
       honoured — it bypasses the window check entirely.
    3. next_call is snapped UP to the nearest ROUND_TO_S boundary so the
       user sees clean times (e.g. "next refresh at 14:30") rather than
       arbitrary offsets.
    4. Buffers are exposed via `window_info()` so the frontend can render
       a "fresh" / "stale" badge without extra logic.
    """

    def __init__(self):
        self._records: Dict[str, CallRecord] = {
            k: CallRecord() for k in API_WINDOWS
        }

    # ── Public query interface ───────────────────────────────────────────

    def is_due(self, source: str, force: bool = False) -> bool:
        """Return True if *source* should be fetched right now."""
        rec = self._records.get(source)
        if rec is None:
            return False
        if force or rec.force_pending:
            return True
        return time.time() >= self._rounded_next_ts(source)

    def mark_called(self, source: str, success: bool = True):
        """Record that a fetch was just attempted."""
        now = time.time()
        rec = self._records[source]
        rec.last_attempt_ts = now
        rec.force_pending = False
        rec.call_count += 1
        if success:
            rec.last_called_ts = now

    def request_force_refresh(self, source: Optional[str] = None):
        """Flag one source (or all) for immediate refresh on next cycle."""
        targets = [source] if source else list(self._records.keys())
        for s in targets:
            if s in self._records:
                self._records[s].force_pending = True

    def seconds_until_due(self, source: str) -> Optional[int]:
        """Seconds until the next scheduled (non-forced) call. 0 if overdue."""
        rec = self._records.get(source)
        if rec is None:
            return None
        remaining = self._rounded_next_ts(source) - time.time()
        return max(0, int(remaining))

    def is_fresh(self, source: str) -> bool:
        """True if the last successful fetch is within buffer_s."""
        win = API_WINDOWS.get(source)
        rec = self._records.get(source)
        if not win or not rec:
            return False
        return rec.last_called_ts > 0 and (time.time() - rec.last_called_ts) < win.buffer_s

    def window_info(self) -> Dict[str, dict]:
        """Serialisable summary of every source — sent to the frontend."""
        now = time.time()
        out: Dict[str, dict] = {}
        for key, win in API_WINDOWS.items():
            rec = self._records[key]
            next_ts  = self._rounded_next_ts(key)
            age_s    = int(now - rec.last_called_ts) if rec.last_called_ts > 0 else None
            secs_due = max(0, int(next_ts - now))
            out[key] = {
                "label":          win.label,
                "nominal_s":      win.nominal_s,
                "buffer_s":       win.buffer_s,
                "round_to_s":     win.round_to_s,
                "requires_key":   win.requires_key,
                "note":           win.note,
                "last_called_ts": rec.last_called_ts or None,
                "call_count":     rec.call_count,
                "force_pending":  rec.force_pending,
                "is_fresh":       self.is_fresh(key),
                "age_s":          age_s,
                "next_call_ts":   next_ts,
                "secs_until_due": secs_due,
                # human-readable rounded next call time (ISO-style HH:MM)
                "next_call_hhmm": _hhmm(next_ts),
            }
        return out

    # ── Internal helpers ─────────────────────────────────────────────────

    def _rounded_next_ts(self, source: str) -> float:
        """Snap last_called + nominal_s UP to next ROUND_TO_S boundary."""
        win = API_WINDOWS[source]
        rec = self._records[source]
        if rec.last_called_ts == 0:
            # Never called — due immediately
            return 0.0
        raw_next = rec.last_called_ts + win.nominal_s
        r = win.round_to_s
        if r <= 60:
            return raw_next  # no rounding for very short intervals
        return math.ceil(raw_next / r) * r


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _hhmm(ts: float) -> str:
    """Format a unix timestamp as HH:MM local time string."""
    import datetime
    if ts <= 0:
        return "—"
    try:
        dt = datetime.datetime.fromtimestamp(ts)
        return dt.strftime("%H:%M")
    except Exception:
        return "—"


# Module-level singleton used by server.py
scheduler = SmartScheduler()
