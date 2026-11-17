export const VENUE_DECIMAL = /^-?\d+(\.\d+)?$/

export const TRADE_REJECT_REASONS = ['INVALID_TIMESTAMP', 'INVALID_NUMBER', 'MISSING_ID'] as const

export type TradeRejectReason = (typeof TRADE_REJECT_REASONS)[number]

export type TradeRejectCounts = Record<TradeRejectReason, number>

export function emptyRejectCounts(): TradeRejectCounts {
  return {
    INVALID_TIMESTAMP: 0,
    INVALID_NUMBER: 0,
    MISSING_ID: 0,
  }
}

export class TradeRejectCounter {
  counts = emptyRejectCounts()

  reset(): void {
    this.counts = emptyRejectCounts()
  }

  reject(reason: TradeRejectReason): null {
    this.counts[reason] += 1
    return null
  }
}

export function venueDecimal(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return VENUE_DECIMAL.test(value) ? value : null
}

export function requiredDecimal(value: unknown, rejected: TradeRejectCounter): string | null {
  const parsed = venueDecimal(value)
  if (parsed === null) return rejected.reject('INVALID_NUMBER')
  return parsed
}

export function optionalDecimal(value: unknown, rejected: TradeRejectCounter): string | null | undefined {
  if (value === undefined || value === null || value === '') return null
  const parsed = venueDecimal(value)
  if (parsed === null) {
    rejected.reject('INVALID_NUMBER')
    return undefined
  }
  return parsed
}

export function decimalOrZero(value: unknown, rejected: TradeRejectCounter): string | null {
  if (value === undefined || value === null || value === '') return '0'
  return requiredDecimal(value, rejected)
}

export function flexibleTimeToIso(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  if (typeof value === 'string' && value.trim() === '') return null
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return null
  const millis = Math.abs(numeric) > 1_000_000_000_000 ? numeric : numeric * 1000
  const parsed = new Date(millis)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString()
}

export function epochMillisToIso(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString()
}

function scaledInteger(value: string, scale: number): bigint | null {
  if (!VENUE_DECIMAL.test(value)) return null
  const negative = value.startsWith('-')
  const body = negative ? value.slice(1) : value
  const [whole, fraction = ''] = body.split('.')
  const digits = `${whole}${fraction.padEnd(scale, '0')}`
  const magnitude = BigInt(digits)
  return negative ? -magnitude : magnitude
}

export function addDecimals(left: string, right: string): string | null {
  if (!VENUE_DECIMAL.test(left) || !VENUE_DECIMAL.test(right)) return null
  const leftScale = left.split('.')[1]?.length ?? 0
  const rightScale = right.split('.')[1]?.length ?? 0
  const scale = Math.max(leftScale, rightScale)
  const sum = scaledInteger(left, scale)
  const addend = scaledInteger(right, scale)
  if (sum === null || addend === null) return null
  return unscaledInteger(sum + addend, scale)
}

export function multiplyDecimals(left: string, right: string): string | null {
  if (!VENUE_DECIMAL.test(left) || !VENUE_DECIMAL.test(right)) return null
  const leftScale = left.split('.')[1]?.length ?? 0
  const rightScale = right.split('.')[1]?.length ?? 0
  const leftInt = scaledInteger(left, leftScale)
  const rightInt = scaledInteger(right, rightScale)
  if (leftInt === null || rightInt === null) return null
  return unscaledInteger(leftInt * rightInt, leftScale + rightScale)
}

export function absDecimal(value: string): string {
  return value.startsWith('-') ? value.slice(1) : value
}

export function negateDecimal(value: string): string {
  if (!VENUE_DECIMAL.test(value) || /^-?0(\.0+)?$/.test(value)) return value
  return value.startsWith('-') ? value.slice(1) : `-${value}`
}

function unscaledInteger(value: bigint, scale: number): string {
  const negative = value < BigInt(0)
  const digits = (negative ? -value : value).toString().padStart(scale + 1, '0')
  if (scale === 0) return negative ? `-${digits}` : digits
  const whole = digits.slice(0, digits.length - scale)
  const fraction = digits.slice(digits.length - scale)
  const body = `${whole}.${fraction}`
  return negative ? `-${body}` : body
}

export function isNegativeDecimal(value: string): boolean {
  return value.startsWith('-') && value !== '-0' && !/^-0\.0+$/.test(value)
}
