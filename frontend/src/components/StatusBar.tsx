import { MacroState } from '../types'
import styles from './StatusBar.module.css'

interface Props {
  state: MacroState
  connected: boolean
  wsError: string
}

export default function StatusBar({ state, connected, wsError }: Props) {
  const ts = state.ts ? new Date(state.ts * 1000).toLocaleTimeString() : '—'
  const bulls = state.currencies.filter(c => c.bias === 'Bullish').length
  const bears = state.currencies.filter(c => c.bias === 'Bearish').length

  return (
    <div className={styles.bar}>
      <div className={styles.item}>
        <span className={styles.label}>STATUS</span>
        <span className={connected ? styles.ok : styles.err}>
          {connected ? '● LIVE' : wsError ? `✕ ${wsError}` : '○ CONNECTING…'}
        </span>
      </div>
      <div className={styles.sep} />
      <div className={styles.item}>
        <span className={styles.label}>REGIME</span>
        <span className={
          state.regime === 'RISK ON' ? styles.ok :
          state.regime === 'RISK OFF' ? styles.err : styles.warn
        }>{state.regime}</span>
      </div>
      <div className={styles.sep} />
      <div className={styles.item}>
        <span className={styles.label}>BULL</span>
        <span className={styles.ok}>{bulls}</span>
      </div>
      <div className={styles.item}>
        <span className={styles.label}>BEAR</span>
        <span className={styles.err}>{bears}</span>
      </div>
      <div className={styles.sep} />
      <div className={styles.item}>
        <span className={styles.label}>CARRY ENV</span>
        <span className={styles.neutral}>{state.carry_env}</span>
      </div>
      <div className={styles.sep} />
      <div className={styles.item}>
        <span className={styles.label}>DXY SCORE</span>
        <span className={state.dxy_score > 2 ? styles.err : state.dxy_score < -2 ? styles.ok : styles.neutral}>
          {state.dxy_score > 0 ? '+' : ''}{state.dxy_score.toFixed(1)}
        </span>
      </div>
      <div className={styles.spacer} />
      <div className={styles.item}>
        <span className={styles.label}>UPDATED</span>
        <span className={styles.neutral}>{ts}</span>
      </div>
    </div>
  )
}
