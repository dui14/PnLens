import { APP_TIME_ZONE, APP_UTC_OFFSET_MINUTES } from '@/lib/time/appUtcOffset'

export { APP_TIME_ZONE, APP_UTC_OFFSET_MINUTES }

const DAY_MS = 24 * 60 * 60 * 1000
const MONTH_LENGTHS = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

export type RangeName = 'day' | 'week' | 'month' | 'year' | 'all'

export type InstantRange = {
  start: Date | null
  end: Date
}

type CivilParts = {
  year: number
  month: number
  day: number
  hour: number
}

function offsetMillis(offsetMinutes: number): number {
  return offsetMinutes * 60 * 1000
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}

function civilFromDays(dayIndex: number): { year: number; month: number; day: number } {
  const z = dayIndex + 719468
  const era = Math.floor(z / 146097)
  const dayOfEra = z - era * 146097
  const yearOfEra = Math.floor(
    (dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365
  )
  let year = yearOfEra + era * 400
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100))
  const monthPart = Math.floor((5 * dayOfYear + 2) / 153)
  const day = dayOfYear - Math.floor((153 * monthPart + 2) / 5) + 1
  const month = monthPart + (monthPart < 10 ? 3 : -9)
  year += month <= 2 ? 1 : 0
  return { year, month, day }
}

function daysFromCivil(year: number, month: number, day: number): number {
  const shiftedYear = year - (month <= 2 ? 1 : 0)
  const era = Math.floor(shiftedYear / 400)
  const yearOfEra = shiftedYear - era * 400
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear
  return era * 146097 + dayOfEra - 719468
}

function parts(date: Date, offsetMinutes: number): CivilParts {
  const shifted = date.getTime() + offsetMillis(offsetMinutes)
  const dayIndex = Math.floor(shifted / DAY_MS)
  const timeOfDay = shifted - dayIndex * DAY_MS
  const civil = civilFromDays(dayIndex)
  return {
    year: civil.year,
    month: civil.month,
    day: civil.day,
    hour: Math.floor(timeOfDay / 3600000),
  }
}

function civilToDate(year: number, month: number, day: number, offsetMinutes: number): Date {
  return new Date(daysFromCivil(year, month, day) * DAY_MS - offsetMillis(offsetMinutes))
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) return 29
  return MONTH_LENGTHS[month] ?? 0
}

export function mondayIndex(year: number, month: number, day: number): number {
  return ((daysFromCivil(year, month, day) + 3) % 7 + 7) % 7
}

export function vietnamDateParts(date: Date, offsetMinutes: number = APP_UTC_OFFSET_MINUTES): CivilParts {
  return parts(date, offsetMinutes)
}

export function toDayKey(date: Date, offsetMinutes: number = APP_UTC_OFFSET_MINUTES): string | null {
  if (Number.isNaN(date.getTime())) return null
  const value = parts(date, offsetMinutes)
  return `${value.year}-${pad(value.month)}-${pad(value.day)}`
}

export function toMonthKey(date: Date, offsetMinutes: number = APP_UTC_OFFSET_MINUTES): string | null {
  if (Number.isNaN(date.getTime())) return null
  const value = parts(date, offsetMinutes)
  return `${value.year}-${pad(value.month)}`
}

export function toHourKey(date: Date, offsetMinutes: number = APP_UTC_OFFSET_MINUTES): string | null {
  if (Number.isNaN(date.getTime())) return null
  const value = parts(date, offsetMinutes)
  return `${value.year}-${pad(value.month)}-${pad(value.day)} ${pad(value.hour)}:00`
}

export function startOfDay(date: Date, offsetMinutes: number = APP_UTC_OFFSET_MINUTES): Date {
  const value = parts(date, offsetMinutes)
  return civilToDate(value.year, value.month, value.day, offsetMinutes)
}

export function startOfWeek(date: Date, offsetMinutes: number = APP_UTC_OFFSET_MINUTES): Date {
  const value = parts(date, offsetMinutes)
  const start = civilToDate(value.year, value.month, value.day, offsetMinutes)
  return new Date(start.getTime() - mondayIndex(value.year, value.month, value.day) * DAY_MS)
}

export function startOfMonth(date: Date, offsetMinutes: number = APP_UTC_OFFSET_MINUTES): Date {
  const value = parts(date, offsetMinutes)
  return civilToDate(value.year, value.month, 1, offsetMinutes)
}

export function monthStart(year: number, month: number, offsetMinutes: number = APP_UTC_OFFSET_MINUTES): Date {
  return civilToDate(year, month, 1, offsetMinutes)
}

export function startOfYear(date: Date, offsetMinutes: number = APP_UTC_OFFSET_MINUTES): Date {
  const value = parts(date, offsetMinutes)
  return civilToDate(value.year, 1, 1, offsetMinutes)
}

export function monthBounds(
  year: number,
  month: number,
  offsetMinutes: number = APP_UTC_OFFSET_MINUTES
): { start: Date; end: Date } {
  const start = civilToDate(year, month, 1, offsetMinutes)
  const next = month === 12 ? civilToDate(year + 1, 1, 1, offsetMinutes) : civilToDate(year, month + 1, 1, offsetMinutes)
  return { start, end: new Date(next.getTime() - 1) }
}

export function yearBounds(year: number, offsetMinutes: number = APP_UTC_OFFSET_MINUTES): { start: Date; end: Date } {
  const start = civilToDate(year, 1, 1, offsetMinutes)
  const next = civilToDate(year + 1, 1, 1, offsetMinutes)
  return { start, end: new Date(next.getTime() - 1) }
}

export function rangeFor(range: string, now: Date, offsetMinutes: number = APP_UTC_OFFSET_MINUTES): InstantRange {
  if (range === 'all') return { start: null, end: now }
  if (range === 'day') return { start: startOfDay(now, offsetMinutes), end: now }
  if (range === 'week') return { start: startOfWeek(now, offsetMinutes), end: now }
  if (range === 'month') return { start: startOfMonth(now, offsetMinutes), end: now }
  if (range === 'year') return { start: startOfYear(now, offsetMinutes), end: now }
  throw new Error('VALIDATION_ERROR')
}

export function snapshotBounds(
  period: RangeName,
  now: Date,
  offsetMinutes: number = APP_UTC_OFFSET_MINUTES
): { period_start: string; period_end: string } {
  const range = rangeFor(period, now, offsetMinutes)
  return {
    period_start: range.start ? range.start.toISOString() : '1970-01-01T00:00:00.000Z',
    period_end: range.end.toISOString(),
  }
}

export function pnlTimeFields(): { timezone: string; utcOffsetMinutes: number } {
  return { timezone: APP_TIME_ZONE, utcOffsetMinutes: APP_UTC_OFFSET_MINUTES }
}
