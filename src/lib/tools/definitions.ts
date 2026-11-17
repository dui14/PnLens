export const TOOL_NAMES = [
  'get_trade_history',
  'get_pnl_stats',
  'get_crypto_news',
  'get_market_quotes',
] as const
export type ToolName = (typeof TOOL_NAMES)[number]

export const TOOL_EXCHANGES = ['all', 'binance', 'okx', 'bybit', 'bitget', 'gateio'] as const
export type ToolExchange = (typeof TOOL_EXCHANGES)[number]

export const TOOL_PERIODS = ['7d', '30d', '90d'] as const
export type ToolPeriod = (typeof TOOL_PERIODS)[number]

type ToolParameter = {
  type: 'string' | 'number' | 'boolean'
  description: string
  enum?: readonly string[]
}

type ToolParameters = {
  type: 'object'
  properties: Record<string, ToolParameter>
  required?: string[]
  additionalProperties?: boolean
}

export type OpenRouterToolDefinition = {
  type: 'function'
  function: {
    name: ToolName
    description: string
    parameters: ToolParameters
  }
}

export const TOOL_DEFINITIONS: OpenRouterToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'get_trade_history',
      description: 'Get recent closed trades of the user from the system',
      parameters: {
        type: 'object',
        properties: {
          exchange: {
            type: 'string',
            description: 'Filter by exchange',
            enum: TOOL_EXCHANGES,
          },
          symbol: {
            type: 'string',
            description: 'Filter by trading pair, for example BTCUSDT',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of trades, minimum 1, maximum 50',
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_pnl_stats',
      description: 'Calculate PNL statistics over a 7/30/90 day period',
      parameters: {
        type: 'object',
        properties: {
          period: {
            type: 'string',
            description: 'Statistics period',
            enum: TOOL_PERIODS,
          },
          exchange: {
            type: 'string',
            description: 'Filter by exchange',
            enum: TOOL_EXCHANGES,
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_crypto_news',
      description: 'Get the latest crypto news from multiple RSS feeds in parallel',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Keyword to filter news, for example bitcoin, ethereum, etf',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of news items, minimum 1, maximum 12',
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_market_quotes',
      description: 'Get current market prices for assets such as XAUUSD, NVDA and other common symbols',
      parameters: {
        type: 'object',
        properties: {
          symbols: {
            type: 'string',
            description: 'Comma-separated list of symbols. Example: XAUUSD,NVDA',
          },
          query: {
            type: 'string',
            description: 'Question or keyword used to extract symbols when symbols is not provided',
          },
        },
        additionalProperties: false,
      },
    },
  },
]