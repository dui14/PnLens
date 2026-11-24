import { describe, expect, it } from 'vitest'
import { PNLSummaryQuerySchema } from '@/lib/validators/pnl'
import {
  APP_UTC_OFFSET_MINUTES,
  rangeFor,
  startOfDay,
  startOfMonth,
  startOfWeek,
  startOfYear,
  toDayKey,
} from '@/lib/time/dayBoundary'

describe('Vietnam day boundary', () => {
  it('keeps the offset at UTC+7', () => {
    expect(APP_UTC_OFFSET_MINUTES).toBe(420)
  })

  it('assigns 2026-01-01T16:59:59.999Z to 2026-01-01', () => {
    expect(toDayKey(new Date('2026-01-01T16:59:59.999Z'))).toBe('2026-01-01')
  })

  it('assigns 2026-01-01T17:00:00.000Z to 2026-01-02', () => {
    expect(toDayKey(new Date('2026-01-01T17:00:00.000Z'))).toBe('2026-01-02')
  })

  it('starts the week on Monday', () => {
    expect(startOfWeek(new Date('2026-01-04T16:59:59.999Z')).toISOString()).toBe('2025-12-28T17:00:00.000Z')
    expect(startOfWeek(new Date('2026-01-04T17:00:00.000Z')).toISOString()).toBe('2026-01-04T17:00:00.000Z')
  })

  it('starts the month on the Vietnam month boundary', () => {
    expect(startOfMonth(new Date('2026-02-28T16:59:59.999Z')).toISOString()).toBe('2026-01-31T17:00:00.000Z')
    expect(startOfMonth(new Date('2026-02-28T17:00:00.000Z')).toISOString()).toBe('2026-02-28T17:00:00.000Z')
  })

  it('starts the year on 1 January in Vietnam', () => {
    expect(startOfYear(new Date('2025-12-31T16:59:59.999Z')).toISOString()).toBe('2024-12-31T17:00:00.000Z')
    expect(startOfYear(new Date('2025-12-31T17:00:00.000Z')).toISOString()).toBe('2025-12-31T17:00:00.000Z')
  })

  it('uses the calendar day, Monday week, calendar month, and calendar year through now', () => {
    const now = new Date('2026-06-15T10:30:00.000Z')
    expect(startOfDay(now).toISOString()).toBe('2026-06-14T17:00:00.000Z')
    expect(rangeFor('day', now)).toEqual({ start: startOfDay(now), end: now })
    expect(rangeFor('week', now).start?.toISOString()).toBe('2026-06-14T17:00:00.000Z')
    expect(rangeFor('month', now).start?.toISOString()).toBe('2026-05-31T17:00:00.000Z')
    expect(rangeFor('year', now).start?.toISOString()).toBe('2025-12-31T17:00:00.000Z')
    expect(rangeFor('year', now).end).toEqual(now)
  })

  it('returns an open start for range all', () => {
    const now = new Date('2026-06-15T10:30:00.000Z')
    expect(rangeFor('all', now)).toEqual({ start: null, end: now })
  })

  it('rejects an unknown range', () => {
    expect(() => rangeFor('decade', new Date('2026-06-15T10:30:00.000Z'))).toThrow('VALIDATION_ERROR')
    expect(PNLSummaryQuerySchema.safeParse({ range: 'decade' }).success).toBe(false)
  })
})
