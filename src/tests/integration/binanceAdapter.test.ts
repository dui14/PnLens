import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BinanceAdapter } from '@/lib/adapters/binanceAdapter'
import { credentials as hmacCredentials, installFastSleep, jsonResponse, recentSince, testPrivateKeyPem } from './support/http'

const credentials = { ...hmacCredentials, apiSecret: testPrivateKeyPem }

const http = vi.hoisted(() => {
  return {
    handler: (_url: string): Response =>
      new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }),
  }
})

vi.mock('@/lib/adapters/httpClient', () => ({
  fetchExchange: (url: string) => http.handler(url),
}))

installFastSleep()

const spotTime = 1710000000000

function spotTrade(id = 42) {
  return {
    id,
    symbol: 'BTCUSDT',
    price: '65000.12345678',
    qty: '0.00000001',
    commission: '0.00000001',
    commissionAsset: 'BNB',
    time: spotTime,
    isBuyer: true,
  }
}

function futuresTrade(id = 7) {
  return {
    id,
    symbol: 'ETHUSDT',
    side: 'SELL',
    price: '2400.50',
    qty: '1.2500',
    commission: '0.0500',
    commissionAsset: 'USDT',
    realizedPnl: '-3.25',
    time: spotTime,
  }
}

function defaultRoute(url: string): Response {
  if (url.includes('/api/v3/account')) return jsonResponse({ balances: [] })
  if (url.includes('/api/v3/myTrades')) return jsonResponse([])
  if (url.includes('/fapi/v1/userTrades')) return jsonResponse([])
  if (url.includes('/fapi/v1/income')) return jsonResponse([])
  if (url.includes('/fapi/v2/positionRisk')) return jsonResponse([])
  if (url.includes('/api/v3/ticker/price')) return jsonResponse({ price: '1' })
  return jsonResponse({ code: -1000, msg: 'unmocked' }, 404)
}

describe('BinanceAdapter', () => {
  beforeEach(() => {
    http.handler = defaultRoute
  })

  it('normalizes spot and futures trades, timestamps, symbols, and decimal strings', async () => {
    http.handler = (url) => {
      if (url.includes('/api/v3/myTrades') && url.includes('symbol=BTCUSDT')) {
        return jsonResponse([spotTrade()])
      }
      if (url.includes('/fapi/v1/userTrades') && url.includes('symbol=BTCUSDT') && !url.includes('startTime=')) {
        return jsonResponse([futuresTrade()])
      }
      return defaultRoute(url)
    }

    const trades = await new BinanceAdapter().fetchTrades(credentials, new Date(spotTime - 1000))
    const spot = trades.find((trade) => trade.external_trade_id === 'spot_42')
    const futures = trades.find((trade) => trade.external_trade_id === 'futures_7')

    expect(spot).toMatchObject({
      symbol: 'BTCUSDT',
      side: 'buy',
      quantity: '0.00000001',
      price: '65000.12345678',
      fee: '0.00000001',
      fee_currency: 'BNB',
      realized_pnl: null,
      trade_type: 'spot',
      traded_at: new Date(spotTime).toISOString(),
    })
    expect(futures).toMatchObject({
      symbol: 'ETHUSDT',
      side: 'sell',
      quantity: '1.2500',
      price: '2400.50',
      fee: '0.0500',
      realized_pnl: '-3.25',
      trade_type: 'futures',
      traded_at: new Date(spotTime).toISOString(),
    })
    expect(JSON.stringify(trades).includes(credentials.apiSecret)).toBe(false)
    expect(JSON.stringify(trades).includes('signature=')).toBe(false)
  })

  it('queries and keeps a held bStock spot pair', async () => {
    const requested: string[] = []
    http.handler = (url) => {
      if (url.includes('/api/v3/account')) {
        return jsonResponse({ balances: [{ asset: 'NVDAB', free: '2.5', locked: '0' }] })
      }
      if (url.includes('/api/v3/myTrades')) {
        const symbol = new URL(url).searchParams.get('symbol') ?? ''
        requested.push(symbol)
        if (symbol === 'NVDABUSDT') {
          return jsonResponse([{ ...spotTrade(9), symbol: 'NVDABUSDT', price: '188.40', qty: '2.5' }])
        }
      }
      return defaultRoute(url)
    }

    const trades = await new BinanceAdapter().fetchTrades(credentials, new Date(spotTime - 1000))

    expect(requested).toContain('NVDABUSDT')
    expect(trades.find((trade) => trade.external_trade_id === 'spot_9')).toMatchObject({
      symbol: 'NVDABUSDT',
      side: 'buy',
      quantity: '2.5',
      price: '188.40',
      trade_type: 'spot',
    })
  })

  it('drops a zero position and maps long and short position amounts', async () => {
    http.handler = (url) => {
      if (url.includes('/fapi/v2/positionRisk')) {
        return jsonResponse([
          {
            symbol: 'BTCUSDT',
            positionAmt: '0.01000000',
            entryPrice: '65000.1',
            markPrice: '66000.2',
            unRealizedProfit: '10.01',
            leverage: '5',
          },
          {
            symbol: 'ETHUSDT',
            positionAmt: '-1.5',
            entryPrice: '2400',
            markPrice: '2300',
            unRealizedProfit: '150',
            leverage: '3',
          },
          {
            symbol: 'SOLUSDT',
            positionAmt: '0',
            entryPrice: '1',
            markPrice: '1',
            unRealizedProfit: '0',
            leverage: '1',
          },
        ])
      }
      return defaultRoute(url)
    }

    const positions = await new BinanceAdapter().fetchOpenPositions(credentials)
    expect(positions).toEqual([
      {
        symbol: 'BTCUSDT',
        side: 'long',
        size: 0.01,
        entryPrice: 65000.1,
        markPrice: 66000.2,
        unrealizedPnl: 10.01,
        leverage: 5,
        tradeType: 'futures',
      },
      {
        symbol: 'ETHUSDT',
        side: 'short',
        size: 1.5,
        entryPrice: 2400,
        markPrice: 2300,
        unrealizedPnl: 150,
        leverage: 3,
        tradeType: 'futures',
      },
    ])
  })

  it('returns no trades for an empty account and empty fills', async () => {
    const trades = await new BinanceAdapter().fetchTrades(credentials, recentSince())
    expect(trades).toEqual([])
  })

  it('treats an invalid symbol as an empty fill page and a server error as a failed window', async () => {
    http.handler = (url) => {
      if (url.includes('/api/v3/myTrades')) return jsonResponse({ code: -1121, msg: 'Invalid symbol' }, 400)
      return defaultRoute(url)
    }

    await expect(new BinanceAdapter().fetchTrades(credentials, recentSince())).resolves.toEqual([])

    http.handler = (url) => {
      if (url.includes('/fapi/v1/userTrades')) return jsonResponse({ code: -1000, msg: 'server' }, 500)
      return defaultRoute(url)
    }

    await expect(new BinanceAdapter().fetchTrades(credentials, recentSince())).rejects.toMatchObject({
      code: 'EXCHANGE_ERROR',
    })
  })

  it('retries a spot rate limit and then maps the fill', async () => {
    let attempts = 0
    http.handler = (url) => {
      if (url.includes('/api/v3/myTrades') && url.includes('symbol=BTCUSDT')) {
        attempts += 1
        if (attempts === 1) return jsonResponse({ code: -1003, msg: 'Too many requests' }, 429)
        return jsonResponse([spotTrade()])
      }
      return defaultRoute(url)
    }

    const trades = await new BinanceAdapter().fetchTrades(credentials, new Date(spotTime - 1000))
    expect(attempts).toBeGreaterThanOrEqual(2)
    expect(trades.some((trade) => trade.external_trade_id === 'spot_42')).toBe(true)
  })

  it('retries a rate-limited futures window using Retry-After and keeps all rows', async () => {
    let attempts = 0
    http.handler = (url) => {
      if (url.includes('/fapi/v1/userTrades') && url.includes('symbol=BTCUSDT') && url.includes('startTime=')) {
        attempts += 1
        if (attempts === 1) {
          return new Response(JSON.stringify({ code: -1003, msg: 'Too many requests' }), {
            status: 429,
            headers: { 'content-type': 'application/json', 'retry-after': '1' },
          })
        }
      }
      return defaultRoute(url)
    }

    const adapter = new BinanceAdapter()
    await adapter.fetchTrades(credentials, recentSince())
    expect(attempts).toBeGreaterThanOrEqual(2)
    expect(adapter.historyGaps().filter((gap) => gap.market === 'futures')).toHaveLength(0)
  })

  it('records a history gap when a futures window stays rate limited', async () => {
    http.handler = (url) => {
      if (url.includes('/fapi/v1/userTrades') && url.includes('symbol=BTCUSDT') && url.includes('startTime=')) {
        return jsonResponse({ code: -1003, msg: 'Too many requests' }, 418)
      }
      return defaultRoute(url)
    }

    const adapter = new BinanceAdapter()
    await adapter.fetchTrades(credentials, recentSince())
    expect(adapter.historyGaps().some((gap) => gap.market === 'futures')).toBe(true)
  })

  it('keeps one spot fill when the same id is returned twice', async () => {
    http.handler = (url) => {
      if (url.includes('/api/v3/myTrades') && url.includes('symbol=BTCUSDT')) {
        return jsonResponse([spotTrade(42), spotTrade(42)])
      }
      return defaultRoute(url)
    }

    const trades = await new BinanceAdapter().fetchTrades(credentials, new Date(spotTime - 1000))
    expect(trades.filter((trade) => trade.external_trade_id === 'spot_42')).toHaveLength(1)
  })

  it('keeps one futures trade when the external id is duplicated', async () => {
    http.handler = (url) => {
      if (url.includes('/fapi/v1/userTrades') && url.includes('symbol=BTCUSDT') && !url.includes('startTime=')) {
        return jsonResponse([futuresTrade(9), futuresTrade(9)])
      }
      return defaultRoute(url)
    }

    const trades = await new BinanceAdapter().fetchTrades(credentials, recentSince())
    const matches = trades.filter((trade) => trade.external_trade_id === 'futures_9')
    expect(matches).toHaveLength(1)
  })

  it('requests the next income page after a full page', async () => {
    const calls: string[] = []
    const pageTime = Date.now() - 500
    http.handler = (url) => {
      if (url.includes('/fapi/v1/income') && url.includes('incomeType=REALIZED_PNL')) {
        calls.push(url)
        if (calls.length === 1) {
          return jsonResponse(
            Array.from({ length: 1000 }, (_, index) => ({
              symbol: 'BTCUSDT',
              incomeType: 'REALIZED_PNL',
              income: '0.01',
              asset: 'USDT',
              info: '',
              time: pageTime,
              tranId: index + 1,
              tradeId: String(index + 1),
            }))
          )
        }
        return jsonResponse([])
      }
      return defaultRoute(url)
    }

    const trades = await new BinanceAdapter().fetchTrades(credentials, recentSince())
    expect(calls.length).toBeGreaterThanOrEqual(2)
    expect(trades.filter((trade) => trade.income_type === 'REALIZED_PNL')).toHaveLength(1000)
    expect(JSON.stringify(calls).includes(credentials.apiSecret)).toBe(false)
  })

  it('keeps income pages until a short page', async () => {
    const calls: string[] = []
    const pageTime = Date.now() - 60_000
    http.handler = (url) => {
      if (url.includes('/fapi/v1/income') && url.includes('incomeType=REALIZED_PNL')) {
        calls.push(url)
        const page = calls.length
        const length = page < 3 ? 1000 : 1
        return jsonResponse(
          Array.from({ length }, (_, index) => ({
            symbol: 'BTCUSDT',
            incomeType: 'REALIZED_PNL',
            income: '0.01',
            asset: 'USDT',
            info: '',
            time: pageTime + page * 1000 + index,
            tranId: page * 1000 + index + 1,
            tradeId: String(page * 1000 + index + 1),
          }))
        )
      }
      return defaultRoute(url)
    }

    const trades = await new BinanceAdapter().fetchTrades(credentials, recentSince())
    expect(calls.length).toBeGreaterThanOrEqual(3)
    expect(trades.filter((trade) => trade.income_type === 'REALIZED_PNL')).toHaveLength(2001)
    expect(JSON.stringify(calls).includes(credentials.apiSecret)).toBe(false)
  })

  describe('spot symbol discovery', () => {
    const catalog = {
      symbols: [
        { symbol: 'NVDABUSDT', baseAsset: 'NVDAB', quoteAsset: 'USDT', status: 'TRADING' },
        { symbol: 'NVDABFDUSD', baseAsset: 'NVDAB', quoteAsset: 'FDUSD', status: 'TRADING' },
        { symbol: 'OLDUSDT', baseAsset: 'OLD', quoteAsset: 'USDT', status: 'BREAK' },
        { symbol: 'OLDETH', baseAsset: 'OLD', quoteAsset: 'ETH', status: 'BREAK' },
        { symbol: 'DUSTUSDC', baseAsset: 'DUST', quoteAsset: 'USDC', status: 'TRADING' },
        { symbol: 'CVTBTC', baseAsset: 'CVT', quoteAsset: 'BTC', status: 'TRADING' },
        { symbol: 'DEPUSDT', baseAsset: 'DEP', quoteAsset: 'USDT', status: 'TRADING' },
        { symbol: 'WDRUSDT', baseAsset: 'WDR', quoteAsset: 'USDT', status: 'TRADING' },
        { symbol: 'AAPLBUSDT', baseAsset: 'AAPLB', quoteAsset: 'USDT', status: 'TRADING' },
      ],
    }
    const coins = [
      { coin: 'NVDAB', name: 'NVIDIA (bStocks)' },
      { coin: 'AAPLB', name: 'Apple (bStocks)' },
      { coin: 'BTC', name: 'Bitcoin' },
    ]

    function discoveryRoute(requested: string[], overrides: (url: string) => Response | null = () => null) {
      return (url: string): Response => {
        const custom = overrides(url)
        if (custom) return custom
        if (url.includes('/api/v3/exchangeInfo')) return jsonResponse(catalog)
        if (url.includes('/sapi/v1/capital/config/getall')) return jsonResponse(coins)
        if (url.includes('/sapi/v1/capital/deposit/hisrec')) return jsonResponse([{ coin: 'DEP' }])
        if (url.includes('/sapi/v1/capital/withdraw/history')) return jsonResponse([{ coin: 'WDR' }])
        if (url.includes('/sapi/v1/convert/tradeFlow')) {
          return jsonResponse({ list: [{ fromAsset: 'USDT', toAsset: 'CVT' }], moreData: false })
        }
        if (url.includes('/sapi/v1/asset/dribblet')) {
          return jsonResponse({ userAssetDribblets: [{ userAssetDribbletDetails: [{ fromAsset: 'DUST' }] }] })
        }
        if (url.includes('/api/v3/myTrades')) {
          requested.push(new URL(url).searchParams.get('symbol') ?? '')
          return jsonResponse([])
        }
        return defaultRoute(url)
      }
    }

    it('scans stored symbols even when the balance is zero', async () => {
      const requested: string[] = []
      http.handler = discoveryRoute(requested)
      const adapter = new BinanceAdapter()
      adapter.setKnownSpotSymbols(['OLDUSDT'])
      await adapter.fetchTrades(credentials, recentSince())
      expect(requested).toContain('OLDUSDT')
      expect(adapter.spotDiscoveryStats().known).toBe(1)
    })

    it('expands deposit, withdraw, convert and dust assets to listed pairs including BREAK ones', async () => {
      const requested: string[] = []
      http.handler = discoveryRoute(requested)
      const adapter = new BinanceAdapter()
      adapter.setKnownSpotSymbols(['SEEDUSDT'])
      await adapter.fetchTrades(credentials, recentSince())
      expect(requested).toEqual(expect.arrayContaining(['DEPUSDT', 'WDRUSDT', 'CVTBTC', 'DUSTUSDC']))
      expect(requested).not.toContain('OLDETH')
      expect(adapter.spotDiscoveryStats().history).toBe(4)
    })

    it('scans bStock pairs on the first scan only', async () => {
      const first: string[] = []
      http.handler = discoveryRoute(first)
      const firstAdapter = new BinanceAdapter()
      firstAdapter.setKnownSpotSymbols([])
      await firstAdapter.fetchTrades(credentials, recentSince())
      expect(first).toEqual(expect.arrayContaining(['NVDABUSDT', 'NVDABFDUSD', 'AAPLBUSDT']))
      expect(first).not.toContain('OLDUSDT')
      expect(firstAdapter.spotDiscoveryStats().bStock).toBe(3)

      const later: string[] = []
      http.handler = discoveryRoute(later)
      const laterAdapter = new BinanceAdapter()
      laterAdapter.setKnownSpotSymbols(['BTCUSDT'])
      await laterAdapter.fetchTrades(credentials, recentSince())
      expect(later).not.toContain('NVDABUSDT')
      expect(later).not.toContain('AAPLBUSDT')
    })

    it('finishes the scan without a gap when every optional discovery endpoint fails', async () => {
      const requested: string[] = []
      http.handler = discoveryRoute(requested, (url) =>
        url.includes('/sapi/') && !url.includes('getall') ? jsonResponse({ code: -2015, msg: 'denied' }, 401) : null
      )
      const adapter = new BinanceAdapter()
      adapter.setKnownSpotSymbols(['OLDUSDT'])
      const trades = await adapter.fetchTrades(credentials, recentSince())
      expect(Array.isArray(trades)).toBe(true)
      expect(requested).toContain('OLDUSDT')
      expect(adapter.historyGaps()).toEqual([])
    })

    it('records a gap only when exchangeInfo fails', async () => {
      const requested: string[] = []
      http.handler = discoveryRoute(requested, (url) =>
        url.includes('/api/v3/exchangeInfo') ? jsonResponse({ code: -1000 }, 500) : null
      )
      const adapter = new BinanceAdapter()
      adapter.setKnownSpotSymbols(['OLDUSDT'])
      await adapter.fetchTrades(credentials, recentSince())
      expect(adapter.historyGaps().map((gap) => gap.market)).toEqual(['spot_discovery'])
    })
  })
})
