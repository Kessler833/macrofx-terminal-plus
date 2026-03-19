import { MacroState } from '../../types'
import styles from './SignalsView.module.css'

interface Props { state: MacroState }

export default function SignalsView({ state }: Props) {
  const CURS = ['USD','EUR','GBP','JPY','AUD','NZD','CAD','CHF']

  return (
    <div className={styles.wrap}>
      {/* Regime panel */}
      <div className={styles.regimeRow}>
        <div className={styles.regimeCard}>
          <div className="panel-title">GLOBAL MACRO REGIME</div>
          <div className={styles.regimeBody}>
            <span className={styles.regimeBig} style={{
              color: state.regime === 'RISK ON' ? 'var(--green)' :
                     state.regime === 'RISK OFF' ? 'var(--red)' : 'var(--yellow)'
            }}>{state.regime}</span>
          </div>
        </div>
        <div className={styles.regimeCard}>
          <div className="panel-title">MARKET CONDITIONS</div>
          <div className={styles.condGrid}>
            <div className={styles.condItem}>
              <span className={styles.condLabel}>DXY TREND</span>
              <span style={{ color: state.dxy_score > 2 ? 'var(--red)' : state.dxy_score < -2 ? 'var(--green)' : 'var(--text-secondary)', fontWeight: 700 }}>
                {state.dxy_score > 2 ? '↑ BULL' : state.dxy_score < -2 ? '↓ BEAR' : '→ NEUTRAL'}
              </span>
            </div>
            <div className={styles.condItem}>
              <span className={styles.condLabel}>CARRY ENV</span>
              <span style={{ color: state.carry_env?.includes('FAVOR') ? 'var(--green)' : 'var(--yellow)', fontWeight: 700 }}>{state.carry_env}</span>
            </div>
            <div className={styles.condItem}>
              <span className={styles.condLabel}>VIX PROXY</span>
              <span style={{ color: state.regime === 'RISK ON' ? 'var(--green)' : state.regime === 'RISK OFF' ? 'var(--red)' : 'var(--yellow)', fontWeight: 700 }}>
                {state.regime === 'RISK ON' ? '< 18 LOW' : state.regime === 'RISK OFF' ? '> 25 HIGH' : '18–25 MED'}
              </span>
            </div>
            <div className={styles.condItem}>
              <span className={styles.condLabel}>TOP CARRY</span>
              <span style={{ color: 'var(--accent)', fontWeight: 700 }}>{state.top_spread_pair}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Signals table */}
      <div className="panel">
        <div className="panel-title"><span className="dot" />ACTIVE SIGNALS — CMSI DIFFERENTIAL</div>
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th>PAIR</th><th>DIR</th><th>STRENGTH</th><th>DIFF</th>
                <th>KEY DRIVER</th><th>ENTRY</th><th>TARGET</th><th>STOP</th><th>CARRY</th>
              </tr>
            </thead>
            <tbody>
              {state.signals.length === 0 ? (
                <tr><td colSpan={9} style={{ textAlign: 'center', padding: '20px', color: 'var(--text-secondary)' }}>No signals above threshold</td></tr>
              ) : state.signals.map(sig => {
                const isLong = sig.direction === 'LONG'
                const strW = Math.min(100, (Math.abs(sig.diff) / 8) * 100).toFixed(0)
                const strCls = sig.strength === 'HIGH' ? 'str-high' : sig.strength === 'MED' ? 'str-med' : 'str-low'
                return (
                  <tr key={sig.pair}>
                    <td style={{ fontWeight: 700 }}>{sig.pair}</td>
                    <td><span className={isLong ? 'dir-long' : 'dir-short'}>{isLong ? '▲ LONG' : '▼ SHORT'}</span></td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div className={`str-bar-wrap ${strCls}`}><div className="str-bar-fill" style={{ width: `${strW}%` }} /></div>
                        <span style={{ fontSize: '9px', color: 'var(--text-secondary)' }}>{sig.strength}</span>
                      </div>
                    </td>
                    <td style={{ color: isLong ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>
                      {sig.diff >= 0 ? '+' : ''}{sig.diff.toFixed(1)}
                    </td>
                    <td style={{ fontSize: '9px', color: 'var(--text-secondary)' }}>{sig.key_driver}</td>
                    <td>{sig.entry ? sig.entry.toFixed(4) : '—'}</td>
                    <td style={{ color: 'var(--green)' }}>{sig.target ? sig.target.toFixed(4) : '—'}</td>
                    <td style={{ color: 'var(--red)' }}>{sig.stop_loss ? sig.stop_loss.toFixed(4) : '—'}</td>
                    <td style={{ color: sig.carry >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {sig.carry >= 0 ? '+' : ''}{sig.carry.toFixed(2)}%
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Correlation matrix */}
      <div className="panel">
        <div className="panel-title">CURRENCY CORRELATION MATRIX — 3-MONTH ROLLING</div>
        <div className={styles.corrWrap}>
          <table>
            <thead>
              <tr>
                <th></th>
                {CURS.map(c => <th key={c}>{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {CURS.map(a => (
                <tr key={a}>
                  <td style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>{a}</td>
                  {CURS.map(b => {
                    const r = state.correlation?.[a]?.[b] ?? (a === b ? 1 : 0)
                    const abs = Math.abs(r)
                    const bg = a === b
                      ? 'rgba(108,99,255,0.25)'
                      : r > 0.7 ? `rgba(0,212,170,${(abs * 0.35).toFixed(2)})`
                      : r < -0.7 ? `rgba(255,68,102,${(abs * 0.35).toFixed(2)})`
                      : 'rgba(120,120,170,0.06)'
                    const col = a === b ? 'var(--accent)' : r > 0 ? 'var(--green)' : 'var(--red)'
                    return (
                      <td key={b} style={{ background: bg, color: col, textAlign: 'center', fontWeight: 600 }}>
                        {r.toFixed(2)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
