from __future__ import annotations
from dataclasses import dataclass, field
from typing import Dict, Optional

CURRENCIES = ["USD", "EUR", "GBP", "JPY", "AUD", "NZD", "CAD", "CHF"]

FACTORS = [
    "trend","season","cot","crowd","gdp","mpmi","spmi","retail",
    "conf","cpi","ppi","pce","rates","nfp","urate","claims","adp","jolts","news"
]

# ── Seasonal bias (statistical, does not change with API availability) ────────
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
        v = getattr(self, f, None)
        return v if v is not None else 0


# ── Scoring helpers ───────────────────────────────────────────────────────────

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


def cpi_score(change: float) -> int:
    """CPI MoM change: rising inflation above target is hawkish (good for currency)."""
    # change is the MoM difference of the index level
    # Thresholds tuned for FRED index-level units (not %-points)
    if change > 0.30:   return -1  # above 0.3 → overheating, central bank may cut later
    if change > 0.05:   return  1  # mild rise → hawkish territory
    if abs(change) <= 0.05: return 0
    if change > -0.10:  return -1  # mild deflation
    return -2                       # significant deflation


def ppi_score(change: float) -> int:
    """PPI MoM change: pipeline inflation signal."""
    if change > 0.5:    return  2
    if change > 0.1:    return  1
    if abs(change) <= 0.1: return 0
    if change > -0.3:   return -1
    return -2


def pce_score(change: float) -> int:
    """PCE MoM change: Fed's preferred inflation gauge."""
    if change > 0.4:    return -1  # overheating
    if change > 0.1:    return  1  # healthy rise
    if abs(change) <= 0.1: return 0
    return -1


def nfp_score(change: float, cur: str) -> int:
    """Employment growth — higher is bullish."""
    # USD: ADP in thousands of workers; international: index % change
    if cur == "USD":
        if change > 200:   return  2
        if change > 100:   return  1
        if change > 0:     return  0
        if change > -100:  return -1
        return -2
    else:
        # International employment MoM index change
        if change > 0.3:   return  2
        if change > 0.05:  return  1
        if abs(change) <= 0.05: return 0
        if change > -0.1:  return -1
        return -2


def urate_score(rate: float) -> int:
    """Unemployment rate — lower is bullish."""
    if rate < 3.5:   return  2
    if rate < 4.5:   return  1
    if rate < 5.5:   return  0
    if rate < 7.0:   return -1
    return -2


def claims_score(change: float) -> int:
    """Initial jobless claims MoM change — falling claims is bullish."""
    # change is MoM diff in raw claims count (thousands)
    if change < -20000:  return  2
    if change < -5000:   return  1
    if abs(change) < 5000: return 0
    if change < 20000:   return -1
    return -2


def adp_score(change: float) -> int:
    """ADP private employment change (thousands) — USD only."""
    if change > 200:    return  2
    if change > 100:    return  1
    if change > 0:      return  0
    if change > -100:   return -1
    return -2


def jolts_score(change: float) -> int:
    """JOLTS job openings MoM change — USD only."""
    if change > 300:    return  2
    if change > 50:     return  1
    if abs(change) < 50: return 0
    if change > -300:   return -1
    return -2


# ── Main builder ──────────────────────────────────────────────────────────────

def build_factor_data(
    month:        int,
    cb_rates:     Dict[str, float],
    gdp_vals:     Dict[str, float],
    cpi_changes:  Dict[str, float],
    news_scores:  Dict[str, int],
    # FRED-derived indicator dicts
    ppi_changes:  Optional[Dict[str, float]] = None,
    pce_changes:  Optional[Dict[str, float]] = None,
    nfp_vals:     Optional[Dict[str, float]] = None,
    urate_vals:   Optional[Dict[str, float]] = None,
    claims_vals:  Optional[Dict[str, float]] = None,
    adp_vals:     Optional[Dict[str, float]] = None,
    jolts_vals:   Optional[Dict[str, float]] = None,
    trend_data:   Optional[Dict[str, int]]   = None,
    # Optional external PMI/COT/crowd data
    pmi_data:     Optional[Dict[str, dict]]  = None,
    cot_data:     Optional[Dict[str, int]]   = None,
    crowd_data:   Optional[Dict[str, int]]   = None,
) -> Dict[str, "FactorScores"]:
    """
    Build full factor matrix.

    Factors with no data source are set to None (not 0), which the frontend
    renders as N/A cells instead of a misleading green/red bar.
    """
    max_rate = max(cb_rates.values()) if cb_rates else None
    min_rate = min(cb_rates.values()) if cb_rates else None

    result: Dict[str, FactorScores] = {}
    for cur in CURRENCIES:
        fs = FactorScores()

        # ── Seasonal (always available) ───────────────────────────────────
        fs.season = SEASONAL[cur][month]

        # ── CB Rates ──────────────────────────────────────────────────────
        if cur in cb_rates and max_rate is not None and min_rate is not None:
            fs.rates = rate_score(cb_rates[cur], max_rate, min_rate)

        # ── GDP ───────────────────────────────────────────────────────────
        if cur in gdp_vals:
            fs.gdp = gdp_score(gdp_vals[cur])

        # ── CPI ───────────────────────────────────────────────────────────
        if cpi_changes and cur in cpi_changes:
            fs.cpi = cpi_score(cpi_changes[cur])

        # ── PPI (FRED) ────────────────────────────────────────────────────
        if ppi_changes and cur in ppi_changes:
            fs.ppi = ppi_score(ppi_changes[cur])

        # ── PCE (FRED, USD only — others get None) ────────────────────────
        if pce_changes and cur in pce_changes:
            fs.pce = pce_score(pce_changes[cur])

        # ── NFP / Employment ──────────────────────────────────────────────
        if nfp_vals and cur in nfp_vals:
            fs.nfp = nfp_score(nfp_vals[cur], cur)

        # ── Unemployment rate ─────────────────────────────────────────────
        if urate_vals and cur in urate_vals:
            fs.urate = urate_score(urate_vals[cur])

        # ── Initial claims (USD only) ─────────────────────────────────────
        if claims_vals and cur in claims_vals:
            fs.claims = claims_score(claims_vals[cur])

        # ── ADP (USD only) ────────────────────────────────────────────────
        if adp_vals and cur in adp_vals:
            fs.adp = adp_score(adp_vals[cur])

        # ── JOLTS (USD only) ──────────────────────────────────────────────
        if jolts_vals and cur in jolts_vals:
            fs.jolts = jolts_score(jolts_vals[cur])

        # ── PMI (Finnhub) ─────────────────────────────────────────────────
        if pmi_data and cur in pmi_data:
            fs.mpmi = pmi_score(pmi_data[cur].get("m", 50.0))
            fs.spmi = pmi_score(pmi_data[cur].get("s", 50.0))

        # ── COT (CFTC) ────────────────────────────────────────────────────
        if cot_data is not None and cur in cot_data:
            fs.cot = cot_data[cur]

        # ── Crowd / retail sentiment (contrarian, MyFXBook) ───────────────
        if crowd_data is not None and cur in crowd_data:
            fs.crowd = crowd_data[cur]

        # ── News sentiment (NewsAPI) ──────────────────────────────────────
        if cur in news_scores:
            fs.news = max(-2, min(2, news_scores[cur]))

        # ── Trend: FX history MA cross (Frankfurter) ──────────────────────
        # trend_data is populated by fetcher._derive_trends_from_history()
        # It replaces the former Alpha Vantage trend_overrides mechanism.
        if trend_data and cur in trend_data:
            fs.trend = trend_data[cur]
        else:
            # Fallback: derive from available hard factors when no FX history yet
            available_hard = [v for v in [fs.rates, fs.gdp, fs.cpi] if v is not None]
            if len(available_hard) >= 2:
                total = sum(available_hard)
                fs.trend = 1 if total > 1 else -1 if total < -1 else 0

        result[cur] = fs

    return result


# ── CMSI aggregation ──────────────────────────────────────────────────────────

def compute_cmsi(
    factor_data: Dict[str, FactorScores],
    weights:     Dict[str, float],
) -> Dict[str, float]:
    """
    Compute CMSI composite score. Only available (non-None) factors contribute.
    Returns a score even with partial data; frontend shows completeness separately.
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
        total_w  = sum(weights.get(f, 1.0) for f, _ in available)
        weighted = sum(v * weights.get(f, 1.0) for f, v in available)
        scores[cur] = round(weighted / total_w * len(available), 2) if total_w else 0.0
    return scores


def get_factor_completeness(factor_data: Dict[str, FactorScores]) -> Dict[str, int]:
    """Return how many of 19 factors are non-None for each currency."""
    return {
        cur: sum(1 for f in FACTORS if getattr(fs, f) is not None)
        for cur, fs in factor_data.items()
    }


def get_bias(score: float, completeness: int = 19) -> str:
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
    factor_data:  Optional[Dict[str, FactorScores]] = None,
) -> list:
    """Generate trading signals. Skip pairs where either currency has < 5 factors."""
    signals = []
    for pair in active_pairs:
        if len(pair) != 6:
            continue
        base, quote = pair[:3], pair[3:]
        if base not in cmsi or quote not in cmsi:
            continue
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
        key_driver = _compute_key_driver(base, quote, factor_data)
        signals.append({
            "pair":        pair,
            "direction":   direction,
            "strength":    strength,
            "diff":        round(diff, 2),
            "base_score":  cmsi.get(base, 0),
            "quote_score": cmsi.get(quote, 0),
            "carry":       carry,
            "entry":       entry,
            "target":      target,
            "stop_loss":   stop_loss,
            "key_driver":  key_driver,
        })
    signals.sort(key=lambda s: abs(s["diff"]), reverse=True)
    return signals


def _compute_key_driver(
    base:        str,
    quote:       str,
    factor_data: Optional[Dict[str, FactorScores]] = None,
) -> str:
    """
    Determine the dominant factor driving a currency pair signal.
    Uses the largest absolute factor delta between base and quote.
    Falls back to static pair-type labels when factor_data is unavailable.
    """
    if factor_data:
        fs_b = factor_data.get(base)
        fs_q = factor_data.get(quote)
        if fs_b and fs_q:
            # Factor label → friendly name mapping
            labels = {
                "rates":  "RATE DIFFERENTIAL",
                "cpi":    "INFLATION DIVERGENCE",
                "ppi":    "PPI DIVERGENCE",
                "pce":    "PCE INFLATION",
                "gdp":    "GROWTH DIVERGENCE",
                "nfp":    "EMPLOYMENT DIVERGENCE",
                "urate":  "UNEMPLOYMENT DIVERGENCE",
                "adp":    "ADP EMPLOYMENT",
                "jolts":  "JOLTS OPENINGS",
                "claims": "JOBLESS CLAIMS",
                "mpmi":   "MANUFACTURING PMI",
                "spmi":   "SERVICES PMI",
                "cot":    "COT POSITIONING",
                "crowd":  "SENTIMENT (CONTRARIAN)",
                "news":   "NEWS SENTIMENT",
                "trend":  "TREND MOMENTUM",
                "season": "SEASONAL PATTERN",
            }
            best_factor = None
            best_delta  = 0.0
            for f, label in labels.items():
                vb = getattr(fs_b, f, None)
                vq = getattr(fs_q, f, None)
                if vb is None or vq is None:
                    continue
                delta = abs(vb - vq)
                if delta > best_delta:
                    best_delta  = delta
                    best_factor = label
            if best_factor:
                return best_factor

    # Static fallback by pair type
    carry_pairs     = {"AUDJPY", "NZDJPY", "CADJPY", "GBPJPY", "EURJPY"}
    inflation_pairs = {"EURUSD", "GBPUSD", "EURGBP", "USDCAD"}
    policy_pairs    = {"USDJPY", "EURCHF", "AUDNZD"}
    pair = base + quote
    if pair in carry_pairs:     return "RATE DIFFERENTIAL"
    if pair in inflation_pairs: return "INFLATION DIVERGENCE"
    if pair in policy_pairs:    return "POLICY DIVERGENCE"
    return "MACRO MOMENTUM"
