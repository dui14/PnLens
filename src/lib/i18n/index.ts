import { en } from './en'
import { vi } from './vi'
import type { Dictionary } from './en'
import type { Locale } from './locales'

export const DICTIONARIES: Record<Locale, Dictionary> = { en, vi }

export function getDictionaryFor(locale: Locale): Dictionary {
  return DICTIONARIES[locale]
}

export type { Dictionary }
