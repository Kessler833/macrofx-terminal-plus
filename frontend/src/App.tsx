import React, { useState, useEffect, useCallback } from 'react'
import TitleBar from './components/TitleBar'
import Sidebar from './components/Sidebar'
import StatusBar from './components/StatusBar'
import HeatmapView from './components/views/HeatmapView'
import SignalsView from './components/views/SignalsView'
import MacroView from './components/views/MacroView'
import BacktestView from './components/views/BacktestView'
import ConfigView from './components/views/ConfigView'
import AboutView from './components/views/AboutView'
import ErrorBoundary from './components/ErrorBoundary'
import { useMacroWS } from './hooks/useMacroWS'
import { useApi } from './hooks/useApi'
import { MacroState, emptyState } from './types'
import s from './App.module.css'

export type ViewId = 'heatmap' | 'signals' | 'macro' | 'backtest' | 'config' | 'about'

export default function App() {
  const [activeView, setActiveView] = useState<ViewId>('heatmap')
  const { state: wsState, connected, wsError } = useMacroWS()
  const { saveConfig, triggerRefresh } = useApi('http://127.0.0.1:8766')

  // stateOverride: applied after a config save so api_status dots update
  // instantly (without waiting for the next WS push).
  // It is cleared automatically once the WS delivers a real state update
  // (ts > 0 and currencies populated) — preventing it from "leaking" over
  // a fresh WS state and causing a blank heatmap.
  const [stateOverride, setStateOverride] = useState<Partial<MacroState> | null>(null)

  // Clear the override as soon as WS delivers live data so we never freeze
  // the UI on a stale override after a reconnect
  useEffect(() => {
    if (wsState && wsState.ts > 0 && wsState.currencies.length > 0) {
      setStateOverride(null)
    }
  }, [wsState])

  const state: MacroState = {
    ...(wsState ?? emptyState()),
    // Apply override only for config/api_status — never override currencies
    // or signals (those must always come from live WS data)
    api_status: stateOverride?.api_status ?? wsState?.api_status ?? {},
    config:     stateOverride?.config     ?? wsState?.config     ?? {},
  }

  const cfg       = state.config     ?? {}
  const apiStatus = state.api_status ?? {}

  const handleSaveConfig = useCallback(async (cfg: Record<string, unknown>) => {
    const result = await saveConfig(cfg)
    if (result?.freshState && typeof result.freshState === 'object') {
      // Only override the lightweight fields — never touch currencies/signals
      const fresh = result.freshState as Partial<MacroState>
      setStateOverride({
        api_status: fresh.api_status,
        config:     fresh.config,
      })
    }
  }, [saveConfig])

  const handleRefresh = useCallback(async () => {
    await triggerRefresh()
  }, [triggerRefresh])

  return (
    <div className={s.root}>
      <TitleBar connected={connected} onRefresh={handleRefresh} />
      <div className={s.body}>
        <Sidebar active={activeView} onChange={setActiveView} state={state} />
        <main className={s.main}>
          <ErrorBoundary label={activeView}>
            {activeView === 'heatmap'  && <HeatmapView  state={state} />}
            {activeView === 'signals'  && <SignalsView  state={state} />}
            {activeView === 'macro'    && <MacroView    state={state} />}
            {activeView === 'backtest' && <BacktestView state={state} activePairs={(cfg as any).active_pairs ?? []} />}
            {activeView === 'config'   && <ConfigView   config={cfg} apiStatus={apiStatus} onSave={handleSaveConfig} />}
            {activeView === 'about'    && <AboutView    apiStatus={apiStatus} />}
          </ErrorBoundary>
        </main>
      </div>
      <StatusBar state={state} connected={connected} wsError={wsError} />
    </div>
  )
}
