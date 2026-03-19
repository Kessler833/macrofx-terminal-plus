import React, { useState, useCallback, useEffect, useRef } from 'react'
import s from './ConfigView.module.css'

const ALL_PAIRS = [
  'AUDJPY','NZDJPY','USDJPY','EURUSD','GBPUSD',
  'AUDUSD','EURGBP','USDCAD','EURAUD','GBPJPY',
  'AUDNZD','EURJPY','CADJPY','CHFJPY','EURCHF',
  'GBPAUD','GBPCAD','GBPNZD','EURCAD','EURNZD',
]
const FACTORS = [
  'trend','season','cot','crowd','gdp','mpmi','spmi','retail',
  'conf','cpi','ppi','pce','rates','nfp','urate','claims','adp','jolts','news',
]

// ── Per-source schedule info returned by /api/schedule ───────────────────────
interface SourceInfo {
  label:          string
  nominal_s:      number
  buffer_s:       number
  requires_key:   boolean
  note:           string
  last_called_ts: number | null
  call_count:     number
  force_pending:  boolean
  is_fresh:       boolean
  age_s:          number | null
  next_call_ts:   number
  secs_until_due: number
  next_call_hhmm: string
}

type ScheduleMap = Record<string, SourceInfo>

const SOURCE_ORDER = ['fx', 'cb_rates', 'gdp', 'fx_history', 'cpi', 'news', 'av']

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtAge(age_s: number | null): string {
  if (age_s === null) return '—'
  if (age_s < 60)     return `${age_s}s ago`
  if (age_s < 3600)   return `${Math.floor(age_s / 60)}m ago`
  if (age_s < 86400)  return `${Math.floor(age_s / 3600)}h ago`
  return `${Math.floor(age_s / 86400)}d ago`
}

function fmtCountdown(secs: number): string {
  if (secs <= 0)     return 'NOW'
  if (secs < 60)     return `${secs}s`
  if (secs < 3600)   return `${Math.floor(secs / 60)}m ${secs % 60}s`
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`
}

function fmtNominal(s: number): string {
  if (s < 60)     return `${s}s`
  if (s < 3600)   return `${s / 60}m`
  if (s < 86400)  return `${s / 3600}h`
  return `${s / 86400}d`
}

function fmtTs(ts: number | null): string {
  if (!ts) return '—'
  try {
    const d = new Date(ts * 1000)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch { return '—' }
}

const API_BASE = 'http://localhost:8766'

async function triggerRefresh(source?: string): Promise<void> {
  const url = source
    ? `${API_BASE}/api/refresh?source=${encodeURIComponent(source)}`
    : `${API_BASE}/api/refresh`
  await fetch(url, { method: 'POST' }).catch(() => {})
}

async function fetchSchedule(): Promise<ScheduleMap | null> {
  try {
    const r = await fetch(`${API_BASE}/api/schedule`)
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <div className={s.toggle} onClick={() => onChange(!value)}>
      <div className={`${s.toggleSwitch} ${value ? s.on : ''}`}>
        <div className={s.toggleKnob} />
      </div>
      <span className={s.toggleLabel}>{label}</span>
    </div>
  )
}

function ApiDot({ status }: { status?: string }) {
  const cls   = status === 'ok' ? s.dotOk : status === 'error' ? s.dotError : status === 'no_key' ? s.dotNoKey : s.dotUnknown
  const label = status === 'ok' ? 'Connected' : status === 'error' ? 'Error' : status === 'no_key' ? 'No key' : 'Pending'
  return (
    <span className={s.apiStatus}>
      <span className={`${s.dot} ${cls}`} />
      {label}
    </span>
  )
}

// ── Live source status table ───────────────────────────────────────────────────

export function RefreshTable() {
  const [schedule, setSchedule]     = useState<ScheduleMap | null>(null)
  const [loading,  setLoading]      = useState(true)
  const [refreshing, setRefreshing] = useState<Record<string, boolean>>({})
  const [, setTicks]                = useState(0)
  const tickRef = useRef<ReturnType<typeof setInterval>>()

  const loadSchedule = useCallback(async () => {
    const data = await fetchSchedule()
    if (data) setSchedule(data)
    setLoading(false)
  }, [])

  useEffect(() => {
    loadSchedule()
    const pollInterval = setInterval(loadSchedule, 10_000)
    tickRef.current   = setInterval(() => setTicks(t => t + 1), 1000)
    return () => {
      clearInterval(pollInterval)
      if (tickRef.current) clearInterval(tickRef.current)
    }
  }, [loadSchedule])

  const handleRefreshSource = async (key: string) => {
    setRefreshing(prev => ({ ...prev, [key]: true }))
    await triggerRefresh(key)
    await loadSchedule()
    setTimeout(() => {
      setRefreshing(prev => ({ ...prev, [key]: false }))
      loadSchedule()
    }, 2500)
  }

  const handleRefreshAll = async () => {
    const next: Record<string, boolean> = {}
    SOURCE_ORDER.forEach(k => { next[k] = true })
    setRefreshing(next)
    await triggerRefresh()
    await loadSchedule()
    setTimeout(() => {
      const cleared: Record<string, boolean> = {}
      SOURCE_ORDER.forEach(k => { cleared[k] = false })
      setRefreshing(cleared)
      loadSchedule()
    }, 3000)
  }

  if (loading) {
    return (
      <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-faint)', fontSize: '10px' }}>
        Loading schedule…
      </div>
    )
  }

  if (!schedule) {
    return (
      <div style={{ padding: '12px', background: 'rgba(255,80,80,0.06)', border: '1px solid rgba(255,80,80,0.2)', borderRadius: 4, fontSize: '9px', color: 'var(--red)' }}>
        ⚠ Backend not reachable — schedule unavailable. Ensure the backend is running on port 8766.
      </div>
    )
  }

  const now = Math.floor(Date.now() / 1000)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '9px', color: 'var(--text-faint)', letterSpacing: '0.04em' }}>
          Each source has its own automatic interval · Countdown is live
        </span>
        <button
          className={s.btnRefreshAll}
          onClick={handleRefreshAll}
          disabled={Object.values(refreshing).some(Boolean)}
        >
          ↺ Refresh All
        </button>
      </div>

      <div className={s.scheduleTable}>
        <div className={s.scheduleHead}>
          <span>Source</span>
          <span>Status</span>
          <span>Last Fetched</span>
          <span>Next In</span>
          <span>Next At</span>
          <span>Interval</span>
          <span>Calls</span>
          <span></span>
        </div>

        {SOURCE_ORDER.map(key => {
          const info = schedule[key]
          if (!info) return null

          const liveSecs    = Math.max(0, info.next_call_ts - now)
          const isRefreshing = !!refreshing[key]

          let statusLabel = 'NEVER'
          let statusCls   = s.statusNever
          if (info.force_pending) {
            statusLabel = 'PENDING'; statusCls = s.statusPending
          } else if (info.is_fresh) {
            statusLabel = 'FRESH';   statusCls = s.statusFresh
          } else if (info.last_called_ts) {
            statusLabel = 'STALE';   statusCls = s.statusStale
          }

          return (
            <div key={key} className={`${s.scheduleRow} ${info.requires_key ? s.scheduleRowKeyed : ''}`}>
              <span className={s.scheduleLabel}>
                {info.requires_key && <span className={s.keyBadge}>KEY</span>}
                {info.label}
                <span className={s.scheduleNote}>{info.note}</span>
              </span>

              <span className={`${s.statusBadge} ${statusCls}`}>{statusLabel}</span>

              <span className={s.scheduleCell} style={{ fontFamily: 'var(--font-mono)' }}>
                {fmtTs(info.last_called_ts)}
                {info.age_s !== null && (
                  <span style={{ display: 'block', fontSize: '8px', color: 'var(--text-faint)', marginTop: 1 }}>
                    {fmtAge(info.age_s)}
                  </span>
                )}
              </span>

              <span
                className={s.scheduleCell}
                style={{
                  fontFamily: 'var(--font-mono)',
                  color: liveSecs === 0 ? 'var(--yellow)' : 'var(--text-primary)',
                  fontWeight: liveSecs === 0 ? 700 : 400,
                }}
              >
                {fmtCountdown(liveSecs)}
              </span>

              <span className={s.scheduleCell} style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                {info.next_call_hhmm}
              </span>

              <span className={s.scheduleCell} style={{ color: 'var(--text-faint)' }}>
                {fmtNominal(info.nominal_s)}
              </span>

              <span className={s.scheduleCell} style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                {info.call_count}
              </span>

              <span style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  className={`${s.btnRefreshRow} ${isRefreshing ? s.btnRefreshing : ''}`}
                  onClick={() => handleRefreshSource(key)}
                  disabled={isRefreshing}
                  title={`Force-refresh ${info.label}`}
                >
                  {isRefreshing ? '…' : '↺'}
                </button>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  config: Record<string, any>
  apiStatus: Record<string, string>
  onSave: (cfg: Record<string, any>) => void
}

export default function ConfigView({ config, apiStatus, onSave }: Props) {
  const [local, setLocal]         = useState<Record<string, any>>({ ...config })
  const [saved, setSaved]         = useState(false)
  const [activeTab, setActiveTab] = useState<'api' | 'strategy' | 'sources' | 'weights' | 'pairs'>('api')

  const set = (key: string, val: any) =>
    setLocal(prev => ({ ...prev, [key]: val }))

  const setWeight = (factor: string, val: string) =>
    setLocal(prev => ({
      ...prev,
      factor_weights: { ...prev.factor_weights, [factor]: parseFloat(val) || 0 },
    }))

  const togglePair = useCallback((pair: string) => {
    setLocal(prev => {
      const pairs: string[] = prev.active_pairs ?? []
      return {
        ...prev,
        active_pairs: pairs.includes(pair)
          ? pairs.filter(p => p !== pair)
          : [...pairs, pair],
      }
    })
  }, [])

  const handleSave = () => {
    onSave(local)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  const handleReset = () => setLocal({ ...config })

  const tabs: { id: typeof activeTab; label: string }[] = [
    { id: 'api',      label: '🔑 API Keys' },
    { id: 'strategy', label: '🎯 Strategy' },
    { id: 'sources',  label: '📡 Data Sources' },
    { id: 'weights',  label: '⚖️ Weights' },
    { id: 'pairs',    label: '💱 Pairs' },
  ]

  return (
    <div className={s.container}>
      <div className={s.pageHeader}>
        <h1>⚙️ Configuration</h1>
        <p>API keys, strategy parameters, factor weights and active pairs</p>
      </div>

      {/* Tab bar */}
      <div style={{
        display: 'flex', gap: 4, marginBottom: 16,
        borderBottom: '1px solid var(--border)', paddingBottom: 0,
      }}>
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '6px 12px', fontSize: '10px', fontWeight: 700,
              fontFamily: 'inherit', letterSpacing: '0.05em',
              color: activeTab === t.id ? 'var(--accent)' : 'var(--text-secondary)',
              borderBottom: activeTab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: '-1px',
              transition: 'color 0.15s, border-color 0.15s',
            }}
          >{t.label}</button>
        ))}
      </div>

      {/* ── Tab: API Keys ──────────────────────────────────────────────── */}
      {activeTab === 'api' && (
        <div className={s.section}>
          <div className={s.sectionHeader}>
            <span className={s.sectionIcon}>🔑</span>
            <span className={s.sectionTitle}>API Keys</span>
          </div>
          <div className={s.sectionBody}>
            <p style={{ fontSize: '9px', color: 'var(--text-secondary)', marginBottom: 12, maxWidth: 520 }}>
              Each user supplies their own keys — data is fetched directly from your machine to the API.
              No key is shared or stored on any server. Free-tier accounts are sufficient for all features.
            </p>
            {[
              { key: 'fred_api_key',      label: 'FRED (St. Louis Fed)',     api: 'fred', hint: 'Free at fred.stlouisfed.org — CPI, Fed Funds rate, US GDP' },
              { key: 'alpha_vantage_key', label: 'Alpha Vantage (FX Trend)', api: 'av',   hint: 'Free at alphavantage.co — weekly FX trend calculation (25 req/day free)' },
              { key: 'news_api_key',      label: 'NewsAPI (Sentiment)',       api: 'news', hint: 'Free at newsapi.org — news sentiment scoring (100 req/day free)' },
            ].map(({ key, label, api, hint }) => (
              <div className={s.field} key={key}>
                <div className={s.fieldRow}>
                  <span className={s.label}>{label}</span>
                  <ApiDot status={apiStatus?.[api]} />
                </div>
                <input
                  className={`${s.input} ${s.inputMono}`}
                  type="password"
                  placeholder="Enter API key…"
                  value={local[key] ?? ''}
                  onChange={e => set(key, e.target.value)}
                  autoComplete="off"
                />
                <span className={s.hint}>{hint}</span>
              </div>
            ))}
            <div style={{ marginTop: 12, padding: '8px 10px', background: 'rgba(80,180,255,0.05)', border: '1px solid rgba(80,180,255,0.15)', borderRadius: 4, fontSize: '9px', color: 'var(--text-secondary)' }}>
              <strong style={{ color: 'var(--accent)' }}>No-key sources (always live):</strong>{' '}
              Frankfurter.app (FX rates) · ECB Data Portal (EUR rate) · World Bank (GDP)
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Strategy ─────────────────────────────────────────────── */}
      {activeTab === 'strategy' && (
        <div className={s.section}>
          <div className={s.sectionHeader}>
            <span className={s.sectionIcon}>🎯</span>
            <span className={s.sectionTitle}>Strategy Parameters</span>
          </div>
          <div className={s.sectionBody}>
            {[
              { key: 'signal_threshold', label: 'Signal Threshold',     hint: 'Min CMSI diff to open trade (1–10)', min: 0.5, max: 10,  step: 0.5 },
              { key: 'min_hold_days',    label: 'Min Hold Days',         hint: 'Minimum trade duration in days',     min: 1,   max: 90,  step: 1   },
              { key: 'max_hold_days',    label: 'Max Hold Days',         hint: 'Force-exit after N days',            min: 7,   max: 365, step: 1   },
              { key: 'max_positions',    label: 'Max Open Positions',    hint: 'Simultaneous trades allowed',        min: 1,   max: 10,  step: 1   },
            ].map(({ key, label, hint, min, max, step }) => (
              <div className={s.field} key={key}>
                <div className={s.fieldRow}>
                  <span className={s.label}>{label}</span>
                  <input
                    className={`${s.input} ${s.inputSmall}`}
                    type="number"
                    min={min} max={max} step={step}
                    value={local[key] ?? ''}
                    onChange={e => set(key, parseFloat(e.target.value))}
                  />
                </div>
                <span className={s.hint}>{hint}</span>
              </div>
            ))}
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Toggle value={!!local.use_news}          onChange={v => set('use_news', v)}          label="Use news sentiment scoring" />
              <Toggle value={!!local.use_cot}           onChange={v => set('use_cot', v)}           label="Use COT positioning data" />
              <Toggle value={!!local.use_carry_filter}  onChange={v => set('use_carry_filter', v)}  label="Carry environment filter" />
              <Toggle value={!!local.use_trend_confirm} onChange={v => set('use_trend_confirm', v)} label="Trend confirmation (AV)" />
              <Toggle value={!!local.use_regime_filter} onChange={v => set('use_regime_filter', v)} label="Market regime filter" />
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Data Sources (live scheduler status) ─────────────────────── */}
      {activeTab === 'sources' && (
        <div className={s.section}>
          <div className={s.sectionHeader}>
            <span className={s.sectionIcon}>📡</span>
            <span className={s.sectionTitle}>Data Sources — Live Status</span>
          </div>
          <div className={s.sectionBody}>
            <p style={{ fontSize: '9px', color: 'var(--text-secondary)', marginBottom: 12, maxWidth: 560, lineHeight: 1.6 }}>
              Each source fetches on its own automatic schedule based on API rate limits.
              Use the <strong style={{ color: 'var(--accent)' }}>↺</strong> buttons to force an immediate refresh of any source.
            </p>
            <RefreshTable />
          </div>
        </div>
      )}

      {/* ── Tab: Weights ──────────────────────────────────────────────── */}
      {activeTab === 'weights' && (
        <div className={s.section}>
          <div className={s.sectionHeader}>
            <span className={s.sectionIcon}>⚖️</span>
            <span className={s.sectionTitle}>Factor Weights — CMSI Engine</span>
          </div>
          <div className={s.sectionBody}>
            <span className={s.hint}>Higher weight = greater influence on CMSI score. All values are relative.</span>
            <div className={s.weightGrid}>
              {FACTORS.map(f => (
                <div className={s.weightItem} key={f}>
                  <span className={s.weightName}>{f}</span>
                  <input
                    className={s.weightInput}
                    type="number"
                    min={0} max={50} step={1}
                    value={local.factor_weights?.[f] ?? 5}
                    onChange={e => setWeight(f, e.target.value)}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Active Pairs ─────────────────────────────────────────── */}
      {activeTab === 'pairs' && (
        <div className={s.section}>
          <div className={s.sectionHeader}>
            <span className={s.sectionIcon}>💱</span>
            <span className={s.sectionTitle}>Active Trading Pairs</span>
          </div>
          <div className={s.sectionBody}>
            <span className={s.hint}>Click to toggle. Active pairs are included in signal generation and backtest.</span>
            <div className={s.pairsGrid}>
              {ALL_PAIRS.map(pair => {
                const active = (local.active_pairs ?? []).includes(pair)
                return (
                  <div
                    key={pair}
                    className={`${s.pairChip} ${active ? s.active : ''}`}
                    onClick={() => togglePair(pair)}
                  >
                    <span className={s.pairDot} />
                    {pair}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Actions ───────────────────────────────────────────────────── */}
      <div className={s.actions}>
        <button className={s.btnSave} onClick={handleSave}>
          {saved ? '✓ Saved' : '💾 Save Config'}
        </button>
        <button className={s.btnReset} onClick={handleReset}>↺ Reset</button>
      </div>
    </div>
  )
}
