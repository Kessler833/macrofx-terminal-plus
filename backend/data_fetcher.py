from __future__ import annotations
import asyncio, logging
from datetime import date, timedelta
from typing import Dict, Optional

import httpx

logger = logging.getLogger("macrofx.fetcher")

CURRENCIES   = ["USD", "EUR", "GBP", "JPY", "AUD", "NZD", "CAD", "CHF"]
PAIRS_DEFAULT = [
    "AUDJPY","NZDJPY","USDJPY","EURUSD","GBPUSD",
    "AUDUSD","EURGBP","USDCAD","EURAUD","GBPJPY",
    "AUDNZD","EURJPY","CADJPY","CHFJPY","EURCHF",
]

CB_RATES_STATIC: Dict[str, float] = {
    "USD": 4.375, "EUR": 2.50, "GBP": 4.50, "JPY": 0.50,
    "AUD": 4.10,  "NZD": 3.75, "CAD": 2.75, "CHF": 0.25,
}
CB_META_STATIC = {
    "USD": {"bank": "Federal Reserve",    "stance": "Neutral", "next": "07 May 2026", "change": -0.25},
    "EUR": {"bank": "ECB",                "stance": "Dovish",  "next": "17 Apr 2026", "change": -0.25},
    "GBP": {"bank": "Bank of England",    "stance": "Neutral", "next": "08 May 2026", "change":  0.00},
    "JPY": {"bank": "Bank of Japan",      "stance": "Hawkish", "next": "30 Apr 2026", "change":  0.25},
    "AUD": {"bank": "Reserve Bank AUS",   "stance": "Dovish",  "next": "06 May 2026", "change": -0.25},
    "NZD": {"bank": "RBNZ",               "stance": "Dovish",  "next": "28 May 2026", "change": -0.25},
    "CAD": {"bank": "Bank of Canada",     "stance": "Dovish",  "next": "16 Apr 2026", "change": -0.25},
    "CHF": {"bank": "Swiss Nat. Bank",    "stance": "Dovish",  "next": "19 Jun 2026", "change": -0.25},
}

GDP_STATIC: Dict[str, float] = {
    "USD": 2.3, "EUR": 0.9, "GBP": 1.1, "JPY": 0.4,
    "AUD": 1.8, "NZD": 1.2, "CAD": 1.5, "CHF": 1.4,
}


class DataFetcher:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        self._client: Optional[httpx.AsyncClient] = None
        # Cache
        self.fx_rates:    Dict[str, float] = {}
        self.fx_history:  Dict[str, Dict[str, float]] = {}
        self.cb_rates:    Dict[str, float] = dict(CB_RATES_STATIC)
        self.cb_meta:     dict = {k: dict(v) for k, v in CB_META_STATIC.items()}
        self.gdp_vals:    Dict[str, float] = dict(GDP_STATIC)
        self.cpi_changes: Dict[str, float] = {}
        self.news_scores: Dict[str, int]   = {}
        self.api_status:  Dict[str, str]   = {
            "fx": "unknown", "fred": "unknown",
            "worldbank": "unknown", "news": "unknown", "av": "unknown"
        }

    @property
    def client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=12.0, follow_redirects=True)
        return self._client

    async def close(self):
        if self._client and not self._client.is_closed:
            await self._client.aclose()

    # ── FX Rates ─────────────────────────────────────────────────────────
    async def fetch_fx_rates(self) -> bool:
        urls = [
            "https://api.frankfurter.app/latest?base=USD",
            "https://open.er-api.com/v6/latest/USD",
        ]
        for url in urls:
            try:
                r = await self.client.get(url)
                r.raise_for_status()
                data = r.json()
                rates = data.get("rates") or data.get("conversion_rates", {})
                if not rates:
                    continue
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
                        self.fx_rates[pair] = round(rq / rb, 5)
                self.api_status["fx"] = "ok"
                return True
            except Exception as e:
                logger.warning(f"[FX] {url}: {e}")
        self.api_status["fx"] = "error"
        # Use stale data if available, else compute from CB rates proxy
        return bool(self.fx_rates)

    # ── FX History (for correlation matrix) ──────────────────────────────
    async def fetch_fx_history(self) -> bool:
        end   = date.today()
        start = end - timedelta(days=92)
        url   = (f"https://api.frankfurter.app/{start}..{end}"
                 f"?base=USD&symbols=EUR,GBP,JPY,AUD,NZD,CAD,CHF")
        try:
            r = await self.client.get(url)
            r.raise_for_status()
            self.fx_history = r.json().get("rates", {})
            return True
        except Exception as e:
            logger.warning(f"[FX history] {e}")
            return False

    # ── ECB Deposit Rate ──────────────────────────────────────────────────
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
                self.cb_rates["EUR"] = val
                self.cb_meta["EUR"]["stance"] = (
                    "Hawkish" if val > 2.5 else "Dovish" if val < 1.5 else "Neutral"
                )
            return True
        except Exception as e:
            logger.warning(f"[ECB] {e}")
            return False

    # ── World Bank GDP ────────────────────────────────────────────────────
    async def fetch_gdp(self) -> bool:
        wb_map = {
            "EUR": "EMU", "GBP": "GBR", "JPY": "JPN",
            "AUD": "AUS", "NZD": "NZL", "CAD": "CAN", "CHF": "CHE",
        }
        ok = False
        tasks = []
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
        self.api_status["worldbank"] = "ok" if ok else "error"
        return ok

    # ── FRED ─────────────────────────────────────────────────────────────
    async def fetch_fred(self) -> bool:
        key = self.cfg.get("fred_api_key", "").strip()
        if not key:
            self.api_status["fred"] = "no_key"
            return False
        base = "https://api.stlouisfed.org/fred/series/observations"

        async def _series(series_id: str):
            url = (f"{base}?series_id={series_id}&api_key={key}"
                   f"&file_type=json&limit=3&sort_order=desc")
            try:
                r = await self.client.get(url)
                r.raise_for_status()
                obs = [o for o in r.json().get("observations", []) if o["value"] != "."]
                if len(obs) < 2:
                    return None
                return {"cur": float(obs[0]["value"]), "prev": float(obs[1]["value"])}
            except Exception as e:
                logger.warning(f"[FRED {series_id}] {e}")
                return None

        tasks_def = [
            ("CPIAUCSL", "usd_cpi"),
            ("FEDFUNDS", "fed_funds"),
            ("A191RL1Q225SBEA", "usd_gdp"),
        ]
        results = await asyncio.gather(*[_series(s) for s, _ in tasks_def])
        ok = False
        for (_, key_name), res in zip(tasks_def, results):
            if res is None:
                continue
            ok = True
            change = res["cur"] - res["prev"]
            if key_name == "usd_cpi":
                self.cpi_changes["USD"] = round(change, 3)
            elif key_name == "fed_funds":
                self.cb_rates["USD"] = round(res["cur"], 3)
            elif key_name == "usd_gdp":
                self.gdp_vals["USD"] = round(res["cur"], 2)

        self.api_status["fred"] = "ok" if ok else "error"
        return ok

    # ── News Sentiment ────────────────────────────────────────────────────
    async def fetch_news_sentiment(self) -> bool:
        key = self.cfg.get("news_api_key", "").strip()
        if not key:
            self.api_status["news"] = "no_key"
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
        self.api_status["news"] = "ok" if ok else "error"
        return ok

    # ── Alpha Vantage (trend) ─────────────────────────────────────────────
    async def fetch_av_trends(self, trend_overrides: dict) -> bool:
        """Update trend_overrides dict in-place."""
        key = self.cfg.get("alpha_vantage_key", "").strip()
        if not key:
            self.api_status["av"] = "no_key"
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
                if "Note" in data:
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
                trend  = (2 if price > ma8 > ma20
                          else 1 if price > ma8
                          else -2 if price < ma8 < ma20
                          else -1)
                trend_overrides[cur] = trend
                ok = True
                await asyncio.sleep(1.2)
            except Exception as e:
                logger.warning(f"[AV {cur}] {e}")
        self.api_status["av"] = "ok" if ok else "error"
        return ok

    # ── Compute correlation matrix ────────────────────────────────────────
    def compute_correlation_matrix(self) -> Dict[str, Dict[str, float]]:
        import math
        curs = ["USD","EUR","GBP","JPY","AUD","NZD","CAD","CHF"]
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
        """Run all fetches in parallel where possible."""
        await asyncio.gather(
            self.fetch_fx_rates(),
            self.fetch_ecb_rate(),
            self.fetch_gdp(),
            return_exceptions=True
        )
        # Slower/keyed fetches
        await asyncio.gather(
            self.fetch_fred(),
            self.fetch_news_sentiment(),
            self.fetch_av_trends(trend_overrides),
            return_exceptions=True
        )
        # History after rates (used in correlation)
        await self.fetch_fx_history()
