import {
  DEMO_CHANGE_DECIMALS,
  DEMO_PRICE_DEFAULT_MAX_DECIMALS,
  DEMO_PRICE_MAX_DECIMALS,
  DEMO_PRICE_SIGNIFICANT_DIGITS,
} from '@/lib/config/demoTrading'

const LOCALE = 'en-US'

export const EMPTY_VALUE = '--'

export function formatPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return EMPTY_VALUE
  const abs = Math.abs(value)
  const maximumFractionDigits =
    abs > 0 && abs < 1
      ? Math.min(DEMO_PRICE_MAX_DECIMALS, Math.ceil(-Math.log10(abs)) + DEMO_PRICE_SIGNIFICANT_DIGITS - 1)
      : DEMO_PRICE_DEFAULT_MAX_DECIMALS
  return value.toLocaleString(LOCALE, {
    minimumFractionDigits: 2,
    maximumFractionDigits: Math.max(maximumFractionDigits, 2),
  })
}

export function formatAmount(value: number | null | undefined, maxDigits = 4): string {
  if (value == null || !Number.isFinite(value)) return EMPTY_VALUE
  return value.toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: maxDigits })
}

export function formatQuantity(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return EMPTY_VALUE
  return value.toLocaleString(LOCALE, { maximumFractionDigits: 6 })
}

export function formatSigned(value: number | null | undefined, maxDigits = 2): string {
  if (value == null || !Number.isFinite(value)) return EMPTY_VALUE
  const text = Math.abs(value).toLocaleString(LOCALE, {
    minimumFractionDigits: 2,
    maximumFractionDigits: maxDigits,
  })
  return `${value >= 0 ? '+' : '-'}${text}`
}

export function pnlTone(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'text-slate-500'
  return value >= 0 ? 'text-emerald-400' : 'text-rose-400'
}

export function sideTone(side: 'buy' | 'sell'): string {
  return side === 'buy' ? 'text-emerald-400' : 'text-rose-400'
}

export function formatTime(iso: string | null | undefined, locale: string): string {
  if (!iso) return EMPTY_VALUE
  return new Date(iso).toLocaleString(locale, {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatChangePercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return EMPTY_VALUE
  const text = Math.abs(value).toLocaleString(LOCALE, {
    minimumFractionDigits: DEMO_CHANGE_DECIMALS,
    maximumFractionDigits: DEMO_CHANGE_DECIMALS,
  })
  return `${value >= 0 ? '+' : '-'}${text}%`
}
