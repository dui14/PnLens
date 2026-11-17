'use client'

import { useT } from '@/lib/i18n/client'
import { PNL_PERIODS, type PnlPeriod } from '@/lib/types'

type PeriodSwitchProps = {
  value: PnlPeriod
  onChange: (period: PnlPeriod) => void
  variant?: 'compact' | 'full'
}

export function PeriodSwitch({ value, onChange, variant = 'compact' }: PeriodSwitchProps): React.JSX.Element {
  const { t } = useT()
  const s = t.dashboard.periodSwitch
  const labels = variant === 'compact' ? s.short : s.full

  return (
    <div
      role="group"
      aria-label={s.label}
      className="inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg border border-slate-200 dark:border-primary/20 bg-white dark:bg-background-dark p-0.5"
    >
      {PNL_PERIODS.map((period) => (
        <button
          key={period}
          type="button"
          aria-pressed={period === value}
          title={s.full[period]}
          aria-label={s.full[period]}
          onClick={() => onChange(period)}
          className={`h-7 shrink-0 rounded-md px-2 text-[11px] font-bold whitespace-nowrap transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary ${
            period === value
              ? 'bg-primary text-accent'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-primary/10'
          } ${variant === 'full' ? 'sm:px-3 sm:text-xs' : ''}`}
        >
          {labels[period]}
        </button>
      ))}
    </div>
  )
}
