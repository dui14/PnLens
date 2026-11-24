'use client'

import { createContext, useCallback, useContext, useMemo } from 'react'
import { getDictionaryFor } from './index'
import { INTL_LOCALES, LOCALE_COOKIE_MAX_AGE_SECONDS, LOCALE_COOKIE_NAME } from './locales'
import type { Dictionary } from './index'
import type { Locale } from './locales'

type I18nValue = {
  locale: Locale
  intlLocale: string
  t: Dictionary
}

const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale
  children: React.ReactNode
}): React.JSX.Element {
  const value = useMemo<I18nValue>(
    () => ({ locale, intlLocale: INTL_LOCALES[locale], t: getDictionaryFor(locale) }),
    [locale]
  )
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useT(): I18nValue {
  const value = useContext(I18nContext)
  if (!value) throw new Error('useT must be used inside I18nProvider')
  return value
}

export function useSetLocale(): (locale: Locale) => void {
  return useCallback((locale: Locale) => {
    document.cookie = `${LOCALE_COOKIE_NAME}=${locale}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE_SECONDS}; samesite=lax`
  }, [])
}
