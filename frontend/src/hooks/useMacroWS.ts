import { useState, useEffect, useRef } from 'react'
import { MacroState, emptyState } from '../types'

const WS_URL    = 'ws://127.0.0.1:8766/ws'
const REST_BASE = 'http://127.0.0.1:8766'

export function useMacroWS() {
  const [state, setState]         = useState<MacroState>(emptyState())
  const [connected, setConnected] = useState(false)
  const [wsError, setWsError]     = useState('')
  const wsRef    = useRef<WebSocket | null>(null)
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function connect() {
    if (wsRef.current?.readyState === WebSocket.OPEN) return
    setWsError('')
    let ws: WebSocket
    try { ws = new WebSocket(WS_URL) } catch (e: any) {
      setWsError(String(e?.message ?? e))
      retryRef.current = setTimeout(connect, 2000)
      return
    }
    wsRef.current = ws
    ws.onopen    = () => { setConnected(true); setWsError(''); if (retryRef.current) clearTimeout(retryRef.current) }
    ws.onmessage = (e) => { try { setState(JSON.parse(e.data) as MacroState) } catch {} }
    ws.onerror   = ()  => setWsError('connection error')
    ws.onclose   = (e) => { setConnected(false); setWsError(`closed (${e.code})`); retryRef.current = setTimeout(connect, 1500) }
  }

  useEffect(() => {
    connect()
    return () => { if (retryRef.current) clearTimeout(retryRef.current); wsRef.current?.close() }
  }, [])

  return { state, connected, wsError }
}

export async function apiPost(path: string, body: Record<string, unknown>): Promise<any> {
  try {
    const res = await fetch(`${REST_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return res.json()
  } catch (e) { return { error: String(e) } }
}

export async function apiGet(path: string): Promise<any> {
  try { return (await fetch(`${REST_BASE}${path}`)).json() }
  catch (e) { return {} }
}
