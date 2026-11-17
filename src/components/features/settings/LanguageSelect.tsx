'use client'

import { useRouter } from 'next/navigation'
import { useSetLocale, useT } from '@/lib/i18n/client'
import { LOCALE_LABELS, SUPPORTED_LOCALES, isLocale } from '@/lib/i18n/locales'

export function LanguageSelect(): React.JSX.Element {
  const { t, locale } = useT()
  const router = useRouter()
  const setLocale = useSetLocale()

  const handleChange = (event: React.ChangeEvent<HTMLSelectElement>): void => {
    const next = event.target.value
    if (!isLocale(next)) return
    setLocale(next)
    router.refresh()
  }

  return (
    <div className="space-y-2">
      <label
        htmlFor="language-select"
        className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2"
      >
        {t.settings.language}
      </label>
      <select
        id="language-select"
        value={locale}
        onChange={handleChange}
        className="w-full md:w-1/2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-primary focus:border-primary transition-all p-3 outline-none"
      >
        {SUPPORTED_LOCALES.map((option) => (
          <option key={option} value={option}>
            {LOCALE_LABELS[option]}
          </option>
        ))}
      </select>
    </div>
  )
}
