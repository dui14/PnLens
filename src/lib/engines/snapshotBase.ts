import type { Exchange, PnlPeriod, Trade } from '@/lib/types'
import { USD_LIKE_CURRENCIES } from '@/lib/config/fees'
import { APP_UTC_OFFSET_MINUTES, rangeFor, startOfDay } from '@/lib/time/dayBoundary'

export const MS_PER_DAY = 24 * 60 * 60 * 1000
export const TRAILING_WINDOW_DAYS = { today: 1, week: 7, month: 30, quarter: 90 } as const
const QUOTE_SUFFIXES = ['USDT', 'USDC', 'BUSD', 'USD', 'VND', 'BTC', 'ETH']
const USD_LIKE_ASSETS = new Set<string>(USD_LIKE_CURRENCIES)
const CONTRACT_SUFFIX_PATTERN = /(UMCBL|DMCBL|CMCBL|USDTFUTURES|COINFUTURES|USDCFUTURES)$/g

export type TradeWithExchange = Trade & { exchange?: Exchange }

export function getWindowStartDate(days: number, now: Date): Date {
  const start = startOfDay(now, APP_UTC_OFFSET_MINUTES)
  return new Date(start.getTime() - (days - 1) * MS_PER_DAY)
}

export function getPeriodStartDate(period: PnlPeriod, now: Date): Date {
  switch (period) {
    case 'today':
      return getWindowStartDate(TRAILING_WINDOW_DAYS.today, now)
    case 'd7':
      return getWindowStartDate(TRAILING_WINDOW_DAYS.week, now)
    case 'd30':
      return getWindowStartDate(TRAILING_WINDOW_DAYS.month, now)
    case 'd90':
      return getWindowStartDate(TRAILING_WINDOW_DAYS.quarter, now)
    case 'year':
      return rangeFor('year', now, APP_UTC_OFFSET_MINUTES).start ?? now
  }
}

export function isExecutedTrade(trade: Trade): boolean {
  return trade.quantity > 0 && trade.price > 0
}

export function extractBaseAssetFromSymbol(symbol: string): string | null {
  const normalized = symbol.toUpperCase().replace(/[^A-Z0-9_]/g, '')
  if (!normalized) return null

  const head = normalized.split('_')[0]
  const withoutContractSuffix = head.replace(CONTRACT_SUFFIX_PATTERN, '')

  for (const suffix of QUOTE_SUFFIXES) {
    if (withoutContractSuffix.endsWith(suffix) && withoutContractSuffix.length > suffix.length) {
      return withoutContractSuffix.slice(0, -suffix.length)
    }
  }

  return withoutContractSuffix || null
}

function stripContractSuffix(symbol: string): string {
  const normalized = symbol.toUpperCase().replace(/[^A-Z0-9_]/g, '')
  return normalized.split('_')[0].replace(CONTRACT_SUFFIX_PATTERN, '')
}

export function extractQuoteAssetFromSymbol(symbol: string): string | null {
  const head = stripContractSuffix(symbol)
  for (const suffix of QUOTE_SUFFIXES) {
    if (head.endsWith(suffix) && head.length > suffix.length) return suffix
  }
  return null
}

export function isUsdLikeAsset(asset: string | null | undefined): boolean {
  return !!asset && USD_LIKE_ASSETS.has(asset.trim().toUpperCase())
}

export function tradeVolumeUsd(trade: Trade): number {
  const quote = extractQuoteAssetFromSymbol(trade.symbol)
  if (quote === null || isUsdLikeAsset(quote)) return trade.quantity * trade.price
  const base = extractBaseAssetFromSymbol(trade.symbol)
  return isUsdLikeAsset(base) ? trade.quantity : 0
}
