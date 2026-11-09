import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BinanceAdapter } from '@/lib/adapters/binanceAdapter'
import { credentials, installFastSleep, jsonResponse, recentSince } from './support/http'

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

    const trades = await new BinanceAdapter().fetchTrades(credentials, recentSince())
    const spot = trades.find((trade) => trade.external_trade_id === 'spot_42')
    const futures = trades.find((trade) => trade.external_trade_id === 'futures_7')

    expect(spot).toMatchObject({
      symbol: 'BTCUSDT',
      side: 'buy',
      quantity: 0.00000001,
      price: 65000.12345678,
      fee: 0.00000001,
      fee_currency: 'BNB',
      realized_pnl: null,
      trade_type: 'spot',
      traded_at: new Date(spotTime).toISOString(),
    })
    expect(futures).toMatchObject({
      symbol: 'ETHUSDT',
      side: 'sell',
      quantity: 1.25,
      price: 2400.5,
      fee: 0.05,
      realized_pnl: -3.25,
      trade_type: 'futures',
      traded_at: new Date(spotTime).toISOString(),
    })
    expect(JSON.stringify(trades).includes(credentials.apiSecret)).toBe(false)
    expect(JSON.stringify(trades).includes('signature=')).toBe(false)
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

  it('treats an invalid symbol and a server error as an empty fill page', async () => {
    http.handler = (url) => {
      if (url.includes('/api/v3/myTrades')) return jsonResponse({ code: -1121, msg: 'Invalid symbol' }, 400)
      if (url.includes('/fapi/v1/userTrades')) return jsonResponse({ code: -1000, msg: 'server' }, 500)
      return defaultRoute(url)
    }

    await expect(new BinanceAdapter().fetchTrades(credentials, recentSince())).resolves.toEqual([])
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

    const trades = await new BinanceAdapter().fetchTrades(credentials, recentSince())
    expect(attempts).toBeGreaterThanOrEqual(2)
    expect(trades.some((trade) => trade.external_trade_id === 'spot_42')).toBe(true)
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
})
