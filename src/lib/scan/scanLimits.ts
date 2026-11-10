import type { Exchange } from '@/lib/types'

export const SCAN_COOLDOWN_MS = 5 * 60 * 1000
export const SCAN_STALE_AFTER_MS = 30 * 60 * 1000
export const SCAN_OVERLAP_MS = 2 * 60 * 60 * 1000
export const SCAN_LOOKBACK_MS = 365 * 24 * 60 * 60 * 1000
export const UPSERT_BATCH_SIZE = 200

export type ExchangeScanLimit = {
  maxLookbackDays: number | null
  windowDays: number | null
  pageSize: number | null
}

export const EXCHANGE_SCAN_LIMITS: Record<Exchange, ExchangeScanLimit> = {
  binance: { maxLookbackDays: null, windowDays: null, pageSize: 1000 },
  okx: { maxLookbackDays: 90, windowDays: null, pageSize: null },
  bybit: { maxLookbackDays: null, windowDays: null, pageSize: 100 },
  bitget: { maxLookbackDays: null, windowDays: null, pageSize: 500 },
  gateio: { maxLookbackDays: null, windowDays: null, pageSize: 1000 },
}

export type ScanWindow = {
  start: Date
  end: Date
}

export function buildScanWindows(input: {
  now: Date
  lastSynced: string | null
  limits: ExchangeScanLimit
}): { windows: ScanWindow[]; warnings: string[] } {
  const warnings: string[] = []
  const yearStart = new Date(input.now.getTime() - SCAN_LOOKBACK_MS)
  let rangeStart = yearStart
  const maxStart =
    input.limits.maxLookbackDays == null
      ? null
      : new Date(input.now.getTime() - input.limits.maxLookbackDays * 24 * 60 * 60 * 1000)

  if (maxStart == null) {
    warnings.push('LOOKBACK_UNVERIFIED')
  } else if (maxStart.getTime() > rangeStart.getTime()) {
    rangeStart = maxStart
  }

  if (input.lastSynced) {
    const overlap = new Date(new Date(input.lastSynced).getTime() - SCAN_OVERLAP_MS)
    if (maxStart && overlap.getTime() < maxStart.getTime()) {
      warnings.push('COVERAGE_GAP')
      rangeStart = maxStart
    } else {
      rangeStart = overlap.getTime() > rangeStart.getTime() ? overlap : rangeStart
    }
  }

  const end = input.now
  if (rangeStart.getTime() > end.getTime()) rangeStart = end
  const windowMs = input.limits.windowDays == null ? null : input.limits.windowDays * 24 * 60 * 60 * 1000
  if (windowMs == null || windowMs <= 0) {
    return { windows: [{ start: rangeStart, end }], warnings }
  }

  const windows: ScanWindow[] = []
  let cursor = rangeStart.getTime()
  const endMs = end.getTime()
  while (cursor < endMs) {
    const next = Math.min(cursor + windowMs, endMs)
    windows.push({ start: new Date(cursor), end: new Date(next) })
    cursor = next
  }
  if (windows.length === 0) windows.push({ start: rangeStart, end })
  return { windows, warnings }
}

export function scanStoredError(skipped: number, warnings: string[]): string | null {
  const parts: string[] = []
  if (skipped > 0) parts.push(`ROWS_SKIPPED:${skipped}`)
  if (warnings.includes('COVERAGE_GAP')) parts.push('COVERAGE_GAP')
  if (warnings.includes('LOOKBACK_UNVERIFIED')) parts.push('LOOKBACK_UNVERIFIED')
  return parts.length > 0 ? parts.join(',') : null
}
