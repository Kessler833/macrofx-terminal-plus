import styles from './TitleBar.module.css'

interface Props { connected: boolean }

export default function TitleBar({ connected }: Props) {
  const minimize = () => (window as any).electronAPI?.minimize()
  const maximize = () => (window as any).electronAPI?.maximize()
  const close    = () => (window as any).electronAPI?.close()

  return (
    <div className={styles.bar}>
      <div className={styles.left}>
        <span className={styles.logo}>▲ MACROFX</span>
        <span className={styles.sub}>TERMINAL PLUS</span>
        <span className={styles.version}>v1.0</span>
      </div>
      <div className={styles.drag} />
      <div className={styles.right}>
        <span className={`${styles.dot} ${connected ? styles.dotOn : styles.dotOff}`} />
        <span className={styles.connLabel}>{connected ? 'LIVE' : 'OFFLINE'}</span>
        <button className={styles.wc} onClick={minimize}>─</button>
        <button className={styles.wc} onClick={maximize}>□</button>
        <button className={`${styles.wc} ${styles.close}`} onClick={close}>✕</button>
      </div>
    </div>
  )
}
