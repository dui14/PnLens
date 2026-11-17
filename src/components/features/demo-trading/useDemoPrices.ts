'use client'

import { useEffect, useState } from 'react'
import {
  DEMO_FUTURES_PRICE_WS_URL,
  DEMO_FUTURES_TICKER_24H_API_URL,
  DEMO_MARKET_BY_SYMBOL,
  DEMO_MARKETS,
  DEMO_PRICE_WS_URL,
  DEMO_TICKER_24H_API_URL,
  DEMO_WS_RECONNECT_MS,
  type DemoMarket,
} from '@/lib/config/demoTrading'
import {
  buildDemoSubscribeMessage,
  parseDemoTickerMessage,
  parseDemoTickerRest,
  type DemoTickerQuote,
} from '@/lib/engines/demoChartOverlays'

export type DemoPriceFeed = {
  prices: Record<string, number>
  changes: Record<string, number>
}

const WS_URLS: Record<DemoMarket, string> = {
  spot: DEMO_PRICE_WS_URL,
  futures: DEMO_FUTURES_PRICE_WS_URL,
}

function restUrl(market: DemoMarket, symbols: string[]): string {
  return market === 'spot'
    ? `${DEMO_TICKER_24H_API_URL}?symbols=${encodeURIComponent(JSON.stringify(symbols))}`
    : DEMO_FUTURES_TICKER_24H_API_URL
}

export function useDemoPrices(symbols: string[]): DemoPriceFeed {
  const [feed, setFeed] = useState<DemoPriceFeed>({ prices: {}, changes: {} })
  const key = Array.from(new Set(symbols)).sort().join(',')

  useEffect(() => {
    const list = key ? key.split(',') : []
    let disposed = false
    const sockets = new Map<DemoMarket, WebSocket>()
    const timers = new Map<DemoMarket, number>()

    const apply = (quotes: DemoTickerQuote[]): void => {
      if (disposed || quotes.length === 0) return
      setFeed((prev) => {
        const prices = { ...prev.prices }
        const changes = { ...prev.changes }
        for (const quote of quotes) {
          prices[quote.symbol] = quote.price
          if (quote.changePercent !== null) changes[quote.symbol] = quote.changePercent
        }
        return { prices, changes }
      })
    }

    for (const market of DEMO_MARKETS) {
      const marketSymbols = list.filter((symbol) => DEMO_MARKET_BY_SYMBOL[symbol] === market)
      if (marketSymbols.length === 0) continue
      const wanted = new Set(marketSymbols)

      const seed = async (): Promise<void> => {
        try {
          const res = await fetch(restUrl(market, marketSymbols))
          if (!res.ok) return
          const rows = (await res.json()) as unknown[]
          if (!Array.isArray(rows)) return
          apply(
            rows
              .map(parseDemoTickerRest)
              .filter((quote): quote is DemoTickerQuote => quote !== null && wanted.has(quote.symbol))
          )
        } catch {
          return
        }
      }

      const connect = (): void => {
        if (disposed) return
        const ws = new WebSocket(WS_URLS[market])
        sockets.set(market, ws)
        ws.onopen = (): void => {
          ws.send(buildDemoSubscribeMessage(marketSymbols, 1))
        }
        ws.onmessage = (event): void => {
          try {
            const quote = parseDemoTickerMessage(JSON.parse(event.data))
            if (quote && wanted.has(quote.symbol)) apply([quote])
          } catch {
            return
          }
        }
        ws.onerror = (): void => {
          return
        }
        ws.onclose = (): void => {
          if (disposed) return
          timers.set(market, window.setTimeout(connect, DEMO_WS_RECONNECT_MS))
        }
      }

      void seed()
      connect()
    }

    return () => {
      disposed = true
      timers.forEach((timer) => window.clearTimeout(timer))
      sockets.forEach((socket) => socket.close())
    }
  }, [key])

  return feed
}
