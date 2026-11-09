import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GateioAdapter } from '@/lib/adapters/gateioAdapter'
import { credentials, installFastSleep, jsonResponse, recentSince, requestUrl } from './support/http'

installFastSleep()

function spotTrade(overrides: Record<string, string> = {}) {
  return {
    id: 'spot-1',
    currency_pair: 'BTC_USDT',
    side: 'sell',
    amount: '-0.01500000',
    price: '65000.2500',
    fee: '-0.0100',
    fee_currency: 'usdt',
    create_time_ms: '1710000000000',
    ...overrides,
  }
}

function defaultRoute(url: string): Response {
  if (url.includes('/futures/') && url.includes('/contracts')) {
    return jsonResponse([{ name: 'BTC_USDT', quanto_multiplier: '0.0001' }])
  }
  if (
    url.includes('/spot/my_trades') ||
    url.includes('/my_trades_timerange') ||
    url.includes('/position_close') ||
    url.includes('/futures/')
  ) {
    return jsonResponse([])
  }
  if (url.includes('/spot/accounts')) return jsonResponse([])
  return jsonResponse({ label: 'UNMOCKED' }, 404)
}

describe('GateioAdapter', () => {
  let handler: (url: string) => Response

  beforeEach(() => {
    handler = defaultRoute
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => handler(requestUrl(input)))
    )
  })

  it('normalizes a spot trade, symbol, absolute size, and millisecond timestamp', async () => {
    handler = (url) => {
      if (url.includes('/spot/my_trades')) return jsonResponse([spotTrade()])
      return defaultRoute(url)
    }

    const trades = await new GateioAdapter().fetchTrades(credentials, recentSince())
    expect(trades).toEqual([
      expect.objectContaining({
        external_trade_id: 'spot-1',
        symbol: 'BTCUSDT',
        side: 'sell',
        quantity: 0.015,
        price: 65000.25,
        fee: 0.01,
        fee_currency: 'USDT',
        realized_pnl: null,
        trade_type: 'spot',
        traded_at: new Date(1710000000000).toISOString(),
      }),
    ])
    expect(JSON.stringify(trades).includes(credentials.apiSecret)).toBe(false)
  })

  it('treats a small create_time as seconds and a bad amount as zero', async () => {
    handler = (url) => {
      if (url.includes('/spot/my_trades')) {
        return jsonResponse([
          {
            id: 'seconds',
            currency_pair: 'BTC_USDT',
            side: 'buy',
            amount: 'bad',
            price: '1',
            fee: '0',
            fee_currency: 'USDT',
            create_time: '1710000000',
          },
        ])
      }
      return defaultRoute(url)
    }

    const trades = await new GateioAdapter().fetchTrades(credentials, recentSince())
    expect(trades[0]).toMatchObject({
      external_trade_id: 'seconds',
      quantity: 0,
      traded_at: new Date(1710000000 * 1000).toISOString(),
    })
  })

  it('uses the current time when the timestamp cannot be parsed', async () => {
    const before = Date.now()
    handler = (url) => {
      if (url.includes('/spot/my_trades')) {
        return jsonResponse([spotTrade({ create_time_ms: 'not-a-time' })])
      }
      return defaultRoute(url)
    }

    const trades = await new GateioAdapter().fetchTrades(credentials, recentSince())
    const tradedAtMs = new Date(trades[0]?.traded_at ?? '').getTime()
    expect(tradedAtMs).toBeGreaterThanOrEqual(before)
    expect(tradedAtMs).toBeLessThanOrEqual(Date.now() + 1000)
  })

  it('scales a futures contract and maps a short position', async () => {
    handler = (url) => {
      if (url.includes('/futures/usdt/my_trades_timerange')) {
        return jsonResponse([
          {
            id: 'fut-1',
            contract: 'BTC_USDT',
            size: '-3',
            price: '65000',
            fee: '0.02',
            pnl: '8.5',
            create_time_ms: '1710000000000',
          },
        ])
      }
      if (url.includes('/futures/usdt/positions')) {
        return jsonResponse([
          {
            contract: 'BTC_USDT',
            size: '-2',
            entry_price: '64000',
            mark_price: '63000',
            unrealised_pnl: '20',
            leverage: '5',
          },
          { contract: 'ETH_USDT', size: '0', entry_price: '1', mark_price: '1', unrealised_pnl: '0', leverage: '1' },
        ])
      }
      return defaultRoute(url)
    }

    const adapter = new GateioAdapter()
    const trades = await adapter.fetchTrades(credentials, recentSince())
    const futures = trades.find((trade) => trade.external_trade_id === 'fut-1')
    expect(futures).toMatchObject({
      symbol: 'BTCUSDT',
      side: 'sell',
      quantity: 3 * 0.0001,
      realized_pnl: 8.5,
      trade_type: 'futures',
    })

    const positions = await adapter.fetchOpenPositions(credentials)
    expect(positions).toEqual([
      expect.objectContaining({
        symbol: 'BTCUSDT',
        side: 'short',
        size: 2 * 0.0001,
        unrealizedPnl: 20,
        leverage: 5,
      }),
    ])
  })

  it('returns no trades for empty pages', async () => {
    await expect(new GateioAdapter().fetchTrades(credentials, recentSince())).resolves.toEqual([])
  })

  it('returns no trades when the exchange returns an error', async () => {
    handler = (url) => {
      if (url.includes('/contracts')) return defaultRoute(url)
      return jsonResponse({ label: 'INVALID_KEY', message: 'invalid' }, 401)
    }

    await expect(new GateioAdapter().fetchTrades(credentials, recentSince())).resolves.toEqual([])
  })

  it('retries a rate limit and then reads the page', async () => {
    let attempts = 0
    handler = (url) => {
      if (url.includes('/spot/my_trades')) {
        attempts += 1
        if (attempts === 1) return jsonResponse({ label: 'TOO_MANY_REQUESTS' }, 429)
        return jsonResponse([spotTrade()])
      }
      return defaultRoute(url)
    }

    const trades = await new GateioAdapter().fetchTrades(credentials, recentSince())
    expect(attempts).toBeGreaterThanOrEqual(2)
    expect(trades[0]?.external_trade_id).toBe('spot-1')
  })

  it('requests the next spot page and keeps one copy of a duplicate id', async () => {
    let pages = 0
    const seen: string[] = []
    handler = (url) => {
      if (url.includes('/spot/my_trades')) {
        pages += 1
        seen.push(url)
        if (pages === 1) {
          return jsonResponse(
            Array.from({ length: 1000 }, (_, index) =>
              spotTrade({ id: index === 1 ? 'spot-0' : `spot-${index}` })
            )
          )
        }
        return jsonResponse([spotTrade({ id: 'spot-0' })])
      }
      return defaultRoute(url)
    }

    const trades = await new GateioAdapter().fetchTrades(credentials, recentSince())
    expect(pages).toBeGreaterThanOrEqual(2)
    expect(seen.some((url) => url.includes('page=2'))).toBe(true)
    expect(trades.filter((trade) => trade.external_trade_id === 'spot-0')).toHaveLength(1)
  })
})