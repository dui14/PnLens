import type { ChartRange, PNLCalendarDay, PNLCalendarMonth, PNLChartPoint, PnlSnapshotCalendar } from '@/lib/types'
import { toDayKey, toMonthKey, vietnamDateParts } from '@/lib/time/dayBoundary'

const MS_PER_DAY = 24 * 60 * 60 * 1000
const WEEK_DAYS = 7
const MONTH_DAYS = 30
const YEAR_MONTHS = 12
const DAILY_PNL_PATTERN = [42.6, -18.4, 65.1, 12.9, -31.7, 88.3, 23.5, -9.8, 54.2, -44.6, 71.9, 15.3, -22.1, 39.8]
const DAILY_TRADES_PATTERN = [6, 3, 9, 4, 7, 11, 5, 2, 8, 10, 12, 4, 6, 9]
const MONTHLY_PNL_PATTERN = [412.8, -138.2, 530.4, 295.7, -76.9, 644.1, 188.3, 351.6, -212.5, 478.2, 123.9, 389.4]

function pick(pattern: number[], index: number): number {
  return pattern[index % pattern.length]
}

function dailySeries(now: Date, days: number): PNLChartPoint[] {
  const points: PNLChartPoint[] = []
  let cumulative = 0
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const key = toDayKey(new Date(now.getTime() - offset * MS_PER_DAY))
    if (!key) continue
    const pnl = pick(DAILY_PNL_PATTERN, days - offset)
    cumulative += pnl
    points.push({ date: key, pnl, cumulative_pnl: Number(cumulative.toFixed(2)) })
  }
  return points
}

function monthlySeries(now: Date): PNLChartPoint[] {
  const points: PNLChartPoint[] = []
  const { year, month } = vietnamDateParts(now)
  let cumulative = 0
  for (let offset = YEAR_MONTHS - 1; offset >= 0; offset -= 1) {
    const index = year * YEAR_MONTHS + (month - 1) - offset
    const key = toMonthKey(new Date(Date.UTC(Math.floor(index / YEAR_MONTHS), index % YEAR_MONTHS, 15)))
    if (!key) continue
    const pnl = pick(MONTHLY_PNL_PATTERN, YEAR_MONTHS - offset)
    cumulative += pnl
    points.push({ date: key, pnl, cumulative_pnl: Number(cumulative.toFixed(2)) })
  }
  return points
}

export function buildSampleChart(now: Date): Record<ChartRange, PNLChartPoint[]> {
  return {
    day: [],
    week: dailySeries(now, WEEK_DAYS),
    month: dailySeries(now, MONTH_DAYS),
    year: monthlySeries(now),
  }
}

export function buildSampleCalendar(now: Date): PnlSnapshotCalendar {
  const { year, month, day } = vietnamDateParts(now)
  const days: PNLCalendarDay[] = []
  for (let d = 1; d <= day; d += 1) {
    const key = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    days.push({ date: key, pnl: pick(DAILY_PNL_PATTERN, d), tradeCount: pick(DAILY_TRADES_PATTERN, d) })
  }
  const months: PNLCalendarMonth[] = []
  for (let m = 1; m <= month; m += 1) {
    months.push({ year, month: m, pnl: pick(MONTHLY_PNL_PATTERN, m), tradeCount: 40 + m * 7 })
  }
  return { days, months }
}
