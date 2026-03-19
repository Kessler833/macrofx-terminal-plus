import { apiPost, apiGet } from './useMacroWS'

export function useApi(baseUrl: string) {
  async function saveConfig(config: Record<string, unknown>): Promise<any> {
    return apiPost('/api/config', config)
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

  return { saveConfig, triggerRefresh, runBacktest, getSignals }
}
