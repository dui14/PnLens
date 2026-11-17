import { daysInMonth } from '@/lib/time/dayBoundary'
import type { PNLCalendarDay, PNLCalendarMonth } from '@/lib/types'

const MONTHS_IN_YEAR = 12

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export function dayKey(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`
}

export function zeroFillMonthDays(
  days: PNLCalendarDay[],
  year: number,
  month: number
): PNLCalendarDay[] {
  const byDate = new Map(days.map((entry) => [entry.date, entry]))
  const total = daysInMonth(year, month)

  return Array.from({ length: total }, (_, index) => {
    const date = dayKey(year, month, index + 1)
    return byDate.get(date) ?? { date, pnl: 0, tradeCount: 0 }
  })
}

export function zeroFillYearMonths(
  months: PNLCalendarMonth[],
  year: number
): PNLCalendarMonth[] {
  const byMonth = new Map(
    months.filter((entry) => entry.year === year).map((entry) => [entry.month, entry])
  )

  return Array.from({ length: MONTHS_IN_YEAR }, (_, index) => {
    const month = index + 1
    return byMonth.get(month) ?? { year, month, pnl: 0, tradeCount: 0 }
  })
}

export function earliestCalendarYear(
  months: PNLCalendarMonth[],
  fallbackYear: number
): number {
  return months.reduce((min, entry) => Math.min(min, entry.year), fallbackYear)
}
