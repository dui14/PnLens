export type ApiResponse<T> = {
  success: boolean
  data: T | null
  error: string | null
  meta?: {
    page?: number
    limit?: number
    total?: number
  }
}

export type Result<T, E = string> =
  | { success: true; data: T }
  | { success: false; error: E }

export const EXCHANGES = ['binance', 'okx', 'bybit', 'bitget', 'gateio'] as const
export type Exchange = (typeof EXCHANGES)[number]

export const PERIOD_TYPES = ['day', 'week', 'month', 'year', 'all'] as const
export type PeriodType = (typeof PERIOD_TYPES)[number]

export const CHART_RANGES = ['day', 'week', 'month', 'year'] as const
export type ChartRange = (typeof CHART_RANGES)[number]

export const TRADE_SEGMENTS = ['all', 'spot', 'futures'] as const
export type TradeSegment = (typeof TRADE_SEGMENTS)[number]

export type UserProfile = {
  id: string
  email: string
  display_name: string | null
  avatar_url: string | null
  demo_balance: number
  created_at: string
  updated_at: string
}

export const SYNC_STATUSES = ['pending', 'syncing', 'synced', 'error'] as const
export type SyncStatus = (typeof SYNC_STATUSES)[number]

export type ExchangeAccount = {
  id: string
  user_id: string
  exchange: Exchange
  label: string | null
  is_active: boolean
  sync_status: SyncStatus
  sync_error: string | null
  last_synced: string | null
  created_at: string
}

export type ExchangeAccountWithStats = ExchangeAccount & {
  trade_count: number
  has_passphrase: boolean
}

export type ExchangeCredentials = {
  apiKey: string
  apiSecret: string
  passphrase?: string
  proxy?: string
}

export type ApiKeyRow = {
  id: string
  exchange_account_id: string
  key_encrypted: string
  secret_encrypted: string
  passphrase_encrypted: string | null
  proxy_encrypted: string | null
  key_iv: string
  secret_iv: string
  passphrase_iv: string | null
  proxy_iv: string | null
  key_version: number
  created_at: string
}

export type Trade = {
  id: string
  exchange_account_id: string
  user_id: string
  external_trade_id: string
  symbol: string
  side: 'buy' | 'sell'
  quantity: number
  price: number
  fee: number
  fee_currency: string | null
  realized_pnl: number | null
  funding_fee: number
  income_type: string | null
  trade_type: 'spot' | 'futures' | 'margin'
  traded_at: string
  raw_data: Record<string, unknown> | null
  created_at: string
}

export type PNLSnapshot = {
  id: string
  user_id: string
  exchange_account_id: string | null
  period_type: PeriodType
  period_start: string
  period_end: string
  total_pnl: number
  win_count: number
  loss_count: number
  trade_count: number
  win_rate: number | null
  best_trade_pnl: number | null
  worst_trade_pnl: number | null
  calculated_at: string
}

export type DemoTrade = {
  id: string
  user_id: string
  symbol: string
  side: 'buy' | 'sell'
  order_type: 'market' | 'limit'
  margin_mode: 'cross' | 'isolated' | null
  leverage: number | null
  quantity: number
  entry_price: number
  initial_margin: number | null
  position_notional: number | null
  take_profit: number | null
  stop_loss: number | null
  market_price_at_open: number | null
  exit_price: number | null
  realized_pnl: number | null
  status: 'open' | 'closed' | 'cancelled'
  opened_at: string
  closed_at: string | null
  created_at: string
}

export type AgentReferenceLink = {
  title: string
  url: string
  source?: string
}

export type AgentAnalysisStep =
  | {
      type: 'thinking_start'
      message: string
    }
  | {
      type: 'thinking_step'
      message: string
    }
  | {
      type: 'tool'
      tool: string
      label: string
      status: 'loading' | 'done'
      summary?: string
      links?: AgentReferenceLink[]
    }

export type ChatMessageAnalysisMeta = {
  steps: AgentAnalysisStep[]
  elapsedSeconds?: number
  completedAt?: string
}

export type TradingViewRssNewsFeedInfo = {
  name: string
  url: string
}

export type TradingViewRssNewsFeedItem =
  | TradingViewRssNewsFeedInfo
  | TradingViewRssNewsFeedInfo[]

export type TradingViewRssNewsFeedParams = {
  default: TradingViewRssNewsFeedItem
} & Record<string, TradingViewRssNewsFeedItem>

export type TradingViewWidgetConfig = {
  container_id?: string
  symbol?: string
  interval?: string
  timezone?: string
  theme?: string
  style?: string
  locale?: string
  width?: string | number
  height?: string | number
  hide_top_toolbar?: boolean
  hide_legend?: boolean
  save_image?: boolean
  hide_side_toolbar?: boolean
  allow_symbol_change?: boolean
  withdateranges?: boolean
  studies?: unknown[]
  backgroundColor?: string
  rss_news_feed?: TradingViewRssNewsFeedParams
  [key: string]: unknown
}

export type ChatConversation = {
  id: string
  user_id: string
  title: string | null
  created_at: string
  updated_at: string
}

export type ChatMessage = {
  id: string
  conversation_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  tokens_used: number | null
  analysis_meta?: ChatMessageAnalysisMeta | null
  created_at: string
}

export type PNLSummary = {
  total_pnl: number
  win_rate: number
  trade_count: number
  win_count: number
  loss_count: number
  best_trade: number | null
  worst_trade: number | null
  period: PeriodType
}

export type PNLChartPoint = {
  date: string
  pnl: number
  cumulative_pnl: number
}

export type PNLCalendarDay = {
  date: string
  pnl: number
  tradeCount: number
}

export type PNLCalendarMonth = {
  year: number
  month: number
  pnl: number
  tradeCount: number
}

export type DashboardOverview = {
  pnl: {
    today: number
    d7: number
    d30: number
    d90: number
    year: number
    all: number
  }
  winRate: {
    d7: number
    d30: number
    d90: number
    all: number
  }
  totalTrades: {
    count: number
    volumeUsd: number
    volumeUsdD7: number
    volumeUsdD30: number
    volumeUsdD90: number
    volumeUsdAll: number
  }
}

export type AssetDistributionItem = {
  exchange: Exchange
  asset: string
  quantity: number
  usdValue: number
  ratio: number
}

export type AssetDistributionSummary = {
  totalUsd: number
  items: AssetDistributionItem[]
}

export type ExchangeAdapterTrade = {
  external_trade_id: string
  symbol: string
  side: 'buy' | 'sell'
  quantity: string
  price: string
  fee: string
  fee_currency: string
  realized_pnl: string | null
  funding_fee?: string
  income_type?: string | null
  trade_type: 'spot' | 'futures' | 'margin'
  traded_at: string
  raw_data: Record<string, unknown>
}

export type AssetBalance = {
  asset: string
  free: number
  locked: number
  usdValue: number
}

export type UnrealizedPosition = {
  symbol: string
  side: 'long' | 'short'
  size: number
  entryPrice: number
  markPrice: number
  unrealizedPnl: number
  leverage: number
  tradeType: 'futures'
}

export type ExchangeBalanceResult = {
  exchange_account_id: string
  exchange: Exchange
  total_usd: number
  assets: AssetBalance[]
  fetched_at: string
}

export type ExchangePositionsResult = {
  exchange_account_id: string
  total_unrealized_pnl: number
  positions: UnrealizedPosition[]
  fetched_at: string
}

export type SyncResult = {
  synced_trades: number
  new_trades: number
  last_synced: string
}
