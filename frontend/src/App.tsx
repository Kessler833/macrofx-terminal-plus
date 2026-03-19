import React, { useState } from 'react'
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
import s from './App.module.css'

export type ViewId = 'heatmap' | 'signals' | 'macro' | 'backtest' | 'config' | 'about'

export default function App() {
  const [activeView, setActiveView] = useState<ViewId>('heatmap')
  const { state, connected } = useMacroWS('ws://127.0.0.1:8766/ws')
  const { saveConfig, triggerRefresh, runBacktest } = useApi('http://127.0.0.1:8766')

  const cfg       = state?.config     ?? {}
  const apiStatus = state?.api_status ?? {}

  return (
    <div className={s.root}>
      <TitleBar connected={connected} onRefresh={triggerRefresh} />
      <div className={s.body}>
        <Sidebar active={activeView} onChange={setActiveView} state={state} />
        <main className={s.main}>
          {activeView === 'heatmap'  && <HeatmapView  state={state} />}
          {activeView === 'signals'  && <SignalsView  state={state} />}
          {activeView === 'macro'    && <MacroView    state={state} />}
          {activeView === 'backtest' && <BacktestView runBacktest={runBacktest} activePairs={cfg.active_pairs ?? []} />}
          {activeView === 'config'   && <ConfigView   config={cfg} apiStatus={apiStatus} onSave={saveConfig} />}
          {activeView === 'about'    && <AboutView    apiStatus={apiStatus} />}
        </main>
      </div>
      <StatusBar state={state} connected={connected} />
    </div>
  )
}
