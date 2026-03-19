import { MacroState, provenanceBadge } from '../../types'
import styles from './MacroView.module.css'

interface Props { state: MacroState }

// Safe number helpers — never crash on null/undefined from backend
const fmt = (v: number | null | undefined, decimals = 2, fallback = '—') =>
  v == null ? fallback : v.toFixed(decimals)

const fmtSigned = (v: number | null | undefined, decimals = 2) =>
  v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(decimals)

export default function MacroView({ state }: Props) {
  const waiting    = state.ts === 0
  const provenance = state.provenance ?? {}
  const cbProv     = provenance.cb_rates
  const gdpProv    = provenance.gdp

  return (
    <div className={styles.wrap}>

      {/* CB Rates table */}
      <div className="panel">
        <div className="panel-title">
          <span className="dot" />
          CENTRAL BANK POLICY RATES — PRIMARY DRIVER OF CARRY TRADES
          {cbProv && (
            <span style={{
              marginLeft: 'auto', fontSize: '8px', fontWeight: 700,
              color: provenanceBadge(cbProv.source).color,
              border: `1px solid ${provenanceBadge(cbProv.source).color}`,
              padding: '1px 5px', borderRadius: '3px',
            }}>
              {provenanceBadge(cbProv.source).label}
              {cbProv.age_s != null ? ` · ${Math.round(cbProv.age_s / 60)}m ago` : ''}
            </span>
          )}
        </div>

        {cbProv?.is_static && (
          <div style={{ padding: '4px 8px', marginBottom: '4px', background: 'rgba(255,200,80,0.06)', border: '1px solid rgba(255,200,80,0.2)', borderRadius: '3px', fontSize: '9px', color: 'var(--yellow)' }}>
            ⚠ Showing cached March 2026 CB rates — ECB API unavailable. FRED key adds live USD rate.
          </div>
        )}

        <div className={styles.tableWrap}>
          {waiting ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '11px' }}>⟳ LOADING…</div>
          ) : state.cb_rates.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--red)', fontSize: '11px' }}>✕ CB RATE DATA UNAVAILABLE</div>
          ) : (
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
                    <td style={{ fontWeight: 700 }}>
                      {r.currency}
                      {!r.is_live && <span title="Static data" style={{ color: 'var(--yellow)', fontSize: '8px', marginLeft: 4 }}>~</span>}
                    </td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '10px' }}>{r.bank}</td>
                    <td style={{ fontWeight: 700, color: 'var(--cyan)' }}>{fmt(r.rate)}%</td>
                    <td style={{
                      color: (r.change ?? 0) > 0 ? 'var(--green)' : (r.change ?? 0) < 0 ? 'var(--red)' : 'var(--text-secondary)',
                      fontWeight: 600,
                    }}>
                      {fmtSigned(r.change)}%
                    </td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '10px' }}>{r.next_mtg}</td>
                    <td>
                      <span style={{
                        color: r.stance === 'Hawkish' ? 'var(--green)' : r.stance === 'Dovish' ? 'var(--red)' : 'var(--yellow)',
                        fontWeight: 700, fontSize: '10px'
                      }}>{(r.stance ?? '—').toUpperCase()}</span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div style={{ width: '80px', height: '4px', background: 'rgba(120,120,170,0.15)', borderRadius: '2px' }}>
                          <div style={{ width: `${r.relative ?? 0}%`, height: '100%', background: 'var(--cyan)', borderRadius: '2px' }} />
                        </div>
                        <span style={{ fontSize: '9px', color: 'var(--text-secondary)' }}>{r.relative ?? 0}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Rate differentials */}
      <div className="panel">
        <div className="panel-title">INTEREST RATE DIFFERENTIALS — KEY PAIRS</div>
        {state.rate_diffs.length === 0 ? (
          <div style={{ padding: '12px', color: 'var(--text-secondary)', fontSize: '10px' }}>—</div>
        ) : (
          <div className={styles.diffGrid}>
            {state.rate_diffs.map(d => (
              <div key={d.pair} className={styles.diffCard}>
                <span className={styles.diffPair}>{d.pair}</span>
                <div className={styles.diffBarWrap}>
                  <div className={styles.diffBar} style={{
                    width: `${Math.min(100, Math.abs(d.diff ?? 0) / 5 * 100).toFixed(0)}%`,
                    background: (d.diff ?? 0) >= 0 ? 'var(--green)' : 'var(--red)',
                  }} />
                </div>
                <span className={styles.diffVal} style={{ color: (d.diff ?? 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {fmtSigned(d.diff)}%
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Currency macro cards */}
      <div className="panel-title" style={{ padding: '0 0 6px 0', marginTop: '4px' }}>
        <span className="dot" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block', marginRight: 8 }} />
        CURRENCY MACRO OVERVIEW
        {gdpProv && (
          <span style={{
            marginLeft: 8, fontSize: '8px', fontWeight: 700,
            color: provenanceBadge(gdpProv.source).color,
          }}>{provenanceBadge(gdpProv.source).label} GDP</span>
        )}
      </div>

      {waiting ? (
        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '11px' }}>⟳ LOADING…</div>
      ) : state.currencies.length === 0 ? (
        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--red)', fontSize: '11px' }}>✕ NO CURRENCY DATA — CHECK BACKEND CONNECTION</div>
      ) : (
        <div className={styles.macroGrid}>
          {state.currencies.map(cur => {
            const score = cur.score ?? 0
            const scoreColor = cur.completeness < 5 ? 'var(--text-secondary)'
                              : score > 2  ? 'var(--green)'
                              : score < -2 ? 'var(--red)'
                              : 'var(--yellow)'
            const cb = state.cb_rates.find(r => r.currency === cur.code)
            return (
              <div key={cur.code} className={styles.macroCard}>
                <div className={styles.macroCardHeader}>
                  <span className={styles.macroCode}>{cur.code}</span>
                  {cur.bias === 'Insufficient'
                    ? <span style={{ color: 'var(--text-secondary)', fontSize: '8px' }}>INSUF.</span>
                    : <span className={cur.bias === 'Bullish' ? 'tag-bull' : cur.bias === 'Bearish' ? 'tag-bear' : 'tag-neut'}>
                        {cur.bias.toUpperCase()}
                      </span>
                  }
                  <span className={styles.macroScore} style={{ color: scoreColor }}>
                    {cur.completeness >= 5 ? fmtSigned(cur.score, 1) : '—'}
                  </span>
                </div>
                <div style={{ fontSize: '8px', color: 'var(--text-faint)', padding: '0 8px 2px' }}>
                  {cur.completeness}/19 factors
                </div>
                {cb && (
                  <div className={styles.macroRate}>
                    <span style={{ color: 'var(--text-faint)', fontSize: '8px' }}>RATE{!cb.is_live ? ' ~' : ''}</span>
                    <span style={{ color: 'var(--cyan)', fontWeight: 700 }}>{fmt(cb.rate)}%</span>
                    <span style={{ color: cb.stance === 'Hawkish' ? 'var(--green)' : cb.stance === 'Dovish' ? 'var(--red)' : 'var(--yellow)', fontSize: '9px' }}>
                      {(cb.stance ?? '—').toUpperCase()}
                    </span>
                  </div>
                )}
                <div className={styles.macroFactors}>
                  {(['cpi','gdp','rates','trend'] as const).map(f => {
                    const v = (cur.factors as any)[f]
                    const isNA = v == null
                    return (
                      <div key={f} className={styles.macroFactor}>
                        <span style={{ fontSize: '8px', color: 'var(--text-faint)' }}>{f.toUpperCase()}</span>
                        <span style={{
                          fontWeight: 700, fontSize: '10px',
                          color: isNA ? 'var(--text-faint)'
                               : v > 0 ? 'var(--green)'
                               : v < 0 ? 'var(--red)'
                               : 'var(--text-secondary)',
                        }}>
                          {isNA ? 'N/A' : (v > 0 ? '+' : '') + v}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
