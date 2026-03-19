import React, { useState, useCallback } from 'react'
import TitleBar from './components/TitleBar'
import Sidebar from './components/Sidebar'
import StatusBar from './components/StatusBar'
import HeatmapView from './components/views/HeatmapView'
import SignalsView from './components/views/SignalsView'
import MacroView from './components/views/MacroView'
import BacktestView from './components/views/BacktestView'
import ConfigView from './components/views/ConfigView'
import AboutView from './components/views/AboutView'
import { useMacroWS } from './hooks/useMacroWS'
import { useApi } from './hooks/useApi'
import { MacroState, emptyState } from './types'
import s from './App.module.css'

export type ViewId = 'heatmap' | 'signals' | 'macro' | 'backtest' | 'config' | 'about'

export default function App() {
  const [activeView, setActiveView] = useState<ViewId>('heatmap')
  const { state: wsState, connected, wsError } = useMacroWS()
  const { saveConfig, triggerRefresh } = useApi('http://127.0.0.1:8766')

  // Override state: after saving config we get a fresh /state response
  // and merge it here so api_status dots update instantly (no 60s wait)
  const [stateOverride, setStateOverride] = useState<Partial<MacroState> | null>(null)

  const state: MacroState = {
    ...(wsState ?? emptyState()),
    ...(stateOverride ?? {}),
    // Always prefer live WS state for time-sensitive fields, but keep
    // override for api_status and config until next WS push overwrites it
    api_status: stateOverride?.api_status ?? wsState?.api_status ?? {},
    config:     stateOverride?.config     ?? wsState?.config     ?? {},
  }

  const cfg       = state.config     ?? {}
  const apiStatus = state.api_status ?? {}

  // When WS delivers a new state, clear the override (WS is authoritative)
  // This is handled naturally: wsState updates trigger re-render and the
  // spread above uses wsState values once they arrive.

  const handleSaveConfig = useCallback(async (cfg: Record<string, unknown>) => {
    const result = await saveConfig(cfg)
    // result.freshState is the /state response immediately after save
    // This updates api_status dots and config without waiting for next WS push
    if (result?.freshState && typeof result.freshState === 'object') {
      setStateOverride(result.freshState as Partial<MacroState>)
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
          {activeView === 'heatmap'  && <HeatmapView  state={state} />}
          {activeView === 'signals'  && <SignalsView  state={state} />}
          {activeView === 'macro'    && <MacroView    state={state} />}
          {activeView === 'backtest' && <BacktestView state={state} activePairs={(cfg as any).active_pairs ?? []} />}
          {activeView === 'config'   && <ConfigView   config={cfg} apiStatus={apiStatus} onSave={handleSaveConfig} />}
          {activeView === 'about'    && <AboutView    apiStatus={apiStatus} />}
        </main>
      </div>
      <StatusBar state={state} connected={connected} wsError={wsError} />
    </div>
  )
}
