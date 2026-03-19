import { ViewId } from '../App'
import { MacroState } from '../types'
import styles from './Sidebar.module.css'

const TABS: { id: ViewId; icon: string; label: string }[] = [
  { id: 'heatmap',  icon: '\u2b1b', label: 'HEATMAP'  },
  { id: 'signals',  icon: '\u26a1', label: 'SIGNALS'  },
  { id: 'macro',    icon: '\ud83c\udfd9', label: 'MACRO'    },
  { id: 'backtest', icon: '\ud83d\udcc8', label: 'BACKTEST' },
  { id: 'config',   icon: '\u2699', label: 'CONFIG'   },
  { id: 'about',    icon: '\u2139', label: 'ABOUT'    },
]

interface Props {
  active: ViewId
  onChange: (t: ViewId) => void
  state: MacroState | null
}

export default function Sidebar({ active, onChange, state }: Props) {
  const currencies = state?.currencies ?? []
  const topCur = [...currencies].sort((a, b) => b.score - a.score)[0]
  const botCur = [...currencies].sort((a, b) => a.score - b.score)[0]

  return (
    <aside className={styles.sidebar}>
      <nav className={styles.nav}>
        {TABS.map(t => (
          <button
            key={t.id}
            className={`${styles.navItem} ${active === t.id ? styles.active : ''}`}
            onClick={() => onChange(t.id)}
          >
            <span className={styles.icon}>{t.icon}</span>
            <span className={styles.label}>{t.label}</span>
            {active === t.id && <span className={styles.indicator} />}
          </button>
        ))}
      </nav>

      <div className={styles.panels}>
        <div className={styles.miniPanel}>
          <div className={styles.miniTitle}>TOP LONG</div>
          <div className={styles.miniVal} style={{ color: 'var(--green)' }}>
            {topCur ? `${topCur.code}  +${topCur.score.toFixed(1)}` : '\u2014'}
          </div>
        </div>
        <div className={styles.miniPanel}>
          <div className={styles.miniTitle}>TOP SHORT</div>
          <div className={styles.miniVal} style={{ color: 'var(--red)' }}>
            {botCur ? `${botCur.code}  ${botCur.score.toFixed(1)}` : '\u2014'}
          </div>
        </div>
        <div className={styles.miniPanel}>
          <div className={styles.miniTitle}>SIGNALS</div>
          <div className={styles.miniVal} style={{ color: 'var(--accent)' }}>
            {state?.signals?.length ?? 0}
          </div>
        </div>
        <div className={styles.miniPanel}>
          <div className={styles.miniTitle}>REGIME</div>
          <div className={styles.miniVal} style={{
            color: state?.regime === 'RISK ON'  ? 'var(--green)'  :
                   state?.regime === 'RISK OFF' ? 'var(--red)'    : 'var(--yellow)'
          }}>
            {state?.regime === 'RISK ON'  ? '\u25b2 ON'   :
             state?.regime === 'RISK OFF' ? '\u25bc OFF'  : '\u2192 WAIT'}
          </div>
        </div>
      </div>

      <div className={styles.footer}>
        <div className={styles.footerText}>MACROFX TERMINAL+</div>
        <div className={styles.footerSub}>Kessler833 \u00b7 2026</div>
      </div>
    </aside>
  )
}
