import { useState } from 'react'
import { MacroState, FACTORS, FLAGS } from '../../types'
import styles from './HeatmapView.module.css'

interface Props { state: MacroState }

type Filter = 'all' | 'bull' | 'bear' | 'neut'

const FACTOR_LABELS = [
  'TREND','SEASON','COT','CROWD','GDP','MPMI','SPMI','RETAIL',
  'CONF','CPI','PPI','PCE','RATES','NFP','URATE','CLAIMS','ADP','JOLTS','NEWS'
]

function cellClass(v: number): string {
  if (v >= 2)  return 'hm-pos2'
  if (v === 1) return 'hm-pos1'
  if (v === 0) return 'hm-zero'
  if (v === -1) return 'hm-neg1'
  return 'hm-neg2'
}

function scoreColor(s: number): string {
  if (s >= 2)  return 'var(--green)'
  if (s > 0)   return '#5ddfca'
  if (s === 0) return 'var(--text-secondary)'
  if (s > -2)  return '#ff8899'
  return 'var(--red)'
}

export default function HeatmapView({ state }: Props) {
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')

  const rows = [...state.currencies]
    .sort((a, b) => b.score - a.score)
    .filter(r => {
      if (filter === 'bull' && r.bias !== 'Bullish') return false
      if (filter === 'bear' && r.bias !== 'Bearish') return false
      if (filter === 'neut' && r.bias !== 'Neutral') return false
      if (search && !r.code.includes(search.toUpperCase())) return false
      return true
    })

  const bulls = state.currencies.filter(c => c.bias === 'Bullish').length
  const bears = state.currencies.filter(c => c.bias === 'Bearish').length
  const neuts = state.currencies.filter(c => c.bias === 'Neutral').length

  return (
    <div className={styles.wrap}>
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
        </div>
      </div>

      {/* Controls */}
      <div className={styles.controls}>
        <div className={styles.filters}>
          {(['all','bull','bear','neut'] as Filter[]).map(f => (
            <button
              key={f}
              className={`${styles.filterBtn} ${filter === f ? styles.filterActive : ''}`}
              onClick={() => setFilter(f)}
            >
              {f.toUpperCase()}
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

      {/* Table */}
      <div className={styles.tableWrap}>
        <table>
          <thead>
            <tr>
              <th>SYMBOL</th>
              <th>BIAS</th>
              <th>SCORE ↑</th>
              {FACTOR_LABELS.map(f => <th key={f}>{f}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={22} style={{ textAlign: 'center', padding: '20px', color: 'var(--text-secondary)' }}>No results</td></tr>
            ) : rows.map(row => (
              <tr key={row.code}>
                <td>
                  <span className={styles.flag}>{FLAGS[row.code]}</span>
                  <span className={styles.code}>{row.code}</span>
                </td>
                <td>
                  <span className={
                    row.bias === 'Bullish' ? 'tag-bull' :
                    row.bias === 'Bearish' ? 'tag-bear' : 'tag-neut'
                  }>{row.bias.toUpperCase()}</span>
                </td>
                <td>
                  <span style={{ fontWeight: 700, color: scoreColor(row.score) }}>
                    {row.score >= 0 ? '+' : ''}{row.score.toFixed(1)}
                  </span>
                </td>
                {FACTORS.map(f => {
                  const v = (row.factors as any)[f] ?? 0
                  return (
                    <td key={f}>
                      <span className={`hm-cell ${cellClass(v)}`}>
                        {v > 0 ? '+' : ''}{v}
                      </span>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pair signal cards */}
      <div className={styles.pairsHeader}>
        <span className={styles.title}>ACTIVE PAIR SIGNALS</span>
        <span className={styles.sub}>CMSI DIFFERENTIAL · THRESHOLD ±{state.config?.signal_threshold ?? 3}</span>
      </div>
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
                <div className={styles.cardPrice}>{sig.entry.toFixed(4)}</div>
              )}
            </div>
          )
        })}
        {state.signals.length === 0 && (
          <div className={styles.noSignals}>No signals above threshold. Adjust threshold in Config.</div>
        )}
      </div>
    </div>
  )
}
