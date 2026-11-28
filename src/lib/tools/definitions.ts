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
      description:
        "Get the signed-in user's own recent closed trades from PnLens. Use when the user asks about specific trades, their trade history, best or worst trades, or a symbol or exchange they traded. Do not use for aggregate PNL, win rate or totals (use get_pnl_stats), for greetings or concept questions, or for market prices.",
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
      description:
        "Get the signed-in user's own PNL statistics (total PNL, win rate, trade count, fees) over a 7, 30 or 90 day period, optionally per exchange. Use when the user asks how they are performing or about profit, loss, win rate or fees. Do not use for individual trade lists (use get_trade_history), for market prices or news, or for greetings and concept questions.",
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
      description:
        "Get the latest crypto news headlines from public RSS feeds, optionally filtered by a keyword. Use when the user asks for news, headlines, sentiment or what is happening in the crypto market. Do not use for prices (use get_market_quotes), for the user's own trades or PNL, or for general concept questions.",
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
      description:
        "Get current prices for crypto tickers (BTC, ETH, SOL and their USDT or USD pairs), gold (XAUUSD), stocks such as NVDA, indices such as NASDAQ, SPX and DXY, and oil. Use when the user asks for a current price or quote of a supported asset. Do not use for the user's own trades or PNL, for news, or for assets outside these groups.",
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