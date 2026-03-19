import React, { useState, useCallback } from 'react'
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

// ── Refresh interval options ──────────────────────────────────────────────────
// Designed to stay within free-tier API limits:
//   - Frankfurter (FX): no hard limit — safe at any interval
//   - World Bank GDP: ~10 req/s, data changes quarterly — no concern
//   - ECB: no hard limit — safe at any interval
//   - FRED: 120 calls/min per key — safe even at 15 min interval
//   - NewsAPI free: 100 requests/day → min safe interval = 100 / 8 currencies = 12.5 req/call → 12 calls/day max → ~2h
//   - Alpha Vantage free: 25 req/day → 7 currencies per call → 3 full calls/day → min ~8h
// The "Fastest" option is calibrated to NewsAPI (2h) as the tightest constraint.
const REFRESH_OPTIONS: { label: string; value: number; note: string }[] = [
  { value: 7200,  label: 'Fastest (~2h)',  note: 'Min safe for NewsAPI free tier (100 req/day)' },
  { value: 900,   label: '15 min',         note: 'Good for FX + FRED only; skips news/AV on free tiers' },
  { value: 1800,  label: '30 min',         note: 'Recommended for FX + FRED + ECB' },
  { value: 3600,  label: '1 hour',         note: 'Balanced — all sources, light on rate limits' },
  { value: 5400,  label: '1.5 hours',      note: 'Comfortable buffer for all free-tier APIs' },
  { value: 14400, label: '4 hours',        note: 'Conservative — lowest API usage' },
  { value: 28800, label: '8 hours',        note: 'Safe for AV free tier (25 req/day)' },
  { value: 86400, label: 'Daily (24h)',    note: 'Lowest possible API usage — macro data rarely changes faster' },
]

interface Props {
  config: Record<string, any>
  apiStatus: Record<string, string>
  onSave: (cfg: Record<string, any>) => void
}

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

export default function ConfigView({ config, apiStatus, onSave }: Props) {
  const [local, setLocal]   = useState<Record<string, any>>({ ...config })
  const [saved, setSaved]   = useState(false)
  const [activeTab, setActiveTab] = useState<'api' | 'strategy' | 'weights' | 'pairs' | 'refresh'>('api')

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

  const currentInterval = local.refresh_interval_s ?? 900
  const currentOption   = REFRESH_OPTIONS.find(o => o.value === currentInterval)

  const tabs: { id: typeof activeTab; label: string }[] = [
    { id: 'api',      label: '🔑 API Keys' },
    { id: 'strategy', label: '🎯 Strategy' },
    { id: 'refresh',  label: '⏱ Refresh Rate' },
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

      {/* ── Tab: Refresh Rate ─────────────────────────────────────────── */}
      {activeTab === 'refresh' && (
        <div className={s.section}>
          <div className={s.sectionHeader}>
            <span className={s.sectionIcon}>⏱</span>
            <span className={s.sectionTitle}>Refresh Interval</span>
          </div>
          <div className={s.sectionBody}>
            <p style={{ fontSize: '9px', color: 'var(--text-secondary)', marginBottom: 14, maxWidth: 560, lineHeight: 1.6 }}>
              Controls how often the backend fetches new data from all APIs.
              The limiting factor is typically <strong style={{ color: 'var(--yellow)' }}>NewsAPI</strong> (100 req/day free)
              and <strong style={{ color: 'var(--yellow)' }}>Alpha Vantage</strong> (25 req/day free).
              Shorter intervals will exhaust your free quota if you have those keys configured.
              FX rates and GDP/ECB have no meaningful rate limits.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {REFRESH_OPTIONS.map(opt => {
                const isSelected = currentInterval === opt.value
                return (
                  <div
                    key={opt.value}
                    onClick={() => set('refresh_interval_s', opt.value)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '8px 12px',
                      background: isSelected ? 'rgba(122,162,247,0.1)' : 'var(--surface)',
                      border: `1px solid ${isSelected ? 'rgba(122,162,247,0.4)' : 'var(--border)'}`,
                      borderRadius: 4, cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                  >
                    <div style={{
                      width: 12, height: 12, borderRadius: '50%',
                      background: isSelected ? 'var(--accent)' : 'transparent',
                      border: `2px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                      flexShrink: 0,
                      transition: 'all 0.15s',
                    }} />
                    <span style={{ fontWeight: 700, fontSize: '10px', color: isSelected ? 'var(--accent)' : 'var(--text-primary)', minWidth: 100 }}>
                      {opt.label}
                    </span>
                    <span style={{ fontSize: '9px', color: 'var(--text-secondary)' }}>
                      {opt.note}
                    </span>
                  </div>
                )
              })}
            </div>

            {currentOption && (
              <div style={{ marginTop: 14, padding: '8px 12px', background: 'rgba(122,162,247,0.05)', border: '1px solid rgba(122,162,247,0.2)', borderRadius: 4, fontSize: '9px', color: 'var(--text-secondary)' }}>
                <strong style={{ color: 'var(--accent)' }}>Current:</strong> {currentOption.label} — refreshes every {currentOption.value >= 3600 ? `${currentOption.value/3600}h` : `${currentOption.value/60}min`}.
                {' '}{currentOption.note}.
              </div>
            )}
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
        <button className={s.btnSave} onClick={handleSave}>💾 Save Config</button>
        <button className={s.btnReset} onClick={handleReset}>↺ Reset</button>
        <span className={`${s.saveMsg} ${saved ? s.visible : ''}`}>✓ Saved successfully</span>
      </div>
    </div>
  )
}
