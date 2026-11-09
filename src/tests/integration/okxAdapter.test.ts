import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OKXAdapter } from '@/lib/adapters/okxAdapter'
import { credentials, installFastSleep, jsonResponse, recentSince, requestUrl } from './support/http'

installFastSleep()

const tradedAt = '1710000000000'

function fill(overrides: Record<string, string> = {}) {
  return {
    instId: 'BTC-USDT',
    instType: 'SPOT',
    side: 'sell',
    fillSz: '0.1250',
    fillPx: '65000.1200',
    fillFee: '-0.30',
    fillPnl: '1.5',
    fillFeeCcy: 'USDT',
    tradeId: 'fill-1',
    execType: 'T',
    ts: tradedAt,
    ...overrides,
  }
}

function defaultRoute(url: string): Response {
  if (url.includes('/api/v5/public/instruments')) {
    return jsonResponse({
      code: '0',
      data: [{ instId: 'BTC-USDT-SWAP', ctVal: '0.01', ctValCcy: 'BTC' }],
    })
  }
  if (url.includes('/api/v5/trade/fills-history')) return jsonResponse({ code: '0', data: [] })
  if (url.includes('/api/v5/account/bills-archive')) return jsonResponse({ code: '0', data: [] })
  if (url.includes('/api/v5/account/positions')) return jsonResponse({ code: '0', data: [] })
  if (url.includes('/api/v5/market/ticker')) return jsonResponse({ code: '0', data: [{ last: '1' }] })
  return jsonResponse({ code: '50000', msg: 'unmocked' }, 404)
}

describe('OKXAdapter', () => {
  let handler: (url: string) => Response

  beforeEach(() => {
    handler = defaultRoute
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => handler(requestUrl(input)))
    )
  })

  it('normalizes a spot fill, strips the instrument hyphen, and keeps decimal strings', async () => {
    handler = (url) => {
      if (url.includes('/api/v5/trade/fills-history') && url.includes('instType=SPOT')) {
        return jsonResponse({ code: '0', data: [fill()] })
      }
      return defaultRoute(url)
    }

    const trades = await new OKXAdapter().fetchTrades(credentials, recentSince())
    expect(trades).toHaveLength(1)
    expect(trades[0]).toMatchObject({
      external_trade_id: 'okx_fill_fill-1',
      symbol: 'BTCUSDT',
      side: 'sell',
      quantity: 0.125,
      price: 65000.12,
      fee: 0.3,
      fee_currency: 'USDT',
      realized_pnl: 1.5,
      trade_type: 'spot',
      traded_at: new Date(1710000000000).toISOString(),
    })
    expect(JSON.stringify(trades).includes(credentials.apiSecret)).toBe(false)
  })

  it('scales swap quantity by the contract value and converts the symbol', async () => {
    handler = (url) => {
      if (url.includes('/api/v5/trade/fills-history') && url.includes('instType=SWAP')) {
        return jsonResponse({
          code: '0',
          data: [
            fill({
              instId: 'BTC-USDT-SWAP',
              instType: 'SWAP',
              fillSz: '2',
              fillPx: '65000',
              tradeId: 'swap-1',
            }),
          ],
        })
      }
      return defaultRoute(url)
    }

    const trades = await new OKXAdapter().fetchTrades(credentials, recentSince())
    const swap = trades.find((trade) => trade.external_trade_id === 'okx_fill_swap-1')
    expect(swap).toMatchObject({
      symbol: 'BTCUSDTSWAP',
      quantity: 0.02,
      trade_type: 'futures',
    })
  })

  it('uses the current time when the fill timestamp is not a number', async () => {
    const before = Date.now()
    handler = (url) => {
      if (url.includes('/api/v5/trade/fills-history') && url.includes('instType=SPOT')) {
        return jsonResponse({ code: '0', data: [fill({ ts: 'not-a-time', tradeId: 'bad-ts' })] })
      }
      return defaultRoute(url)
    }

    const trades = await new OKXAdapter().fetchTrades(credentials, recentSince())
    const tradedAtMs = new Date(trades[0]?.traded_at ?? '').getTime()
    expect(tradedAtMs).toBeGreaterThanOrEqual(before)
    expect(tradedAtMs).toBeLessThanOrEqual(Date.now() + 1000)
  })

  it('turns a non-numeric price into zero', async () => {
    handler = (url) => {
      if (url.includes('/api/v5/trade/fills-history') && url.includes('instType=SPOT')) {
        return jsonResponse({ code: '0', data: [fill({ fillPx: 'not-a-price', fillPnl: '' })] })
      }
      return defaultRoute(url)
    }

    const trades = await new OKXAdapter().fetchTrades(credentials, recentSince())
    expect(trades[0]?.price).toBe(0)
    expect(trades[0]?.realized_pnl).toBeNull()
  })

  it('returns no trades when every page is empty', async () => {
    await expect(new OKXAdapter().fetchTrades(credentials, recentSince())).resolves.toEqual([])
  })

  it('returns no trades when the exchange responds with an error', async () => {
    handler = (url) => {
      if (url.includes('/api/v5/public/instruments')) return defaultRoute(url)
      return jsonResponse({ code: '50000', msg: 'error' }, 500)
    }

    await expect(new OKXAdapter().fetchTrades(credentials, recentSince())).resolves.toEqual([])
  })

  it('retries a rate limit and then reads the fill', async () => {
    let attempts = 0
    handler = (url) => {
      if (url.includes('/api/v5/trade/fills-history') && url.includes('instType=SPOT')) {
        attempts += 1
        if (attempts === 1) return jsonResponse({ code: '50011', msg: 'rate limit' }, 429)
        return jsonResponse({ code: '0', data: [fill()] })
      }
      return defaultRoute(url)
    }

    const trades = await new OKXAdapter().fetchTrades(credentials, recentSince())
    expect(attempts).toBeGreaterThanOrEqual(2)
    expect(trades[0]?.external_trade_id).toBe('okx_fill_fill-1')
  })

  it('requests an older cursor after a full fill page and drops duplicate trade ids', async () => {
    let spotPages = 0
    const seen: string[] = []
    handler = (url) => {
      if (url.includes('/api/v5/trade/fills-history') && url.includes('instType=SPOT')) {
        spotPages += 1
        seen.push(url)
        if (spotPages === 1) {
          const stamp = String(Date.now() - 100)
          return jsonResponse({
            code: '0',
            data: Array.from({ length: 100 }, (_, index) =>
              fill({
                tradeId: index === 1 ? 'fill-0' : `fill-${index}`,
                ts: stamp,
              })
            ),
          })
        }
        return jsonResponse({
          code: '0',
          data: [fill({ tradeId: 'fill-next', ts: String(Date.now() - 50) })],
        })
      }
      return defaultRoute(url)
    }

    const trades = await new OKXAdapter().fetchTrades(credentials, recentSince())
    expect(spotPages).toBeGreaterThanOrEqual(2)
    expect(seen[1]).not.toBe(seen[0])
    const ids = trades.map((trade) => trade.external_trade_id)
    expect(ids.filter((id) => id === 'okx_fill_fill-0')).toHaveLength(1)
    expect(ids).toContain('okx_fill_fill-next')
  })
})
