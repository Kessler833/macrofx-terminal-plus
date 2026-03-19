// ── Factor scores per currency ────────────────────────────────────────────────
export interface FactorScores {
  trend: number; season: number; cot: number; crowd: number;
  gdp: number; mpmi: number; spmi: number; retail: number;
  conf: number; cpi: number; ppi: number; pce: number;
  rates: number; nfp: number; urate: number; claims: number;
  adp: number; jolts: number; news: number;
}

export interface CurrencyRow {
  code:    string
  score:   number
  bias:    'Bullish' | 'Bearish' | 'Neutral'
  factors: FactorScores
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
}

export interface RateDiff {
  pair: string
  diff: number
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
  n:            number
  pair:         string
  dir:          string
  entry_date:   string
  exit_date:    string
  days:         number
  entry:        number
  exit:         number
  pnl_usd:      number
  pnl_pct:      number
  cmsi_at_entry: number
  exit_reason:  string
}

export function emptyState(): MacroState {
  return {
    ts: 0, currencies: [], signals: [], cb_rates: [],
    rate_diffs: [], correlation: {}, regime: 'LOADING…',
    carry_env: '—', top_spread_pair: '—', dxy_score: 0,
    api_status: {}, config: {},
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