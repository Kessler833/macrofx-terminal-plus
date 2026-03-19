import { useState, useRef, useEffect } from 'react'
import { MacroState, BacktestResult } from '../../types'
import { apiPost } from '../../hooks/useMacroWS'
import styles from './BacktestView.module.css'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, PointElement, LineElement,
  Tooltip, Legend, Filler
} from 'chart.js'
import { Line } from 'react-chartjs-2'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler)

interface Props { state: MacroState }

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export default function BacktestView({ state }: Props) {
  const pairs = (state.config?.active_pairs as string[] | undefined) ?? ['AUDJPY','EURUSD','USDJPY']
  const [pair, setPair]   = useState(pairs[0] || 'AUDJPY')
  const [strat, setStrat] = useState('cmsi')
  const [from, setFrom]   = useState('2013-01-01')
  const [to, setTo]       = useState('2025-12-31')
  const [cap, setCap]     = useState('10000')
  const [pos, setPos]     = useState('10')
  const [thr, setThr]     = useState(String(state.config?.signal_threshold ?? 3))
  const [running, setRunning] = useState(false)
  const [result, setResult]   = useState<BacktestResult | null>(null)

  async function runBacktest() {
    setRunning(true)
    setResult(null)
    const res = await apiPost('/backtest', {
      pair, strategy: strat,
      start: from, end: to,
      capital: parseFloat(cap),
      position_pct: parseFloat(pos),
      threshold: parseFloat(thr),
    })
    setResult(res as BacktestResult)
    setRunning(false)
  }

  const chartData = result ? {
    labels: result.equity_curve.map(p => p.t),
    datasets: [
      {
        label: 'Strategy',
        data: result.equity_curve.map(p => p.v),
        borderColor: '#6c63ff', borderWidth: 1.5,
        pointRadius: 0, fill: false, tension: 0.1,
      },
      {
        label: 'Buy & Hold',
        data: result.hodl_curve.map(p => p.v),
        borderColor: '#00ccff', borderWidth: 1.5,
        pointRadius: 0, fill: false, tension: 0.1,
        borderDash: [4, 4],
      },
    ],
  } : null

  const chartOptions = {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: '#7878aa', font: { family: 'JetBrains Mono', size: 10 } } },
      tooltip: { backgroundColor: '#12121f', titleFont: { family: 'JetBrains Mono', size: 10 }, bodyFont: { family: 'JetBrains Mono', size: 10 } },
    },
    scales: {
      x: { ticks: { color: '#7878aa', font: { family: 'JetBrains Mono', size: 9 }, maxTicksLimit: 8 }, grid: { color: 'rgba(30,30,58,0.5)' } },
      y: { ticks: { color: '#7878aa', font: { family: 'JetBrains Mono', size: 9 } }, grid: { color: 'rgba(30,30,58,0.5)' } },
    },
  }

  const allYears = result ? Object.keys(result.monthly_returns).sort() : []

  return (
    <div className={styles.wrap}>
      {/* Parameters */}
      <div className="panel">
        <div className="panel-title">BACKTEST PARAMETERS</div>
        <div className={styles.paramGrid}>
          <div className={styles.paramItem}>
            <label>PAIR</label>
            <select value={pair} onChange={e => setPair(e.target.value)}>
              {pairs.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className={styles.paramItem}>
            <label>STRATEGY</label>
            <select value={strat} onChange={e => setStrat(e.target.value)}>
              <option value="cmsi">CMSI Multi-Factor</option>
              <option value="carry">Carry Only</option>
            </select>
          </div>
          <div className={styles.paramItem}>
            <label>FROM</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
          </div>
          <div className={styles.paramItem}>
            <label>TO</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} />
          </div>
          <div className={styles.paramItem}>
            <label>CAPITAL ($)</label>
            <input type="number" value={cap} onChange={e => setCap(e.target.value)} />
          </div>
          <div className={styles.paramItem}>
            <label>POSITION SIZE (%)</label>
            <input type="number" value={pos} min="1" max="100" onChange={e => setPos(e.target.value)} />
          </div>
          <div className={styles.paramItem}>
            <label>THRESHOLD (CMSI DIFF)</label>
            <input type="number" value={thr} step="0.5" onChange={e => setThr(e.target.value)} />
          </div>
          <div className={styles.paramItem} style={{ alignSelf: 'end' }}>
            <button className="btn btn-primary" onClick={runBacktest} disabled={running}>
              {running ? '⟳ RUNNING…' : '▶ RUN BACKTEST'}
            </button>
          </div>
        </div>
      </div>

      {result && !result.error && (
        <>
          {/* Stats */}
          <div className={styles.statsGrid}>
            {[
              { label: 'TOTAL RETURN', val: `${result.total_return >= 0 ? '+' : ''}${result.total_return.toFixed(1)}%`, pos: result.total_return >= 0 },
              { label: 'CAGR', val: `${result.cagr >= 0 ? '+' : ''}${result.cagr.toFixed(1)}%`, pos: result.cagr >= 0 },
              { label: 'SHARPE', val: result.sharpe.toFixed(2), pos: result.sharpe > 0.5 },
              { label: 'SORTINO', val: result.sortino.toFixed(2), pos: result.sortino > 0.5 },
              { label: 'MAX DRAWDOWN', val: `-${result.max_drawdown.toFixed(1)}%`, pos: false },
              { label: 'WIN RATE', val: `${result.win_rate.toFixed(1)}%`, pos: result.win_rate > 50 },
              { label: 'AVG TRADE DAYS', val: result.avg_trade_days.toFixed(0), pos: true },
              { label: 'PROFIT FACTOR', val: result.profit_factor.toFixed(2), pos: result.profit_factor > 1 },
              { label: 'TOTAL TRADES', val: String(result.total_trades), pos: true },
            ].map(s => (
              <div key={s.label} className={styles.statCard}>
                <div className={styles.statLabel}>{s.label}</div>
                <div className={styles.statVal} style={{ color: s.pos ? 'var(--green)' : 'var(--red)' }}>{s.val}</div>
              </div>
            ))}
          </div>

          {/* Equity curve */}
          <div className="panel">
            <div className="panel-title">EQUITY CURVE — STRATEGY vs BUY & HOLD</div>
            <div className={styles.chartWrap}>
              {chartData && <Line data={chartData} options={chartOptions as any} />}
            </div>
          </div>

          {/* Monthly returns */}
          <div className="panel">
            <div className="panel-title">MONTHLY RETURNS HEATMAP (%)</div>
            <div className={styles.monthlyWrap}>
              <table>
                <thead>
                  <tr>
                    <th>YEAR</th>
                    {MONTH_LABELS.map(m => <th key={m}>{m}</th>)}
                    <th>ANNUAL</th>
                  </tr>
                </thead>
                <tbody>
                  {allYears.map(yr => {
                    const mdata = result.monthly_returns[yr] || {}
                    const annual = Object.values(mdata).reduce((s, v) => s + v, 0)
                    return (
                      <tr key={yr}>
                        <td style={{ fontWeight: 700 }}>{yr}</td>
                        {['01','02','03','04','05','06','07','08','09','10','11','12'].map(m => {
                          const v = mdata[m]
                          const bg = v === undefined ? 'transparent'
                            : v > 3 ? 'rgba(0,212,170,0.4)' : v > 1 ? 'rgba(0,212,170,0.2)'
                            : v > 0 ? 'rgba(0,212,170,0.08)'
                            : v > -1 ? 'rgba(255,68,102,0.08)' : v > -3 ? 'rgba(255,68,102,0.2)' : 'rgba(255,68,102,0.4)'
                          return (
                            <td key={m} style={{ background: bg, textAlign: 'center', color: v === undefined ? 'var(--text-faint)' : v >= 0 ? 'var(--green)' : 'var(--red)', fontSize: '10px' }}>
                              {v !== undefined ? (v >= 0 ? '+' : '') + v.toFixed(1) : '—'}
                            </td>
                          )
                        })}
                        <td style={{ fontWeight: 700, color: annual >= 0 ? 'var(--green)' : 'var(--red)' }}>
                          {annual >= 0 ? '+' : ''}{annual.toFixed(1)}%
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Trade log */}
          <div className="panel">
            <div className="panel-title">TRADE LOG — LAST {result.trades.length} TRADES</div>
            <div className={styles.tradeWrap}>
              <table>
                <thead>
                  <tr>
                    <th>#</th><th>PAIR</th><th>DIR</th><th>ENTRY DATE</th><th>EXIT DATE</th>
                    <th>DAYS</th><th>ENTRY</th><th>EXIT</th><th>P&L ($)</th><th>P&L (%)</th>
                    <th>CMSI@ENTRY</th><th>EXIT REASON</th>
                  </tr>
                </thead>
                <tbody>
                  {result.trades.map(t => (
                    <tr key={t.n}>
                      <td style={{ color: 'var(--text-faint)' }}>{t.n}</td>
                      <td style={{ fontWeight: 700 }}>{t.pair}</td>
                      <td><span className={t.dir === 'LONG' ? 'dir-long' : 'dir-short'}>{t.dir === 'LONG' ? '▲' : '▼'} {t.dir}</span></td>
                      <td style={{ color: 'var(--text-secondary)' }}>{t.entry_date}</td>
                      <td style={{ color: 'var(--text-secondary)' }}>{t.exit_date}</td>
                      <td>{t.days}</td>
                      <td>{t.entry.toFixed(4)}</td>
                      <td>{t.exit.toFixed(4)}</td>
                      <td style={{ color: t.pnl_usd >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>
                        {t.pnl_usd >= 0 ? '+' : ''}{t.pnl_usd.toFixed(2)}
                      </td>
                      <td style={{ color: t.pnl_pct >= 0 ? 'var(--green)' : 'var(--red)' }}>
                        {t.pnl_pct >= 0 ? '+' : ''}{t.pnl_pct.toFixed(2)}%
                      </td>
                      <td style={{ color: 'var(--accent)' }}>{t.cmsi_at_entry.toFixed(1)}</td>
                      <td style={{ fontSize: '9px', color: 'var(--text-secondary)' }}>{t.exit_reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {result?.error && (
        <div className={styles.errorBox}>✕ {result.error}</div>
      )}

      {running && (
        <div className={styles.loadingBox}>⟳ Running backtest simulation…</div>
      )}
    </div>
  )
}
