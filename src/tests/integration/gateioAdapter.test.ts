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
        quantity: '-0.01500000',
        price: '65000.2500',
        fee: '-0.0100',
        fee_currency: 'USDT',
        realized_pnl: null,
        trade_type: 'spot',
        traded_at: new Date(1710000000000).toISOString(),
      }),
    ])
    expect(JSON.stringify(trades).includes(credentials.apiSecret)).toBe(false)
  })

  it('treats a small create_time as seconds and drops a malformed amount', async () => {
    handler = (url) => {
      if (url.includes('/spot/my_trades')) {
        return jsonResponse([
          {
            id: 'seconds',
            currency_pair: 'BTC_USDT',
            side: 'buy',
            amount: '1.5',
            price: '1',
            fee: '0',
            fee_currency: 'USDT',
            create_time: '1710000000',
          },
          {
            id: 'bad-amount',
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
    expect(trades.map((trade) => trade.external_trade_id)).toEqual(['seconds'])
    expect(trades[0]).toMatchObject({
      quantity: '1.5',
      traded_at: new Date(1710000000 * 1000).toISOString(),
    })
  })

  it('drops a spot trade whose timestamp cannot be parsed', async () => {
    handler = (url) => {
      if (url.includes('/spot/my_trades')) {
        return jsonResponse([
          spotTrade({ create_time_ms: 'not-a-time', id: 'bad-ts' }),
          spotTrade({ id: 'spot-ok' }),
        ])
      }
      return defaultRoute(url)
    }

    const trades = await new GateioAdapter().fetchTrades(credentials, recentSince())
    expect(trades.map((trade) => trade.external_trade_id)).toEqual(['spot-ok'])
  })

  it('keeps the futures fill size and maps a short position', async () => {
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
      quantity: '0.0003',
      realized_pnl: '8.5',
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

  it('converts futures contracts to base units so volume is not inflated', async () => {
    handler = (url) => {
      if (url.includes('/futures/usdt/my_trades_timerange')) {
        return jsonResponse([
          { trade_id: '843', contract: 'BTC_USDT', size: 66, price: '84500', fee: '0.27885', create_time_ms: '1710000000000' },
        ])
      }
      return defaultRoute(url)
    }

    const [trade] = await new GateioAdapter().fetchTrades(credentials, recentSince())
    expect(trade.quantity).toBe('0.0066')
    expect(Number(trade.quantity) * Number(trade.price)).toBeCloseTo(557.7, 6)
  })

  it('skips a futures fill whose contract spec cannot be read instead of storing raw contracts', async () => {
    handler = (url) => {
      if (url.includes('/futures/usdt/my_trades_timerange')) {
        return jsonResponse([
          { trade_id: '844', contract: 'ETH_USDT', size: 5, price: '3000', fee: '0.1', create_time_ms: '1710000000000' },
        ])
      }
      if (url.includes('/futures/usdt/contracts/ETH_USDT')) return jsonResponse({ label: 'ERR' }, 404)
      return defaultRoute(url)
    }

    const trades = await new GateioAdapter().fetchTrades(credentials, recentSince())
    expect(trades.filter((trade) => trade.trade_type === 'futures')).toEqual([])
  })

  it('reads a single contract spec object without downloading the full contract list', async () => {
    const requested: string[] = []
    handler = (url) => {
      requested.push(url)
      if (url.includes('/futures/usdt/my_trades_timerange')) {
        return jsonResponse([
          { trade_id: '845', contract: 'ETH_USDT', size: 10, price: '3000', fee: '0.1', create_time_ms: '1710000000000' },
        ])
      }
      if (url.endsWith('/futures/usdt/contracts/ETH_USDT')) {
        return jsonResponse({ name: 'ETH_USDT', quanto_multiplier: '0.01' })
      }
      return defaultRoute(url)
    }

    const trades = await new GateioAdapter().fetchTrades(credentials, recentSince())
    expect(trades.find((trade) => trade.external_trade_id === '845')?.quantity).toBe('0.10')
    expect(requested.some((url) => url.endsWith('/futures/usdt/contracts'))).toBe(false)
  })

  it('accepts numeric size and time on futures fills and uses trade_id', async () => {
    handler = (url) => {
      if (url.includes('/futures/usdt/my_trades_timerange')) {
        return jsonResponse([
          {
            trade_id: '991',
            order_id: '5001',
            contract: 'BTC_USDT',
            size: -3,
            price: '65000',
            fee: '0.02',
            create_time: 1710000000.5,
          },
        ])
      }
      return defaultRoute(url)
    }

    const trades = await new GateioAdapter().fetchTrades(credentials, recentSince())
    expect(trades).toEqual([
      expect.objectContaining({
        external_trade_id: '991',
        symbol: 'BTCUSDT',
        side: 'sell',
        quantity: '0.0003',
        fee: '0.02',
        realized_pnl: null,
        trade_type: 'futures',
        traded_at: new Date(1710000000500).toISOString(),
      }),
    ])
  })

  it('stores a position_close record with pnl, fee, funding and a derived id', async () => {
    handler = (url) => {
      if (url.includes('/futures/usdt/position_close')) {
        return jsonResponse([
          {
            time: 1710000100,
            contract: 'BTC_USDT',
            side: 'long',
            pnl: '12.5',
            pnl_pnl: '13',
            pnl_fund: '-0.1',
            pnl_fee: '-0.4',
            text: 'web',
          },
        ])
      }
      return defaultRoute(url)
    }

    const trades = await new GateioAdapter().fetchTrades(credentials, recentSince())
    expect(trades).toEqual([
      expect.objectContaining({
        external_trade_id: 'position_close_BTCUSDT_long_1710000100',
        symbol: 'BTCUSDT',
        side: 'sell',
        realized_pnl: '12.5',
        fee: '-0.4',
        funding_fee: '-0.1',
        income_type: 'position_close',
        trade_type: 'futures',
        traded_at: new Date(1710000100000).toISOString(),
      }),
    ])
  })
})
