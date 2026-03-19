import React from 'react'

interface State { hasError: boolean; error: string; info: string }
interface Props { children: React.ReactNode; label?: string }

/**
 * Catches render errors in any child tree and shows a styled recovery
 * panel instead of a blank white screen.
 *
 * Usage:
 *   <ErrorBoundary label="HeatmapView">
 *     <HeatmapView state={state} />
 *   </ErrorBoundary>
 */
export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: '', info: '' }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error: error?.message ?? String(error) }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.setState({ info: info.componentStack ?? '' })
    console.error('[ErrorBoundary]', this.props.label ?? 'unknown', error, info)
  }

  handleReset = () => this.setState({ hasError: false, error: '', info: '' })

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', height: '100%', padding: '40px 24px',
        fontFamily: 'var(--font, monospace)',
      }}>
        <div style={{
          maxWidth: 560, width: '100%',
          background: 'rgba(255,80,80,0.06)',
          border: '1px solid rgba(255,80,80,0.25)',
          borderRadius: 6, padding: '20px 24px',
        }}>
          <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--red, #f87171)', marginBottom: 6, letterSpacing: '0.08em' }}>
            ✕ RENDER ERROR{this.props.label ? ` — ${this.props.label.toUpperCase()}` : ''}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-primary, #cdd6f4)', marginBottom: 12, wordBreak: 'break-word' }}>
            {this.state.error || 'An unexpected error occurred.'}
          </div>
          {this.state.info && (
            <pre style={{
              fontSize: '8px', color: 'var(--text-faint, #6c7086)',
              background: 'rgba(0,0,0,0.2)', borderRadius: 4,
              padding: '8px 10px', overflowX: 'auto', marginBottom: 14,
              maxHeight: 120, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            }}>
              {this.state.info.trim()}
            </pre>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={this.handleReset}
              style={{
                padding: '5px 14px', fontSize: '9px', fontWeight: 700,
                fontFamily: 'inherit', letterSpacing: '0.06em',
                background: 'rgba(255,80,80,0.12)',
                border: '1px solid rgba(255,80,80,0.3)',
                borderRadius: 4, color: 'var(--red, #f87171)', cursor: 'pointer',
              }}
            >
              ↺ RETRY
            </button>
            <span style={{ fontSize: '9px', color: 'var(--text-faint, #6c7086)', alignSelf: 'center' }}>
              Check the console (F12) for the full stack trace.
            </span>
          </div>
        </div>
      </div>
    )
  }
}
