export const SUPPORTED_LOCALES = ['en', 'vi'] as const

export type Locale = (typeof SUPPORTED_LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'en'

export const LOCALE_COOKIE_NAME = 'pnlens_locale'

export const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  vi: 'Tiếng Việt',
}

export const INTL_LOCALES: Record<Locale, string> = {
  en: 'en-US',
  vi: 'vi-VN',
}

export function isLocale(value: string | undefined | null): value is Locale {
  return SUPPORTED_LOCALES.some((locale) => locale === value)
}

export function resolveLocale(value: string | undefined | null): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE
}
