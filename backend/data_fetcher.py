from __future__ import annotations
import asyncio, csv, io, logging, math, time
from datetime import date, timedelta
from typing import Dict, List, Optional, Any

import httpx

logger = logging.getLogger("macrofx.fetcher")

CURRENCIES    = ["USD", "EUR", "GBP", "JPY", "AUD", "NZD", "CAD", "CHF"]
PAIRS_DEFAULT = [
    "AUDJPY","NZDJPY","USDJPY","EURUSD","GBPUSD",
    "AUDUSD","EURGBP","USDCAD","EURAUD","GBPJPY",
    "AUDNZD","EURJPY","CADJPY","CHFJPY","EURCHF",
]

# ── FRED series IDs ───────────────────────────────────────────────────────────
FRED_CPI_SERIES: Dict[str, str] = {
    "USD": "CPIAUCSL",
    "EUR": "CP0000EZ19M086NEST",
    "GBP": "GBRCPIALLMINMEI",
    "JPY": "JPNCPIALLMINMEI",
    "AUD": "AUSCPIALLQINMEI",
    "NZD": "NZLCPIALLQINMEI",
    "CAD": "CPALCY01CAM661N",
    "CHF": "CHECPIALLMINMEI",
}

FRED_RATE_SERIES: Dict[str, str] = {
    "USD": "FEDFUNDS",
    "GBP": "IUDSOIA",
    "JPY": "IRSTCB01JPM156N",
    "AUD": "IRSTCB01AUM156N",
    "NZD": "IRSTCB01NZM156N",
    "CAD": "IRSTCB01CAM156N",
    "CHF": "IRSTCB01CHM156N",
}

# PPI: Producer Price Index (MoM change)
FRED_PPI_SERIES: Dict[str, str] = {
    "USD": "PPIACO",           # US PPI all commodities
    "EUR": "PIEAMP01EZM661N",  # Euro area PPI
    "GBP": "PIEAMP01GBM661N",  # UK PPI
    "JPY": "PIEAMP01JPM661N",  # Japan PPI
    "AUD": "PIEAMP01AUM661N",  # Australia PPI
    "NZD": "PIEAMP01NZM661N",  # New Zealand PPI
    "CAD": "PIEAMP01CAM661N",  # Canada PPI
    "CHF": "PIEAMP01CHM661N",  # Switzerland PPI
}

# PCE: Personal Consumption Expenditures (USD only; others approximate via CPI)
FRED_PCE_SERIES: Dict[str, str] = {
    "USD": "PCEPI",            # US PCE price index
}

# US-only labor market series (USD heatmap row)
FRED_LABOR_USD: Dict[str, str] = {
    "nfp":    "PAYEMS",        # Non-Farm Payrolls (thousands)
    "urate":  "UNRATE",        # Unemployment Rate %
    "claims": "ICSA",          # Initial Jobless Claims
    "adp":    "ADPWNUSNERSA",  # ADP Private Employment
    "jolts":  "JTSJOL",        # JOLTS Job Openings
}

# International unemployment rates for URATE column
FRED_URATE_INTL: Dict[str, str] = {
    "EUR": "LRHUTTTTEZM156S",  # Euro area unemployment rate
    "GBP": "LRHUTTTTGBM156S",  # UK unemployment rate
    "JPY": "LRHUTTTTJPM156S",  # Japan unemployment rate
    "AUD": "LRHUTTTTAUM156S",  # Australia unemployment rate
    "NZD": "LRHUTTTTNTM156S",  # New Zealand unemployment
    "CAD": "LRHUTTTTCAM156S",  # Canada unemployment rate
    "CHF": "LRHUTTTTTCHM156S", # Switzerland unemployment rate
}

# International NFP equivalents (employment growth %)
FRED_EMPLOY_INTL: Dict[str, str] = {
    "EUR": "LFEMTTTTEZM647S",  # Euro area employment
    "GBP": "LCEAMN01GBM661S",  # UK employment change
    "JPY": "LCEAMN01JPM661S",  # Japan employment
    "AUD": "LCEAMN01AUM661S",  # Australia employment
    "CAD": "LCEAMN01CAM661S",  # Canada employment
}

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

# ── CFTC: currency → legacy report code ──────────────────────────────────────
CFTC_CODES: Dict[str, str] = {
    "EUR": "099741",
    "GBP": "096742",
    "JPY": "097741",
    "AUD": "232741",
    "NZD": "112741",
    "CAD": "090741",
    "CHF": "092741",
}

# ── Finnhub: ISM economic event codes ────────────────────────────────────────
FINNHUB_PMI: Dict[str, Dict[str, str]] = {
    "USD": {"m": "ISM Manufacturing PMI", "s": "ISM Services PMI"},
    "EUR": {"m": "Manufacturing PMI",     "s": "Services PMI"},
    "GBP": {"m": "Manufacturing PMI",     "s": "Services PMI"},
    "JPY": {"m": "Manufacturing PMI",     "s": "Services PMI"},
    "AUD": {"m": "Manufacturing PMI",     "s": "Services PMI"},
    "NZD": {"m": "Manufacturing PMI",     "s": "Services PMI"},
    "CAD": {"m": "Manufacturing PMI",     "s": "Services PMI"},
    "CHF": {"m": "Manufacturing PMI",     "s": "Services PMI"},
}

# Country codes for Finnhub economic calendar
FINNHUB_COUNTRY: Dict[str, str] = {
    "USD": "US", "EUR": "EU", "GBP": "GB",
    "JPY": "JP", "AUD": "AU", "NZD": "NZ",
    "CAD": "CA", "CHF": "CH",
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
        self.ppi_changes: Dict[str, float] = {}
        self.pce_changes: Dict[str, float] = {}
        self.news_scores: Dict[str, int]   = {}

        # Labor market data (per currency where available)
        self.nfp_vals:    Dict[str, float] = {}  # MoM change in employment
        self.urate_vals:  Dict[str, float] = {}  # Unemployment %
        self.claims_vals: Dict[str, float] = {}  # Initial claims (USD only)
        self.adp_vals:    Dict[str, float] = {}  # ADP (USD only)
        self.jolts_vals:  Dict[str, float] = {}  # JOLTS openings (USD only)

        # PMI data per currency
        self.pmi_data: Dict[str, Dict[str, float]] = {}  # {"USD": {"m": 51.5, "s": 53.2}}

        # COT data per currency: net positioning score -2 to +2
        self.cot_data:  Dict[str, int] = {}

        # Crowd/retail sentiment per currency: contrarian score -2 to +2
        self.crowd_data: Dict[str, int] = {}

        # Trend from FX history MA cross (replaces Alpha Vantage)
        self.trend_data: Dict[str, int] = {}

        self.data_sources: Dict[str, str] = {
            "cb_rates": "pending",
            "gdp":      "pending",
            "cpi":      "pending",
            "ppi":      "pending",
            "pce":      "pending",
            "nfp":      "pending",
            "urate":    "pending",
            "claims":   "pending",
            "adp":      "pending",
            "jolts":    "pending",
            "fx":       "pending",
            "news":     "pending",
            "pmi":      "pending",
            "cot":      "pending",
            "crowd":    "pending",
            "trend":    "pending",
        }

        self.api_status: Dict[str, str] = {
            "fx":        "pending",
            "fred":      "pending",
            "worldbank": "pending",
            "news":      "pending",
            "ecb":       "pending",
            "finnhub":   "pending",
            "cftc":      "pending",
            "myfxbook":  "pending",
        }

        self.api_errors: Dict[str, Any] = {}

        self.fetch_ts: Dict[str, float] = {
            k: 0 for k in self.data_sources
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
                last_code = getattr(getattr(e, "response", None), "status_code", None)
        self.api_status["fx"]   = "error"
        self.data_sources["fx"] = "error"
        if last_exc:
            self._record_error("fx", last_exc, last_code)
        return False

    # ── FX History (used for TREND derivation) ────────────────────────────
    async def fetch_fx_history(self) -> bool:
        end   = date.today()
        start = end - timedelta(days=200)  # ~28 weekly bars for MA20
        url   = (f"https://api.frankfurter.app/{start}..{end}"
                 f"?base=USD&symbols=EUR,GBP,JPY,AUD,NZD,CAD,CHF")
        try:
            r = await self.client.get(url)
            r.raise_for_status()
            data = r.json().get("rates", {})
            if not data:
                raise ValueError("Empty history")
            self.fx_history = data
            self._derive_trends_from_history()
            return True
        except Exception as e:
            self._record_error("trend", e,
                getattr(getattr(e, "response", None), "status_code", None))
            return False

    def _derive_trends_from_history(self) -> None:
        """Compute MA8 vs MA20 trend score from Frankfurter history. Replaces Alpha Vantage."""
        targets = ["EUR", "GBP", "JPY", "AUD", "NZD", "CAD", "CHF"]
        dates   = sorted(self.fx_history.keys())
        any_ok  = False
        for cur in targets:
            prices: List[float] = []
            for d in reversed(dates):
                v = self.fx_history[d].get(cur)
                if v is not None:
                    prices.append(float(v))
            if len(prices) < 20:
                continue
            # prices[0] = most recent
            ma8  = sum(prices[:8])  / 8
            ma20 = sum(prices[:20]) / 20
            p    = prices[0]
            self.trend_data[cur] = (
                 2 if p > ma8 > ma20 else
                 1 if p > ma8        else
                -2 if p < ma8 < ma20 else -1
            )
            any_ok = True
        # USD trend: inverse of basket average
        if self.trend_data:
            avg = sum(self.trend_data.values()) / len(self.trend_data)
            self.trend_data["USD"] = max(-2, min(2, -round(avg)))
        if any_ok:
            self.data_sources["trend"] = "live"
            self.fetch_ts["trend"]     = time.time()
            self.api_errors.pop("trend", None)

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
            if not obs:
                raise ValueError("ECB: empty observations")
            latest_key = max(obs.keys(), key=int)
            val = float(obs[latest_key][0])
            self._store_cb_rate("EUR", val)
            self.api_status["ecb"]        = "ok"
            self.data_sources["cb_rates"] = "live"
            self.fetch_ts["cb_rates"]     = time.time()
            self.api_errors.pop("cb_rates", None)
            return True
        except Exception as e:
            self.api_status["ecb"] = "error"
            self._record_error("cb_rates", e,
                getattr(getattr(e, "response", None), "status_code", None))
            return False

    def _store_cb_rate(self, cur: str, val: float) -> None:
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
                code = getattr(getattr(e, "response", None), "status_code", None)
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

    # ── FRED: all economic indicators ─────────────────────────────────────
    async def fetch_fred(self) -> bool:
        key = self.cfg.get("fred_api_key", "").strip()
        if not key:
            for ds in ["cpi","ppi","pce","cb_rates","nfp","urate","claims","adp","jolts"]:
                self.data_sources[ds] = "no_key"
                self.api_errors[ds] = {
                    "error":      "No FRED API key configured",
                    "error_type": "NO_KEY",
                    "http_code":  None,
                    "ts":         int(time.time()),
                }
            self.api_status["fred"] = "no_key"
            return False

        base_url = "https://api.stlouisfed.org/fred/series/observations"

        async def _series(series_id: str, label: str, n: int = 4):
            url = (f"{base_url}?series_id={series_id}&api_key={key}"
                   f"&file_type=json&limit={n}&sort_order=desc")
            try:
                r = await self.client.get(url)
                if r.status_code == 429:
                    raise httpx.HTTPStatusError("FRED rate limit",
                        request=r.request, response=r)
                r.raise_for_status()
                obs = [o for o in r.json().get("observations", [])
                       if o.get("value", ".") != "."]
                if len(obs) < 2:
                    raise ValueError(f"FRED {series_id}: only {len(obs)} obs")
                return {
                    "cur":  float(obs[0]["value"]),
                    "prev": float(obs[1]["value"]),
                    "vals": [float(o["value"]) for o in obs],
                }
            except Exception as e:
                code = getattr(getattr(e, "response", None), "status_code", None)
                logger.warning("[FRED %s/%s] %s", label, series_id, e)
                return None

        # ── Build full task list ──────────────────────────────────────────
        tasks: list = []

        for cur, sid in FRED_CPI_SERIES.items():
            tasks.append(("cpi",    cur, sid))
        for cur, sid in FRED_RATE_SERIES.items():
            tasks.append(("rate",   cur, sid))
        for cur, sid in FRED_PPI_SERIES.items():
            tasks.append(("ppi",    cur, sid))
        for cur, sid in FRED_PCE_SERIES.items():
            tasks.append(("pce",    cur, sid))
        for metric, sid in FRED_LABOR_USD.items():
            tasks.append((metric,   "USD", sid))
        for cur, sid in FRED_URATE_INTL.items():
            tasks.append(("urate",  cur, sid))
        for cur, sid in FRED_EMPLOY_INTL.items():
            tasks.append(("nfp",    cur, sid))
        # USD GDP from FRED
        tasks.append(("gdp", "USD", "A191RL1Q225SBEA"))

        results = await asyncio.gather(
            *[_series(sid, f"{typ}/{cur}") for typ, cur, sid in tasks]
        )

        any_ok = False
        group_ok: Dict[str, bool] = {}

        for (typ, cur, sid), res in zip(tasks, results):
            if res is None:
                continue
            any_ok = True
            change = res["cur"] - res["prev"]
            group_ok[typ] = True

            if typ == "cpi":
                self.cpi_changes[cur] = round(change, 4)

            elif typ == "rate":
                self._store_cb_rate(cur, res["cur"])
                if cur in self.cb_meta:
                    self.cb_meta[cur]["change"] = round(change, 3)

            elif typ == "ppi":
                self.ppi_changes[cur] = round(change, 4)

            elif typ == "pce":
                self.pce_changes[cur] = round(change, 4)

            elif typ == "gdp" and cur == "USD":
                self.gdp_vals["USD"] = round(res["cur"], 2)

            elif typ == "nfp":
                self.nfp_vals[cur] = round(change, 2)

            elif typ == "urate":
                self.urate_vals[cur] = round(res["cur"], 2)

            elif typ == "claims":
                self.claims_vals["USD"] = round(change, 0)

            elif typ == "adp":
                self.adp_vals["USD"] = round(change, 0)

            elif typ == "jolts":
                self.jolts_vals["USD"] = round(change, 0)

        self.api_status["fred"] = "ok" if any_ok else "error"
        now = time.time()

        for ds in ["cpi","ppi","pce","cb_rates","nfp","urate","claims","adp","jolts"]:
            if group_ok.get(ds) or group_ok.get("rate") and ds == "cb_rates":
                self.data_sources[ds] = "live"
                self.fetch_ts[ds]     = now
                self.api_errors.pop(ds, None)
            elif ds not in self.api_errors:
                self.data_sources[ds] = "error"
                self.api_errors[ds]   = {
                    "error":      f"FRED {ds}: no data returned",
                    "error_type": "HTTP_ERROR",
                    "http_code":  None,
                    "ts":         int(now),
                }

        return any_ok

    # ── Finnhub: PMI (MPMI + SPMI) ───────────────────────────────────────
    async def fetch_pmi_finnhub(self) -> bool:
        key = self.cfg.get("finnhub_api_key", "").strip()
        if not key:
            self.api_status["finnhub"]  = "no_key"
            self.data_sources["pmi"]    = "no_key"
            self.api_errors["pmi"] = {
                "error":      "No Finnhub API key configured",
                "error_type": "NO_KEY",
                "http_code":  None,
                "ts":         int(time.time()),
            }
            return False

        end   = date.today().isoformat()
        start = (date.today() - timedelta(days=45)).isoformat()
        any_ok = False

        for cur, country in FINNHUB_COUNTRY.items():
            url = (f"https://finnhub.io/api/v1/calendar/economic"
                   f"?from={start}&to={end}&token={key}")
            try:
                r = await self.client.get(url)
                if r.status_code == 429:
                    self.api_errors["pmi"] = {
                        "error": "Finnhub rate limit",
                        "error_type": "RATE_LIMIT",
                        "http_code": 429,
                        "ts": int(time.time()),
                    }
                    break
                r.raise_for_status()
                events = r.json().get("economicCalendar", [])

                m_val: Optional[float] = None
                s_val: Optional[float] = None

                for ev in reversed(events):
                    if ev.get("country", "").upper() != country:
                        continue
                    name = (ev.get("event") or "").lower()
                    actual = ev.get("actual")
                    if actual is None:
                        continue
                    try:
                        actual = float(actual)
                    except (ValueError, TypeError):
                        continue
                    if "manufacturing pmi" in name or "ism manufacturing" in name:
                        if m_val is None:
                            m_val = actual
                    if "services pmi" in name or "ism services" in name or "non-manufacturing" in name:
                        if s_val is None:
                            s_val = actual

                if m_val is not None or s_val is not None:
                    self.pmi_data[cur] = {
                        "m": m_val if m_val is not None else 50.0,
                        "s": s_val if s_val is not None else 50.0,
                    }
                    any_ok = True

                await asyncio.sleep(0.3)  # Finnhub free: 60 req/min
            except Exception as e:
                logger.warning("[FINNHUB PMI %s] %s", cur, e)

        if any_ok:
            self.api_status["finnhub"]  = "ok"
            self.data_sources["pmi"]    = "live"
            self.fetch_ts["pmi"]        = time.time()
            self.api_errors.pop("pmi", None)
        else:
            self.api_status["finnhub"]  = "error"
            self.data_sources["pmi"]    = "error"
        return any_ok

    # ── CFTC: Commitments of Traders (COT) ───────────────────────────────
    async def fetch_cot(self) -> bool:
        """
        Downloads the official CFTC legacy futures-only COT report (CSV).
        Free, no API key required. Updated every Friday ~3:30 PM ET.
        """
        year  = date.today().year
        # Try current year first, fall back to prior year
        for y in [year, year - 1]:
            url = f"https://www.cftc.gov/files/dea/history/fut_fin_txt_{y}.zip"
            try:
                import zipfile

                r = await self.client.get(url, timeout=30.0)
                if r.status_code == 404:
                    continue
                r.raise_for_status()

                # Parse zip in-memory
                with zipfile.ZipFile(io.BytesIO(r.content)) as zf:
                    csv_name = next((n for n in zf.namelist() if n.endswith(".txt") or n.endswith(".csv")), None)
                    if not csv_name:
                        raise ValueError("No CSV in CFTC zip")
                    raw = zf.read(csv_name).decode("utf-8", errors="replace")

                reader  = csv.DictReader(io.StringIO(raw))
                latest: Dict[str, dict] = {}

                for row in reader:
                    cftc_code = row.get("CFTC_Contract_Market_Code", "").strip()
                    matched   = None
                    for cur, code in CFTC_CODES.items():
                        if cftc_code == code:
                            matched = cur
                            break
                    if matched is None:
                        continue
                    # Keep only the most recent row (CSV is sorted oldest→newest)
                    latest[matched] = row

                any_ok = False
                for cur, row in latest.items():
                    try:
                        longs  = float(row.get("NonComm_Positions_Long_All",  0) or 0)
                        shorts = float(row.get("NonComm_Positions_Short_All", 0) or 0)
                        total  = longs + shorts
                        if total < 100:
                            continue
                        net_pct = (longs - shorts) / total  # -1 to +1
                        if net_pct >  0.30: score =  2
                        elif net_pct > 0.10: score =  1
                        elif net_pct < -0.30: score = -2
                        elif net_pct < -0.10: score = -1
                        else:                score =  0
                        self.cot_data[cur] = score
                        any_ok = True
                    except (ValueError, TypeError, ZeroDivisionError):
                        continue

                if any_ok:
                    self.api_status["cftc"]  = "ok"
                    self.data_sources["cot"] = "live"
                    self.fetch_ts["cot"]     = time.time()
                    self.api_errors.pop("cot", None)
                    return True

            except Exception as e:
                logger.warning("[CFTC COT y=%s] %s", y, e)

        self.api_status["cftc"]  = "error"
        self.data_sources["cot"] = "error"
        self.api_errors["cot"]   = {
            "error":      "CFTC COT fetch failed",
            "error_type": "HTTP_ERROR",
            "http_code":  None,
            "ts":         int(time.time()),
        }
        return False

    # ── MyFXBook: retail sentiment (CROWD) ───────────────────────────────
    async def fetch_crowd_myfxbook(self) -> bool:
        """
        MyFXBook community outlook — retail long/short % per pair.
        Free, no API key required.
        Contrarian: heavy retail long → bearish signal for that currency.
        """
        url = "https://www.myfxbook.com/api/get-community-outlook.json"
        try:
            r = await self.client.get(url, timeout=15.0)
            r.raise_for_status()
            data = r.json()
            symbols = data.get("symbols", {}).get("symbol", [])
            if not symbols:
                raise ValueError("MyFXBook: empty symbols")

            # Aggregate sentiment per currency across all pairs
            cur_long:  Dict[str, List[float]] = {c: [] for c in CURRENCIES}
            cur_short: Dict[str, List[float]] = {c: [] for c in CURRENCIES}

            for sym in symbols:
                name = (sym.get("name") or "").upper().replace("/", "")
                if len(name) != 6:
                    continue
                base, quote = name[:3], name[3:]
                try:
                    long_pct  = float(sym.get("longPercentage",  50))
                    short_pct = float(sym.get("shortPercentage", 50))
                except (TypeError, ValueError):
                    continue
                if base in cur_long:
                    cur_long[base].append(long_pct)
                    cur_short[base].append(short_pct)
                if quote in cur_long:
                    # quote currency: retail long the pair = bearish for quote
                    cur_long[quote].append(short_pct)
                    cur_short[quote].append(long_pct)

            any_ok = False
            for cur in CURRENCIES:
                ls = cur_long[cur]
                if not ls:
                    continue
                avg_long = sum(ls) / len(ls)
                # Contrarian logic: if retail > 65% long → bearish (-1 or -2)
                if avg_long > 75:   score = -2
                elif avg_long > 60: score = -1
                elif avg_long < 25: score =  2
                elif avg_long < 40: score =  1
                else:               score =  0
                self.crowd_data[cur] = score
                any_ok = True

            if any_ok:
                self.api_status["myfxbook"]  = "ok"
                self.data_sources["crowd"]   = "live"
                self.fetch_ts["crowd"]       = time.time()
                self.api_errors.pop("crowd", None)
                return True

            raise ValueError("MyFXBook: no pairs parsed")

        except Exception as e:
            self.api_status["myfxbook"]  = "error"
            self.data_sources["crowd"]   = "error"
            self.api_errors["crowd"] = {
                "error":      str(e)[:200],
                "error_type": "HTTP_ERROR",
                "http_code":  getattr(getattr(e, "response", None), "status_code", None),
                "ts":         int(time.time()),
            }
            return False

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

    # ── Correlation matrix ────────────────────────────────────────────────
    def compute_correlation_matrix(self) -> Dict[str, Dict[str, float]]:
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
        # Phase 1: fast, no-key sources
        await asyncio.gather(
            self.fetch_fx_rates(),
            self.fetch_ecb_rate(),
            self.fetch_gdp(),
            self.fetch_cot(),
            self.fetch_crowd_myfxbook(),
            return_exceptions=True
        )
        # Phase 2: keyed sources + FX history (for trend)
        await asyncio.gather(
            self.fetch_fred(),
            self.fetch_news_sentiment(),
            self.fetch_pmi_finnhub(),
            self.fetch_fx_history(),
            return_exceptions=True
        )
        # Merge derived trend data into trend_overrides for cmsi_engine
        for cur, val in self.trend_data.items():
            trend_overrides[cur] = val
