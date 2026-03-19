import { useCallback } from 'react'

export function useApi(baseUrl: string) {
  const saveConfig = useCallback(async (cfg: Record<string, any>) => {
    try {
      await fetch(`${baseUrl}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      })
    } catch (e) {
      console.error('saveConfig failed', e)
    }
  }, [baseUrl])

  const triggerRefresh = useCallback(async () => {
    try {
      await fetch(`${baseUrl}/api/refresh`, { method: 'POST' })
    } catch (e) {
      console.error('triggerRefresh failed', e)
    }
  }, [baseUrl])

  const runBacktest = useCallback(async (params: Record<string, any>) => {
    try {
      const res = await fetch(`${baseUrl}/api/backtest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
      return await res.json()
    } catch (e) {
      console.error('runBacktest failed', e)
      return null
    }
  }, [baseUrl])

  return { saveConfig, triggerRefresh, runBacktest }
}
