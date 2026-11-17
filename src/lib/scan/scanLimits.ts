import type { Exchange } from '@/lib/types'
import type { HistoryGap } from '@/lib/adapters/historyGaps'

export const SCAN_COOLDOWN_MS = 15 * 60 * 1000
export const SCAN_STALE_AFTER_MS = 30 * 60 * 1000
export const SCAN_POLL_INTERVAL_MS = 3000
export const SCAN_POLL_MAX_WAIT_MS = SCAN_STALE_AFTER_MS
export const DAY_MS = 24 * 60 * 60 * 1000
export const SCAN_LOOKBACK_DAYS = 365
export const SCAN_LOOKBACK_MS = SCAN_LOOKBACK_DAYS * DAY_MS

export const BINANCE_HISTORY = {
  futuresFillsLookbackDays: 180,
  futuresWindowDays: 7,
  incomeWindowDays: 7,
  spotPageSize: 1000,
  maxSpotPages: 200,
  usedWeightHeader: 'x-mbx-used-weight-1m',
  retryAfterHeader: 'retry-after',
  rateLimitCode: -1003,
  rateLimitStatuses: [429, 418],
  weightSlowdownThreshold: 1800,
  weightPauseMs: 5000,
} as const

export const HISTORY_RETRY = {
  maxAttempts: 4,
  baseDelayMs: 1000,
  maxDelayMs: 60_000,
  okxRateLimitCode: '50011',
  bybitRateLimitCode: 10006,
} as const
export const UPSERT_BATCH_SIZE = 200

export type ExchangeScanLimit = {
  maxLookbackDays: number
  windowDays: number | null
  pageSize: number | null
}

export const EXCHANGE_SCAN_LIMITS: Record<Exchange, ExchangeScanLimit> = {
  binance: { maxLookbackDays: 180, windowDays: null, pageSize: 1000 },
  okx: { maxLookbackDays: 90, windowDays: null, pageSize: null },
  bybit: { maxLookbackDays: 180, windowDays: null, pageSize: 100 },
  bitget: { maxLookbackDays: 90, windowDays: null, pageSize: 500 },
  gateio: { maxLookbackDays: 90, windowDays: null, pageSize: 1000 },
}

export const MAX_PARTIAL_HISTORY_TOKENS = 10
export const PARTIAL_HISTORY_CODE = 'PARTIAL_HISTORY'

export type ScanWindow = {
  start: Date
  end: Date
}

export function buildScanWindows(input: {
  now: Date
  limits: ExchangeScanLimit
}): { windows: ScanWindow[]; warnings: string[] } {
  const warnings: string[] = []
  let rangeStart = new Date(input.now.getTime() - input.limits.maxLookbackDays * DAY_MS)

  const end = input.now
  if (rangeStart.getTime() > end.getTime()) rangeStart = end
  const windowMs = input.limits.windowDays == null ? null : input.limits.windowDays * DAY_MS
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
  for (const warning of warnings) {
    if (warning.startsWith(`${PARTIAL_HISTORY_CODE}:`)) {
      parts.push(warning)
    }
  }
  return parts.length > 0 ? parts.join(',') : null
}

export function partialHistoryWarnings(gaps: HistoryGap[]): string[] {
  const merged = new Map<string, { startMs: number; endMs: number }>()
  for (const gap of gaps) {
    const current = merged.get(gap.market)
    if (!current) {
      merged.set(gap.market, { startMs: gap.startMs, endMs: gap.endMs })
    } else {
      current.startMs = Math.min(current.startMs, gap.startMs)
      current.endMs = Math.max(current.endMs, gap.endMs)
    }
  }
  return Array.from(merged.entries())
    .slice(0, MAX_PARTIAL_HISTORY_TOKENS)
    .map(([market, range]) => {
      const from = new Date(range.startMs).toISOString().slice(0, 10)
      const to = new Date(range.endMs).toISOString().slice(0, 10)
      return `${PARTIAL_HISTORY_CODE}:${market}:${from}:${to}`
    })
}

export const BINANCE_SPOT_DISCOVERY = {
  quoteAssets: ['USDT', 'FDUSD', 'USDC', 'BTC'],
  concurrency: 2,
  requestPauseMs: 700,
  historyPageSize: 1000,
  historyMaxPages: 20,
  historyPauseMs: 300,
  depositWithdrawWindowDays: 90,
  convertWindowDays: 30,
  dustWindowDays: 90,
  bStockNamePattern: /bstock/i,
  gapMarket: 'spot_discovery',
} as const
