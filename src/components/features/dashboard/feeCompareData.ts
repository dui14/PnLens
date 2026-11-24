import {
  COMPARE_MIN_EXCHANGES,
  COMPARE_MIN_TYPES,
  COMPARE_METRICS,
  COMPARE_PERIOD_DAYS,
  COMPARE_WEEKLY_THRESHOLD_DAYS,
  type CompareMetric,
} from '@/lib/config/feeCompare'
import { FEE_TRADE_TYPES } from '@/lib/config/fees'
import { APP_UTC_OFFSET_MINUTES, toDayKey } from '@/lib/time/dayBoundary'
import { EXCHANGES, type Exchange, type FeeDailyPoint, type FeeTradeType, type PnlPeriod } from '@/lib/types'

export type CompareBucketing = 'day' | 'week'

export type CompareConfig = {
  exchanges: Exchange[]
  types: FeeTradeType[]
  metrics: CompareMetric[]
  period: PnlPeriod
}

export type CompareSeries = {
  key: string
  exchange: Exchange
  tradeType: FeeTradeType
  metric: CompareMetric
}

export type CompareRow = { bucket: string } & Record<string, number | string>

export type CompareData = {
  series: CompareSeries[]
  rows: CompareRow[]
  bucketing: CompareBucketing
}

const MS_PER_DAY = 86_400_000
const MONDAY_OFFSET_FROM_SUNDAY = 6
const SUNDAY_INDEX = 0
const YEAR_START_SUFFIX = '01-01'
const YEAR_PREFIX_LENGTH = 4
const DAY_KEY_LENGTH = 10

function parseDay(date: string): number {
  return Date.parse(`${date}T00:00:00Z`)
}

function formatDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, DAY_KEY_LENGTH)
}

export function shiftDay(date: string, delta: number): string {
  return formatDay(parseDay(date) + delta * MS_PER_DAY)
}

export function endDateFromIso(iso: string): string | null {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return null
  return toDayKey(parsed, APP_UTC_OFFSET_MINUTES)
}

export function periodRange(period: PnlPeriod, endDate: string): { start: string; end: string } {
  if (period === 'year') {
    return { start: `${endDate.slice(0, YEAR_PREFIX_LENGTH)}-${YEAR_START_SUFFIX}`, end: endDate }
  }
  return { start: shiftDay(endDate, -(COMPARE_PERIOD_DAYS[period] - 1)), end: endDate }
}

export function enumerateDays(start: string, end: string): string[] {
  const days: string[] = []
  for (let ms = parseDay(start); ms <= parseDay(end); ms += MS_PER_DAY) {
    days.push(formatDay(ms))
  }
  return days
}

export function resolveBucketing(dayCount: number): CompareBucketing {
  return dayCount > COMPARE_WEEKLY_THRESHOLD_DAYS ? 'week' : 'day'
}

export function bucketStart(date: string, bucketing: CompareBucketing): string {
  if (bucketing === 'day') return date
  const dayIndex = new Date(parseDay(date)).getUTCDay()
  const sinceMonday = dayIndex === SUNDAY_INDEX ? MONDAY_OFFSET_FROM_SUNDAY : dayIndex - 1
  return shiftDay(date, -sinceMonday)
}

export function seriesKey(exchange: Exchange, tradeType: FeeTradeType, metric: CompareMetric): string {
  return `${metric}:${exchange}:${tradeType}`
}

export function buildSeriesList(config: CompareConfig): CompareSeries[] {
  const series: CompareSeries[] = []
  for (const metric of COMPARE_METRICS) {
    if (!config.metrics.includes(metric)) continue
    for (const exchange of EXCHANGES) {
      if (!config.exchanges.includes(exchange)) continue
      for (const tradeType of FEE_TRADE_TYPES) {
        if (!config.types.includes(tradeType)) continue
        series.push({ key: seriesKey(exchange, tradeType, metric), exchange, tradeType, metric })
      }
    }
  }
  return series
}

export function isCompareConfigValid(config: CompareConfig): boolean {
  return (
    config.exchanges.length >= COMPARE_MIN_EXCHANGES &&
    config.types.length >= COMPARE_MIN_TYPES &&
    config.metrics.length >= 1
  )
}

export function listExchangesWithData(daily: FeeDailyPoint[], period: PnlPeriod, endDate: string | null): Exchange[] {
  const range = endDate ? periodRange(period, endDate) : null
  const present = new Set(
    daily
      .filter((point) => !range || (point.date >= range.start && point.date <= range.end))
      .map((point) => point.exchange)
  )
  return EXCHANGES.filter((exchange) => present.has(exchange))
}

export function buildCompareData(daily: FeeDailyPoint[], config: CompareConfig, endDate: string): CompareData {
  const series = buildSeriesList(config)
  const range = periodRange(config.period, endDate)
  const days = enumerateDays(range.start, range.end)
  const bucketing = resolveBucketing(days.length)
  const wanted = new Set(series.map((item) => `${item.exchange}:${item.tradeType}`))

  const rowsByBucket = new Map<string, CompareRow>()
  for (const day of days) {
    const bucket = bucketStart(day, bucketing)
    if (rowsByBucket.has(bucket)) continue
    const row: CompareRow = { bucket }
    for (const item of series) row[item.key] = 0
    rowsByBucket.set(bucket, row)
  }

  for (const point of daily) {
    if (point.date < range.start || point.date > range.end) continue
    if (!wanted.has(`${point.exchange}:${point.tradeType}`)) continue
    const row = rowsByBucket.get(bucketStart(point.date, bucketing))
    if (!row) continue
    for (const metric of config.metrics) {
      const key = seriesKey(point.exchange, point.tradeType, metric)
      const amount = metric === 'fee' ? point.feeUsd : point.volumeUsd
      row[key] = Number(row[key]) + amount
    }
  }

  return { series, rows: Array.from(rowsByBucket.values()), bucketing }
}
