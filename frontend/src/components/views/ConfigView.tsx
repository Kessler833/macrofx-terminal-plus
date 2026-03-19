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
  const cls = status === 'ok' ? s.dotOk : status === 'error' ? s.dotError : status === 'no_key' ? s.dotNoKey : s.dotUnknown
  const label = status === 'ok' ? 'Connected' : status === 'error' ? 'Error' : status === 'no_key' ? 'No key' : 'Pending'
  return (
    <span className={s.apiStatus}>
      <span className={`${s.dot} ${cls}`} />
      {label}
    </span>
  )
}

export default function ConfigView({ config, apiStatus, onSave }: Props) {
  const [local, setLocal] = useState<Record<string, any>>({ ...config })
  const [saved, setSaved] = useState(false)

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

  return (
    <div className={s.container}>
      <div className={s.pageHeader}>
        <h1>⚙️ Configuration</h1>
        <p>API keys, strategy parameters, factor weights and active pairs</p>
      </div>

      <div className={s.grid}>
        {/* API Keys */}
        <div className={s.section}>
          <div className={s.sectionHeader}>
            <span className={s.sectionIcon}>🔑</span>
            <span className={s.sectionTitle}>API Keys</span>
          </div>
          <div className={s.sectionBody}>
            {[
              { key: 'fred_api_key', label: 'FRED (St. Louis Fed)', api: 'fred', hint: 'Free at fred.stlouisfed.org' },
              { key: 'alpha_vantage_key', label: 'Alpha Vantage (FX Trend)', api: 'av', hint: 'Free at alphavantage.co' },
              { key: 'news_api_key', label: 'NewsAPI (Sentiment)', api: 'news', hint: 'Free at newsapi.org' },
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
          </div>
        </div>

        {/* Strategy Parameters */}
        <div className={s.section}>
          <div className={s.sectionHeader}>
            <span className={s.sectionIcon}>🎯</span>
            <span className={s.sectionTitle}>Strategy Parameters</span>
          </div>
          <div className={s.sectionBody}>
            {[
              { key: 'signal_threshold', label: 'Signal Threshold', hint: 'Min CMSI diff to open trade (1–10)', min: 0.5, max: 10, step: 0.5 },
              { key: 'min_hold_days',    label: 'Min Hold Days',    hint: 'Minimum trade duration in days', min: 1, max: 90, step: 1 },
              { key: 'max_hold_days',    label: 'Max Hold Days',    hint: 'Force-exit after N days', min: 7, max: 365, step: 1 },
              { key: 'max_positions',    label: 'Max Open Positions', hint: 'Simultaneous trades allowed', min: 1, max: 10, step: 1 },
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
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <Toggle value={!!local.use_news}          onChange={v => set('use_news', v)}          label="Use news sentiment scoring" />
              <Toggle value={!!local.use_cot}           onChange={v => set('use_cot', v)}           label="Use COT positioning data" />
              <Toggle value={!!local.use_carry_filter}  onChange={v => set('use_carry_filter', v)}  label="Carry environment filter" />
              <Toggle value={!!local.use_trend_confirm} onChange={v => set('use_trend_confirm', v)} label="Trend confirmation (AV)" />
              <Toggle value={!!local.use_regime_filter} onChange={v => set('use_regime_filter', v)} label="Market regime filter" />
            </div>
          </div>
        </div>

        {/* Factor Weights */}
        <div className={`${s.section} ${s.gridFull}`}>
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

        {/* Active Pairs */}
        <div className={`${s.section} ${s.gridFull}`}>
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
      </div>

      {/* Actions */}
      <div className={s.actions}>
        <button className={s.btnSave} onClick={handleSave}>💾 Save Config</button>
        <button className={s.btnReset} onClick={handleReset}>↺ Reset</button>
        <span className={`${s.saveMsg} ${saved ? s.visible : ''}`}>✓ Saved successfully</span>
      </div>
    </div>
  )
}
