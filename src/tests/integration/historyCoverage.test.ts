import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BinanceAdapter } from '@/lib/adapters/binanceAdapter'
import { BitgetAdapter } from '@/lib/adapters/bitgetAdapter'
import { BybitAdapter } from '@/lib/adapters/bybitAdapter'
import { GateioAdapter } from '@/lib/adapters/gateioAdapter'
import { OKXAdapter } from '@/lib/adapters/okxAdapter'
import { BINANCE_HISTORY, DAY_MS, EXCHANGE_SCAN_LIMITS, SCAN_LOOKBACK_DAYS } from '@/lib/scan/scanLimits'
import { credentials, installFastSleep, jsonResponse, requestUrl, testPrivateKeyPem } from './support/http'

installFastSleep()

const WEEK_DAYS = 7
const GATE_WINDOW_DAYS = 30
const PAGE_ROWS = 100
const BINANCE_PAGE_ROWS = 1000

type Router = (url: string) => Response

let router: Router
let urls: string[]

beforeEach(() => {
  urls = []
  router = () => jsonResponse({}, 404)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input)
      urls.push(url)
      return router(url)
    })
  )
})

function param(url: string, key: string): string | null {
  return new URL(url).searchParams.get(key)
}

function starts(match: (url: string) => boolean, key: string, scale = 1): number[] {
  return urls
    .filter(match)
    .map((url) => Number(param(url, key)) * scale)
    .filter((value) => Number.isFinite(value) && value > 0)
}

function since(days: number): Date {
  return new Date(Date.now() - days * DAY_MS)
}

function expectCoverage(startValues: number[], days: number, windowDays: number) {
  const unique = Array.from(new Set(startValues)).sort((a, b) => a - b)
  expect(unique.length).toBeGreaterThanOrEqual(Math.floor(days / windowDays))
  expect(unique[0]).toBeLessThanOrEqual(Date.now() - (days - windowDays) * DAY_MS)
  for (let index = 1; index < unique.length; index += 1) {
    expect(unique[index] - unique[index - 1]).toBeLessThanOrEqual(windowDays * DAY_MS + 1)
  }
}

describe('history coverage', () => {
  it('binance futures walks userTrades windows even when recent fills exist', async () => {
    const binanceCredentials = { ...credentials, apiSecret: testPrivateKeyPem }
    router = (url) => {
      if (url.includes('/api/v3/account')) return jsonResponse({ balances: [] })
      if (url.includes('/fapi/v1/userTrades') && url.includes('symbol=BTCUSDT') && !url.includes('startTime=')) {
        return jsonResponse([
          {
            id: 1,
            symbol: 'BTCUSDT',
            side: 'BUY',
            price: '1',
            qty: '1',
            commission: '0',
            commissionAsset: 'USDT',
            realizedPnl: '0',
            time: Date.now() - 1000,
          },
        ])
      }
      return jsonResponse([])
    }

    await new BinanceAdapter().fetchTrades(binanceCredentials, since(SCAN_LOOKBACK_DAYS))

    const windowStarts = starts(
      (url) => url.includes('/fapi/v1/userTrades') && url.includes('symbol=BTCUSDT') && url.includes('startTime='),
      'startTime'
    )
    expectCoverage(windowStarts, BINANCE_HISTORY.futuresFillsLookbackDays, BINANCE_HISTORY.futuresWindowDays)
  })

  it('binance futures income covers the full lookback', async () => {
    const binanceCredentials = { ...credentials, apiSecret: testPrivateKeyPem }
    router = (url) => (url.includes('/api/v3/account') ? jsonResponse({ balances: [] }) : jsonResponse([]))

    await new BinanceAdapter().fetchTrades(binanceCredentials, since(SCAN_LOOKBACK_DAYS))

    const incomeStarts = starts(
      (url) => url.includes('/fapi/v1/income') && url.includes('incomeType=REALIZED_PNL'),
      'startTime'
    )
    expectCoverage(incomeStarts, SCAN_LOOKBACK_DAYS, BINANCE_HISTORY.incomeWindowDays)
  })

  it('binance spot pages by fromId until a short page', async () => {
    const binanceCredentials = { ...credentials, apiSecret: testPrivateKeyPem }
    const tradeTime = Date.now() - DAY_MS
    const spot = (id: number) => ({
      id,
      symbol: 'BTCUSDT',
      price: '1',
      qty: '1',
      commission: '0',
      commissionAsset: 'BNB',
      time: tradeTime,
      isBuyer: true,
    })
    router = (url) => {
      if (url.includes('/api/v3/account')) return jsonResponse({ balances: [] })
      if (url.includes('/api/v3/myTrades') && url.includes('symbol=BTCUSDT')) {
        const fromId = Number(param(url, 'fromId'))
        if (fromId === 0) {
          return jsonResponse(Array.from({ length: BINANCE_PAGE_ROWS }, (_, index) => spot(index + 1)))
        }
        return jsonResponse([spot(BINANCE_PAGE_ROWS + 1)])
      }
      return jsonResponse([])
    }

    const trades = await new BinanceAdapter().fetchTrades(binanceCredentials, since(SCAN_LOOKBACK_DAYS))

    expect(trades.filter((trade) => trade.trade_type === 'spot')).toHaveLength(BINANCE_PAGE_ROWS + 1)
    const fromIds = starts((url) => url.includes('/api/v3/myTrades') && url.includes('symbol=BTCUSDT'), 'fromId')
    expect(fromIds).toContain(BINANCE_PAGE_ROWS + 1)
  })

  it('okx walks fills-history windows and pages inside a full window', async () => {
    const days = SCAN_LOOKBACK_DAYS
    let firstSpotCall = true
    router = (url) => {
      if (url.includes('/trade/fills-history') && url.includes('instType=SPOT')) {
        if (firstSpotCall) {
          firstSpotCall = false
          const end = Number(param(url, 'end'))
          return jsonResponse({
            code: '0',
            data: Array.from({ length: PAGE_ROWS }, (_, index) => ({ ts: String(end - index) })),
          })
        }
      }
      return jsonResponse({ code: '0', data: [] })
    }

    await new OKXAdapter().fetchTrades(credentials, since(days))

    const spotCalls = urls.filter((url) => url.includes('/trade/fills-history') && url.includes('instType=SPOT'))
    const windowStarts = spotCalls.map((url) => Number(param(url, 'begin')))
    expectCoverage(windowStarts, days, WEEK_DAYS)
    expect(spotCalls.length).toBeGreaterThan(new Set(windowStarts).size)
  })

  it('bybit walks execution windows and follows the cursor', async () => {
    const days = SCAN_LOOKBACK_DAYS
    let issuedCursor = false
    router = (url) => {
      if (url.includes('/v5/execution/list') && url.includes('category=spot')) {
        if (!issuedCursor) {
          issuedCursor = true
          return jsonResponse({
            retCode: 0,
            result: {
              list: Array.from({ length: PAGE_ROWS }, (_, index) => ({ execId: `e${index}`, execTime: '1' })),
              nextPageCursor: 'next-page',
            },
          })
        }
      }
      return jsonResponse({ retCode: 0, result: { list: [], nextPageCursor: '' } })
    }

    await new BybitAdapter().fetchTrades({ ...credentials, apiSecret: testPrivateKeyPem }, since(days))

    const spotCalls = urls.filter((url) => url.includes('/v5/execution/list') && url.includes('category=spot'))
    expectCoverage(spotCalls.map((url) => Number(param(url, 'startTime'))), days, WEEK_DAYS)
    expect(spotCalls.some((url) => param(url, 'cursor') === 'next-page')).toBe(true)
  })

  it('bybit retries a body rate limit instead of skipping the window', async () => {
    let limited = true
    router = (url) => {
      if (url.includes('/v5/execution/list') && url.includes('category=spot') && limited) {
        limited = false
        return jsonResponse({ retCode: 10006, retMsg: 'Too many visits' })
      }
      return jsonResponse({ retCode: 0, result: { list: [], nextPageCursor: '' } })
    }

    await new BybitAdapter().fetchTrades({ ...credentials, apiSecret: testPrivateKeyPem }, since(WEEK_DAYS))

    const firstStart = Math.min(
      ...starts((url) => url.includes('/v5/execution/list') && url.includes('category=spot'), 'startTime')
    )
    const repeats = urls.filter(
      (url) => url.includes('/v5/execution/list') && Number(param(url, 'startTime')) === firstStart && url.includes('category=spot')
    )
    expect(repeats.length).toBeGreaterThanOrEqual(2)
  })

  it('bitget walks spot and futures windows across the lookback', async () => {
    const bitgetCredentials = { ...credentials, apiSecret: testPrivateKeyPem }
    router = (url) => {
      if (url.includes('/api/v2/spot/trade/fills')) return jsonResponse({ code: '00000', data: [] })
      if (url.includes('/api/v2/mix/order/fill-history')) {
        return jsonResponse({ code: '00000', data: { fillList: [], endId: '' } })
      }
      return jsonResponse({ code: '00000', data: [] })
    }

    await new BitgetAdapter().fetchTrades(bitgetCredentials, since(SCAN_LOOKBACK_DAYS))

    expectCoverage(
      starts((url) => url.includes('/api/v2/spot/trade/fills'), 'startTime'),
      SCAN_LOOKBACK_DAYS,
      WEEK_DAYS
    )
    expectCoverage(
      starts((url) => url.includes('/mix/order/fill-history') && url.includes('productType=USDT-FUTURES') && url.includes('startTime='), 'startTime'),
      EXCHANGE_SCAN_LIMITS.bitget.maxLookbackDays,
      WEEK_DAYS
    )
  })

  it('gateio walks 30 day windows for spot and futures and pages spot', async () => {
    let firstSpot = true
    router = (url) => {
      if (url.includes('/spot/my_trades') && firstSpot) {
        firstSpot = false
        return jsonResponse(Array.from({ length: BINANCE_PAGE_ROWS }, (_, index) => ({ id: `s${index}` })))
      }
      return jsonResponse([])
    }

    await new GateioAdapter().fetchTrades(credentials, since(SCAN_LOOKBACK_DAYS))

    const spotCalls = urls.filter((url) => url.includes('/spot/my_trades'))
    const spotStarts = spotCalls.map((url) => Number(param(url, 'from')) * 1000)
    expectCoverage(spotStarts, SCAN_LOOKBACK_DAYS, GATE_WINDOW_DAYS)
    expect(spotCalls.some((url) => param(url, 'page') === '2')).toBe(true)
    expectCoverage(
      starts((url) => url.includes('/futures/usdt/my_trades_timerange'), 'from', 1000),
      SCAN_LOOKBACK_DAYS,
      GATE_WINDOW_DAYS
    )
  })

  it('okx re-signs a retried request with a newer timestamp', async () => {
    const stamps: string[] = []
    let limited = true
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-06-01T00:00:00.000Z'))
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input)
        if (url.includes('/trade/fills-history') && url.includes('instType=SPOT')) {
          stamps.push(new Headers(init?.headers).get('OK-ACCESS-TIMESTAMP') ?? '')
          if (limited) {
            limited = false
            vi.setSystemTime(new Date('2026-06-01T00:00:05.000Z'))
            return jsonResponse({ code: '50011', msg: 'Too Many Requests', data: [] })
          }
        }
        return jsonResponse({ code: '0', data: [] })
      })
    )

    await new OKXAdapter().fetchTrades(credentials, new Date(Date.now() - DAY_MS), new Date())
    vi.useRealTimers()

    expect(stamps.length).toBeGreaterThanOrEqual(2)
    expect(stamps[1]).not.toBe(stamps[0])
    expect(Date.parse(stamps[1])).toBeGreaterThan(Date.parse(stamps[0]))
  })

  it('bybit re-signs a retried request with a newer timestamp', async () => {
    const stamps: number[] = []
    let limited = true
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-06-01T00:00:00.000Z'))
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input)
        if (url.includes('/v5/execution/list') && url.includes('category=spot')) {
          stamps.push(Number(new Headers(init?.headers).get('X-BAPI-TIMESTAMP')))
          if (limited) {
            limited = false
            vi.setSystemTime(new Date('2026-06-01T00:00:05.000Z'))
            return jsonResponse({ retCode: 10006, retMsg: 'Too many visits' })
          }
        }
        return jsonResponse({ retCode: 0, result: { list: [], nextPageCursor: '' } })
      })
    )

    await new BybitAdapter().fetchTrades(
      { ...credentials, apiSecret: testPrivateKeyPem },
      new Date(Date.now() - DAY_MS),
      new Date()
    )
    vi.useRealTimers()

    expect(stamps.length).toBeGreaterThanOrEqual(2)
    expect(stamps[1]).toBeGreaterThan(stamps[0])
  })

  it('records a history gap when a window fails for a non rate limit reason', async () => {
    router = (url) => {
      if (url.includes('/v5/execution/list') && url.includes('category=spot')) {
        return jsonResponse({ retCode: 10001, retMsg: 'bad request' })
      }
      return jsonResponse({ retCode: 0, result: { list: [], nextPageCursor: '' } })
    }

    const adapter = new BybitAdapter()
    await adapter.fetchTrades({ ...credentials, apiSecret: testPrivateKeyPem }, since(WEEK_DAYS * 2))

    const gaps = adapter.historyGaps()
    expect(gaps.length).toBeGreaterThanOrEqual(2)
    expect(gaps.map((gap) => gap.market)).toEqual(gaps.map(() => 'spot'))
    expect(gaps.every((gap) => gap.endMs >= gap.startMs)).toBe(true)
  })

  it('binance spot resumes from the stored id instead of zero', async () => {
    const binanceCredentials = { ...credentials, apiSecret: testPrivateKeyPem }
    router = (url) => (url.includes('/api/v3/account') ? jsonResponse({ balances: [] }) : jsonResponse([]))

    const adapter = new BinanceAdapter()
    adapter.setSpotResume(async () => 500)
    await adapter.fetchTrades(binanceCredentials, since(WEEK_DAYS))

    const fromIds = starts((url) => url.includes('/api/v3/myTrades'), 'fromId')
    expect(fromIds.length).toBeGreaterThan(0)
    expect(fromIds.every((value) => value === 500)).toBe(true)
  })

  it('binance re-signs a retried request with a newer timestamp and signature', async () => {
    const seen: Array<{ timestamp: string; signature: string }> = []
    let limited = true
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-06-01T00:00:00.000Z'))
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = requestUrl(input)
        if (url.includes('/api/v3/account')) return jsonResponse({ balances: [] })
        if (url.includes('/api/v3/myTrades') && url.includes('symbol=BTCUSDT')) {
          seen.push({ timestamp: param(url, 'timestamp') ?? '', signature: param(url, 'signature') ?? '' })
          if (limited) {
            limited = false
            vi.setSystemTime(new Date('2026-06-01T00:00:05.000Z'))
            return jsonResponse({ code: -1003, msg: 'too many requests' }, 429)
          }
        }
        return jsonResponse([])
      })
    )

    await new BinanceAdapter().fetchTrades(
      { ...credentials, apiSecret: testPrivateKeyPem },
      new Date(Date.now() - DAY_MS),
      new Date()
    )
    vi.useRealTimers()

    expect(seen.length).toBeGreaterThanOrEqual(2)
    expect(Number(seen[1].timestamp)).toBeGreaterThan(Number(seen[0].timestamp))
    expect(seen[1].signature).not.toBe(seen[0].signature)
  })
})
