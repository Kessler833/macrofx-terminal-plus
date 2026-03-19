from __future__ import annotations
import asyncio, logging, time
from datetime import date, timedelta
from typing import Dict, Optional, Any

import httpx

logger = logging.getLogger("macrofx.fetcher")

CURRENCIES    = ["USD", "EUR", "GBP", "JPY", "AUD", "NZD", "CAD", "CHF"]
PAIRS_DEFAULT = [
    "AUDJPY","NZDJPY","USDJPY","EURUSD","GBPUSD",
    "AUDUSD","EURGBP","USDCAD","EURAUD","GBPJPY",
    "AUDNZD","EURJPY","CADJPY","CHFJPY","EURCHF",
]

# ── FRED series IDs per currency ──────────────────────────────────────────────
# CPI series: MoM change in consumer prices (or closest available)
# Rate series: overnight/policy rate
FRED_CPI_SERIES: Dict[str, str] = {
    "USD": "CPIAUCSL",      # US CPI All Urban Consumers
    "EUR": "CP0000EZ19M086NEST",  # Euro area HICP
    "GBP": "GBRCPIALLMINMEI",    # UK CPI all items
    "JPY": "JPNCPIALLMINMEI",    # Japan CPI all items
    "AUD": "AUSCPIALLQINMEI",    # Australia CPI (quarterly — FRED best available)
    "NZD": "NZLCPIALLQINMEI",    # New Zealand CPI (quarterly)
    "CAD": "CPALCY01CAM661N",    # Canada CPI
    "CHF": "CHECPIALLMINMEI",    # Switzerland CPI
}

FRED_RATE_SERIES: Dict[str, str] = {
    "USD": "FEDFUNDS",           # US Federal Funds Rate
    "GBP": "IUDSOIA",           # Bank Rate (BoE) — FRED code
    "JPY": "IRSTCB01JPM156N",   # Japan call rate / BoJ policy
    "AUD": "IRSTCB01AUM156N",   # RBA cash rate
    "NZD": "IRSTCB01NZM156N",   # RBNZ OCR
    "CAD": "IRSTCB01CAM156N",   # BoC overnight rate
    "CHF": "IRSTCB01CHM156N",   # SNB policy rate
    # EUR is fetched directly from ECB — not FRED
}

# Bank labels and hawkish/dovish thresholds
CB_META_STATIC: Dict[str, dict] = {
    "USD": {"bank": "Federal Reserve",  "hawk_above": 4.0,  "dove_below": 2.0},
    "EUR": {"bank": "ECB",              "hawk_above": 2.5,  "dove_below": 1.5},
    "GBP": {"bank": "Bank of England",  "hawk_above": 4.0,  "dove_below": 2.0},
    "JPY": {"bank": "Bank of Japan",    "hawk_above": 0.5,  "dove_below": 0.0},
    "AUD": {"bank": "RBA",              "hawk_above": 3.5,  "dove_below": 2.0},
    "NZD": {"bank": "RBNZ",             "hawk_above": 3.5,  "dove_below": 2.0},
    "CAD": {"bank": "Bank of Canada",   "hawk_above": 3.5,  "dove_below": 2.0},
    "CHF": {"bank": "SNB",              "hawk_above": 1.0,  "dove_below": 0.0},
}


class DataFetcher:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        self._client: Optional[httpx.AsyncClient] = None

        self.fx_rates:    Dict[str, float] = {}
        self.fx_history:  Dict[str, Dict[str, float]] = {}
        self.cb_rates:    Dict[str, float] = {}
        self.cb_meta:     dict = {}
        self.gdp_vals:    Dict[str, float] = {}
        self.cpi_changes: Dict[str, float] = {}
        self.news_scores: Dict[str, int]   = {}

        self.data_sources: Dict[str, str] = {
            "cb_rates": "pending",
            "gdp":      "pending",
            "cpi":      "pending",
            "fx":       "pending",
            "news":     "pending",
            "av":       "pending",
        }

        self.api_status: Dict[str, str] = {
            "fx":        "pending",
            "fred":      "pending",
            "worldbank": "pending",
            "news":      "pending",
            "av":        "pending",
            "ecb":       "pending",
        }

        self.api_errors: Dict[str, Any] = {}

        self.fetch_ts: Dict[str, float] = {
            "cb_rates": 0, "gdp": 0, "cpi": 0,
            "fx": 0, "news": 0, "av": 0,
        }

    @property
    def client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=20.0, follow_redirects=True)
        return self._client

    async def close(self):
        if self._client and not self._client.is_closed:
            await self._client.aclose()

    def _record_error(self, group: str, exc: Exception, http_code: Optional[int] = None):
        msg = str(exc)
        if http_code == 429:
            etype = "RATE_LIMIT"
        elif http_code and http_code >= 400:
            etype = "HTTP_ERROR"
        elif isinstance(exc, httpx.TimeoutException):
            etype = "TIMEOUT"
        elif isinstance(exc, httpx.NetworkError):
            etype = "NETWORK"
        elif "parse" in msg.lower() or isinstance(exc, (KeyError, IndexError, ValueError)):
            etype = "PARSE_ERROR"
        else:
            etype = "NETWORK"
        self.api_errors[group] = {
            "error":      msg[:200],
            "error_type": etype,
            "http_code":  http_code,
            "ts":         int(time.time()),
        }
        logger.warning("[%s] %s: %s", group, etype, msg[:120])

    def get_data_provenance(self) -> Dict[str, dict]:
        now = time.time()
        result = {}
        for key, src in self.data_sources.items():
            ts  = self.fetch_ts.get(key, 0)
            err = self.api_errors.get(key)
            result[key] = {
                "source": src,
                "age_s":  int(now - ts) if ts > 0 else None,
                "error":  err,
            }
        return result

    # ── FX Rates ──────────────────────────────────────────────────────────
    async def fetch_fx_rates(self) -> bool:
        urls = [
            "https://api.frankfurter.app/latest?base=USD",
            "https://open.er-api.com/v6/latest/USD",
        ]
        last_exc: Optional[Exception] = None
        last_code: Optional[int] = None
        for url in urls:
            try:
                r = await self.client.get(url)
                last_code = r.status_code
                r.raise_for_status()
                data  = r.json()
                rates = data.get("rates") or data.get("conversion_rates", {})
                if not rates:
                    raise ValueError("Empty rates object")
                new_rates: Dict[str, float] = {}
                for pair in PAIRS_DEFAULT:
                    b, q = pair[:3], pair[3:]
                    rb = 1.0 if b == "USD" else rates.get(b)
                    rq = 1.0 if q == "USD" else rates.get(q)
                    if rb and rq:
                        new_rates[pair] = round(rq / rb, 5)
                if not new_rates:
                    raise ValueError("No valid pairs computed")
                self.fx_rates            = new_rates
                self.api_status["fx"]    = "ok"
                self.data_sources["fx"]  = "live"
                self.fetch_ts["fx"]      = time.time()
                self.api_errors.pop("fx", None)
                return True
            except Exception as e:
                last_exc  = e
                last_code = getattr(getattr(e, 'response', None), 'status_code', None)
        self.api_status["fx"]   = "error"
        self.data_sources["fx"] = "error"
        if last_exc:
            self._record_error("fx", last_exc, last_code)
        return False

    # ── FX History ────────────────────────────────────────────────────────
    async def fetch_fx_history(self) -> bool:
        end   = date.today()
        start = end - timedelta(days=92)
        url   = (f"https://api.frankfurter.app/{start}..{end}"
                 f"?base=USD&symbols=EUR,GBP,JPY,AUD,NZD,CAD,CHF")
        try:
            r = await self.client.get(url)
            r.raise_for_status()
            data = r.json().get("rates", {})
            if not data:
                raise ValueError("Empty history")
            self.fx_history = data
            return True
        except Exception as e:
            self._record_error("fx_history", e,
                getattr(getattr(e, 'response', None), 'status_code', None))
            return False

    # ── ECB Deposit Rate (free, no key) ───────────────────────────────────
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
            if not obs:
                raise ValueError("ECB: empty observations")
            latest_key = max(obs.keys(), key=int)
            val = float(obs[latest_key][0])
            self._store_cb_rate("EUR", val)
            self.api_status["ecb"]       = "ok"
            self.data_sources["cb_rates"] = "live"
            self.fetch_ts["cb_rates"]     = time.time()
            self.api_errors.pop("cb_rates", None)
            return True
        except Exception as e:
            self.api_status["ecb"] = "error"
            self._record_error("cb_rates", e,
                getattr(getattr(e, 'response', None), 'status_code', None))
            return False

    def _store_cb_rate(self, cur: str, val: float) -> None:
        """Store a CB rate and update meta."""
        self.cb_rates[cur] = round(val, 3)
        meta = CB_META_STATIC.get(cur, {})
        self.cb_meta[cur] = {
            "bank":   meta.get("bank", cur),
            "rate":   round(val, 3),
            "stance": ("Hawkish" if val > meta.get("hawk_above", 3.0)
                       else "Dovish" if val < meta.get("dove_below", 1.0)
                       else "Neutral"),
            "next":   "—",
            "change": 0,
        }

    # ── World Bank GDP ────────────────────────────────────────────────────
    async def fetch_gdp(self) -> bool:
        wb_map = {
            "EUR": "EMU", "GBP": "GBR", "JPY": "JPN",
            "AUD": "AUS", "NZD": "NZL", "CAD": "CAN", "CHF": "CHE",
        }
        ok     = False
        errors: list = []

        async def _fetch_one(cur: str, iso: str):
            nonlocal ok
            url = (f"https://api.worldbank.org/v2/country/{iso}/"
                   f"indicator/NY.GDP.MKTP.KD.ZG?format=json&mrv=4&per_page=4")
            try:
                r = await self.client.get(url)
                r.raise_for_status()
                payload = r.json()
                if not payload or len(payload) < 2:
                    raise ValueError(f"WB GDP {cur}: malformed")
                obs = [x for x in (payload[1] or []) if x.get("value") is not None]
                if not obs:
                    raise ValueError(f"WB GDP {cur}: no data")
                self.gdp_vals[cur] = round(obs[0]["value"], 2)
                ok = True
            except Exception as e:
                code = getattr(getattr(e, 'response', None), 'status_code', None)
                errors.append(f"{cur}:{code or str(e)[:40]}")

        await asyncio.gather(*[_fetch_one(c, i) for c, i in wb_map.items()])
        if ok:
            self.api_status["worldbank"] = "ok"
            self.data_sources["gdp"]     = "live"
            self.fetch_ts["gdp"]         = time.time()
            self.api_errors.pop("gdp", None)
        else:
            self.api_status["worldbank"] = "error"
            self.data_sources["gdp"]     = "error"
            self.api_errors["gdp"] = {
                "error":      "All WB GDP requests failed: " + ", ".join(errors),
                "error_type": "HTTP_ERROR",
                "http_code":  None,
                "ts":         int(time.time()),
            }
        return ok

    # ── FRED: CPI + CB rates for all currencies ───────────────────────────
    async def fetch_fred(self) -> bool:
        key = self.cfg.get("fred_api_key", "").strip()
        if not key:
            self.api_status["fred"]  = "no_key"
            self.data_sources["cpi"] = "no_key"
            self.api_errors["cpi"] = {
                "error":      "No FRED API key configured",
                "error_type": "NO_KEY",
                "http_code":  None,
                "ts":         int(time.time()),
            }
            return False

        base_url = "https://api.stlouisfed.org/fred/series/observations"

        async def _series(series_id: str, label: str):
            url = (f"{base_url}?series_id={series_id}&api_key={key}"
                   f"&file_type=json&limit=4&sort_order=desc")
            try:
                r = await self.client.get(url)
                if r.status_code == 429:
                    raise httpx.HTTPStatusError("FRED rate limit",
                        request=r.request, response=r)
                r.raise_for_status()
                obs = [o for o in r.json().get("observations", [])
                       if o.get("value", ".") != "."]
                if len(obs) < 2:
                    raise ValueError(
                        f"FRED {series_id}: only {len(obs)} obs (need 2)")
                return {
                    "cur":  float(obs[0]["value"]),
                    "prev": float(obs[1]["value"]),
                }
            except Exception as e:
                code = getattr(getattr(e, 'response', None), 'status_code', None)
                logger.warning("[FRED %s/%s] %s", label, series_id, e)
                return None

        # Build task list: (currency, type, series_id)
        tasks: list[tuple[str, str, str]] = []
        for cur, sid in FRED_CPI_SERIES.items():
            tasks.append((cur, "cpi", sid))
        for cur, sid in FRED_RATE_SERIES.items():
            tasks.append((cur, "rate", sid))
        # Also fetch USD GDP from FRED
        tasks.append(("USD", "gdp", "A191RL1Q225SBEA"))

        results = await asyncio.gather(
            *[_series(sid, f"{cur}/{typ}") for cur, typ, sid in tasks]
        )

        any_ok   = False
        cpi_ok   = False
        rates_ok = False

        for (cur, typ, sid), res in zip(tasks, results):
            if res is None:
                continue
            any_ok = True
            change = res["cur"] - res["prev"]

            if typ == "cpi":
                self.cpi_changes[cur] = round(change, 4)
                cpi_ok = True

            elif typ == "rate":
                self._store_cb_rate(cur, res["cur"])
                # Patch change into meta
                if cur in self.cb_meta:
                    self.cb_meta[cur]["change"] = round(change, 3)
                rates_ok = True

            elif typ == "gdp" and cur == "USD":
                self.gdp_vals["USD"] = round(res["cur"], 2)

        self.api_status["fred"] = "ok" if any_ok else "error"

        if cpi_ok:
            self.data_sources["cpi"] = "live"
            self.fetch_ts["cpi"]     = time.time()
            self.api_errors.pop("cpi", None)
        else:
            self.data_sources["cpi"] = "error"
            self.api_errors["cpi"] = {
                "error":      "FRED CPI fetch failed for all currencies",
                "error_type": "HTTP_ERROR",
                "http_code":  None,
                "ts":         int(time.time()),
            }

        if rates_ok:
            self.data_sources["cb_rates"] = "live"
            self.fetch_ts["cb_rates"]      = time.time()
            self.api_errors.pop("cb_rates", None)

        if not any_ok:
            self.api_errors["cpi"] = {
                "error":      "FRED returned no usable data (check key validity)",
                "error_type": "HTTP_ERROR",
                "http_code":  None,
                "ts":         int(time.time()),
            }

        return any_ok

    # ── News sentiment ────────────────────────────────────────────────────
    async def fetch_news_sentiment(self) -> bool:
        key = self.cfg.get("news_api_key", "").strip()
        if not key:
            self.api_status["news"]   = "no_key"
            self.data_sources["news"] = "no_key"
            self.api_errors["news"] = {
                "error":      "No NewsAPI key configured",
                "error_type": "NO_KEY",
                "http_code":  None,
                "ts":         int(time.time()),
            }
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
        POS = {"surge","rise","strong","growth","beat","bullish","hawkish",
               "gain","high","positive","increase","expand","rally","jump"}
        NEG = {"fall","drop","weak","recession","miss","bearish","dovish",
               "loss","cut","decline","contract","concern","slump","slide"}
        ok = False
        any_error: Optional[str] = None
        for cur, q in queries.items():
            url = (f"https://newsapi.org/v2/everything?q={q}"
                   f"&language=en&pageSize=10&sortBy=publishedAt&apiKey={key}")
            try:
                r = await self.client.get(url)
                if r.status_code == 429:
                    any_error = "NewsAPI rate limit"
                    break
                r.raise_for_status()
                data = r.json()
                if data.get("status") != "ok":
                    any_error = data.get("message", "NewsAPI error")
                    continue
                score = 0
                for art in data.get("articles", []):
                    text = ((art.get("title") or "") + " " +
                            (art.get("description") or "")).lower()
                    for w in POS:
                        if w in text: score += 1
                    for w in NEG:
                        if w in text: score -= 1
                self.news_scores[cur] = max(-2, min(2, round(score / 3)))
                ok = True
                await asyncio.sleep(0.15)
            except Exception as e:
                any_error = f"{type(e).__name__}: {str(e)[:80]}"
                logger.warning("[NEWS %s] %s", cur, any_error)
        if ok:
            self.api_status["news"]   = "ok"
            self.data_sources["news"] = "live"
            self.fetch_ts["news"]     = time.time()
            self.api_errors.pop("news", None)
        else:
            self.api_status["news"]   = "error"
            self.data_sources["news"] = "error"
            self.api_errors["news"] = {
                "error":      any_error or "NewsAPI: all requests failed",
                "error_type": "RATE_LIMIT" if "rate limit" in (any_error or "").lower() else "HTTP_ERROR",
                "http_code":  None,
                "ts":         int(time.time()),
            }
        return ok

    # ── Alpha Vantage FX trend ────────────────────────────────────────────
    async def fetch_av_trends(self, trend_overrides: dict) -> bool:
        key = self.cfg.get("alpha_vantage_key", "").strip()
        if not key:
            self.api_status["av"]   = "no_key"
            self.data_sources["av"] = "no_key"
            self.api_errors["av"] = {
                "error":      "No Alpha Vantage API key configured",
                "error_type": "NO_KEY",
                "http_code":  None,
                "ts":         int(time.time()),
            }
            return False
        targets      = ["EUR","GBP","JPY","AUD","NZD","CAD","CHF"]
        ok           = False
        rate_limited = False
        for cur in targets:
            if rate_limited:
                break
            url = (f"https://www.alphavantage.co/query?function=FX_WEEKLY"
                   f"&from_symbol={cur}&to_symbol=USD&apikey={key}")
            try:
                r = await self.client.get(url)
                r.raise_for_status()
                data = r.json()
                if "Note" in data or "Information" in data:
                    rate_limited = True
                    self.api_errors["av"] = {
                        "error":      data.get("Note") or data.get("Information", "AV rate limit"),
                        "error_type": "RATE_LIMIT",
                        "http_code":  None,
                        "ts":         int(time.time()),
                    }
                    break
                series = data.get("Weekly Time Series Forex (FX)", {})
                if not series:
                    raise ValueError(f"AV {cur}: no series")
                dates = sorted(series.keys(), reverse=True)
                if len(dates) < 20:
                    raise ValueError(f"AV {cur}: only {len(dates)} bars")
                price = float(series[dates[0]]["4. close"])
                ma8   = sum(float(series[d]["4. close"]) for d in dates[:8])  / 8
                ma20  = sum(float(series[d]["4. close"]) for d in dates[:20]) / 20
                trend_overrides[cur] = (
                    2 if price > ma8 > ma20  else
                    1 if price > ma8         else
                   -2 if price < ma8 < ma20  else -1
                )
                ok = True
                await asyncio.sleep(1.2)
            except Exception as e:
                logger.warning("[AV %s] %s", cur, e)
        if ok:
            self.api_status["av"]   = "ok"
            self.data_sources["av"] = "live"
            self.fetch_ts["av"]     = time.time()
            if not rate_limited:
                self.api_errors.pop("av", None)
        elif not rate_limited:
            self.api_status["av"]   = "error"
            self.data_sources["av"] = "error"
            if "av" not in self.api_errors:
                self.api_errors["av"] = {
                    "error":      "Alpha Vantage: all requests failed",
                    "error_type": "HTTP_ERROR",
                    "http_code":  None,
                    "ts":         int(time.time()),
                }
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

    # ── Full refresh ──────────────────────────────────────────────────────
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
