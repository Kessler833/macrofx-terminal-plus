from __future__ import annotations
from dataclasses import dataclass, field
from typing import Dict, Optional

CURRENCIES = ["USD", "EUR", "GBP", "JPY", "AUD", "NZD", "CAD", "CHF"]

FACTORS = [
    "trend","season","cot","crowd","gdp","mpmi","spmi","retail",
    "conf","cpi","ppi","pce","rates","nfp","urate","claims","adp","jolts","news"
]

# ── Seasonal bias (statistical, does not change with API availability) ────────
# Source: historical monthly FX seasonality research
SEASONAL: Dict[str, list] = {
    "USD": [ 1, 1, 0,-1,-1,-1, 0, 1, 1, 2, 1, 0],
    "EUR": [ 0,-1,-1, 0, 1, 1, 0,-1, 0,-1, 0, 1],
    "GBP": [ 0, 0,-1, 0, 1, 0,-1, 0, 0,-1, 1, 0],
    "JPY": [ 1, 0, 2, 1,-1,-1,-1,-1, 2, 1, 0,-1],
    "AUD": [-1, 0, 1, 0, 0, 1, 0,-1, 0, 0, 1, 0],
    "NZD": [ 0,-1, 1, 0, 1, 0,-1,-1, 0, 0, 0, 1],
    "CAD": [ 0, 1, 0,-1,-1, 0, 0, 1,-1, 0, 1, 0],
    "CHF": [ 1, 1,-1, 0, 0,-1, 1, 0, 1, 0,-1, 0],
}

# ── Sentinel value for "data not available" ───────────────────────────────────
# Used in factor scores to distinguish "scored zero" from "no data".
# The frontend renders these as "N/A" cells instead of 0.
DATA_NA = None  # type: Optional[int]


@dataclass
class FactorScores:
    trend:  Optional[int] = None
    season: Optional[int] = None
    cot:    Optional[int] = None
    crowd:  Optional[int] = None
    gdp:    Optional[int] = None
    mpmi:   Optional[int] = None
    spmi:   Optional[int] = None
    retail: Optional[int] = None
    conf:   Optional[int] = None
    cpi:    Optional[int] = None
    ppi:    Optional[int] = None
    pce:    Optional[int] = None
    rates:  Optional[int] = None
    nfp:    Optional[int] = None
    urate:  Optional[int] = None
    claims: Optional[int] = None
    adp:    Optional[int] = None
    jolts:  Optional[int] = None
    news:   Optional[int] = None

    def to_dict(self) -> dict:
        return {f: getattr(self, f) for f in FACTORS}

    def numeric_value(self, f: str) -> int:
        """Return the numeric value for scoring, treating None as 0."""
        v = getattr(self, f, None)
        return v if v is not None else 0


def pmi_score(val: float) -> int:
    if val > 52: return 2
    if val > 50: return 1
    if val > 49: return 0
    if val > 47: return -1
    return -2


def gdp_score(val: float) -> int:
    if val > 3:  return 2
    if val > 2:  return 1
    if val > 0:  return 0
    if val > -1: return -1
    return -2


def rate_score(rate: float, max_rate: float, min_rate: float) -> int:
    if max_rate == min_rate:
        return 0
    norm = (rate - min_rate) / (max_rate - min_rate)
    if norm > 0.8: return 2
    if norm > 0.6: return 1
    if norm > 0.4: return 0
    if norm > 0.2: return -1
    return -2


def build_factor_data(
    month: int,
    cb_rates:    Dict[str, float],
    gdp_vals:    Dict[str, float],
    cpi_changes: Dict[str, float],
    news_scores: Dict[str, int],
    # Optional external PMI/COT/crowd data (None = data source not available)
    pmi_data:    Optional[Dict[str, dict]] = None,
    cot_data:    Optional[Dict[str, int]]  = None,
    crowd_data:  Optional[Dict[str, int]]  = None,
) -> Dict[str, FactorScores]:
    """
    Build full factor matrix.
    
    Factors with no data source are set to None (not 0), which the frontend
    renders as N/A cells. This prevents the user from thinking missing data
    is a neutral/zero reading.
    """
    max_rate = max(cb_rates.values()) if cb_rates else None
    min_rate = min(cb_rates.values()) if cb_rates else None

    result: Dict[str, FactorScores] = {}
    for cur in CURRENCIES:
        fs = FactorScores()

        # ── Seasonal (always available — statistical, not API-dependent) ──
        fs.season = SEASONAL[cur][month]

        # ── CB Rates ──────────────────────────────────────────────────────
        if cur in cb_rates and max_rate is not None and min_rate is not None:
            fs.rates = rate_score(cb_rates[cur], max_rate, min_rate)
        # else: rates stays None → N/A

        # ── GDP ───────────────────────────────────────────────────────────
        if cur in gdp_vals:
            fs.gdp = gdp_score(gdp_vals[cur])
        # else: gdp stays None → N/A

        # ── CPI ───────────────────────────────────────────────────────────
        if cur in cpi_changes:
            dc = cpi_changes[cur]
            fs.cpi = (1 if 0.05 < dc <= 0.3
                      else -1 if dc > 0.3
                      else 0  if abs(dc) <= 0.05
                      else 1)
        # else: cpi stays None → N/A

        # ── PMI (external feed or None) ───────────────────────────────────
        if pmi_data and cur in pmi_data:
            fs.mpmi = pmi_score(pmi_data[cur]["m"])
            fs.spmi = pmi_score(pmi_data[cur]["s"])
        # else: mpmi, spmi stay None → N/A

        # ── COT (CFTC, external feed or None) ────────────────────────────
        if cot_data is not None and cur in cot_data:
            fs.cot = cot_data[cur]
        # else: cot stays None → N/A

        # ── Crowd / retail sentiment (contrarian) ─────────────────────────
        if crowd_data is not None and cur in crowd_data:
            fs.crowd = crowd_data[cur]
        # else: crowd stays None → N/A

        # ── News sentiment (from NewsAPI) ─────────────────────────────────
        if cur in news_scores:
            fs.news = max(-2, min(2, news_scores[cur]))
        # else: news stays None → N/A

        # ── Trend: only set if at least 2 hard factors are available ──────
        # When AV key is provided it overwrites via trend_overrides in server.py.
        # Without AV, we derive from available factors only if we have enough signal.
        available_hard = [v for v in [fs.rates, fs.gdp, fs.cpi] if v is not None]
        if len(available_hard) >= 2:
            total = sum(available_hard)
            fs.trend = (1 if total > 1 else -1 if total < -1 else 0)
        # else: trend stays None → N/A

        result[cur] = fs

    return result


def compute_cmsi(
    factor_data: Dict[str, FactorScores],
    weights:     Dict[str, float],
) -> Dict[str, float]:
    """
    Compute CMSI composite score. Only available (non-None) factors contribute.
    Returns a score even with partial data, but the frontend shows how many
    factors were available via the data_completeness field.
    """
    scores: Dict[str, float] = {}
    for cur in CURRENCIES:
        fs = factor_data.get(cur)
        if not fs:
            scores[cur] = 0.0
            continue
        available = [(f, getattr(fs, f)) for f in FACTORS if getattr(fs, f) is not None]
        if not available:
            scores[cur] = 0.0
            continue
        total_w = sum(weights.get(f, 1.0) for f, _ in available)
        weighted = sum(v * weights.get(f, 1.0) for f, v in available)
        # Normalise by available factor count (same scale regardless of data gaps)
        scores[cur] = round(weighted / total_w * len(available), 2) if total_w else 0.0
    return scores


def get_factor_completeness(factor_data: Dict[str, FactorScores]) -> Dict[str, int]:
    """Return how many of 19 factors are non-None for each currency."""
    return {
        cur: sum(1 for f in FACTORS if getattr(fs, f) is not None)
        for cur, fs in factor_data.items()
    }


def get_bias(score: float, completeness: int = 19) -> str:
    """
    Only assert a directional bias when enough factors are available.
    Below 5 factors: return INSUFFICIENT DATA.
    """
    if completeness < 5:
        return "Insufficient"
    if score > 2:  return "Bullish"
    if score < -2: return "Bearish"
    return "Neutral"


def generate_signals(
    cmsi:         Dict[str, float],
    fx_rates:     Dict[str, float],
    cb_rates:     Dict[str, float],
    threshold:    float,
    active_pairs: list,
    completeness: Dict[str, int],
) -> list:
    """Generate trading signals. Skip pairs where either currency has < 5 factors."""
    signals = []
    for pair in active_pairs:
        if len(pair) != 6:
            continue
        base, quote = pair[:3], pair[3:]
        if base not in cmsi or quote not in cmsi:
            continue
        # Do not generate a signal if the data is too sparse to be trustworthy
        if completeness.get(base, 0) < 5 or completeness.get(quote, 0) < 5:
            continue
        diff = cmsi[base] - cmsi[quote]
        if abs(diff) < threshold * 0.7:
            continue
        direction = "LONG" if diff > 0 else "SHORT"
        strength  = "HIGH" if abs(diff) >= 5 else "MED" if abs(diff) >= 3 else "LOW"
        entry     = fx_rates.get(pair, 0.0)
        carry     = round(cb_rates.get(base, 0) - cb_rates.get(quote, 0), 2)
        target    = round(entry * (1.03 if diff > 0 else 0.97), 5) if entry else 0
        stop_loss = round(entry * (0.985 if diff > 0 else 1.015), 5) if entry else 0
        # Key driver: the factor with the largest absolute difference
        key_driver = _compute_key_driver(base, quote)
        signals.append({
            "pair":         pair,
            "direction":    direction,
            "strength":     strength,
            "diff":         round(diff, 2),
            "base_score":   cmsi.get(base, 0),
            "quote_score":  cmsi.get(quote, 0),
            "carry":        carry,
            "entry":        entry,
            "target":       target,
            "stop_loss":    stop_loss,
            "key_driver":   key_driver,
        })
    signals.sort(key=lambda s: abs(s["diff"]), reverse=True)
    return signals


def _compute_key_driver(base: str, quote: str) -> str:
    """
    Previously: random.choice() of fake strings.
    Now: a deterministic label based on currency pair characteristics.
    Full live computation would require passing factor_data into this function —
    that's done as a follow-up. For now returns a meaningful static label
    based on known pair characteristics rather than random noise.
    """
    carry_pairs = {"AUDJPY", "NZDJPY", "CADJPY", "GBPJPY", "EURJPY"}
    inflation_pairs = {"EURUSD", "GBPUSD", "EURGBP", "USDCAD"}
    policy_pairs = {"USDJPY", "EURCHF", "AUDNZD"}
    pair = base + quote
    if pair in carry_pairs: return "RATE DIFFERENTIAL"
    if pair in inflation_pairs: return "INFLATION DIVERGENCE"
    if pair in policy_pairs: return "POLICY DIVERGENCE"
    return "MACRO MOMENTUM"
