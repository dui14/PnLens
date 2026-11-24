import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchDemoPrices, groupDemoSymbolsByMarket } from '@/lib/adapters/demoPrice'
import {
  DEMO_FUTURES_PRICE_API_URL,
  DEMO_MARKET_PAIRS,
  DEMO_PRICE_API_URL,
} from '@/lib/config/demoTrading'
import { formatPrice } from '@/components/features/demo-trading/demoFormat'

function json(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('demo pair config', () => {
  it('tags pairs with market and category', () => {
    const nvda = DEMO_MARKET_PAIRS.find((pair) => pair.symbol === 'NVDAUSDT')
    const pepe = DEMO_MARKET_PAIRS.find((pair) => pair.symbol === 'PEPEUSDT')
    expect(nvda).toMatchObject({ market: 'futures', category: 'stocks' })
    expect(pepe).toMatchObject({ market: 'spot', category: 'crypto' })
  })
})

describe('groupDemoSymbolsByMarket', () => {
  it('splits symbols by market, dedupes and drops unknown', () => {
    expect(groupDemoSymbolsByMarket(['BTCUSDT', 'NVDAUSDT', 'BTCUSDT', 'XAUUSDT', 'FAKEUSDT'])).toEqual({
      spot: ['BTCUSDT'],
      futures: ['NVDAUSDT', 'XAUUSDT'],
    })
  })
})

describe('fetchDemoPrices', () => {
  it('routes each market to its own endpoint and merges', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith(DEMO_FUTURES_PRICE_API_URL)) {
        return json([
          { symbol: 'NVDAUSDT', price: '180.5' },
          { symbol: 'OTHERUSDT', price: '1' },
        ])
      }
      return json([{ symbol: 'PEPEUSDT', price: '0.0000039' }])
    })
    vi.stubGlobal('fetch', fetchMock)
    const prices = await fetchDemoPrices(['PEPEUSDT', 'NVDAUSDT'])
    expect(prices).toEqual({ PEPEUSDT: 0.0000039, NVDAUSDT: 180.5 })
    const urls = fetchMock.mock.calls.map((call) => call[0])
    expect(urls.some((url) => url.startsWith(DEMO_PRICE_API_URL))).toBe(true)
    expect(urls.some((url) => url.startsWith(DEMO_FUTURES_PRICE_API_URL))).toBe(true)
  })

  it('keeps spot prices when the futures request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.startsWith(DEMO_FUTURES_PRICE_API_URL)) throw new Error('down')
        return json([{ symbol: 'BTCUSDT', price: '65000' }])
      })
    )
    expect(await fetchDemoPrices(['BTCUSDT', 'XAUUSDT'])).toEqual({ BTCUSDT: 65000 })
  })

  it('skips the futures request when no futures symbols are asked for', async () => {
    const fetchMock = vi.fn(async () => json([{ symbol: 'BTCUSDT', price: '1' }]))
    vi.stubGlobal('fetch', fetchMock)
    await fetchDemoPrices(['BTCUSDT'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('formatPrice', () => {
  it('keeps tiny prices readable', () => {
    expect(formatPrice(0.0000039)).toBe('0.0000039')
    expect(formatPrice(0.00001234567)).toBe('0.00001235')
  })

  it('keeps regular prices unchanged', () => {
    expect(formatPrice(65000)).toBe('65,000.00')
    expect(formatPrice(0.5)).toBe('0.50')
    expect(formatPrice(null)).toBe('--')
  })
})
