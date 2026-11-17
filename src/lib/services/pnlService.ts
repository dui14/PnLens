import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  PNLSummary,
  PnlSnapshotRecord,
  SnapshotExchange,
  PNLChartPoint,
  PNLCalendarDay,
  PNLCalendarMonth,
  Trade,
  PeriodType,
  Result,
  TradeSegment,
  DashboardOverview,
  Exchange,
  AssetDistributionSummary,
  FeeSummary,
} from '@/lib/types'
import { EXCHANGES } from '@/lib/types'
import { RECENT_TRADES_PER_EXCHANGE_LIMIT } from '@/lib/config/recentTrades'
import type { TradeCursor } from '@/lib/pagination/tradeCursor'
import { getTradesForPNL, getTrades, getTradeTotals } from '@/lib/db/tradesDb'
import { getExchangeAccountById } from '@/lib/db/exchangeDb'
import { getPnlSnapshot } from '@/lib/db/pnlDb'
import { buildFeeSummary } from '@/lib/engines/feeEngine'
import {
  buildAssetDistribution,
  calculateAllTimeWinRate,
  calculateWinRateByDays,
  getWindowStartDate,
  sumPnl,
  sumPnlFromDate,
  sumVolumeByDays,
} from '@/lib/engines/pnlSnapshotEngine'
import { calculatePNLSummary, buildPNLTimeSeries, buildPNLCalendarDays, buildPNLCalendarMonths, getDateRangeForPeriod } from '@/lib/engines/pnlEngine'
import {
  APP_UTC_OFFSET_MINUTES,
  monthBounds,
  rangeFor,
  yearBounds,
} from '@/lib/time/dayBoundary'

type GetTradesOptions = {
  limit: number
  cursor?: TradeCursor
  exchangeAccountId?: string
  exchange?: Exchange
  symbol?: string
  segment?: TradeSegment
  executedOnly?: boolean
}

type TradesResult = {
  trades: Trade[]
  nextCursor: string | null
}

function mapSegmentToTradeType(segment: TradeSegment): 'spot' | 'futures' | undefined {
  if (segment === 'all') return undefined
  return segment
}

async function requireOwnedAccount(
  supabase: SupabaseClient,
  userId: string,
  exchangeAccountId?: string
): Promise<Result<true>> {
  if (!exchangeAccountId) return { success: true, data: true }
  const account = await getExchangeAccountById(supabase, exchangeAccountId, userId)
  if (!account) return { success: false, error: 'NOT_FOUND' }
  return { success: true, data: true }
}

export async function fetchPNLSummary(
  supabase: SupabaseClient,
  userId: string,
  range: PeriodType,
  exchangeAccountId?: string,
  segment: TradeSegment = 'all',
  exchange?: Exchange
): Promise<Result<PNLSummary>> {
  let startDate: string | undefined
  let endDate: string | undefined

  const owned = await requireOwnedAccount(supabase, userId, exchangeAccountId)
  if (!owned.success) return owned

  if (range !== 'all') {
    const dateRange = rangeFor(range, new Date(), APP_UTC_OFFSET_MINUTES)
    startDate = dateRange.start ? dateRange.start.toISOString() : undefined
    endDate = dateRange.end.toISOString()
  }

  const trades = await getTradesForPNL(supabase, userId, {
    startDate,
    endDate,
    exchangeAccountId,
    exchange,
    tradeType: mapSegmentToTradeType(segment),
  })

  const summary = calculatePNLSummary(trades, range)
  return { success: true, data: summary }
}

export async function fetchPNLChart(
  supabase: SupabaseClient,
  userId: string,
  range: 'day' | 'week' | 'month' | 'year',
  exchangeAccountId?: string,
  segment: TradeSegment = 'all',
  exchange?: Exchange
): Promise<Result<PNLChartPoint[]>> {
  const owned = await requireOwnedAccount(supabase, userId, exchangeAccountId)
  if (!owned.success) return owned

  const { startDate, endDate } = getDateRangeForPeriod(range)

  const trades = await getTradesForPNL(supabase, userId, {
    startDate,
    endDate,
    exchangeAccountId,
    exchange,
    tradeType: mapSegmentToTradeType(segment),
  })

  const chartData = buildPNLTimeSeries(trades, range)
  return { success: true, data: chartData }
}

export async function fetchPaginatedTrades(
  supabase: SupabaseClient,
  userId: string,
  options: GetTradesOptions
): Promise<Result<TradesResult>> {
  const owned = await requireOwnedAccount(supabase, userId, options.exchangeAccountId)
  if (!owned.success) return owned

  const { trades, nextCursor } = await getTrades(supabase, userId, {
    ...options,
    tradeType: mapSegmentToTradeType(options.segment ?? 'all'),
  })
  return { success: true, data: { trades, nextCursor } }
}

export async function fetchRecentTradesPerExchange(
  supabase: SupabaseClient,
  userId: string,
  options: Omit<GetTradesOptions, 'limit' | 'cursor'>
): Promise<Result<Trade[]>> {
  const owned = await requireOwnedAccount(supabase, userId, options.exchangeAccountId)
  if (!owned.success) return owned

  const exchanges = options.exchange ? [options.exchange] : EXCHANGES
  const pages = await Promise.all(
    exchanges.map((exchange) =>
      getTrades(supabase, userId, {
        ...options,
        exchange,
        limit: RECENT_TRADES_PER_EXCHANGE_LIMIT,
        tradeType: mapSegmentToTradeType(options.segment ?? 'all'),
      })
    )
  )

  const merged = pages
    .flatMap((page) => page.trades)
    .sort((a, b) => Date.parse(b.traded_at) - Date.parse(a.traded_at))
  return { success: true, data: merged }
}

export async function fetchPNLCalendar(
  supabase: SupabaseClient,
  userId: string,
  view: 'daily' | 'monthly',
  year: number,
  month?: number,
  segment: TradeSegment = 'all',
  exchange?: Exchange
): Promise<Result<PNLCalendarDay[] | PNLCalendarMonth[]>> {
  let startDate: string
  let endDate: string

  if (view === 'daily' && month) {
    const bounds = monthBounds(year, month, APP_UTC_OFFSET_MINUTES)
    startDate = bounds.start.toISOString()
    endDate = bounds.end.toISOString()
  } else {
    const bounds = yearBounds(year, APP_UTC_OFFSET_MINUTES)
    startDate = bounds.start.toISOString()
    endDate = bounds.end.toISOString()
  }

  const trades = await getTradesForPNL(supabase, userId, {
    startDate,
    endDate,
    exchange,
    tradeType: mapSegmentToTradeType(segment),
  })

  if (view === 'daily' && month) {
    return { success: true, data: buildPNLCalendarDays(trades, year, month) }
  }
  return { success: true, data: buildPNLCalendarMonths(trades, year) }
}

export async function fetchDashboardOverview(
  supabase: SupabaseClient,
  userId: string,
  segment: TradeSegment,
  exchange?: Exchange
): Promise<Result<DashboardOverview>> {
  const tradeType = mapSegmentToTradeType(segment)
  const now = new Date()
  const yearStart = rangeFor('year', now, APP_UTC_OFFSET_MINUTES).start ?? now
  const trailingStart = getWindowStartDate(90, now)
  const rangeStart = new Date(Math.min(yearStart.getTime(), trailingStart.getTime()))
  const rangeStartYear = rangeStart.toISOString()
  const rangeEndIso = now.toISOString()

  const [yearTrades, allTrades, totals] = await Promise.all([
    getTradesForPNL(supabase, userId, {
      startDate: rangeStartYear,
      endDate: rangeEndIso,
      exchange,
      tradeType,
    }),
    getTradesForPNL(supabase, userId, {
      endDate: rangeEndIso,
      exchange,
      tradeType,
    }),
    getTradeTotals(supabase, userId, {
      tradeType,
      exchange,
      executedOnly: true,
    }),
  ])

  const overview: DashboardOverview = {
    pnl: {
      today: sumPnlFromDate(yearTrades, getWindowStartDate(1, now)),
      d7: sumPnlFromDate(yearTrades, getWindowStartDate(7, now)),
      d30: sumPnlFromDate(yearTrades, getWindowStartDate(30, now)),
      d90: sumPnlFromDate(yearTrades, getWindowStartDate(90, now)),
      year: sumPnlFromDate(yearTrades, yearStart),
      all: sumPnl(allTrades),
    },
    winRate: {
      d7: calculateWinRateByDays(yearTrades, 7, now),
      d30: calculateWinRateByDays(yearTrades, 30, now),
      d90: calculateWinRateByDays(yearTrades, 90, now),
      all: calculateAllTimeWinRate(allTrades),
    },
    totalTrades: {
      count: totals.count,
      volumeUsd: totals.volumeUsd,
      volumeUsdD7: sumVolumeByDays(yearTrades, 7, now),
      volumeUsdD30: sumVolumeByDays(yearTrades, 30, now),
      volumeUsdD90: sumVolumeByDays(yearTrades, 90, now),
      volumeUsdAll: totals.volumeUsd,
    },
  }

  return { success: true, data: overview }
}

export async function fetchAssetDistribution(
  supabase: SupabaseClient,
  userId: string,
  segment: TradeSegment = 'all',
  exchange?: Exchange
): Promise<Result<AssetDistributionSummary>> {
  const trades = await getTradesForPNL(supabase, userId, {
    exchange,
    tradeType: mapSegmentToTradeType(segment),
    executedOnly: true,
  })

  return { success: true, data: buildAssetDistribution(trades) }
}

export async function fetchPnlSnapshot(
  supabase: SupabaseClient,
  userId: string,
  segment: TradeSegment,
  exchange: SnapshotExchange
): Promise<Result<PnlSnapshotRecord | null>> {
  const snapshot = await getPnlSnapshot(supabase, userId, segment, exchange)
  return { success: true, data: snapshot }
}

export async function fetchFeeSummary(
  supabase: SupabaseClient,
  userId: string,
  segment: TradeSegment = 'all',
  exchange?: Exchange
): Promise<Result<FeeSummary>> {
  const trades = await getTradesForPNL(supabase, userId, {
    exchange,
    tradeType: mapSegmentToTradeType(segment),
    executedOnly: true,
  })

  return { success: true, data: buildFeeSummary(trades) }
}
