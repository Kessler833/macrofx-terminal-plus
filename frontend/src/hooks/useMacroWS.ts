import { useState, useEffect, useRef, useCallback } from 'react'
import { MacroState, emptyState } from '../types'

const WS_URL    = 'ws://127.0.0.1:8766/ws'
const REST_BASE = 'http://127.0.0.1:8766'

export function useMacroWS() {
  // lastGood: the most recent valid state received — never wiped on disconnect
  const [state, setState]         = useState<MacroState>(emptyState())
  const [connected, setConnected] = useState(false)
  const [wsError, setWsError]     = useState('')
  const wsRef      = useRef<WebSocket | null>(null)
  const retryRef   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastGoodRef = useRef<MacroState>(emptyState())

  // Fetch current state via REST — used as fallback on reconnect so the
  // UI never shows blank while waiting for the next WS push
  const fetchRestState = useCallback(async () => {
    try {
      const res = await fetch(`${REST_BASE}/state`)
      if (!res.ok) return
      const data = await res.json() as MacroState
      // Only apply if it looks like real data (ts > 0 means backend has run)
      if (data && data.ts > 0) {
        lastGoodRef.current = data
        setState(data)
      }
    } catch {
      // backend not yet up — keep showing last good state
    }
  }, [])

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return
    setWsError('')

    let ws: WebSocket
    try {
      ws = new WebSocket(WS_URL)
    } catch (e: any) {
      setWsError(String(e?.message ?? e))
      retryRef.current = setTimeout(connect, 2000)
      return
    }

    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      setWsError('')
      if (retryRef.current) clearTimeout(retryRef.current)
      // On reconnect: immediately pull latest state via REST so the UI
      // updates right away rather than waiting for the next WS push
      fetchRestState()
    }

    ws.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data) as MacroState
        // Only replace state with a message that carries real data
        // (ts === 0 is the emptyState sentinel — ignore it)
        if (parsed && parsed.ts > 0) {
          lastGoodRef.current = parsed
          setState(parsed)
        } else if (parsed && parsed.ts === 0 && lastGoodRef.current.ts > 0) {
          // Backend sent an empty heartbeat — keep the last good state visible
          // but still update connection-level fields (config, api_status)
          setState(prev => ({
            ...lastGoodRef.current,
            config:     parsed.config     ?? prev.config,
            api_status: parsed.api_status ?? prev.api_status,
          }))
        } else {
          setState(parsed)
        }
      } catch {
        // malformed message — ignore, keep last state
      }
    }

    ws.onerror = () => setWsError('connection error')

    ws.onclose = (e) => {
      setConnected(false)
      setWsError(`closed (${e.code})`)
      // Do NOT reset state here — keep showing last good data while reconnecting
      retryRef.current = setTimeout(connect, 1500)
    }
  }, [fetchRestState])

  useEffect(() => {
    connect()
    return () => {
      if (retryRef.current) clearTimeout(retryRef.current)
      wsRef.current?.close()
    }
  }, [connect])

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
