'use client'

import { useEffect, useState } from 'react'
import { RECENT_TRADES_PAGE_SIZE as PAGE_SIZE } from '@/lib/config/recentTrades'
import { useT } from '@/lib/i18n/client'
import { fillTemplate } from '@/lib/i18n/format'
import type { Dictionary } from '@/lib/i18n'
import { ExchangeLogo } from '@/components/ui/ExchangeLogo'
import { EXCHANGE_FILTERS, getExchangeTagClass, getTradeTypeTagClass, type ExchangeFilter } from '@/components/features/dashboard/tradeTags'
import type { Exchange, Trade, TradeSegment } from '@/lib/types'


export type { ExchangeFilter }
type TradeWithExchange = Trade & { exchange?: Exchange }

type TradesApiPayload = {
  success: boolean
  data: TradeWithExchange[] | null
  error: string | null
}

function formatDateIn(dateStr: string, intlLocale: string): string {
  return new Date(dateStr).toLocaleString(intlLocale, {
    timeZone: 'Asia/Ho_Chi_Minh',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatNumberIn(value: number, decimals: number, intlLocale: string): string {
  return value.toLocaleString(intlLocale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function getExchangeLabelIn(exchange: ExchangeFilter, allLabel: string): string {
  if (exchange === 'all') return allLabel
  if (exchange === 'okx') return 'OKX'
  if (exchange === 'bybit') return 'Bybit'
  if (exchange === 'bitget') return 'Bitget'
  if (exchange === 'gateio') return 'Gate.io'
  return 'Binance'
}

function normalizeExchange(value: unknown): ExchangeFilter {
  if (value === 'binance') return 'binance'
  if (value === 'okx') return 'okx'
  if (value === 'bybit') return 'bybit'
  if (value === 'bitget') return 'bitget'
  if (value === 'gateio') return 'gateio'
  return 'all'
}

function mapTradeTypeToSegment(tradeType: Trade['trade_type']): TradeSegment {
  if (tradeType === 'futures') return 'futures'
  if (tradeType === 'spot') return 'spot'
  return 'all'
}

function getTradeTypeLabelIn(segment: TradeSegment, labels: Dictionary['trades']): string {
  if (segment === 'spot') return labels.spot
  if (segment === 'futures') return labels.future
  return labels.all
}

type RecentTradesTableProps = {
  segment: TradeSegment
  exchange?: ExchangeFilter
  onExchangeChange?: (value: ExchangeFilter) => void
}

export function RecentTradesTable({
  segment,
  exchange = 'all',
  onExchangeChange,
}: RecentTradesTableProps): React.JSX.Element {
  const { t, intlLocale } = useT()
  const tr = t.trades
  const formatDate = (dateStr: string): string => formatDateIn(dateStr, intlLocale)
  const formatNumber = (value: number, decimals = 2): string =>
    formatNumberIn(value, decimals, intlLocale)
  const getExchangeLabel = (value: ExchangeFilter): string => getExchangeLabelIn(value, tr.all)
  const getTradeTypeLabel = (value: TradeSegment): string => getTradeTypeLabelIn(value, tr)
  const [allTrades, setAllTrades] = useState<TradeWithExchange[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [exchangeFilter, setExchangeFilter] = useState<ExchangeFilter>(exchange)
  const [segmentFilter, setSegmentFilter] = useState<TradeSegment>(segment)

  useEffect(() => {
    setSegmentFilter(segment)
  }, [segment])

  useEffect(() => {
    setExchangeFilter(exchange)
  }, [exchange])

  useEffect(() => {
    setPage(1)
  }, [exchangeFilter, segmentFilter])

  useEffect(() => {
    const params = new URLSearchParams({ segment: segmentFilter })

    if (exchangeFilter !== 'all') {
      params.set('exchange', exchangeFilter)
    }

    const controller = new AbortController()
    setLoading(true)

    fetch(`/api/pnl/trades?${params.toString()}`, { signal: controller.signal })
      .then((response) => response.json() as Promise<TradesApiPayload>)
      .then((payload) => {
        if (!payload.success) {
          setAllTrades([])
          return
        }

        setAllTrades(payload.data ?? [])
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return
        }
        setAllTrades([])
      })
      .finally(() => setLoading(false))

    return () => controller.abort()
  }, [exchangeFilter, segmentFilter])

  const handleExchangeFilterChange = (value: ExchangeFilter): void => {
    setExchangeFilter(value)
    onExchangeChange?.(value)
  }

  const trades = allTrades.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const hasNextPage = page * PAGE_SIZE < allTrades.length

  const goToNextPage = (): void => {
    if (!hasNextPage) return
    setPage((current) => current + 1)
  }

  return (
    <div className="bg-background-light dark:bg-background-dark rounded-xl border border-slate-200 dark:border-primary/20 shadow-sm overflow-hidden">
      <div className="p-4 sm:p-6 border-b border-slate-200 dark:border-primary/20 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold">{tr.title}</h2>
          <p className="text-sm text-slate-500">{tr.subtitle}</p>
        </div>
        <div className="text-left sm:text-right">
          <p className="text-xs text-slate-500 font-medium">
            {trades.length === 0
              ? tr.zeroTrades
              : fillTemplate(tr.rangeOpen, {
                  from: (page - 1) * PAGE_SIZE + 1,
                  to: (page - 1) * PAGE_SIZE + trades.length,
                })}
          </p>
          <p className="text-[11px] text-slate-400">{fillTemplate(tr.pageNumber, { page })}</p>
        </div>
      </div>

      <div className="px-4 sm:px-6 py-4 border-b border-slate-200 dark:border-primary/20 space-y-3">
        <div className="flex items-center gap-2 overflow-x-auto">
          <span className="text-[11px] uppercase tracking-wider font-bold text-slate-500 shrink-0">{tr.exchange}</span>
          {EXCHANGE_FILTERS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => handleExchangeFilterChange(option)}
              className={`inline-flex items-center gap-1.5 px-3 h-8 rounded-full border text-xs font-bold transition-colors shrink-0 ${getExchangeTagClass(option, option === exchangeFilter)}`}
            >
              {option !== 'all' && <ExchangeLogo exchange={option} size={16} className="rounded-sm" />}
{getExchangeLabel(option)}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 overflow-x-auto">
          <span className="text-[11px] uppercase tracking-wider font-bold text-slate-500 shrink-0">{tr.type}</span>
          {(['all', 'spot', 'futures'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setSegmentFilter(option)}
              className={`inline-flex items-center gap-1.5 px-3 h-8 rounded-full border text-xs font-bold transition-colors shrink-0 ${getTradeTypeTagClass(option, option === segmentFilter)}`}
            >
              {getTradeTypeLabel(option)}
            </button>
          ))}
        </div>
      </div>

      <div>
        {loading && (
          <div className="flex items-center justify-center py-16">
            <span className="material-symbols-outlined animate-spin text-primary/40 text-3xl">refresh</span>
          </div>
        )}
        {!loading && trades.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <span className="material-symbols-outlined text-slate-300 dark:text-slate-600 text-5xl">receipt_long</span>
            <p className="text-sm text-slate-400">{tr.empty}</p>
          </div>
        )}
        {!loading && trades.length > 0 && (
          <>
            <div className="md:hidden px-4 py-4 space-y-3">
              {trades.map((trade) => {
                const pnl = trade.realized_pnl ?? 0
                const pnlPositive = pnl >= 0
                const value = trade.quantity * trade.price
                const tradeExchange = normalizeExchange(trade.exchange)
                const tradeSegment = mapTradeTypeToSegment(trade.trade_type)

                return (
                  <div key={trade.id} className="rounded-lg border border-slate-200 dark:border-primary/15 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-bold">{trade.symbol}</p>
                        <p className="text-[10px] text-slate-400 font-medium uppercase">{formatDate(trade.traded_at)}</p>
                      </div>
                      {trade.realized_pnl !== null ? (
                        <p className={`text-sm font-bold font-mono ${pnlPositive ? 'text-emerald-500' : 'text-rose-500'}`}>
                          {pnlPositive ? '+' : ''}${formatNumber(pnl)}
                        </p>
                      ) : (
                        <p className="text-xs text-slate-400">--</p>
                      )}
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold ${getExchangeTagClass(tradeExchange, true)}`}>
                        {tradeExchange !== 'all' && <ExchangeLogo exchange={tradeExchange} size={14} className="rounded-sm" />}
{getExchangeLabel(tradeExchange)}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-tighter ${
                          trade.side === 'buy'
                            ? 'bg-emerald-500/10 text-emerald-500'
                            : 'bg-rose-500/10 text-rose-500'
                        }`}
                      >
                        {trade.side === 'buy' ? tr.buy : tr.sell}
                      </span>
                      {tradeSegment !== 'all' && (
                        <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${getTradeTypeTagClass(tradeSegment, true)}`}>
                          {getTradeTypeLabel(tradeSegment)}
                        </span>
                      )}
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <p className="text-slate-400">{tr.price}</p>
                        <p className="font-mono font-semibold">${formatNumber(trade.price)}</p>
                      </div>
                      <div>
                        <p className="text-slate-400">{tr.size}</p>
                        <p className="font-mono font-semibold">{formatNumber(trade.quantity, 4)}</p>
                      </div>
                      <div className="col-span-2">
                        <p className="text-slate-400">{tr.value}</p>
                        <p className="font-mono font-semibold">${formatNumber(value)}</p>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[880px]">
                <thead>
                  <tr className="bg-slate-50 dark:bg-primary/5 text-slate-500 text-xs font-bold uppercase tracking-wider">
                    <th className="px-6 py-4">{tr.asset}</th>
                    <th className="px-6 py-4">{tr.side}</th>
                    <th className="px-6 py-4">{tr.type}</th>
                    <th className="px-6 py-4">{tr.price}</th>
                    <th className="px-6 py-4">{tr.sizeValue}</th>
                    <th className="px-6 py-4 text-right">{tr.pnl}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-primary/10">
                  {trades.map((trade) => {
                    const pnl = trade.realized_pnl ?? 0
                    const pnlPositive = pnl >= 0
                    const value = trade.quantity * trade.price
                    const tradeExchange = normalizeExchange(trade.exchange)
                    const tradeSegment = mapTradeTypeToSegment(trade.trade_type)
                    return (
                      <tr
                        key={trade.id}
                        className="hover:bg-slate-50 dark:hover:bg-primary/5 transition-colors"
                      >
                        <td className="px-6 py-4">
                          <p className="text-sm font-bold">{trade.symbol}</p>
                          <p className="text-[10px] text-slate-400 font-medium uppercase">{formatDate(trade.traded_at)}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold ${getExchangeTagClass(tradeExchange, true)}`}>
                              {tradeExchange !== 'all' && <ExchangeLogo exchange={tradeExchange} size={14} className="rounded-sm" />}
{getExchangeLabel(tradeExchange)}
                            </span>
                            {tradeSegment !== 'all' && (
                              <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${getTradeTypeTagClass(tradeSegment, true)}`}>
                                {getTradeTypeLabel(tradeSegment)}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span
                            className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-tighter ${
                              trade.side === 'buy'
                                ? 'bg-emerald-500/10 text-emerald-500'
                                : 'bg-rose-500/10 text-rose-500'
                            }`}
                          >
                            {trade.side === 'buy' ? tr.buy : tr.sell}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          {tradeSegment === 'all' ? (
                            <span className="text-xs text-slate-500 font-medium capitalize">{trade.trade_type}</span>
                          ) : (
                            <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${getTradeTypeTagClass(tradeSegment, true)}`}>
                              {getTradeTypeLabel(tradeSegment)}
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-sm font-medium font-mono">
                          ${formatNumber(trade.price)}
                        </td>
                        <td className="px-6 py-4">
                          <p className="text-sm font-bold font-mono">{formatNumber(trade.quantity, 4)}</p>
                          <p className="text-xs text-slate-400 font-mono">${formatNumber(value)}</p>
                        </td>
                        <td className="px-6 py-4 text-right">
                          {trade.realized_pnl !== null ? (
                            <p className={`text-sm font-bold font-mono ${pnlPositive ? 'text-emerald-500' : 'text-rose-500'}`}>
                              {pnlPositive ? '+' : ''}${formatNumber(pnl)}
                            </p>
                          ) : (
                            <p className="text-xs text-slate-400">--</p>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <div className="px-4 sm:px-6 py-4 border-t border-slate-200 dark:border-primary/20 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3">
        <div />
        <div className="flex items-center gap-2 overflow-x-auto">
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={loading || page === 1}
            className="h-8 px-3 rounded-lg border border-slate-200 dark:border-primary/20 text-xs font-bold text-slate-600 dark:text-slate-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100 dark:hover:bg-primary/10"
          >
            {tr.prev}
          </button>
          <button
            type="button"
            onClick={goToNextPage}
            disabled={loading || !hasNextPage}
            className="h-8 px-3 rounded-lg border border-slate-200 dark:border-primary/20 text-xs font-bold text-slate-600 dark:text-slate-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100 dark:hover:bg-primary/10"
          >
            {tr.next}
          </button>
        </div>
      </div>
    </div>
  )
}
