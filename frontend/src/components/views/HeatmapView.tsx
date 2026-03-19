import { useState } from 'react'
import { MacroState, FACTORS, FLAGS, provenanceBadge } from '../../types'
import styles from './HeatmapView.module.css'

interface Props { state: MacroState }
type Filter = 'all' | 'bull' | 'bear' | 'neut' | 'insuf'

const FACTOR_LABELS = [
  'TREND','SEASON','COT','CROWD','GDP','MPMI','SPMI','RETAIL',
  'CONF','CPI','PPI','PCE','RATES','NFP','URATE','CLAIMS','ADP','JOLTS','NEWS'
]

// ── Which data source drives each factor column ───────────────────────────────
const FACTOR_SOURCE_MAP: Record<string, string> = {
  trend: 'av', season: '', cot: '', crowd: '', gdp: 'gdp',
  mpmi: '', spmi: '', retail: '', conf: '',
  cpi: 'cpi', ppi: 'cpi', pce: 'cpi',
  rates: 'cb_rates',
  nfp: 'cpi', urate: 'cpi', claims: 'cpi', adp: 'cpi', jolts: 'cpi',
  news: 'news',
}

function cellClass(v: number | null | undefined): string {
  if (v === null || v === undefined) return 'hm-na'
  if (v >= 2)   return 'hm-pos2'
  if (v === 1)  return 'hm-pos1'
  if (v === 0)  return 'hm-zero'
  if (v === -1) return 'hm-neg1'
  return 'hm-neg2'
}

function cellLabel(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—'
  return (v > 0 ? '+' : '') + v
}

function scoreColor(s: number, comp: number): string {
  if (comp < 5) return 'var(--text-secondary)'
  if (s >= 2)   return 'var(--green)'
  if (s > 0)    return '#5ddfca'
  if (s === 0)  return 'var(--text-secondary)'
  if (s > -2)   return '#ff8899'
  return 'var(--red)'
}

// ── Error type labels for tooltips ────────────────────────────────────────────
const ERROR_TYPE_LABELS: Record<string, string> = {
  NO_KEY:        'No API key — add in Config',
  RATE_LIMIT:    'API rate limit reached',
  HTTP_ERROR:    'HTTP error from API',
  TIMEOUT:       'Request timed out',
  PARSE_ERROR:   'Could not parse API response',
  NETWORK:       'Network / connection error',
  EMPTY_RESPONSE:'API returned empty data',
}

function errorLabel(errObj: any): string {
  if (!errObj) return ''
  const typeLabel = ERROR_TYPE_LABELS[errObj.error_type] ?? errObj.error_type
  const code = errObj.http_code ? ` [HTTP ${errObj.http_code}]` : ''
  return `${typeLabel}${code}: ${errObj.error ?? ''}`
}

// ── Per-row warning: which factors are missing and why ───────────────────────
function MissingFactorBadge({ factor, provenance, apiErrors }: {
  factor: string
  provenance: Record<string, any>
  apiErrors: Record<string, any>
}) {
  const src = FACTOR_SOURCE_MAP[factor]
  if (!src) return null
  const prov = provenance[src]
  const err  = apiErrors?.[src]
  if (!prov || prov.source === 'live') return null

  const tip = err ? errorLabel(err) : prov.source === 'no_key' ? 'No API key' : 'Not available'
  const color = prov.source === 'no_key' ? 'var(--text-faint)' : 'var(--red)'

  return (
    <span
      title={tip}
      style={{ color, fontSize: '8px', fontWeight: 700, marginLeft: 2, cursor: 'help' }}
    >
      {prov.source === 'no_key' ? '○' : '✕'}
    </span>
  )
}

export default function HeatmapView({ state }: Props) {
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [expandedRow, setExpandedRow] = useState<string | null>(null)

  const waiting = state.ts === 0

  const provenance = state.provenance ?? {}
  const apiErrors  = (state as any).api_errors ?? {}

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

  // ── Status banner classification ────────────────────────────────────────
  const errorKeys  = Object.entries(provenance).filter(([, p]: any) => p.source === 'error').map(([k]) => k)
  const noKeyKeys  = Object.entries(provenance).filter(([, p]: any) => p.source === 'no_key').map(([k]) => k)
  // 'static' source is no longer emitted by the backend — left here as safety guard
  const staleKeys  = Object.entries(provenance).filter(([, p]: any) => p.source === 'static').map(([k]) => k)

  return (
    <div className={styles.wrap}>

      {/* ── Status banner ─────────────────────────────────────────────── */}
      {!waiting && (staleKeys.length > 0 || errorKeys.length > 0 || noKeyKeys.length > 0) && (
        <div style={{
          padding: '6px 12px', marginBottom: '8px',
          background: 'rgba(255,100,80,0.06)',
          border: '1px solid rgba(255,100,80,0.2)',
          borderRadius: '4px', fontSize: '9px',
          display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-start',
        }}>
          {errorKeys.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              <span style={{ color: 'var(--red)', fontWeight: 700 }}>
                ✕ FETCH ERRORS — these factors show — in the table:
              </span>
              {errorKeys.map(k => {
                const err = apiErrors[k]
                return (
                  <span key={k} style={{ color: 'rgba(255,80,80,0.85)', paddingLeft: 8 }}>
                    {k.toUpperCase()}: {err ? errorLabel(err) : 'unknown error'}
                  </span>
                )
              })}
            </div>
          )}
          {noKeyKeys.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              <span style={{ color: 'var(--yellow)', fontWeight: 700 }}>
                ○ NO API KEY — add in Config to enable:
              </span>
              {noKeyKeys.map(k => (
                <span key={k} style={{ color: 'rgba(255,200,80,0.75)', paddingLeft: 8 }}>
                  {k.toUpperCase()}
                </span>
              ))}
            </div>
          )}
          {staleKeys.length > 0 && (
            <span style={{ color: 'var(--yellow)' }}>
              ⚠ STALE DATA: {staleKeys.map(k => k.toUpperCase()).join(', ')}
            </span>
          )}
        </div>
      )}

      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.title}>CURRENCY STRENGTH MATRIX</span>
          <span className={styles.sub}>CMSI SCORE — 19-FACTOR COMPOSITE</span>
        </div>
        <div className={styles.headerRight}>
          <span className={styles.countBull}>▲ {bulls} BULL</span>
          <span className={styles.countBear}>▼ {bears} BEAR</span>
          <span className={styles.countNeut}>— {neuts} NEUT</span>
          {insuf > 0 && <span style={{ color: 'var(--text-secondary)', fontSize: '9px', fontWeight: 700 }}>⊘ {insuf} N/D</span>}
        </div>
      </div>

      {/* ── Controls ──────────────────────────────────────────────────── */}
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

      {/* ── Loading state ─────────────────────────────────────────────── */}
      {waiting && (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary)', fontSize: '11px' }}>
          ⟳ CONNECTING TO BACKEND…
        </div>
      )}

      {/* ── Table ─────────────────────────────────────────────────────── */}
      {!waiting && (
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th>SYMBOL</th>
                <th>BIAS</th>
                <th>SCORE ↑</th>
                <th title="Available factors / 19">DATA</th>
                {FACTOR_LABELS.map(f => <th key={f}>{f}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={23} style={{ textAlign: 'center', padding: '20px', color: 'var(--text-secondary)' }}>No results</td></tr>
              ) : rows.map(row => {
                const hasMissing = (row as any).missing_factors?.length > 0
                const isExpanded = expandedRow === row.code
                return (
                  <>
                    <tr
                      key={row.code}
                      style={hasMissing ? { borderLeft: '2px solid rgba(255,140,0,0.45)' } : undefined}
                      onClick={() => hasMissing ? setExpandedRow(isExpanded ? null : row.code) : undefined}
                      title={hasMissing ? 'Click to see missing factors' : undefined}
                    >
                      <td>
                        <span className={styles.flag}>{FLAGS[row.code]}</span>
                        <span className={styles.code}>{row.code}</span>
                        {hasMissing && (
                          <span
                            title={`Missing: ${(row as any).missing_factors?.join(', ')}`}
                            style={{ color: 'rgba(255,140,0,0.7)', fontSize: '8px', marginLeft: 4, cursor: 'help' }}
                          >⚠</span>
                        )}
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
                          {row.completeness >= 5
                            ? ((row as any).is_partial ? '~' : '') + (row.score >= 0 ? '+' : '') + row.score.toFixed(1)
                            : '—'
                          }
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
                        const v   = (row.factors as any)[f]
                        const src = FACTOR_SOURCE_MAP[f]
                        const prov = src ? provenance[src] : null
                        const err  = src ? apiErrors[src]  : null
                        const isErr = prov && prov.source !== 'live' && prov.source !== 'pending'
                        const tip = isErr && err ? errorLabel(err)
                                  : isErr && prov?.source === 'no_key' ? `${f.toUpperCase()}: No API key — add in Config`
                                  : isErr ? `${f.toUpperCase()}: data unavailable`
                                  : undefined
                        return (
                          <td key={f} title={tip}>
                            <span
                              className={`hm-cell ${cellClass(v)}`}
                              style={isErr && v === null ? { opacity: 0.45, cursor: 'help' } : undefined}
                            >
                              {cellLabel(v)}
                              {isErr && v === null && (
                                <sup style={{ fontSize: '6px', marginLeft: 1 }}>
                                  {prov.source === 'no_key' ? '○' : '✕'}
                                </sup>
                              )}
                            </span>
                          </td>
                        )
                      })}
                    </tr>

                    {/* ── Expanded missing-factor detail row ──────────── */}
                    {isExpanded && hasMissing && (
                      <tr key={`${row.code}-detail`} style={{ background: 'rgba(255,100,0,0.04)' }}>
                        <td colSpan={23} style={{ padding: '6px 12px 8px 24px', fontSize: '9px', color: 'var(--text-secondary)' }}>
                          <span style={{ color: 'rgba(255,140,0,0.8)', fontWeight: 700 }}>MISSING FACTORS FOR {row.code}: </span>
                          {(row as any).missing_factors?.map((f: string) => {
                            const src = FACTOR_SOURCE_MAP[f]
                            const err = src ? apiErrors[src] : null
                            const prov = src ? provenance[src] : null
                            const why = err ? errorLabel(err)
                                       : prov?.source === 'no_key' ? 'No API key'
                                       : prov?.source === 'error'  ? 'Fetch error'
                                       : 'Not available'
                            return (
                              <span key={f} style={{ marginRight: 12 }}>
                                <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{f.toUpperCase()}</span>
                                {src && <span style={{ color: 'var(--text-faint)' }}> ({why})</span>}
                              </span>
                            )
                          })}
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Pair signal cards ─────────────────────────────────────────── */}
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
          const isLong  = sig.direction === 'LONG'
          const noPrice = !sig.entry || sig.entry === 0
          const fxLive  = provenance['fx']?.source === 'live'
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {noPrice ? (
                  <span
                    style={{ fontSize: '9px', color: 'var(--red)', padding: '2px 8px' }}
                    title={provenance['fx']?.error ? errorLabel(provenance['fx'].error) : 'FX rates not loaded'}
                  >
                    ✕ PRICE UNAVAILABLE
                    {provenance['fx']?.error?.error_type
                      ? ` (${ERROR_TYPE_LABELS[provenance['fx'].error.error_type] ?? provenance['fx'].error.error_type})`
                      : ''}
                  </span>
                ) : (
                  <>
                    <span className={styles.cardPrice}>{sig.entry.toFixed(4)}</span>
                    {!fxLive && (
                      <span
                        style={{ color: 'var(--yellow)', fontSize: '8px' }}
                        title="FX rate data not confirmed live"
                      >~</span>
                    )}
                  </>
                )}
              </div>
              <div style={{ fontSize: '8px', color: 'var(--text-faint)', padding: '2px 8px' }}>{sig.key_driver}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
