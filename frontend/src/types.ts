// ── Factor scores per currency ────────────────────────────────────────────────
// null means the data source was unavailable — rendered as N/A, never as 0
export interface FactorScores {
  trend:  number | null; season: number | null; cot:    number | null; crowd:  number | null;
  gdp:    number | null; mpmi:   number | null; spmi:   number | null; retail: number | null;
  conf:   number | null; cpi:    number | null; ppi:    number | null; pce:    number | null;
  rates:  number | null; nfp:    number | null; urate:  number | null; claims: number | null;
  adp:    number | null; jolts:  number | null; news:   number | null;
}

export interface CurrencyRow {
  code:         string
  score:        number
  bias:         'Bullish' | 'Bearish' | 'Neutral' | 'Insufficient'
  factors:      FactorScores
  completeness: number  // 0–19: how many factors are live
}

export interface Signal {
  pair:        string
  direction:   'LONG' | 'SHORT'
  strength:    'HIGH' | 'MED' | 'LOW'
  diff:        number
  base_score:  number
  quote_score: number
  carry:       number
  entry:       number
  target:      number
  stop_loss:   number
  key_driver:  string
}

export interface CBRateRow {
  currency: string
  bank:     string
  rate:     number
  change:   number
  next_mtg: string
  stance:   'Hawkish' | 'Neutral' | 'Dovish'
  relative: number
  is_live:  boolean  // false = showing static fallback data
}

export interface RateDiff {
  pair: string
  diff: number
}

export interface DataProvenance {
  source:    'live' | 'static' | 'error' | 'no_key' | 'pending'
  age_s:     number | null
  is_static?: boolean
}

export interface MacroState {
  ts:              number
  currencies:      CurrencyRow[]
  signals:         Signal[]
  cb_rates:        CBRateRow[]
  rate_diffs:      RateDiff[]
  correlation:     Record<string, Record<string, number>>
  regime:          string
  carry_env:       string
  top_spread_pair: string
  dxy_score:       number
  api_status:      Record<string, string>
  data_sources:    Record<string, string>
  provenance:      Record<string, DataProvenance>
  config:          Record<string, any>
}

export interface BacktestResult {
  total_return:    number
  cagr:            number
  sharpe:          number
  sortino:         number
  max_drawdown:    number
  win_rate:        number
  avg_trade_days:  number
  profit_factor:   number
  total_trades:    number
  equity_curve:    { t: string; v: number }[]
  hodl_curve:      { t: string; v: number }[]
  monthly_returns: Record<string, Record<string, number>>
  trades:          TradeRow[]
  error?:          string
}

export interface TradeRow {
  n:             number
  pair:          string
  dir:           string
  entry_date:    string
  exit_date:     string
  days:          number
  entry:         number
  exit:          number
  pnl_usd:       number
  pnl_pct:       number
  cmsi_at_entry: number
  exit_reason:   string
}

export function emptyState(): MacroState {
  return {
    ts: 0, currencies: [], signals: [], cb_rates: [],
    rate_diffs: [], correlation: {}, regime: 'CONNECTING…',
    carry_env: '—', top_spread_pair: '—', dxy_score: 0,
    api_status: {}, data_sources: {}, provenance: {}, config: {},
  }
}

export const FACTORS = [
  'trend','season','cot','crowd','gdp','mpmi','spmi','retail',
  'conf','cpi','ppi','pce','rates','nfp','urate','claims','adp','jolts','news'
] as const

export const CURRENCIES = ['USD','EUR','GBP','JPY','AUD','NZD','CAD','CHF'] as const

export const FLAGS: Record<string, string> = {
  USD:'🇺🇸', EUR:'🇪🇺', GBP:'🇬🇧', JPY:'🇯🇵',
  AUD:'🇦🇺', NZD:'🇳🇿', CAD:'🇨🇦', CHF:'🇨🇭',
}

/** Source badge label and color for a data provenance entry */
export function provenanceBadge(src: string): { label: string; color: string } {
  switch (src) {
    case 'live':    return { label: 'LIVE',    color: 'var(--green)' }
    case 'static':  return { label: 'STATIC',  color: 'var(--yellow)' }
    case 'error':   return { label: 'ERROR',   color: 'var(--red)' }
    case 'no_key':  return { label: 'NO KEY',  color: 'var(--text-secondary)' }
    case 'pending': return { label: 'PENDING', color: 'var(--cyan)' }
    default:        return { label: 'UNKNOWN', color: 'var(--text-secondary)' }
  }
}
