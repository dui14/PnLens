import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BybitAdapter } from '@/lib/adapters/bybitAdapter'
import { credentials, installFastSleep, jsonResponse, recentSince, requestUrl } from './support/http'

const http = vi.hoisted(() => {
  return {
    handler: (_url: string): Response =>
      new Response('{"retCode":0,"result":{"list":[]}}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  }
})

vi.mock('@/lib/adapters/httpClient', () => ({
  fetchExchange: (url: string) => http.handler(url),
}))

installFastSleep()

function execution(overrides: Record<string, string> = {}) {
  return {
    execId: 'exec-1',
    orderId: 'order-1',
    symbol: 'BTCUSDT',
    side: 'Buy',
    execQty: '0.01000000',
    execPrice: '65000.125',
    execFee: '0.0200',
    feeCurrency: 'USDT',
    closedPnl: '',
    execType: 'Trade',
    execTime: '1710000000000',
    ...overrides,
  }
}

function defaultRoute(url: string): Response {
  if (url.includes('/v5/execution/list')) {
    return jsonResponse({ retCode: 0, result: { list: [], nextPageCursor: '' } })
  }
  if (url.includes('/v5/position/closed-pnl')) {
    return jsonResponse({ retCode: 0, result: { list: [], nextPageCursor: '' } })
  }
  if (url.includes('/v5/position/list')) return jsonResponse({ retCode: 0, result: { list: [] } })
  if (url.includes('/v5/account/wallet-balance')) return jsonResponse({ retCode: 0, result: { list: [] } })
  if (url.includes('/v5/market/tickers')) {
    return jsonResponse({ retCode: 0, result: { list: [{ lastPrice: '2' }] } })
  }
  return jsonResponse({ retCode: 10000, retMsg: 'unmocked' }, 404)
}

describe('BybitAdapter', () => {
  beforeEach(() => {
    http.handler = defaultRoute
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      throw new Error(`live fetch was called for ${requestUrl(input)}`)
    }))
  })

  it('normalizes a spot execution and accepts millisecond and second timestamps', async () => {
    http.handler = (url) => {
      if (url.includes('/v5/execution/list') && url.includes('category=spot')) {
        return jsonResponse({
          retCode: 0,
          result: {
            list: [execution(), execution({ execId: 'exec-sec', execTime: '1710000000' })],
            nextPageCursor: '',
          },
        })
      }
      return defaultRoute(url)
    }

    const trades = await new BybitAdapter().fetchTrades(credentials, recentSince())
    const first = trades.find((trade) => trade.external_trade_id === 'exec-1')
    const second = trades.find((trade) => trade.external_trade_id === 'exec-sec')
    expect(first).toMatchObject({
      symbol: 'BTCUSDT',
      side: 'buy',
      quantity: 0.01,
      price: 65000.125,
      fee: 0.02,
      fee_currency: 'USDT',
      realized_pnl: null,
      trade_type: 'spot',
      traded_at: new Date(1710000000000).toISOString(),
    })
    expect(second?.traded_at).toBe(new Date(1710000000000).toISOString())
    expect(JSON.stringify(trades).includes(credentials.apiSecret)).toBe(false)
  })

  it('uses the current time when execTime is not numeric', async () => {
    const before = Date.now()
    http.handler = (url) => {
      if (url.includes('/v5/execution/list') && url.includes('category=spot')) {
        return jsonResponse({
          retCode: 0,
          result: { list: [execution({ execTime: 'not-a-time' })], nextPageCursor: '' },
        })
      }
      return defaultRoute(url)
    }

    const trades = await new BybitAdapter().fetchTrades(credentials, recentSince())
    const tradedAtMs = new Date(trades[0]?.traded_at ?? '').getTime()
    expect(tradedAtMs).toBeGreaterThanOrEqual(before)
    expect(tradedAtMs).toBeLessThanOrEqual(Date.now() + 1000)
  })

  it('maps a short position and skips a zero size', async () => {
    http.handler = (url) => {
      if (url.includes('/v5/position/list')) {
        return jsonResponse({
          retCode: 0,
          result: {
            list: [
              {
                symbol: 'BTCUSDT',
                side: 'Sell',
                size: '0.20',
                avgPrice: '64000.5',
                markPrice: '63000.25',
                unrealisedPnl: '200.5',
                leverage: '10',
              },
              {
                symbol: 'ETHUSDT',
                side: 'Buy',
                size: '0',
                avgPrice: '1',
                markPrice: '1',
                unrealisedPnl: '0',
                leverage: '1',
              },
            ],
          },
        })
      }
      return defaultRoute(url)
    }

    const positions = await new BybitAdapter().fetchOpenPositions(credentials)
    expect(positions).toEqual([
      {
        symbol: 'BTCUSDT',
        side: 'short',
        size: 0.2,
        entryPrice: 64000.5,
        markPrice: 63000.25,
        unrealizedPnl: 200.5,
        leverage: 10,
        tradeType: 'futures',
      },
    ])
  })

  it('returns no trades for empty pages', async () => {
    await expect(new BybitAdapter().fetchTrades(credentials, recentSince())).resolves.toEqual([])
  })

  it('stops when the exchange returns an error code', async () => {
    http.handler = (url) => {
      if (url.includes('/v5/execution/list') || url.includes('/v5/position/closed-pnl')) {
        return jsonResponse({ retCode: 10006, retMsg: 'rate limit' }, 200)
      }
      return defaultRoute(url)
    }

    await expect(new BybitAdapter().fetchTrades(credentials, recentSince())).resolves.toEqual([])
  })

  it('retries an HTTP rate limit and then reads the execution', async () => {
    let attempts = 0
    http.handler = (url) => {
      if (url.includes('/v5/execution/list') && url.includes('category=spot')) {
        attempts += 1
        if (attempts === 1) return jsonResponse({ retCode: 10006, retMsg: 'too many' }, 429)
        return jsonResponse({
          retCode: 0,
          result: { list: [execution({ closedPnl: '1.25' })], nextPageCursor: '' },
        })
      }
      return defaultRoute(url)
    }

    const trades = await new BybitAdapter().fetchTrades(credentials, recentSince())
    expect(attempts).toBeGreaterThanOrEqual(2)
    expect(trades[0]).toMatchObject({ external_trade_id: 'exec-1', realized_pnl: 1.25 })
  })

  it('follows the next page cursor and keeps one copy of a duplicate exec id', async () => {
    let pages = 0
    const seen: string[] = []
    http.handler = (url) => {
      if (url.includes('/v5/execution/list') && url.includes('category=spot')) {
        pages += 1
        seen.push(url)
        if (pages === 1) {
          return jsonResponse({
            retCode: 0,
            result: {
              list: Array.from({ length: 100 }, (_, index) =>
                execution({ execId: index === 1 ? 'exec-0' : `exec-${index}` })
              ),
              nextPageCursor: 'cursor-2',
            },
          })
        }
        return jsonResponse({
          retCode: 0,
          result: { list: [execution({ execId: 'exec-0' })], nextPageCursor: '' },
        })
      }
      return defaultRoute(url)
    }

    const trades = await new BybitAdapter().fetchTrades(credentials, recentSince())
    expect(pages).toBeGreaterThanOrEqual(2)
    expect(seen[1]?.includes('cursor=cursor-2')).toBe(true)
    expect(trades.filter((trade) => trade.external_trade_id === 'exec-0')).toHaveLength(1)
  })
})
