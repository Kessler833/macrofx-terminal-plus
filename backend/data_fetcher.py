from __future__ import annotations
import asyncio, logging, time
from datetime import date, timedelta
from typing import Dict, Optional

import httpx

logger = logging.getLogger("macrofx.fetcher")

CURRENCIES    = ["USD", "EUR", "GBP", "JPY", "AUD", "NZD", "CAD", "CHF"]
PAIRS_DEFAULT = [
    "AUDJPY","NZDJPY","USDJPY","EURUSD","GBPUSD",
    "AUDUSD","EURGBP","USDCAD","EURAUD","GBPJPY",
    "AUDNZD","EURJPY","CADJPY","CHFJPY","EURCHF",
]

# These are LABELLED as static so the frontend can show STALE badges.
# They are NEVER silently presented as live data.
# source tag: "static" | "live" | "error" | "no_key"
CB_RATES_STATIC: Dict[str, float] = {
    "USD": 4.375, "EUR": 2.50, "GBP": 4.50, "JPY": 0.50,
    "AUD": 4.10,  "NZD": 3.75, "CAD": 2.75, "CHF": 0.25,
}
CB_META_STATIC = {
    "USD": {"bank": "Federal Reserve",  "stance": "Neutral", "next": "07 May 2026", "change": -0.25},
    "EUR": {"bank": "ECB",              "stance": "Dovish",  "next": "17 Apr 2026", "change": -0.25},
    "GBP": {"bank": "Bank of England",  "stance": "Neutral", "next": "08 May 2026", "change":  0.00},
    "JPY": {"bank": "Bank of Japan",    "stance": "Hawkish", "next": "30 Apr 2026", "change":  0.25},
    "AUD": {"bank": "Reserve Bank AUS", "stance": "Dovish",  "next": "06 May 2026", "change": -0.25},
    "NZD": {"bank": "RBNZ",             "stance": "Dovish",  "next": "28 May 2026", "change": -0.25},
    "CAD": {"bank": "Bank of Canada",   "stance": "Dovish",  "next": "16 Apr 2026", "change": -0.25},
    "CHF": {"bank": "Swiss Nat. Bank",  "stance": "Dovish",  "next": "19 Jun 2026", "change": -0.25},
}
GDP_STATIC: Dict[str, float] = {
    "USD": 2.3, "EUR": 0.9, "GBP": 1.1, "JPY": 0.4,
    "AUD": 1.8, "NZD": 1.2, "CAD": 1.5, "CHF": 1.4,
}


class DataFetcher:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        self._client: Optional[httpx.AsyncClient] = None

        # ── Data caches ──────────────────────────────────────────────────
        # Each cache entry is the actual value (or None if not yet fetched).
        # NEVER pre-populate with static data here — that hides failures.
        self.fx_rates:    Dict[str, float] = {}
        self.fx_history:  Dict[str, Dict[str, float]] = {}
        self.cb_rates:    Dict[str, float] = {}   # empty until first live fetch
        self.cb_meta:     dict = {}                # empty until first live fetch
        self.gdp_vals:    Dict[str, float] = {}   # empty until first live fetch
        self.cpi_changes: Dict[str, float] = {}
        self.news_scores: Dict[str, int]   = {}

        # ── Source tagging ───────────────────────────────────────────────
        # Tracks where each data group last came from.
        # Possible values: "live" | "static" | "error" | "no_key" | "pending"
        self.data_sources: Dict[str, str] = {
            "cb_rates": "pending",
            "gdp":      "pending",
            "cpi":      "pending",
            "fx":       "pending",
            "news":     "pending",
            "av":       "pending",
        }

        # ── API status (shown in Config dots) ────────────────────────────
        self.api_status: Dict[str, str] = {
            "fx": "pending", "fred": "pending",
            "worldbank": "pending", "news": "pending", "av": "pending",
        }

        # ── Staleness timestamps ─────────────────────────────────────────
        # Unix timestamp of when each group was last successfully fetched.
        # 0 = never fetched live.
        self.fetch_ts: Dict[str, float] = {
            "cb_rates": 0, "gdp": 0, "cpi": 0,
            "fx": 0, "news": 0, "av": 0,
        }

    @property
    def client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=12.0, follow_redirects=True)
        return self._client

    async def close(self):
        if self._client and not self._client.is_closed:
            await self._client.aclose()

    def _cb_rates_effective(self) -> Dict[str, float]:
        """Return live cb_rates if available, else static fallback (marked as static)."""
        if self.cb_rates:
            return self.cb_rates
        return CB_RATES_STATIC

    def _cb_meta_effective(self) -> dict:
        if self.cb_meta:
            return self.cb_meta
        return {k: dict(v) for k, v in CB_META_STATIC.items()}

    def _gdp_effective(self) -> Dict[str, float]:
        if self.gdp_vals:
            return self.gdp_vals
        return GDP_STATIC

    def get_data_provenance(self) -> Dict[str, dict]:
        """Return provenance info for every data group: source + age_seconds."""
        now = time.time()
        result = {}
        for key, src in self.data_sources.items():
            ts = self.fetch_ts.get(key, 0)
            result[key] = {
                "source": src,
                "age_s": int(now - ts) if ts > 0 else None,
            }
        return result

    # ── FX Rates (no auth needed — frankfurter.app is free) ──────────────
    async def fetch_fx_rates(self) -> bool:
        urls = [
            "https://api.frankfurter.app/latest?base=USD",
            "https://open.er-api.com/v6/latest/USD",
        ]
        for url in urls:
            try:
                r = await self.client.get(url)
                r.raise_for_status()
                data  = r.json()
                rates = data.get("rates") or data.get("conversion_rates", {})
                if not rates:
                    continue
                new_rates: Dict[str, float] = {}
                pairs = [
                    "AUDJPY","NZDJPY","USDJPY","EURUSD","GBPUSD",
                    "AUDUSD","EURGBP","USDCAD","EURAUD","GBPJPY",
                    "AUDNZD","EURJPY","CADJPY","CHFJPY","EURCHF",
                ]
                for pair in pairs:
                    b, q = pair[:3], pair[3:]
                    rb = 1.0 if b == "USD" else rates.get(b)
                    rq = 1.0 if q == "USD" else rates.get(q)
                    if rb and rq:
                        new_rates[pair] = round(rq / rb, 5)
                if new_rates:
                    self.fx_rates = new_rates
                    self.api_status["fx"]    = "ok"
                    self.data_sources["fx"]  = "live"
                    self.fetch_ts["fx"]      = time.time()
                    return True
            except Exception as e:
                logger.warning(f"[FX] {url}: {e}")
        # Both failed — do NOT fall back to made-up rates
        self.api_status["fx"]   = "error"
        self.data_sources["fx"] = "error"
        return False

    # ── FX History (for correlation matrix) ──────────────────────────────
    async def fetch_fx_history(self) -> bool:
        end   = date.today()
        start = end - timedelta(days=92)
        url   = (f"https://api.frankfurter.app/{start}..{end}"
                 f"?base=USD&symbols=EUR,GBP,JPY,AUD,NZD,CAD,CHF")
        try:
            r = await self.client.get(url)
            r.raise_for_status()
            data = r.json().get("rates", {})
            if data:
                self.fx_history = data
                return True
        except Exception as e:
            logger.warning(f"[FX history] {e}")
        return False

    # ── ECB Deposit Rate (free, no key) ──────────────────────────────────
    async def fetch_ecb_rate(self) -> bool:
        url = ("https://data-api.ecb.europa.eu/service/data/FM/"
               "B.U2.EUR.4F.KR.DFR.LEV?lastNObservations=2&format=json")
        try:
            r = await self.client.get(url)
            r.raise_for_status()
            obs = (r.json().get("dataSets", [{}])[0]
                   .get("series", {})
                   .get("0:0:0:0:0:0:0", {})
                   .get("observations", {}))
            if obs:
                latest_key = max(obs.keys(), key=int)
                val = float(obs[latest_key][0])
                if "EUR" not in self.cb_rates:
                    self.cb_rates["EUR"] = val
                else:
                    self.cb_rates["EUR"] = val
                if "EUR" not in self.cb_meta:
                    self.cb_meta["EUR"] = dict(CB_META_STATIC["EUR"])
                self.cb_meta["EUR"]["rate"]   = val
                self.cb_meta["EUR"]["stance"] = (
                    "Hawkish" if val > 2.5 else "Dovish" if val < 1.5 else "Neutral"
                )
                self.data_sources["cb_rates"] = "live"
                self.fetch_ts["cb_rates"]      = time.time()
                return True
        except Exception as e:
            logger.warning(f"[ECB] {e}")
        return False

    # ── World Bank GDP (free, no key) ─────────────────────────────────────
    async def fetch_gdp(self) -> bool:
        wb_map = {
            "EUR": "EMU", "GBP": "GBR", "JPY": "JPN",
            "AUD": "AUS", "NZD": "NZL", "CAD": "CAN", "CHF": "CHE",
        }
        ok = False

        async def _fetch_one(cur: str, iso: str):
            nonlocal ok
            url = (f"https://api.worldbank.org/v2/country/{iso}/"
                   f"indicator/NY.GDP.MKTP.KD.ZG?format=json&mrv=4&per_page=4")
            try:
                r = await self.client.get(url)
                r.raise_for_status()
                obs = [x for x in (r.json()[1] or []) if x.get("value") is not None]
                if obs:
                    self.gdp_vals[cur] = round(obs[0]["value"], 2)
                    ok = True
            except Exception as e:
                logger.warning(f"[WB GDP {cur}] {e}")

        await asyncio.gather(*[_fetch_one(c, i) for c, i in wb_map.items()])
        if ok:
            self.api_status["worldbank"]  = "ok"
            self.data_sources["gdp"]      = "live"
            self.fetch_ts["gdp"]          = time.time()
        else:
            self.api_status["worldbank"]  = "error"
            self.data_sources["gdp"]      = self.data_sources.get("gdp") or "error"
        return ok

    # ── FRED (requires key) ───────────────────────────────────────────────
    async def fetch_fred(self) -> bool:
        key = self.cfg.get("fred_api_key", "").strip()
        if not key:
            self.api_status["fred"] = "no_key"
            self.data_sources["cpi"] = "no_key"
            return False
        base = "https://api.stlouisfed.org/fred/series/observations"

        async def _series(series_id: str):
            url = (f"{base}?series_id={series_id}&api_key={key}"
                   f"&file_type=json&limit=3&sort_order=desc")
            try:
                r = await self.client.get(url)
                r.raise_for_status()
                obs = [o for o in r.json().get("observations", []) if o["value"] != "."]
                return {"cur": float(obs[0]["value"]), "prev": float(obs[1]["value"])} if len(obs) >= 2 else None
            except Exception as e:
                logger.warning(f"[FRED {series_id}] {e}")
                return None

        tasks_def = [
            ("CPIAUCSL",          "usd_cpi"),
            ("FEDFUNDS",          "fed_funds"),
            ("A191RL1Q225SBEA",   "usd_gdp"),
        ]
        results = await asyncio.gather(*[_series(s) for s, _ in tasks_def])
        ok = False
        for (sid, key_name), res in zip(tasks_def, results):
            if res is None:
                continue
            ok = True
            change = res["cur"] - res["prev"]
            if key_name == "usd_cpi":
                self.cpi_changes["USD"] = round(change, 3)
                self.data_sources["cpi"] = "live"
                self.fetch_ts["cpi"]     = time.time()
            elif key_name == "fed_funds":
                self.cb_rates["USD"] = round(res["cur"], 3)
                if "USD" not in self.cb_meta:
                    self.cb_meta["USD"] = dict(CB_META_STATIC["USD"])
                self.data_sources["cb_rates"] = "live"
                self.fetch_ts["cb_rates"]      = time.time()
            elif key_name == "usd_gdp":
                self.gdp_vals["USD"] = round(res["cur"], 2)
                self.data_sources["gdp"] = "live"

        self.api_status["fred"] = "ok" if ok else "error"
        return ok

    # ── News sentiment (requires NewsAPI key) ─────────────────────────────
    async def fetch_news_sentiment(self) -> bool:
        key = self.cfg.get("news_api_key", "").strip()
        if not key:
            self.api_status["news"]    = "no_key"
            self.data_sources["news"]  = "no_key"
            return False
        queries = {
            "USD": "US dollar Federal Reserve interest rates",
            "EUR": "Euro ECB eurozone economy",
            "GBP": "British pound Bank of England UK",
            "JPY": "Japanese yen Bank of Japan policy",
            "AUD": "Australian dollar RBA economy",
            "NZD": "New Zealand dollar RBNZ",
            "CAD": "Canadian dollar Bank of Canada oil",
            "CHF": "Swiss franc SNB safe haven",
        }
        POS = {"surge","rise","strong","growth","beat","bullish","hawkish","gain","high","positive","increase","expand","rally","jump"}
        NEG = {"fall","drop","weak","recession","miss","bearish","dovish","loss","cut","decline","contract","concern","slump","slide"}
        ok = False
        for cur, q in queries.items():
            url = (f"https://newsapi.org/v2/everything?q={q}"
                   f"&language=en&pageSize=10&sortBy=publishedAt&apiKey={key}")
            try:
                r = await self.client.get(url)
                r.raise_for_status()
                data = r.json()
                if data.get("status") != "ok":
                    continue
                score = 0
                for art in data.get("articles", []):
                    text = ((art.get("title") or "") + " " + (art.get("description") or "")).lower()
                    for w in POS:
                        if w in text: score += 1
                    for w in NEG:
                        if w in text: score -= 1
                self.news_scores[cur] = max(-2, min(2, round(score / 3)))
                ok = True
                await asyncio.sleep(0.15)
            except Exception as e:
                logger.warning(f"[NEWS {cur}] {e}")
        if ok:
            self.api_status["news"]    = "ok"
            self.data_sources["news"]  = "live"
            self.fetch_ts["news"]      = time.time()
        else:
            self.api_status["news"]    = "error"
            self.data_sources["news"]  = "error"
        return ok

    # ── Alpha Vantage trend (requires AV key) ─────────────────────────────
    async def fetch_av_trends(self, trend_overrides: dict) -> bool:
        key = self.cfg.get("alpha_vantage_key", "").strip()
        if not key:
            self.api_status["av"]    = "no_key"
            self.data_sources["av"] = "no_key"
            return False
        targets = ["EUR","GBP","JPY","AUD","NZD","CAD","CHF"]
        ok = False
        for cur in targets:
            url = (f"https://www.alphavantage.co/query?function=FX_WEEKLY"
                   f"&from_symbol={cur}&to_symbol=USD&apikey={key}")
            try:
                r = await self.client.get(url)
                r.raise_for_status()
                data = r.json()
                if "Note" in data or "Information" in data:
                    logger.warning("[AV] Rate limit hit")
                    break
                series = data.get("Weekly Time Series Forex (FX)", {})
                if not series:
                    continue
                dates  = sorted(series.keys(), reverse=True)
                if len(dates) < 20:
                    continue
                price  = float(series[dates[0]]["4. close"])
                ma8    = sum(float(series[d]["4. close"]) for d in dates[:8])  / 8
                ma20   = sum(float(series[d]["4. close"]) for d in dates[:20]) / 20
                trend_overrides[cur] = (
                    2 if price > ma8 > ma20  else
                    1 if price > ma8         else
                   -2 if price < ma8 < ma20  else -1
                )
                ok = True
                await asyncio.sleep(1.2)
            except Exception as e:
                logger.warning(f"[AV {cur}] {e}")
        if ok:
            self.api_status["av"]    = "ok"
            self.data_sources["av"] = "live"
            self.fetch_ts["av"]     = time.time()
        else:
            self.api_status["av"]    = "error"
            self.data_sources["av"] = "error"
        return ok

    # ── Correlation matrix ────────────────────────────────────────────────
    def compute_correlation_matrix(self) -> Dict[str, Dict[str, float]]:
        import math
        curs  = ["USD","EUR","GBP","JPY","AUD","NZD","CAD","CHF"]
        dates = sorted(self.fx_history.keys())
        series: Dict[str, list] = {}
        for cur in curs:
            if cur == "USD":
                series["USD"] = [0.0] * max(0, len(dates) - 1)
                continue
            prices = [self.fx_history[d].get(cur) for d in dates if self.fx_history[d].get(cur)]
            if len(prices) < 5:
                series[cur] = []
                continue
            series[cur] = [math.log(prices[i] / prices[i-1]) for i in range(1, len(prices))]

        def pearson(a: list, b: list) -> float:
            n = min(len(a), len(b))
            if n < 3: return 0.0
            a, b = a[:n], b[:n]
            ma = sum(a) / n
            mb = sum(b) / n
            num = sum((a[i]-ma)*(b[i]-mb) for i in range(n))
            da  = math.sqrt(sum((v-ma)**2 for v in a)) or 1e-10
            db  = math.sqrt(sum((v-mb)**2 for v in b)) or 1e-10
            return round(num / (da * db), 3)

        matrix: Dict[str, Dict[str, float]] = {}
        for a in curs:
            matrix[a] = {}
            for b in curs:
                matrix[a][b] = 1.0 if a == b else pearson(series.get(a,[]), series.get(b,[]))
        return matrix

    # ── Full refresh cycle ────────────────────────────────────────────────
    async def refresh_all(self, trend_overrides: dict) -> None:
        await asyncio.gather(
            self.fetch_fx_rates(),
            self.fetch_ecb_rate(),
            self.fetch_gdp(),
            return_exceptions=True
        )
        await asyncio.gather(
            self.fetch_fred(),
            self.fetch_news_sentiment(),
            self.fetch_av_trends(trend_overrides),
            return_exceptions=True
        )
        await self.fetch_fx_history()
