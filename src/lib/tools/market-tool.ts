type GetMarketQuotesArgs = {
  symbols?: string
  query?: string
}

type YahooQuote = {
  symbol?: string
  shortName?: string
  longName?: string
  regularMarketPrice?: number
  regularMarketChange?: number
  regularMarketChangePercent?: number
  regularMarketDayHigh?: number
  regularMarketDayLow?: number
  currency?: string
  fullExchangeName?: string
  marketState?: string
  regularMarketTime?: number
}

type YahooQuoteResponse = {
  quoteResponse?: {
    result?: YahooQuote[]
  }
}

const QUOTE_API_URL = 'https://query1.finance.yahoo.com/v7/finance/quote'
const STOOQ_API_URL = 'https://stooq.com/q/l/'

const SYMBOL_ALIAS: Record<string, string> = {
  XAUUSD: 'XAUUSD=X',
  XAU: 'XAUUSD=X',
  GOLD: 'XAUUSD=X',
  NVDA: 'NVDA',
  NASDAQ: '^IXIC',
  SP500: '^GSPC',
  SPX: '^GSPC',
  DXY: 'DX-Y.NYB',
  USOIL: 'CL=F',
  BTC: 'BTC-USD',
  BTCUSDT: 'BTC-USD',
  BTCUSD: 'BTC-USD',
  BITCOIN: 'BTC-USD',
  ETH: 'ETH-USD',
  ETHUSDT: 'ETH-USD',
  ETHUSD: 'ETH-USD',
  ETHEREUM: 'ETH-USD',
  SOL: 'SOL-USD',
  SOLUSDT: 'SOL-USD',
}

const SYMBOL_QUERY_STOPWORDS = new Set<string>([
  'PRICE',
  'NEWS',
  'TODAY',
  'MARKET',
  'ACTION',
  'ANALYSIS',
  'ONCHAIN',
  'ON-CHAIN',
  'STRATEGY',
  'TRADING',
  'USDT',
  'USD',
])

const STOOQ_SYMBOL_ALIAS: Record<string, string> = {
  'XAUUSD=X': 'XAUUSD',
  NVDA: 'NVDA.US',
  '^IXIC': '^IXIC',
  '^GSPC': '^GSPC',
  'DX-Y.NYB': 'USDIDX',
  'CL=F': 'CL.F',
  'BTC-USD': 'BTCUSD',
  'ETH-USD': 'ETHUSD',
}

function normalizeSymbol(raw: string): string {
  const upper = raw.toUpperCase().trim()
  if (!upper) return ''

  const compact = upper.replace(/\//g, '')
  if (SYMBOL_ALIAS[upper]) {
    return SYMBOL_ALIAS[upper]
  }

  if (SYMBOL_ALIAS[compact]) {
    return SYMBOL_ALIAS[compact]
  }

  return compact
}

function parseSymbolsFromInput(input: string): string[] {
  const tokens = input
    .split(/[\s,;/|]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)

  const unique = new Set<string>()
  for (const token of tokens) {
    const upperToken = token.toUpperCase().trim()
    if (SYMBOL_QUERY_STOPWORDS.has(upperToken)) {
      continue
    }

    const normalized = normalizeSymbol(token)
    if (normalized) {
      unique.add(normalized)
    }
  }

  return Array.from(unique).slice(0, 10)
}

function extractSymbols(query: string): string[] {
  const upper = query.toUpperCase()
  const extracted = new Set<string>()

  for (const [alias, symbol] of Object.entries(SYMBOL_ALIAS)) {
    if (upper.includes(alias)) {
      extracted.add(symbol)
    }
  }

  const directMatches = upper.match(/[A-Z^]{2,12}(?:[-=][A-Z0-9.]{1,10})?/g) ?? []
  for (const token of directMatches) {
    if (SYMBOL_QUERY_STOPWORDS.has(token)) {
      continue
    }

    const normalized = normalizeSymbol(token)
    if (normalized) {
      extracted.add(normalized)
    }
  }

  return Array.from(extracted).slice(0, 10)
}

function inferSymbolsFromQueryHints(query: string): string[] {
  const upper = query.toUpperCase()
  const output = new Set<string>()

  if (upper.includes('BITCOIN') || upper.includes(' BTC ')) {
    output.add('BTC-USD')
  }

  if (upper.includes('ETHEREUM') || upper.includes(' ETH ')) {
    output.add('ETH-USD')
  }

  if (upper.includes('SOLANA') || upper.includes(' SOL ')) {
    output.add('SOL-USD')
  }

  return Array.from(output).slice(0, 10)
}

function pickRequestedSymbols(args: GetMarketQuotesArgs): string[] {
  const fromSymbols = args.symbols ? parseSymbolsFromInput(args.symbols) : []
  if (fromSymbols.length > 0) {
    return fromSymbols
  }

  const query = args.query?.trim() ?? ''
  if (!query) {
    return []
  }

  const extracted = extractSymbols(query)
  if (extracted.length > 0) {
    return extracted
  }

  return inferSymbolsFromQueryHints(query)
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  return null
}

function asNumberFromString(value: string): number | null {
  const normalized = value.trim()
  if (!normalized || normalized === 'N/D') {
    return null
  }

  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) {
    return null
  }

  return parsed
}

function toIsoFromUnixSeconds(value: number | null): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null
  }
  return new Date(value * 1000).toISOString()
}

function mapQuote(quote: YahooQuote): Record<string, unknown> | null {
  const symbol = typeof quote.symbol === 'string' ? quote.symbol : null
  const price = asNumber(quote.regularMarketPrice)

  if (!symbol || price === null) {
    return null
  }

  const url = `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`

  return {
    symbol,
    name: quote.shortName ?? quote.longName ?? symbol,
    price,
    change: asNumber(quote.regularMarketChange),
    changePercent: asNumber(quote.regularMarketChangePercent),
    dayHigh: asNumber(quote.regularMarketDayHigh),
    dayLow: asNumber(quote.regularMarketDayLow),
    currency: quote.currency ?? null,
    exchange: quote.fullExchangeName ?? null,
    marketState: quote.marketState ?? null,
    updatedAt: toIsoFromUnixSeconds(asNumber(quote.regularMarketTime)),
    source: 'Yahoo Finance',
    url,
  }
}

function toStooqSymbol(symbol: string): string {
  const upper = symbol.toUpperCase().trim()
  if (!upper) return upper
  if (STOOQ_SYMBOL_ALIAS[upper]) {
    return STOOQ_SYMBOL_ALIAS[upper]
  }
  return upper.replace(/=/g, '').replace(/-/g, '')
}

function toIsoFromStooq(date: string, time: string): string | null {
  if (date.length !== 8) {
    return null
  }

  const year = Number(date.slice(0, 4))
  const month = Number(date.slice(4, 6))
  const day = Number(date.slice(6, 8))
  const hour = time.length >= 2 ? Number(time.slice(0, 2)) : 0
  const minute = time.length >= 4 ? Number(time.slice(2, 4)) : 0
  const second = time.length >= 6 ? Number(time.slice(4, 6)) : 0

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null
  }

  return new Date(Date.UTC(year, month - 1, day, hour, minute, second)).toISOString()
}

function parseStooqQuoteRow(csvText: string): {
  symbol: string
  date: string
  time: string
  high: number | null
  low: number | null
  close: number | null
} | null {
  const line = csvText
    .trim()
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)[0]

  if (!line) {
    return null
  }

  const fields = line.split(',').map((field) => field.trim())
  if (fields.length < 7) {
    return null
  }

  return {
    symbol: fields[0],
    date: fields[1],
    time: fields[2],
    high: asNumberFromString(fields[4]),
    low: asNumberFromString(fields[5]),
    close: asNumberFromString(fields[6]),
  }
}

async function fetchStooqQuote(symbol: string): Promise<Record<string, unknown> | null> {
  const stooqSymbol = toStooqSymbol(symbol)
  if (!stooqSymbol) {
    return null
  }

  try {
    const response = await fetch(
      `${STOOQ_API_URL}?s=${encodeURIComponent(stooqSymbol.toLowerCase())}&i=d`,
      {
        headers: {
          Accept: 'text/plain',
        },
        next: { revalidate: 60 },
      }
    )

    if (!response.ok) {
      return null
    }

    const row = parseStooqQuoteRow(await response.text())
    if (!row || row.close === null) {
      return null
    }

    return {
      symbol,
      name: symbol,
      price: row.close,
      change: null,
      changePercent: null,
      dayHigh: row.high,
      dayLow: row.low,
      currency: 'USD',
      exchange: 'Stooq',
      marketState: 'REGULAR',
      updatedAt: toIsoFromStooq(row.date, row.time),
      source: 'Stooq',
      url: `https://stooq.com/q/?s=${encodeURIComponent(stooqSymbol.toLowerCase())}`,
    }
  } catch {
    return null
  }
}

async function fetchYahooQuotes(symbols: string[]): Promise<{
  items: Record<string, unknown>[]
  missingSymbols: string[]
  error: string | null
}> {
  const query = symbols.join(',')

  try {
    const response = await fetch(`${QUOTE_API_URL}?symbols=${encodeURIComponent(query)}`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'PnLens/1.0',
      },
      next: { revalidate: 60 },
    })

    if (!response.ok) {
      return {
        items: [],
        missingSymbols: symbols,
        error: `QUOTE_HTTP_${response.status}`,
      }
    }

    const payload = (await response.json()) as YahooQuoteResponse
    const rawResults = Array.isArray(payload.quoteResponse?.result) ? payload.quoteResponse?.result : []
    const items = rawResults
      .map((quote) => mapQuote(quote))
      .filter((quote): quote is Record<string, unknown> => quote !== null)

    const returnedSymbolSet = new Set(
      items
        .map((item) => (typeof item.symbol === 'string' ? item.symbol : null))
        .filter((symbol): symbol is string => symbol !== null)
    )

    const missingSymbols = symbols.filter((symbol) => !returnedSymbolSet.has(symbol))

    return {
      items,
      missingSymbols,
      error: null,
    }
  } catch {
    return {
      items: [],
      missingSymbols: symbols,
      error: 'QUOTE_FETCH_FAILED',
    }
  }
}

export async function getMarketQuotesTool(args: GetMarketQuotesArgs): Promise<Record<string, unknown>> {
  const requestedSymbols = pickRequestedSymbols(args)

  if (requestedSymbols.length === 0) {
    return {
      success: false,
      error: 'NO_SYMBOLS_FOUND',
      count: 0,
      items: [],
    }
  }

  const yahooResult = await fetchYahooQuotes(requestedSymbols)
  const mergedBySymbol = new Map<string, Record<string, unknown>>()

  for (const item of yahooResult.items) {
    const symbol = typeof item.symbol === 'string' ? item.symbol : null
    if (!symbol) {
      continue
    }
    mergedBySymbol.set(symbol, item)
  }

  let remainingSymbols = yahooResult.missingSymbols
  if (remainingSymbols.length > 0) {
    const fallbackItems = await Promise.all(remainingSymbols.map((symbol) => fetchStooqQuote(symbol)))
    for (const item of fallbackItems) {
      if (!item) {
        continue
      }
      const symbol = typeof item.symbol === 'string' ? item.symbol : null
      if (!symbol) {
        continue
      }
      mergedBySymbol.set(symbol, item)
    }

    const returnedAfterFallback = new Set(mergedBySymbol.keys())
    remainingSymbols = remainingSymbols.filter((symbol) => !returnedAfterFallback.has(symbol))
  }

  const items = Array.from(mergedBySymbol.values())

  if (items.length === 0) {
    return {
      success: false,
      error: yahooResult.error ?? 'QUOTE_FETCH_FAILED',
      count: 0,
      items: [],
      requestedSymbols,
      missingSymbols: remainingSymbols,
    }
  }

  return {
    success: true,
    count: items.length,
    items,
    requestedSymbols,
    missingSymbols: remainingSymbols,
    providers: {
      yahoo: yahooResult.items.length,
      stooq: items.filter((item) => item.source === 'Stooq').length,
      fallbackUsed: items.some((item) => item.source === 'Stooq'),
    },
    partialError: yahooResult.error,
  }
}