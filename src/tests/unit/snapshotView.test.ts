import { describe, expect, it } from 'vitest'
import {
  earliestCalendarYear,
  zeroFillMonthDays,
  zeroFillYearMonths,
} from '@/lib/pnl/snapshotView'

describe('zeroFillMonthDays', () => {
  it('fills every day of the month and keeps active days', () => {
    const result = zeroFillMonthDays([{ date: '2026-02-10', pnl: 5, tradeCount: 2 }], 2026, 2)
    expect(result).toHaveLength(28)
    expect(result[9]).toEqual({ date: '2026-02-10', pnl: 5, tradeCount: 2 })
    expect(result[0]).toEqual({ date: '2026-02-01', pnl: 0, tradeCount: 0 })
  })

  it('handles leap years and ignores other months', () => {
    const result = zeroFillMonthDays([{ date: '2024-03-01', pnl: 9, tradeCount: 1 }], 2024, 2)
    expect(result).toHaveLength(29)
    expect(result.every((entry) => entry.pnl === 0)).toBe(true)
  })
})

describe('zeroFillYearMonths', () => {
  it('returns twelve months for the requested year only', () => {
    const result = zeroFillYearMonths(
      [
        { year: 2026, month: 3, pnl: 7, tradeCount: 4 },
        { year: 2025, month: 3, pnl: 1, tradeCount: 1 },
      ],
      2026
    )
    expect(result).toHaveLength(12)
    expect(result[2]).toEqual({ year: 2026, month: 3, pnl: 7, tradeCount: 4 })
    expect(result[0]).toEqual({ year: 2026, month: 1, pnl: 0, tradeCount: 0 })
  })
})

describe('earliestCalendarYear', () => {
  it('returns the fallback when empty', () => {
    expect(earliestCalendarYear([], 2026)).toBe(2026)
  })

  it('returns the earliest year present', () => {
    expect(
      earliestCalendarYear(
        [
          { year: 2024, month: 5, pnl: 1, tradeCount: 1 },
          { year: 2025, month: 1, pnl: 1, tradeCount: 1 },
        ],
        2026
      )
    ).toBe(2024)
  })
})
