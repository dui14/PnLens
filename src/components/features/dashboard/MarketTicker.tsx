'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  DASHBOARD_TICKER_FLUSH_INTERVAL_MS,
  DASHBOARD_TICKER_PLACEHOLDER,
  DASHBOARD_TICKER_SCROLL_SECONDS,
  DASHBOARD_TICKER_SYMBOLS,
} from '@/lib/config/dashboardTicker'
import { DEMO_QUOTE_ASSET, type DemoMarket } from '@/lib/config/demoTrading'
import {
  buildCombinedStreamUrl,
  groupSymbolsByMarket,
  parseTickerMessage,
  reconnectDelayMs,
  tickerLabel,
  type TickerQuote,
} from '@/lib/market/binanceTicker'

type QuoteMap = Record<string, TickerQuote>

function emptyQuote(symbol: string): TickerQuote {
  return {
    symbol,
    price: DASHBOARD_TICKER_PLACEHOLDER,
    change: DASHBOARD_TICKER_PLACEHOLDER,
    changePositive: null,
  }
}

function useTickerQuotes(): QuoteMap {
  const [quotes, setQuotes] = useState<QuoteMap>({})

  useEffect(() => {
    let disposed = false
    const pending: QuoteMap = {}
    const sockets = new Map<DemoMarket, WebSocket>()
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const attempts = new Map<DemoMarket, number>()
    const groups = groupSymbolsByMarket(DASHBOARD_TICKER_SYMBOLS)

    const flush = () => {
      const keys = Object.keys(pending)
      if (keys.length === 0) return
      const batch = { ...pending }
      for (const key of keys) delete pending[key]
      setQuotes((prev) => ({ ...prev, ...batch }))
    }
    const flushTimer = setInterval(flush, DASHBOARD_TICKER_FLUSH_INTERVAL_MS)

    const connect = (market: DemoMarket) => {
      if (disposed) return
      const symbols = groups[market]
      if (symbols.length === 0) return
      const ws = new WebSocket(buildCombinedStreamUrl(market, symbols))
      sockets.set(market, ws)

      ws.onopen = () => {
        attempts.set(market, 0)
      }
      ws.onmessage = (event: MessageEvent<string>) => {
        const quote = parseTickerMessage(event.data)
        if (quote) pending[quote.symbol] = quote
      }
      ws.onclose = () => {
        if (disposed) return
        const attempt = attempts.get(market) ?? 0
        attempts.set(market, attempt + 1)
        const timer = setTimeout(() => {
          timers.delete(timer)
          connect(market)
        }, reconnectDelayMs(attempt))
        timers.add(timer)
      }
      ws.onerror = () => {
        ws.close()
      }
    }

    connect('spot')
    connect('futures')

    return () => {
      disposed = true
      clearInterval(flushTimer)
      timers.forEach(clearTimeout)
      sockets.forEach((ws) => {
        ws.onclose = null
        ws.onerror = null
        ws.close()
      })
    }
  }, [])

  return quotes
}

function changeColor(positive: boolean | null): string {
  if (positive === null) return 'text-slate-500 dark:text-slate-400'
  return positive ? 'text-green-500' : 'text-red-500'
}

function TickerCard({ quote, focusable }: { quote: TickerQuote; focusable: boolean }): React.JSX.Element {
  return (
    <div
      tabIndex={focusable ? 0 : -1}
      className="flex-shrink-0 bg-background-light dark:bg-background-dark border border-slate-200 dark:border-primary/20 rounded-xl px-3 sm:px-4 py-3 min-w-[120px] sm:min-w-[140px] shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <div className="text-xs text-slate-500 dark:text-slate-400 font-medium mb-1">
        {tickerLabel(quote.symbol)}/{DEMO_QUOTE_ASSET}
      </div>
      <div className="text-sm font-bold tabular-nums">${quote.price}</div>
      <div className={`text-xs font-semibold mt-0.5 tabular-nums ${changeColor(quote.changePositive)}`}>
        {quote.change}
      </div>
    </div>
  )
}

export function MarketTicker(): React.JSX.Element {
  const quotes = useTickerQuotes()
  const items = useMemo(
    () => DASHBOARD_TICKER_SYMBOLS.map((symbol) => quotes[symbol] ?? emptyQuote(symbol)),
    [quotes]
  )

  return (
    <div className="ticker-marquee min-w-0 max-w-full py-1">
      <div
        className="ticker-marquee__track"
        style={{ ['--ticker-duration' as string]: `${DASHBOARD_TICKER_SCROLL_SECONDS}s` }}
      >
        {[false, true].map((duplicate) => (
          <div
            key={duplicate ? 'copy' : 'original'}
            className="ticker-marquee__copy flex gap-3 pr-3"
            aria-hidden={duplicate || undefined}
          >
            {items.map((quote) => (
              <TickerCard key={quote.symbol} quote={quote} focusable={!duplicate} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
