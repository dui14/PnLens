import {
  DEMO_FUTURES_PRICE_API_URL,
  DEMO_MARKET_BY_SYMBOL,
  DEMO_PRICE_API_URL,
  DEMO_PRICE_TIMEOUT_MS,
  type DemoMarket,
} from '@/lib/config/demoTrading'

type TickerRow = { symbol?: unknown; price?: unknown }

export function groupDemoSymbolsByMarket(symbols: string[]): Record<DemoMarket, string[]> {
  const groups: Record<DemoMarket, string[]> = { spot: [], futures: [] }
  for (const symbol of new Set(symbols)) {
    const market = DEMO_MARKET_BY_SYMBOL[symbol]
    if (market) groups[market].push(symbol)
  }
  return groups
}

async function fetchTickerRows(url: string): Promise<TickerRow[]> {
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(DEMO_PRICE_TIMEOUT_MS),
    })
    if (!res.ok) return []
    const rows = (await res.json()) as TickerRow[]
    return Array.isArray(rows) ? rows : []
  } catch {
    return []
  }
}

function collectPrices(rows: TickerRow[], wanted: Set<string>): Record<string, number> {
  const prices: Record<string, number> = {}
  for (const row of rows) {
    const price = Number(row.price)
    if (typeof row.symbol === 'string' && wanted.has(row.symbol) && Number.isFinite(price) && price > 0) {
      prices[row.symbol] = price
    }
  }
  return prices
}

async function fetchMarketPrices(market: DemoMarket, symbols: string[]): Promise<Record<string, number>> {
  if (symbols.length === 0) return {}
  const url =
    market === 'spot'
      ? `${DEMO_PRICE_API_URL}?symbols=${encodeURIComponent(JSON.stringify(symbols))}`
      : DEMO_FUTURES_PRICE_API_URL
  return collectPrices(await fetchTickerRows(url), new Set(symbols))
}

export async function fetchDemoPrices(symbols: string[]): Promise<Record<string, number>> {
  const groups = groupDemoSymbolsByMarket(symbols)
  const [spot, futures] = await Promise.all([
    fetchMarketPrices('spot', groups.spot),
    fetchMarketPrices('futures', groups.futures),
  ])
  return { ...spot, ...futures }
}

export async function fetchDemoPrice(symbol: string): Promise<number | null> {
  const prices = await fetchDemoPrices([symbol])
  return prices[symbol] ?? null
}
