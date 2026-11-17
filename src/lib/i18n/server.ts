import { cookies } from 'next/headers'
import { getDictionaryFor } from './index'
import { LOCALE_COOKIE_NAME, resolveLocale } from './locales'
import type { Dictionary } from './index'
import type { Locale } from './locales'

export async function getLocale(): Promise<Locale> {
  const store = await cookies()
  return resolveLocale(store.get(LOCALE_COOKIE_NAME)?.value)
}

export async function getServerDictionary(): Promise<{ locale: Locale; t: Dictionary }> {
  const locale = await getLocale()
  return { locale, t: getDictionaryFor(locale) }
}
