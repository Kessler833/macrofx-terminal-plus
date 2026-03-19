import { apiPost, apiGet } from './useMacroWS'

export function useApi(baseUrl: string) {
  async function saveConfig(config: Record<string, unknown>): Promise<any> {
    // Backend expects { "data": { ...config } } — Pydantic ConfigUpdate model
    const res = await apiPost('/api/config', { data: config })
    // Immediately re-fetch state so api_status dots update without waiting 60s
    const fresh = await apiGet('/state')
    return { saveResult: res, freshState: fresh }
  }

  async function triggerRefresh(): Promise<any> {
    return apiGet('/api/refresh')
  }

  async function runBacktest(params: Record<string, unknown>): Promise<any> {
    return apiPost('/api/backtest', params)
  }

  async function getSignals(): Promise<any> {
    return apiGet('/api/signals')
  }

  async function getState(): Promise<any> {
    return apiGet('/state')
  }

  return { saveConfig, triggerRefresh, runBacktest, getSignals, getState }
}
