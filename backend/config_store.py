import json, os
from pathlib import Path

CONFIG_PATH = Path(__file__).parent.parent / "config.json"

DEFAULTS = {
    "fred_api_key": "",
    "alpha_vantage_key": "",
    "news_api_key": "",
    "signal_threshold": 3.0,
    "min_hold_days": 14,
    "max_hold_days": 90,
    "max_positions": 3,
    "use_news": True,
    "use_cot": True,
    "use_carry_filter": True,
    "use_trend_confirm": True,
    "use_regime_filter": True,
    "active_pairs": [
        "AUDJPY","NZDJPY","USDJPY","EURUSD","GBPUSD",
        "AUDUSD","EURGBP","USDCAD","EURAUD","GBPJPY",
        "AUDNZD","EURJPY","CADJPY","CHFJPY","EURCHF"
    ],
    "factor_weights": {
        "trend": 15, "season": 5, "cot": 10, "crowd": 8,
        "gdp": 12, "mpmi": 8, "spmi": 8, "retail": 7,
        "conf": 5, "cpi": 10, "ppi": 5, "pce": 4,
        "rates": 18, "nfp": 8, "urate": 7, "claims": 4,
        "adp": 4, "jolts": 4, "news": 8
    }
}

def load() -> dict:
    if CONFIG_PATH.exists():
        try:
            with open(CONFIG_PATH) as f:
                data = json.load(f)
            # Merge with defaults to handle new keys
            merged = {**DEFAULTS, **data}
            merged["factor_weights"] = {**DEFAULTS["factor_weights"], **data.get("factor_weights", {})}
            return merged
        except Exception:
            pass
    return dict(DEFAULTS)

def save(cfg: dict):
    with open(CONFIG_PATH, "w") as f:
        json.dump(cfg, f, indent=2)
