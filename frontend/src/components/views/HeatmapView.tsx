import { useState } from 'react'
import { MacroState, FACTORS, FLAGS, provenanceBadge } from '../../types'
import styles from './HeatmapView.module.css'

interface Props { state: MacroState }
type Filter = 'all' | 'bull' | 'bear' | 'neut' | 'insuf'

const FACTOR_LABELS = [
  'TREND','SEASON','COT','CROWD','GDP','MPMI','SPMI','RETAIL',
  'CONF','CPI','PPI','PCE','RATES','NFP','URATE','CLAIMS','ADP','JOLTS','NEWS'
]

function cellClass(v: number | null): string {
  if (v === null || v === undefined) return 'hm-na'
  if (v >= 2)  return 'hm-pos2'
  if (v === 1) return 'hm-pos1'
  if (v === 0) return 'hm-zero'
  if (v === -1) return 'hm-neg1'
  return 'hm-neg2'
}

function cellLabel(v: number | null): string {
  if (v === null || v === undefined) return 'N/A'
  return (v > 0 ? '+' : '') + v
}

function scoreColor(s: number, comp: number): string {
  if (comp < 5) return 'var(--text-secondary)'
  if (s >= 2)  return 'var(--green)'
  if (s > 0)   return '#5ddfca'
  if (s === 0) return 'var(--text-secondary)'
  if (s > -2)  return '#ff8899'
  return 'var(--red)'
}

export default function HeatmapView({ state }: Props) {
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')

  const waiting = state.ts === 0

  const rows = [...state.currencies]
    .sort((a, b) => b.score - a.score)
    .filter(r => {
      if (filter === 'bull'  && r.bias !== 'Bullish') return false
      if (filter === 'bear'  && r.bias !== 'Bearish') return false
      if (filter === 'neut'  && r.bias !== 'Neutral') return false
      if (filter === 'insuf' && r.bias !== 'Insufficient') return false
      if (search && !r.code.includes(search.toUpperCase())) return false
      return true
    })

  const bulls = state.currencies.filter(c => c.bias === 'Bullish').length
  const bears = state.currencies.filter(c => c.bias === 'Bearish').length
  const neuts = state.currencies.filter(c => c.bias === 'Neutral').length
  const insuf = state.currencies.filter(c => c.bias === 'Insufficient').length

  // Data freshness banner — show if any key source is static/error
  const provenance = state.provenance ?? {}
  const staleKeys  = Object.entries(provenance).filter(([, p]) => p.source === 'static').map(([k]) => k)
  const errorKeys  = Object.entries(provenance).filter(([, p]) => p.source === 'error').map(([k]) => k)
  const noKeyKeys  = Object.entries(provenance).filter(([, p]) => p.source === 'no_key').map(([k]) => k)

  return (
    <div className={styles.wrap}>

      {/* Data freshness banner */}
      {!waiting && (staleKeys.length > 0 || errorKeys.length > 0 || noKeyKeys.length > 0) && (
        <div style={{
          padding: '6px 12px', marginBottom: '8px',
          background: 'rgba(255,200,80,0.07)',
          border: '1px solid rgba(255,200,80,0.25)',
          borderRadius: '4px', fontSize: '9px', color: 'var(--yellow)',
          display: 'flex', gap: '16px', flexWrap: 'wrap',
        }}>
          {staleKeys.length > 0 && (
            <span>⚠ STATIC DATA: {staleKeys.map(k => k.toUpperCase()).join(', ')} — scores may not reflect current market</span>
          )}
          {errorKeys.length > 0 && (
            <span style={{ color: 'var(--red)' }}>✕ FETCH ERROR: {errorKeys.map(k => k.toUpperCase()).join(', ')}</span>
          )}
          {noKeyKeys.length > 0 && (
            <span style={{ color: 'var(--text-secondary)' }}>○ NO API KEY: {noKeyKeys.map(k => k.toUpperCase()).join(', ')} — add keys in Config</span>
          )}
        </div>
      )}

      {/* Header bar */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.title}>CURRENCY STRENGTH MATRIX</span>
          <span className={styles.sub}>CMSI SCORE — 19-FACTOR COMPOSITE INDEX</span>
        </div>
        <div className={styles.headerRight}>
          <span className={styles.countBull}>▲ {bulls} BULL</span>
          <span className={styles.countBear}>▼ {bears} BEAR</span>
          <span className={styles.countNeut}>— {neuts} NEUT</span>
          {insuf > 0 && <span style={{ color: 'var(--text-secondary)', fontSize: '9px', fontWeight: 700 }}>⊘ {insuf} N/D</span>}
        </div>
      </div>

      {/* Controls */}
      <div className={styles.controls}>
        <div className={styles.filters}>
          {(['all','bull','bear','neut','insuf'] as Filter[]).map(f => (
            <button
              key={f}
              className={`${styles.filterBtn} ${filter === f ? styles.filterActive : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'insuf' ? 'N/D' : f.toUpperCase()}
            </button>
          ))}
        </div>
        <input
          className={styles.search}
          placeholder="SEARCH…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Loading state */}
      {waiting && (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary)', fontSize: '11px' }}>
          ⟳ CONNECTING TO BACKEND…
        </div>
      )}

      {/* Table */}
      {!waiting && (
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th>SYMBOL</th>
                <th>BIAS</th>
                <th>SCORE ↑</th>
                <th title="Available factors out of 19">DATA</th>
                {FACTOR_LABELS.map(f => <th key={f}>{f}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={23} style={{ textAlign: 'center', padding: '20px', color: 'var(--text-secondary)' }}>No results</td></tr>
              ) : rows.map(row => (
                <tr key={row.code}>
                  <td>
                    <span className={styles.flag}>{FLAGS[row.code]}</span>
                    <span className={styles.code}>{row.code}</span>
                  </td>
                  <td>
                    {row.bias === 'Insufficient'
                      ? <span style={{ color: 'var(--text-secondary)', fontSize: '9px', fontWeight: 700 }}>INSUF. DATA</span>
                      : <span className={row.bias === 'Bullish' ? 'tag-bull' : row.bias === 'Bearish' ? 'tag-bear' : 'tag-neut'}>
                          {row.bias.toUpperCase()}
                        </span>
                    }
                  </td>
                  <td>
                    <span style={{ fontWeight: 700, color: scoreColor(row.score, row.completeness) }}>
                      {row.completeness >= 5 ? (row.score >= 0 ? '+' : '') + row.score.toFixed(1) : '—'}
                    </span>
                  </td>
                  <td>
                    <span style={{
                      fontSize: '9px', fontWeight: 700,
                      color: row.completeness >= 10 ? 'var(--green)'
                           : row.completeness >= 5  ? 'var(--yellow)'
                           : 'var(--red)',
                    }}>{row.completeness}/19</span>
                  </td>
                  {FACTORS.map(f => {
                    const v = (row.factors as any)[f]
                    return (
                      <td key={f}>
                        <span className={`hm-cell ${cellClass(v)}`}>
                          {cellLabel(v)}
                        </span>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pair signal cards */}
      <div className={styles.pairsHeader}>
        <span className={styles.title}>ACTIVE PAIR SIGNALS</span>
        <span className={styles.sub}>CMSI DIFFERENTIAL · THRESHOLD ±{state.config?.signal_threshold ?? 3}</span>
      </div>

      {!waiting && state.signals.length === 0 && (
        <div className={styles.noSignals}>
          No signals above threshold.
          {state.currencies.some(c => c.completeness < 5)
            ? ' Add API keys in Config to improve data coverage.'
            : ' Adjust threshold in Config.'}
        </div>
      )}

      <div className={styles.pairsGrid}>
        {state.signals.map(sig => {
          const isLong = sig.direction === 'LONG'
          return (
            <div key={sig.pair} className={`${styles.pairCard} ${isLong ? styles.cardLong : styles.cardShort}`}>
              <div className={styles.cardHeader}>
                <span className={styles.cardPair}>{sig.pair}</span>
                <span className={styles.cardDiff} style={{ color: isLong ? 'var(--green)' : 'var(--red)' }}>
                  {sig.diff >= 0 ? '+' : ''}{sig.diff.toFixed(1)}
                </span>
              </div>
              <div className={styles.cardBars}>
                <div className={styles.barRow}>
                  <span className={styles.barLabel} style={{ color: 'var(--green)' }}>{sig.pair.slice(0,3)}</span>
                  <div className={styles.barTrack}>
                    <div className={styles.barFill} style={{ width: `${Math.max(0,(sig.base_score+6)/12*100).toFixed(0)}%`, background: 'var(--green)' }} />
                  </div>
                  <span className={styles.barScore} style={{ color: 'var(--green)' }}>{sig.base_score.toFixed(1)}</span>
                </div>
                <div className={styles.barRow}>
                  <span className={styles.barLabel} style={{ color: 'var(--red)' }}>{sig.pair.slice(3)}</span>
                  <div className={styles.barTrack}>
                    <div className={styles.barFill} style={{ width: `${Math.max(0,(sig.quote_score+6)/12*100).toFixed(0)}%`, background: 'var(--red)' }} />
                  </div>
                  <span className={styles.barScore} style={{ color: 'var(--red)' }}>{sig.quote_score.toFixed(1)}</span>
                </div>
              </div>
              <div className={styles.cardCarry}>
                <span style={{ color: 'var(--text-faint)', fontSize: '8px' }}>CARRY</span>
                <span style={{ color: sig.carry >= 0 ? 'var(--green)' : 'var(--red)', fontSize: '10px' }}>
                  {sig.carry >= 0 ? '+' : ''}{sig.carry.toFixed(2)}%
                </span>
              </div>
              <div className={styles.cardSignal} style={{ color: isLong ? 'var(--green)' : 'var(--red)' }}>
                {isLong ? '▲ LONG' : '▼ SHORT'} {sig.pair.slice(0,3)}
              </div>
              {sig.entry > 0 && (
                <div className={styles.cardPrice}>
                  {sig.entry.toFixed(4)}
                  {!fetcher_live_fx && <span style={{ color: 'var(--yellow)', fontSize: '8px', marginLeft: 4 }}>~</span>}
                </div>
              )}
              <div style={{ fontSize: '8px', color: 'var(--text-faint)', padding: '2px 8px' }}>{sig.key_driver}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// This is a compile-time constant — HeatmapView does not have direct access
// to fetcher. The ~ indicator on price is handled by is_live on CBRateRow instead.
const fetcher_live_fx = true  // always show price without ~ for now (handled by provenance banner)
