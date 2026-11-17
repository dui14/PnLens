import type { Trade, PNLSummary, PNLChartPoint, PNLCalendarDay, PNLCalendarMonth, PeriodType } from '@/lib/types'
import {
  APP_UTC_OFFSET_MINUTES,
  daysInMonth,
  rangeFor,
  startOfDay,
  startOfMonth,
  startOfWeek,
  monthStart,
  toDayKey,
  toHourKey,
  toMonthKey,
  vietnamDateParts,
} from '@/lib/time/dayBoundary'

export function calculatePNLSummary(trades: Trade[], period: PeriodType): PNLSummary {
  if (trades.length === 0) {
    return {
      total_pnl: 0,
      win_rate: 0,
      trade_count: 0,
      win_count: 0,
      loss_count: 0,
      best_trade: null,
      worst_trade: null,
      period,
    }
  }

  const tradesWithPNL = trades.filter((t) => t.realized_pnl !== null)

  let totalPnl = 0
  let winCount = 0
  let lossCount = 0
  let bestTrade: number | null = null
  let worstTrade: number | null = null

  for (const trade of tradesWithPNL) {
    const pnl = Number(trade.realized_pnl)
    totalPnl += pnl

    if (pnl > 0) {
      winCount++
      if (bestTrade === null || pnl > bestTrade) bestTrade = pnl
    } else if (pnl < 0) {
      lossCount++
      if (worstTrade === null || pnl < worstTrade) worstTrade = pnl
    }
  }

  const totalWithPNL = winCount + lossCount
  const winRate = totalWithPNL > 0 ? (winCount / totalWithPNL) * 100 : 0

  return {
    total_pnl: parseFloat(totalPnl.toFixed(8)),
    win_rate: parseFloat(winRate.toFixed(2)),
    trade_count: trades.length,
    win_count: winCount,
    loss_count: lossCount,
    best_trade: bestTrade !== null ? parseFloat(bestTrade.toFixed(8)) : null,
    worst_trade: worstTrade !== null ? parseFloat(worstTrade.toFixed(8)) : null,
    period,
  }
}

export function buildPNLTimeSeries(
  trades: Trade[],
  range: 'day' | 'week' | 'month' | 'year'
): PNLChartPoint[] {
  const tradesWithPNL = trades.filter((t) => t.realized_pnl !== null)

  const buckets = buildBuckets(range, new Date())
  const grouped = new Map<string, number>(buckets.map((bucket) => [bucket, 0]))

  for (const trade of tradesWithPNL) {
    const key = toBucketKey(new Date(trade.traded_at), range)
    if (!key || !grouped.has(key)) continue
    const existing = grouped.get(key) ?? 0
    grouped.set(key, existing + Number(trade.realized_pnl))
  }

  let cumulative = 0
  const points: PNLChartPoint[] = []

  for (const bucket of buckets) {
    const pnl = grouped.get(bucket) ?? 0
    cumulative += pnl
    points.push({
      date: bucket,
      pnl: parseFloat(pnl.toFixed(8)),
      cumulative_pnl: parseFloat(cumulative.toFixed(8)),
    })
  }

  return points
}

function toBucketKey(date: Date, range: 'day' | 'week' | 'month' | 'year'): string | null {
  if (range === 'day') return toHourKey(date, APP_UTC_OFFSET_MINUTES)
  if (range === 'year') return toMonthKey(date, APP_UTC_OFFSET_MINUTES)
  return toDayKey(date, APP_UTC_OFFSET_MINUTES)
}

function buildBuckets(range: 'day' | 'week' | 'month' | 'year', now: Date): string[] {
  if (range === 'day') {
    const start = startOfDay(now, APP_UTC_OFFSET_MINUTES)
    return Array.from({ length: 24 }, (_, hour) => toHourKey(new Date(start.getTime() + hour * 60 * 60 * 1000), APP_UTC_OFFSET_MINUTES) ?? '')
  }

  if (range === 'week') {
    const start = startOfWeek(now, APP_UTC_OFFSET_MINUTES)
    return Array.from({ length: 7 }, (_, index) => toDayKey(new Date(start.getTime() + index * 24 * 60 * 60 * 1000), APP_UTC_OFFSET_MINUTES) ?? '')
  }

  if (range === 'year') {
    const current = vietnamDateParts(now, APP_UTC_OFFSET_MINUTES)
    return Array.from({ length: current.month }, (_, index) => toMonthKey(monthStart(current.year, index + 1, APP_UTC_OFFSET_MINUTES), APP_UTC_OFFSET_MINUTES) ?? '')
  }

  const start = startOfMonth(now, APP_UTC_OFFSET_MINUTES)
  const current = vietnamDateParts(now, APP_UTC_OFFSET_MINUTES)
  const count = daysInMonth(current.year, current.month)
  return Array.from({ length: count }, (_, index) => toDayKey(new Date(start.getTime() + index * 24 * 60 * 60 * 1000), APP_UTC_OFFSET_MINUTES) ?? '')
}

export function buildPNLCalendarDays(trades: Trade[], year: number, month: number): PNLCalendarDay[] {
  const tradesWithPNL = trades.filter((t) => t.realized_pnl !== null)
  const grouped = new Map<string, { pnl: number; count: number }>()

  for (const trade of tradesWithPNL) {
    const dateKey = toDayKey(new Date(trade.traded_at), APP_UTC_OFFSET_MINUTES)
    if (!dateKey) continue
    const prefix = `${year}-${String(month).padStart(2, '0')}-`
    if (!dateKey.startsWith(prefix)) continue
    const existing = grouped.get(dateKey) ?? { pnl: 0, count: 0 }
    grouped.set(dateKey, { pnl: existing.pnl + Number(trade.realized_pnl), count: existing.count + 1 })
  }

  const length = daysInMonth(year, month)
  const result: PNLCalendarDay[] = []

  for (let day = 1; day <= length; day++) {
    const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const data = grouped.get(dateKey)
    result.push({
      date: dateKey,
      pnl: data ? parseFloat(data.pnl.toFixed(4)) : 0,
      tradeCount: data?.count ?? 0,
    })
  }

  return result
}

export function buildPNLCalendarMonths(trades: Trade[], year: number): PNLCalendarMonth[] {
  const tradesWithPNL = trades.filter((t) => t.realized_pnl !== null)
  const grouped = new Map<number, { pnl: number; count: number }>()

  for (const trade of tradesWithPNL) {
    const dateKey = toDayKey(new Date(trade.traded_at), APP_UTC_OFFSET_MINUTES)
    if (!dateKey || !dateKey.startsWith(`${year}-`)) continue
    const m = Number(dateKey.slice(5, 7))
    const existing = grouped.get(m) ?? { pnl: 0, count: 0 }
    grouped.set(m, { pnl: existing.pnl + Number(trade.realized_pnl), count: existing.count + 1 })
  }

  const result: PNLCalendarMonth[] = []
  for (let m = 1; m <= 12; m++) {
    const data = grouped.get(m)
    result.push({
      year,
      month: m,
      pnl: data ? parseFloat(data.pnl.toFixed(4)) : 0,
      tradeCount: data?.count ?? 0,
    })
  }

  return result
}

export function getDateRangeForPeriod(range: 'day' | 'week' | 'month' | 'year', now: Date = new Date()): {
  startDate: string
  endDate: string
} {
  const window = rangeFor(range, now, APP_UTC_OFFSET_MINUTES)
  return {
    startDate: window.start ? window.start.toISOString() : now.toISOString(),
    endDate: window.end.toISOString(),
  }
}
