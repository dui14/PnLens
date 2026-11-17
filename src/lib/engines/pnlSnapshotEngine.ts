import type {
  AssetDistributionSummary,
  DashboardOverview,
  Exchange,
  PNLCalendarDay,
  PNLCalendarMonth,
  PnlSnapshotCalendar,
  PnlSnapshotPayload,
  PnlSnapshotRowInput,
  SnapshotExchange,
  Trade,
  TradeSegment,
} from '@/lib/types'
import { CHART_RANGES, SNAPSHOT_EXCHANGES, TRADE_SEGMENTS } from '@/lib/types'
import { buildPNLTimeSeries } from '@/lib/engines/pnlEngine'
import { buildPnlSnapshotFees } from '@/lib/engines/feeSnapshotEngine'
import {
  MS_PER_DAY,
  TRAILING_WINDOW_DAYS,
  extractBaseAssetFromSymbol,
  getPeriodStartDate,
  getWindowStartDate,
  isExecutedTrade,
  tradeVolumeUsd,
  type TradeWithExchange,
} from '@/lib/engines/snapshotBase'

export { extractBaseAssetFromSymbol, getPeriodStartDate, getWindowStartDate, isExecutedTrade }
export type { TradeWithExchange }
import { APP_UTC_OFFSET_MINUTES, rangeFor, toDayKey } from '@/lib/time/dayBoundary'

const PNL_PRECISION = 8
const CALENDAR_PRECISION = 4
const RATE_PRECISION = 2
const PERCENT = 100

export function aggregateDailyPnl(trades: Trade[], startMs?: number): Map<string, number> {
  const dailyPnl = new Map<string, number>()

  for (const trade of trades) {
    if (trade.realized_pnl === null) continue

    const tradedMs = new Date(trade.traded_at).getTime()
    if (startMs !== undefined && tradedMs < startMs) continue

    const pnl = Number(trade.realized_pnl)
    if (!Number.isFinite(pnl)) continue

    const dateKey = toDayKey(new Date(trade.traded_at), APP_UTC_OFFSET_MINUTES)
    if (!dateKey) continue
    dailyPnl.set(dateKey, (dailyPnl.get(dateKey) ?? 0) + pnl)
  }

  return dailyPnl
}

export function sumPnlFromDate(trades: Trade[], startDate: Date): number {
  const startMs = startDate.getTime()
  const total = trades.reduce((sum, trade) => {
    if (trade.realized_pnl === null) return sum

    const numericPnl = Number(trade.realized_pnl)
    if (!Number.isFinite(numericPnl)) return sum

    if (new Date(trade.traded_at).getTime() < startMs) return sum
    return sum + numericPnl
  }, 0)

  return parseFloat(total.toFixed(PNL_PRECISION))
}

export function sumPnl(trades: Trade[]): number {
  const total = trades.reduce((sum, trade) => {
    if (trade.realized_pnl === null) return sum

    const pnl = Number(trade.realized_pnl)
    if (!Number.isFinite(pnl)) return sum
    return sum + pnl
  }, 0)

  return parseFloat(total.toFixed(PNL_PRECISION))
}

export function sumVolumeByDays(trades: Trade[], days: number, now: Date): number {
  const startMs = getWindowStartDate(days, now).getTime()

  const total = trades.reduce((sum, trade) => {
    if (!isExecutedTrade(trade)) return sum
    if (new Date(trade.traded_at).getTime() < startMs) return sum
    return sum + tradeVolumeUsd(trade)
  }, 0)

  return parseFloat(total.toFixed(PNL_PRECISION))
}

export function sumVolumeFromDate(trades: Trade[], startDate: Date): number {
  const startMs = startDate.getTime()
  const total = trades.reduce((sum, trade) => {
    if (!isExecutedTrade(trade)) return sum
    if (new Date(trade.traded_at).getTime() < startMs) return sum
    return sum + tradeVolumeUsd(trade)
  }, 0)

  return parseFloat(total.toFixed(PNL_PRECISION))
}

export function calculateWinRateByDays(trades: Trade[], days: number, now: Date): number {
  const startDate = getWindowStartDate(days, now)
  const dailyPnl = aggregateDailyPnl(trades, startDate.getTime())

  let winDays = 0
  for (let offset = 0; offset < days; offset += 1) {
    const date = new Date(startDate.getTime() + offset * MS_PER_DAY)
    const pnl = dailyPnl.get(toDayKey(date, APP_UTC_OFFSET_MINUTES) ?? '') ?? 0
    if (pnl > 0) winDays += 1
  }

  return parseFloat(((winDays / days) * PERCENT).toFixed(RATE_PRECISION))
}

export function calculateAllTimeWinRate(trades: Trade[]): number {
  const dailyPnl = aggregateDailyPnl(trades)
  if (dailyPnl.size === 0) return 0

  const winDays = Array.from(dailyPnl.values()).filter((pnl) => pnl > 0).length
  return parseFloat(((winDays / dailyPnl.size) * PERCENT).toFixed(RATE_PRECISION))
}

export function buildAssetDistribution(trades: TradeWithExchange[]): AssetDistributionSummary {
  const buckets = new Map<string, { exchange: Exchange; asset: string; quantity: number; lastPrice: number }>()

  for (const trade of trades) {
    if (!isExecutedTrade(trade)) continue
    const tradeExchange = trade.exchange
    if (!tradeExchange) continue

    const asset = extractBaseAssetFromSymbol(trade.symbol)
    if (!asset) continue

    const key = `${tradeExchange}:${asset}`
    const current = buckets.get(key) ?? { exchange: tradeExchange, asset, quantity: 0, lastPrice: 0 }

    current.quantity += trade.side === 'buy' ? trade.quantity : -trade.quantity
    if (Number.isFinite(trade.price) && trade.price > 0) {
      current.lastPrice = trade.price
    }

    buckets.set(key, current)
  }

  const rows = Array.from(buckets.values())
    .map((item) => {
      const quantity = Math.abs(item.quantity)
      return { exchange: item.exchange, asset: item.asset, quantity, usdValue: quantity * item.lastPrice }
    })
    .filter((item) => item.quantity > 0 && item.usdValue > 0)
    .sort((a, b) => b.usdValue - a.usdValue)

  const totalUsdRaw = rows.reduce((sum, item) => sum + item.usdValue, 0)

  return {
    totalUsd: parseFloat(totalUsdRaw.toFixed(PNL_PRECISION)),
    items: rows.map((item) => ({
      ...item,
      ratio: totalUsdRaw > 0 ? parseFloat((item.usdValue / totalUsdRaw).toFixed(PNL_PRECISION)) : 0,
    })),
  }
}

export function buildDashboardOverview(trades: Trade[], now: Date): DashboardOverview {
  const yearStart = rangeFor('year', now, APP_UTC_OFFSET_MINUTES).start ?? now
  const executed = trades.filter(isExecutedTrade)
  const volumeAll = parseFloat(
    executed.reduce((sum, trade) => sum + tradeVolumeUsd(trade), 0).toFixed(PNL_PRECISION)
  )

  return {
    pnl: {
      today: sumPnlFromDate(trades, getWindowStartDate(1, now)),
      d7: sumPnlFromDate(trades, getWindowStartDate(TRAILING_WINDOW_DAYS.week, now)),
      d30: sumPnlFromDate(trades, getWindowStartDate(TRAILING_WINDOW_DAYS.month, now)),
      d90: sumPnlFromDate(trades, getWindowStartDate(TRAILING_WINDOW_DAYS.quarter, now)),
      year: sumPnlFromDate(trades, yearStart),
      all: sumPnl(trades),
    },
    winRate: {
      d7: calculateWinRateByDays(trades, TRAILING_WINDOW_DAYS.week, now),
      d30: calculateWinRateByDays(trades, TRAILING_WINDOW_DAYS.month, now),
      d90: calculateWinRateByDays(trades, TRAILING_WINDOW_DAYS.quarter, now),
      all: calculateAllTimeWinRate(trades),
    },
    totalTrades: {
      count: executed.length,
      volumeUsd: volumeAll,
      volumeUsdD7: sumVolumeByDays(trades, TRAILING_WINDOW_DAYS.week, now),
      volumeUsdD30: sumVolumeByDays(trades, TRAILING_WINDOW_DAYS.month, now),
      volumeUsdD90: sumVolumeByDays(trades, TRAILING_WINDOW_DAYS.quarter, now),
      volumeUsdAll: volumeAll,
      volumeUsdToday: sumVolumeByDays(trades, TRAILING_WINDOW_DAYS.today, now),
      volumeUsdYear: sumVolumeFromDate(trades, yearStart),
    },
  }
}

export function buildPnlCalendarHistory(trades: Trade[]): PnlSnapshotCalendar {
  const byDay = new Map<string, { pnl: number; count: number }>()
  const byMonth = new Map<string, { year: number; month: number; pnl: number; count: number }>()

  for (const trade of trades) {
    if (trade.realized_pnl === null) continue
    const pnl = Number(trade.realized_pnl)
    if (!Number.isFinite(pnl)) continue

    const dayKey = toDayKey(new Date(trade.traded_at), APP_UTC_OFFSET_MINUTES)
    if (!dayKey) continue

    const day = byDay.get(dayKey) ?? { pnl: 0, count: 0 }
    byDay.set(dayKey, { pnl: day.pnl + pnl, count: day.count + 1 })

    const monthKey = dayKey.slice(0, 7)
    const month = byMonth.get(monthKey) ?? {
      year: Number(dayKey.slice(0, 4)),
      month: Number(dayKey.slice(5, 7)),
      pnl: 0,
      count: 0,
    }
    byMonth.set(monthKey, { ...month, pnl: month.pnl + pnl, count: month.count + 1 })
  }

  const days: PNLCalendarDay[] = Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({
      date,
      pnl: parseFloat(value.pnl.toFixed(CALENDAR_PRECISION)),
      tradeCount: value.count,
    }))

  const months: PNLCalendarMonth[] = Array.from(byMonth.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, value]) => ({
      year: value.year,
      month: value.month,
      pnl: parseFloat(value.pnl.toFixed(CALENDAR_PRECISION)),
      tradeCount: value.count,
    }))

  return { days, months }
}

export function filterTradesForSnapshot(
  trades: TradeWithExchange[],
  segment: TradeSegment,
  exchange: SnapshotExchange
): TradeWithExchange[] {
  return trades.filter((trade) => {
    if (segment !== 'all' && trade.trade_type !== segment) return false
    if (exchange !== 'all' && trade.exchange !== exchange) return false
    return true
  })
}

export function buildPnlSnapshotPayload(trades: TradeWithExchange[], now: Date): PnlSnapshotPayload {
  const [dayRange, weekRange, monthRange, yearRange] = CHART_RANGES

  return {
    overview: buildDashboardOverview(trades, now),
    chart: {
      [dayRange]: buildPNLTimeSeries(trades, dayRange),
      [weekRange]: buildPNLTimeSeries(trades, weekRange),
      [monthRange]: buildPNLTimeSeries(trades, monthRange),
      [yearRange]: buildPNLTimeSeries(trades, yearRange),
    } as PnlSnapshotPayload['chart'],
    calendar: buildPnlCalendarHistory(trades),
    assets: buildAssetDistribution(trades),
    fees: buildPnlSnapshotFees(trades, now),
  }
}

export function buildPnlSnapshotRows(trades: TradeWithExchange[], now: Date): PnlSnapshotRowInput[] {
  const rows: PnlSnapshotRowInput[] = []

  for (const segment of TRADE_SEGMENTS) {
    for (const exchange of SNAPSHOT_EXCHANGES) {
      const subset = filterTradesForSnapshot(trades, segment, exchange)
      rows.push({
        segment,
        exchange,
        payload: buildPnlSnapshotPayload(subset, now),
        trade_count: subset.length,
      })
    }
  }

  return rows
}
