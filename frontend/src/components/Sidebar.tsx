import { Tab } from '../App'
import { MacroState } from '../types'
import styles from './Sidebar.module.css'

const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: 'heatmap',  icon: '⬛', label: 'HEATMAP'  },
  { id: 'signals',  icon: '⚡', label: 'SIGNALS'  },
  { id: 'macro',    icon: '🏛', label: 'MACRO'    },
  { id: 'backtest', icon: '📈', label: 'BACKTEST' },
  { id: 'config',   icon: '⚙', label: 'CONFIG'   },
  { id: 'about',    icon: 'ℹ', label: 'ABOUT'    },
]

interface Props { active: Tab; onChange: (t: Tab) => void; state: MacroState }

export default function Sidebar({ active, onChange, state }: Props) {
  const topCur = [...state.currencies].sort((a, b) => b.score - a.score)[0]
  const botCur = [...state.currencies].sort((a, b) => a.score - b.score)[0]

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
            {topCur ? `${topCur.code}  +${topCur.score.toFixed(1)}` : '—'}
          </div>
        </div>
        <div className={styles.miniPanel}>
          <div className={styles.miniTitle}>TOP SHORT</div>
          <div className={styles.miniVal} style={{ color: 'var(--red)' }}>
            {botCur ? `${botCur.code}  ${botCur.score.toFixed(1)}` : '—'}
          </div>
        </div>
        <div className={styles.miniPanel}>
          <div className={styles.miniTitle}>SIGNALS</div>
          <div className={styles.miniVal} style={{ color: 'var(--accent)' }}>
            {state.signals.length}
          </div>
        </div>
        <div className={styles.miniPanel}>
          <div className={styles.miniTitle}>REGIME</div>
          <div className={styles.miniVal} style={{
            color: state.regime === 'RISK ON' ? 'var(--green)' :
                   state.regime === 'RISK OFF' ? 'var(--red)' : 'var(--yellow)'
          }}>
            {state.regime === 'RISK ON' ? '▲ ON' : state.regime === 'RISK OFF' ? '▼ OFF' : '→ TRANS'}
          </div>
        </div>
      </div>

      <div className={styles.footer}>
        <div className={styles.footerText}>MACROFX TERMINAL+</div>
        <div className={styles.footerSub}>Kessler833 · 2026</div>
      </div>
    </aside>
  )
}
