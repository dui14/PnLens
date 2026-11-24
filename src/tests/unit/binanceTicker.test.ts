import { describe, expect, it } from 'vitest'
import { DEMO_FUTURES_PRICE_WS_URL, DEMO_PRICE_WS_URL } from '@/lib/config/demoTrading'
import {
  buildCombinedStreamUrl,
  groupSymbolsByMarket,
  parseTickerMessage,
  reconnectDelayMs,
  tickerLabel,
} from '@/lib/market/binanceTicker'

describe('binanceTicker', () => {
  it('groups symbols by market', () => {
    const groups = groupSymbolsByMarket(['BTCUSDT', 'NVDAUSDT', 'XAUUSDT'])
    expect(groups.spot).toEqual(['BTCUSDT'])
    expect(groups.futures).toEqual(['NVDAUSDT', 'XAUUSDT'])
  })

  it('builds combined stream urls per market', () => {
    expect(buildCombinedStreamUrl('spot', ['BTCUSDT', 'ETHUSDT'])).toBe(
      `${DEMO_PRICE_WS_URL.replace(/\/ws$/, '/stream')}?streams=btcusdt@ticker/ethusdt@ticker`
    )
    expect(buildCombinedStreamUrl('futures', ['NVDAUSDT'])).toBe(
      `${DEMO_FUTURES_PRICE_WS_URL.replace(/\/ws$/, '/stream')}?streams=nvdausdt@ticker`
    )
  })

  it('parses a combined ticker message', () => {
    const quote = parseTickerMessage(JSON.stringify({ stream: 'btcusdt@ticker', data: { s: 'BTCUSDT', c: '65000.5', P: '1.234' } }))
    expect(quote).toEqual({ symbol: 'BTCUSDT', price: '65,000.50', change: '+1.23%', changePositive: true })
  })

  it('marks negative change and falls back to open price', () => {
    const quote = parseTickerMessage(JSON.stringify({ data: { s: 'XAUUSDT', c: '90', o: '100' } }))
    expect(quote?.change).toBe('-10.00%')
    expect(quote?.changePositive).toBe(false)
  })

  it('rejects malformed messages', () => {
    expect(parseTickerMessage('nope')).toBeNull()
    expect(parseTickerMessage(JSON.stringify({ data: { s: 'BTCUSDT' } }))).toBeNull()
    expect(parseTickerMessage(JSON.stringify({ data: { s: 'BTCUSDT', c: 'abc' } }))).toBeNull()
  })

  it('caps reconnect backoff', () => {
    expect(reconnectDelayMs(0)).toBe(1000)
    expect(reconnectDelayMs(2)).toBe(4000)
    expect(reconnectDelayMs(20)).toBe(30000)
  })

  it('strips the quote asset from labels', () => {
    expect(tickerLabel('NVDAUSDT')).toBe('NVDA')
  })
})
