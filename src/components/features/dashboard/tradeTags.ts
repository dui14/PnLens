import type { TradeSegment } from '@/lib/types'

export const EXCHANGE_FILTERS = ['all', 'binance', 'okx', 'bybit', 'bitget', 'gateio'] as const

export type ExchangeFilter = (typeof EXCHANGE_FILTERS)[number]

export function getExchangeTagClass(exchange: ExchangeFilter, active: boolean): string {
  if (active) {
    if (exchange === 'binance') return 'bg-yellow-400 border-yellow-500 text-slate-900'
    if (exchange === 'okx') return 'bg-slate-900 border-slate-900 text-white'
    if (exchange === 'bybit') return 'bg-orange-400 border-orange-500 text-slate-900'
    if (exchange === 'bitget') return 'bg-sky-500 border-sky-600 text-white'
    if (exchange === 'gateio') return 'bg-emerald-500 border-emerald-600 text-white'
    return 'bg-primary border-primary text-accent'
  }

  if (exchange === 'okx') {
    return 'bg-white dark:bg-background-dark border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
  }

  return 'bg-white dark:bg-background-dark border-slate-200 dark:border-primary/20 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-primary/10'
}

export function getTradeTypeTagClass(segment: TradeSegment, active: boolean): string {
  if (active) {
    if (segment === 'spot') return 'bg-emerald-500 border-emerald-600 text-white'
    if (segment === 'futures') return 'bg-indigo-500 border-indigo-600 text-white'
    return 'bg-primary border-primary text-accent'
  }

  return 'bg-white dark:bg-background-dark border-slate-200 dark:border-primary/20 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-primary/10'
}
