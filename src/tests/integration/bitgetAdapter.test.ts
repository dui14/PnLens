import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BitgetAdapter } from '@/lib/adapters/bitgetAdapter'
import { credentials, installFastSleep, jsonResponse, recentSince, requestUrl } from './support/http'

installFastSleep()

function spotFill(overrides: Record<string, string> = {}) {
  return {
    tradeId: 'spot-1',
    symbol: 'BTC_USDT',
    side: 'sell',
    size: '0.01000000',
    priceAvg: '65000.12000000',
    feeDetail: { feeCoin: 'USDT', totalFee: '0.0400' },
    cTime: '1710000000000',
    ...overrides,
  }
}

function defaultRoute(url: string): Response {
  if (url.includes('/api/v2/spot/trade/fills')) return jsonResponse({ code: '00000', data: [] })
  if (url.includes('/api/v2/mix/order/fill-history')) {
    return jsonResponse({ code: '00000', data: { fillList: [], endId: '' } })
  }
  if (url.includes('/api/v2/mix/position/history-position')) {
    return jsonResponse({ code: '00000', data: { list: [] } })
  }
  if (url.includes('/api/mix/v1/position/allPosition-v2')) return jsonResponse({ code: '00000', data: [] })
  if (url.includes('/api/v2/spot/market/tickers')) {
    return jsonResponse({ code: '00000', data: [{ lastPr: '1' }] })
  }
  return jsonResponse({ code: '40000', msg: 'unmocked' }, 404)
}

describe('BitgetAdapter', () => {
  let handler: (url: string) => Response

  beforeEach(() => {
    handler = defaultRoute
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => handler(requestUrl(input)))
    )
  })

  it('normalizes a spot fill and removes the underscore from the symbol', async () => {
    handler = (url) => {
      if (url.includes('/api/v2/spot/trade/fills')) {
        return jsonResponse({ code: '00000', data: [spotFill()] })
      }
      return defaultRoute(url)
    }

    const trades = await new BitgetAdapter().fetchTrades(credentials, recentSince())
    expect(trades).toEqual([
      expect.objectContaining({
        external_trade_id: 'spot-1',
        symbol: 'BTCUSDT',
        side: 'sell',
        quantity: 0.01,
        price: 65000.12,
        fee: 0.04,
        fee_currency: 'USDT',
        realized_pnl: null,
        trade_type: 'spot',
        traded_at: new Date(1710000000000).toISOString(),
      }),
    ])
    expect(JSON.stringify(trades).includes(credentials.apiSecret)).toBe(false)
  })

  it('interprets a second-based cTime as milliseconds and rejects a non-numeric cTime', async () => {
    handler = (url) => {
      if (url.includes('/api/v2/spot/trade/fills')) {
        return jsonResponse({ code: '00000', data: [spotFill({ cTime: '1710000000', tradeId: 'seconds' })] })
      }
      return defaultRoute(url)
    }

    const seconds = await new BitgetAdapter().fetchTrades(credentials, recentSince())
    expect(seconds[0]?.traded_at).toBe(new Date(1710000000).toISOString())

    handler = (url) => {
      if (url.includes('/api/v2/spot/trade/fills')) {
        return jsonResponse({ code: '00000', data: [spotFill({ cTime: 'not-a-time' })] })
      }
      return defaultRoute(url)
    }

    await expect(new BitgetAdapter().fetchTrades(credentials, recentSince())).rejects.toThrow(RangeError)
  })

  it('uses the absolute futures quantity and a zero price for a bad price', async () => {
    handler = (url) => {
      if (url.includes('/api/v2/mix/order/fill-history') && url.includes('productType=USDT-FUTURES') && url.includes('startTime=')) {
        return jsonResponse({
          code: '00000',
          data: {
            fillList: [
              {
                tradeId: 'fut-1',
                symbol: 'ETH_USDT',
                side: 'sell',
                size: '-1.5000',
                price: 'not-a-price',
                fee: '-0.2',
                pnl: '4.5',
                cTime: '1710000000000',
              },
            ],
            endId: '',
          },
        })
      }
      return defaultRoute(url)
    }

    const trades = await new BitgetAdapter().fetchTrades(credentials, recentSince())
    const futures = trades.find((trade) => trade.external_trade_id === 'fut-1')
    expect(futures).toMatchObject({
      symbol: 'ETHUSDT',
      side: 'sell',
      quantity: 1.5,
      price: 0,
      fee: 0.2,
      realized_pnl: 4.5,
      trade_type: 'futures',
    })
  })

  it('maps a short open position and drops a zero size', async () => {
    handler = (url) => {
      if (url.includes('/api/mix/v1/position/allPosition-v2')) {
        return jsonResponse({
          code: '00000',
          data: [
            {
              symbol: 'BTCUSDT_UMCBL',
              holdSide: 'short',
              total: '0.3',
              averageOpenPrice: '64000',
              markPrice: '63000',
              unrealizedPL: '12.5',
              leverage: '8',
            },
            {
              symbol: 'ETHUSDT_UMCBL',
              holdSide: 'long',
              total: '0',
              averageOpenPrice: '1',
              markPrice: '1',
              unrealizedPL: '0',
              leverage: '1',
            },
          ],
        })
      }
      return defaultRoute(url)
    }

    const positions = await new BitgetAdapter().fetchOpenPositions(credentials)
    expect(positions).toHaveLength(1)
    expect(positions[0]).toMatchObject({
      symbol: 'BTCUSDTUMCBL',
      side: 'short',
      size: 0.3,
      unrealizedPnl: 12.5,
    })
  })

  it('returns no trades when fill lists are empty', async () => {
    await expect(new BitgetAdapter().fetchTrades(credentials, recentSince())).resolves.toEqual([])
  })

  it('returns no trades when spot and futures requests fail', async () => {
    handler = () => jsonResponse({ code: '40001', msg: 'error' }, 500)
    await expect(new BitgetAdapter().fetchTrades(credentials, recentSince())).resolves.toEqual([])
  })

  it('retries a spot rate limit', async () => {
    let attempts = 0
    handler = (url) => {
      if (url.includes('/api/v2/spot/trade/fills')) {
        attempts += 1
        if (attempts === 1) return jsonResponse({ code: '429', msg: 'too many' }, 429)
        return jsonResponse({ code: '00000', data: [spotFill()] })
      }
      return defaultRoute(url)
    }

    const trades = await new BitgetAdapter().fetchTrades(credentials, recentSince())
    expect(attempts).toBeGreaterThanOrEqual(2)
    expect(trades[0]?.external_trade_id).toBe('spot-1')
  })

  it('follows idLessThan and keeps one copy of a duplicate trade id', async () => {
    let pages = 0
    const seen: string[] = []
    handler = (url) => {
      if (url.includes('/api/v2/spot/trade/fills')) {
        pages += 1
        seen.push(url)
        if (pages === 1) {
          return jsonResponse({
            code: '00000',
            data: Array.from({ length: 100 }, (_, index) =>
              spotFill({ tradeId: index === 1 ? 'spot-0' : `spot-${index}` })
            ),
          })
        }
        return jsonResponse({
          code: '00000',
          data: [spotFill({ tradeId: 'spot-0' })],
        })
      }
      return defaultRoute(url)
    }

    const trades = await new BitgetAdapter().fetchTrades(credentials, recentSince())
    expect(pages).toBeGreaterThanOrEqual(2)
    expect(seen[1]?.includes('idLessThan=spot-99') || seen[1]?.includes('idLessThan=spot-0')).toBe(true)
    expect(trades.filter((trade) => trade.external_trade_id === 'spot-0')).toHaveLength(1)
  })
})
