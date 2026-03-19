import React from 'react'
import s from './AboutView.module.css'

interface Props {
  apiStatus: Record<string, string>
}

const APIS = [
  { name: 'Frankfurter / Open ER',  key: 'fx',         label: 'Live FX Rates',        free: true, url: 'frankfurter.app' },
  { name: 'World Bank API',         key: 'worldbank',   label: 'GDP Growth (Annual)',   free: true, url: 'api.worldbank.org' },
  { name: 'ECB Data Portal',        key: 'ecb',         label: 'EUR Deposit Rate',      free: true, url: 'data-api.ecb.europa.eu' },
  { name: 'FRED (St. Louis Fed)',   key: 'fred',        label: 'US Macro (CPI, GDP…)',  free: true, url: 'fred.stlouisfed.org' },
  { name: 'Alpha Vantage',          key: 'av',          label: 'FX Trend (Weekly MA)',  free: true, url: 'alphavantage.co' },
  { name: 'NewsAPI',                key: 'news',        label: 'News Sentiment NLP',    free: true, url: 'newsapi.org' },
]

const FACTORS = [
  { name: 'RATES',    weight: 18, desc: 'Central bank interest rate — primary carry driver' },
  { name: 'TREND',    weight: 15, desc: 'Weekly MA crossover via Alpha Vantage FX data' },
  { name: 'GDP',      weight: 12, desc: 'Annual GDP growth rate — World Bank / FRED' },
  { name: 'CPI',      weight: 10, desc: 'Inflation change — hawkish/dovish pressure' },
  { name: 'COT',      weight: 10, desc: 'CFTC net speculative positioning (contrarian)' },
  { name: 'NEWS',     weight:  8, desc: 'NLP sentiment score from 10 recent headlines' },
  { name: 'NFP',      weight:  8, desc: 'Non-farm payrolls vs prior month (USD)' },
  { name: 'MPMI',     weight:  8, desc: 'Manufacturing PMI — Markit/S&P Global' },
  { name: 'SPMI',     weight:  8, desc: 'Services PMI — Markit/S&P Global' },
  { name: 'CROWD',    weight:  8, desc: 'Retail sentiment — IG/OANDA (contrarian signal)' },
  { name: 'URATE',    weight:  7, desc: 'Unemployment rate change (inverse)' },
  { name: 'RETAIL',   weight:  7, desc: 'Retail sales MoM change' },
  { name: 'SEASON',   weight:  5, desc: 'Historical seasonal bias per currency per month' },
  { name: 'PPI',      weight:  5, desc: 'Producer price index — leading CPI indicator' },
  { name: 'PCE',      weight:  4, desc: 'Personal consumption expenditure deflator (USD)' },
  { name: 'CONF',     weight:  5, desc: 'Consumer confidence surveys' },
  { name: 'CLAIMS',   weight:  4, desc: 'Weekly jobless claims (USD, inverse)' },
  { name: 'ADP',      weight:  4, desc: 'ADP private payrolls (USD leading indicator)' },
  { name: 'JOLTS',    weight:  4, desc: 'Job openings — labor market tightness (USD)' },
]

export default function AboutView({ apiStatus }: Props) {
  return (
    <div className={s.container}>
      <div className={s.hero}>
        <div className={s.logo}>📡</div>
        <div className={s.title}>MacroFX Terminal Plus</div>
        <div className={s.subtitle}>
          Institutional-grade macro swing trading terminal. Powered by the Currency Macro
          Strength Index (CMSI) — a 19-factor composite that scores each currency on
          macroeconomic attractiveness and generates long/short signals for FX pairs.
        </div>
        <div className={s.version}>
          <span className={s.badge}>v1.0.0</span>
          <span className={s.badge}>Electron + React + FastAPI</span>
          <span className={`${s.badge} ${s.badgeGreen}`}>Open Source</span>
        </div>
      </div>

      <div className={s.grid}>
        <div className={s.card}>
          <span className={s.cardIcon}>🧮</span>
          <span className={s.cardTitle}>CMSI Engine</span>
          <span className={s.cardText}>
            Scores 8 major currencies across 19 macro factors.
            Weighted composite yields a -10 to +10 score.
            Pair signals generated when differential exceeds configurable threshold.
          </span>
        </div>
        <div className={s.card}>
          <span className={s.cardIcon}>📊</span>
          <span className={s.cardTitle}>Live Heatmap</span>
          <span className={s.cardText}>
            Real-time factor matrix identical in structure to TradeSave+
            but with institutional-depth scoring. Color-coded per factor
            direction. Score and bias updated every 60 seconds via WebSocket.
          </span>
        </div>
        <div className={s.card}>
          <span className={s.cardIcon}>⚡</span>
          <span className={s.cardTitle}>Signal Engine</span>
          <span className={s.cardText}>
            Generates LONG/SHORT signals for up to 20 pairs.
            Includes carry differential, entry/target/SL levels,
            and key macro driver label. Ranked by signal strength.
          </span>
        </div>
        <div className={s.card}>
          <span className={s.cardIcon}>🔬</span>
          <span className={s.cardTitle}>Backtest Engine</span>
          <span className={s.cardText}>
            GBM price simulation calibrated to historical pair volatility
            with crisis-period multipliers. Monthly rebalancing. Returns
            Sharpe, Sortino, CAGR, max drawdown, equity curve, monthly P&amp;L.
          </span>
        </div>
        <div className={s.card}>
          <span className={s.cardIcon}>🏦</span>
          <span className={s.cardTitle}>CB Rate Monitor</span>
          <span className={s.cardText}>
            Live central bank rates for all 8 currencies. Meeting dates,
            expected changes, and dovish/hawkish stance. Rate differential
            chart for key pairs. ECB rate from official ECB Data Portal.
          </span>
        </div>
        <div className={s.card}>
          <span className={s.cardIcon}>🔗</span>
          <span className={s.cardTitle}>Correlation Matrix</span>
          <span className={s.cardText}>
            90-day log-return Pearson correlation across all 8 currencies.
            Identifies diversification opportunities and pair hedging.
            Computed from Frankfurter 90-day OHLC history.
          </span>
        </div>
      </div>

      {/* Data Sources */}
      <div className={s.dataTable}>
        <div className={s.tableHeader}>
          <span>🌐</span>
          <span className={s.tableTitle}>Data Sources — All Free / Public</span>
        </div>
        <div className={s.tableBody}>
          {APIS.map(api => {
            const st = apiStatus?.[api.key]
            const color = st === 'ok' ? 'var(--green)' : st === 'error' ? 'var(--red)' : st === 'no_key' ? 'var(--yellow)' : 'var(--text-faint)'
            return (
              <div className={s.tableRow} key={api.key}>
                <span className={s.tableKey}>{api.name}</span>
                <span className={s.tableVal}>{api.label}</span>
                <span style={{ color, fontSize: '9px', width: '80px', textAlign: 'right' }}>
                  {st === 'ok' ? '● LIVE' : st === 'no_key' ? '○ NO KEY' : st === 'error' ? '✕ ERROR' : '◌ PENDING'}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* CMSI Factors */}
      <div className={s.dataTable}>
        <div className={s.tableHeader}>
          <span>⚖️</span>
          <span className={s.tableTitle}>CMSI Factor Definitions (19 Factors)</span>
        </div>
        <div className={s.tableBody}>
          {FACTORS.map(f => (
            <div className={s.tableRow} key={f.name}>
              <span className={s.tableKey} style={{ color: 'var(--accent)', fontWeight: 700 }}>{f.name}</span>
              <span className={s.tableVal}>{f.desc}</span>
              <span style={{ color: 'var(--text-faint)', fontSize: '9px', width: '60px', textAlign: 'right' }}>
                w={f.weight}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className={s.footer}>
        MacroFX Terminal Plus — built by Kessler833 · Electron 29+ · React 18 · FastAPI 0.110<br />
        Data: Frankfurter API · World Bank · ECB Data Portal · FRED · Alpha Vantage · NewsAPI<br />
        This terminal is for informational and research purposes only. Not financial advice.
      </div>
    </div>
  )
}
