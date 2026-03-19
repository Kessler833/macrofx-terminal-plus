import { MacroState } from '../../types'
import styles from './MacroView.module.css'

interface Props { state: MacroState }

export default function MacroView({ state }: Props) {
  const maxRate = Math.max(...state.cb_rates.map(r => r.rate), 0.01)

  return (
    <div className={styles.wrap}>
      {/* CB Rates table */}
      <div className="panel">
        <div className="panel-title"><span className="dot" />CENTRAL BANK POLICY RATES — PRIMARY DRIVER OF CARRY TRADES</div>
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th>CURRENCY</th><th>BANK</th><th>RATE</th><th>CHANGE</th>
                <th>NEXT MTG</th><th>STANCE</th><th>RELATIVE</th>
              </tr>
            </thead>
            <tbody>
              {state.cb_rates.map(r => (
                <tr key={r.currency}>
                  <td style={{ fontWeight: 700 }}>{r.currency}</td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: '10px' }}>{r.bank}</td>
                  <td style={{ fontWeight: 700, color: 'var(--cyan)' }}>{r.rate.toFixed(2)}%</td>
                  <td style={{ color: r.change > 0 ? 'var(--green)' : r.change < 0 ? 'var(--red)' : 'var(--text-secondary)', fontWeight: 600 }}>
                    {r.change >= 0 ? '+' : ''}{r.change.toFixed(2)}%
                  </td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: '10px' }}>{r.next_mtg}</td>
                  <td>
                    <span style={{
                      color: r.stance === 'Hawkish' ? 'var(--green)' : r.stance === 'Dovish' ? 'var(--red)' : 'var(--yellow)',
                      fontWeight: 700, fontSize: '10px'
                    }}>{r.stance.toUpperCase()}</span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <div style={{ width: '80px', height: '4px', background: 'rgba(120,120,170,0.15)', borderRadius: '2px' }}>
                        <div style={{ width: `${r.relative}%`, height: '100%', background: 'var(--cyan)', borderRadius: '2px' }} />
                      </div>
                      <span style={{ fontSize: '9px', color: 'var(--text-secondary)' }}>{r.relative}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Rate differentials */}
      <div className="panel">
        <div className="panel-title">INTEREST RATE DIFFERENTIALS — KEY PAIRS</div>
        <div className={styles.diffGrid}>
          {state.rate_diffs.map(d => (
            <div key={d.pair} className={styles.diffCard}>
              <span className={styles.diffPair}>{d.pair}</span>
              <div className={styles.diffBarWrap}>
                <div
                  className={styles.diffBar}
                  style={{
                    width: `${Math.min(100, Math.abs(d.diff) / 5 * 100).toFixed(0)}%`,
                    background: d.diff >= 0 ? 'var(--green)' : 'var(--red)',
                  }}
                />
              </div>
              <span className={styles.diffVal} style={{ color: d.diff >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {d.diff >= 0 ? '+' : ''}{d.diff.toFixed(2)}%
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Currency macro cards */}
      <div className="panel-title" style={{ padding: '0 0 6px 0', marginTop: '4px' }}>
        <span className="dot" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block', marginRight: 8 }} />
        CURRENCY MACRO OVERVIEW
      </div>
      <div className={styles.macroGrid}>
        {state.currencies.map(cur => {
          const scoreColor = cur.score > 2 ? 'var(--green)' : cur.score < -2 ? 'var(--red)' : 'var(--yellow)'
          const cb = state.cb_rates.find(r => r.currency === cur.code)
          return (
            <div key={cur.code} className={styles.macroCard}>
              <div className={styles.macroCardHeader}>
                <span className={styles.macroCode}>{cur.code}</span>
                <span className={`${cur.bias === 'Bullish' ? 'tag-bull' : cur.bias === 'Bearish' ? 'tag-bear' : 'tag-neut'}`}>
                  {cur.bias.toUpperCase()}
                </span>
                <span className={styles.macroScore} style={{ color: scoreColor }}>
                  {cur.score >= 0 ? '+' : ''}{cur.score.toFixed(1)}
                </span>
              </div>
              {cb && (
                <div className={styles.macroRate}>
                  <span style={{ color: 'var(--text-faint)', fontSize: '8px' }}>RATE</span>
                  <span style={{ color: 'var(--cyan)', fontWeight: 700 }}>{cb.rate.toFixed(2)}%</span>
                  <span style={{ color: cb.stance === 'Hawkish' ? 'var(--green)' : cb.stance === 'Dovish' ? 'var(--red)' : 'var(--yellow)', fontSize: '9px' }}>
                    {cb.stance.toUpperCase()}
                  </span>
                </div>
              )}
              <div className={styles.macroFactors}>
                {(['cpi','gdp','rates','trend'] as const).map(f => {
                  const v = (cur.factors as any)[f] ?? 0
                  return (
                    <div key={f} className={styles.macroFactor}>
                      <span style={{ fontSize: '8px', color: 'var(--text-faint)' }}>{f.toUpperCase()}</span>
                      <span style={{ fontWeight: 700, fontSize: '10px', color: v > 0 ? 'var(--green)' : v < 0 ? 'var(--red)' : 'var(--text-secondary)' }}>
                        {v > 0 ? '+' : ''}{v}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
