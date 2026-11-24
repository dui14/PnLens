import { describe, expect, it } from 'vitest'
import {
  bucketStart,
  buildCompareData,
  buildSeriesList,
  endDateFromIso,
  enumerateDays,
  isCompareConfigValid,
  listExchangesWithData,
  periodRange,
  resolveBucketing,
  seriesKey,
  shiftDay,
  type CompareConfig,
} from '@/components/features/dashboard/feeCompareData'
import { summarizeByExchange } from '@/components/features/dashboard/feeRingData'
import type { FeeDailyPoint } from '@/lib/types'

const END = '2026-06-15'

const base: CompareConfig = { exchanges: ['okx', 'gateio'], types: ['spot'], metrics: ['fee'], period: 'd7' }

const daily: FeeDailyPoint[] = [
  { date: '2026-06-15', exchange: 'okx', tradeType: 'spot', feeUsd: 2, volumeUsd: 200 },
  { date: '2026-06-15', exchange: 'okx', tradeType: 'futures', feeUsd: 1, volumeUsd: 100 },
  { date: '2026-06-12', exchange: 'okx', tradeType: 'spot', feeUsd: 3, volumeUsd: 300 },
  { date: '2026-06-12', exchange: 'gateio', tradeType: 'spot', feeUsd: 9, volumeUsd: 900 },
  { date: '2026-05-01', exchange: 'okx', tradeType: 'spot', feeUsd: 5, volumeUsd: 500 },
]

describe('date helpers', () => {
  it('shifts days across month boundaries', () => {
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28')
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('derives the UTC+7 end date from an ISO instant', () => {
    expect(endDateFromIso('2026-06-14T18:00:00.000Z')).toBe('2026-06-15')
    expect(endDateFromIso('not a date')).toBeNull()
  })

  it('builds period ranges', () => {
    expect(periodRange('today', END)).toEqual({ start: END, end: END })
    expect(periodRange('d7', END)).toEqual({ start: '2026-06-09', end: END })
    expect(periodRange('d30', END).start).toBe('2026-05-17')
    expect(periodRange('d90', END).start).toBe('2026-03-18')
    expect(periodRange('year', END)).toEqual({ start: '2026-01-01', end: END })
  })

  it('enumerates inclusive day lists', () => {
    expect(enumerateDays('2026-06-13', '2026-06-15')).toEqual(['2026-06-13', '2026-06-14', '2026-06-15'])
  })

  it('floors dates to Monday for weekly buckets', () => {
    expect(bucketStart('2026-06-15', 'week')).toBe('2026-06-15')
    expect(bucketStart('2026-06-14', 'week')).toBe('2026-06-08')
    expect(bucketStart('2026-06-10', 'day')).toBe('2026-06-10')
  })

  it('chooses weekly bucketing only for dense long ranges', () => {
    expect(resolveBucketing(90)).toBe('day')
    expect(resolveBucketing(166)).toBe('week')
  })
})

describe('series and validation', () => {
  it('orders series by metric, exchange, then type', () => {
    const series = buildSeriesList({
      exchanges: ['okx', 'binance'],
      types: ['futures', 'spot'],
      metrics: ['volume', 'fee'],
      period: 'd7',
    })
    expect(series.map((item) => item.key)).toEqual([
      'fee:binance:spot',
      'fee:binance:futures',
      'fee:okx:spot',
      'fee:okx:futures',
      'volume:binance:spot',
      'volume:binance:futures',
      'volume:okx:spot',
      'volume:okx:futures',
    ])
    expect(seriesKey('okx', 'spot', 'fee')).toBe('fee:okx:spot')
  })

  it('validates required selections and the minimums', () => {
    expect(isCompareConfigValid(base)).toBe(true)
    expect(isCompareConfigValid({ ...base, exchanges: [] })).toBe(false)
    expect(isCompareConfigValid({ ...base, exchanges: ['okx'] })).toBe(true)
    expect(isCompareConfigValid({ ...base, types: [] })).toBe(false)
    expect(isCompareConfigValid({ ...base, metrics: [] })).toBe(false)
    expect(isCompareConfigValid({ ...base, exchanges: ['okx', 'binance', 'bybit', 'bitget', 'gateio'] })).toBe(true)
  })

  it('lists exchanges with data in the period in canonical order', () => {
    expect(listExchangesWithData(daily, 'd7', END)).toEqual(['okx', 'gateio'])
    expect(listExchangesWithData(daily, 'today', END)).toEqual(['okx'])
    expect(listExchangesWithData([], 'd7', END)).toEqual([])
    expect(listExchangesWithData(daily, 'd7', null)).toEqual(['okx', 'gateio'])
  })
})

describe('buildCompareData', () => {
  it('zero-fills every day of the period', () => {
    const data = buildCompareData(daily, base, END)
    expect(data.bucketing).toBe('day')
    expect(data.rows).toHaveLength(7)
    expect(data.rows[0].bucket).toBe('2026-06-09')
    expect(data.rows.find((row) => row.bucket === '2026-06-12')?.['fee:okx:spot']).toBe(3)
    expect(data.rows.find((row) => row.bucket === '2026-06-13')?.['fee:okx:spot']).toBe(0)
    expect(data.rows.find((row) => row.bucket === '2026-06-15')?.['fee:okx:spot']).toBe(2)
  })

  it('filters by exchange and type and ignores points outside the range', () => {
    const data = buildCompareData(daily, base, END)
    const total = data.rows.reduce((sum, row) => sum + Number(row['fee:okx:spot']), 0)
    expect(total).toBe(5)
  })

  it('builds one series per exchange, type and metric', () => {
    const data = buildCompareData(
      daily,
      { exchanges: ['okx'], types: ['spot', 'futures'], metrics: ['fee', 'volume'], period: 'today' },
      END
    )
    expect(data.series).toHaveLength(4)
    expect(data.rows).toHaveLength(1)
    expect(data.rows[0]).toMatchObject({
      'fee:okx:spot': 2,
      'fee:okx:futures': 1,
      'volume:okx:spot': 200,
      'volume:okx:futures': 100,
    })
  })

  it('aggregates weekly for the year period', () => {
    const data = buildCompareData(daily, { ...base, period: 'year' }, END)
    expect(data.bucketing).toBe('week')
    expect(data.rows[0].bucket).toBe('2025-12-29')
    expect(data.rows.find((row) => row.bucket === '2026-06-08')?.['fee:okx:spot']).toBe(3)
    expect(data.rows.find((row) => row.bucket === '2026-06-15')?.['fee:okx:spot']).toBe(2)
    expect(data.rows.find((row) => row.bucket === '2026-04-27')?.['fee:okx:spot']).toBe(5)
  })

  it('returns zero rows when there is no matching data', () => {
    const data = buildCompareData([], base, END)
    expect(data.rows.every((row) => row['fee:okx:spot'] === 0)).toBe(true)
  })
})

describe('summarizeByExchange', () => {
  it('merges spot and futures rows and keeps every exchange', () => {
    const result = summarizeByExchange([
      { exchange: 'okx', tradeType: 'spot', feeUsd: 1, volumeUsd: 10, tradeCount: 2 },
      { exchange: 'okx', tradeType: 'futures', feeUsd: 2, volumeUsd: 20, tradeCount: 1 },
      { exchange: 'bybit', tradeType: 'spot', feeUsd: 0, volumeUsd: 0, tradeCount: 0 },
    ])
    expect(result.map((item) => item.exchange)).toEqual(['binance', 'okx', 'bybit', 'bitget', 'gateio'])
    expect(result.find((item) => item.exchange === 'okx')).toEqual({ exchange: 'okx', feeUsd: 3, volumeUsd: 30, tradeCount: 3 })
    expect(result.find((item) => item.exchange === 'bybit')?.tradeCount).toBe(0)
  })
})
