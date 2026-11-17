'use client'

import { useT } from '@/lib/i18n/client'
import { AI_EFFORT_LEVELS } from '@/lib/ai/providerConfig'
import type { AiEffort } from '@/lib/types'

type AiEffortControlProps = {
  value: AiEffort
  disabled: boolean
  onChange: (effort: AiEffort) => void
}

export function AiEffortControl({ value, disabled, onChange }: AiEffortControlProps): React.JSX.Element {
  const { t } = useT()
  const c = t.aiProviders.chat
  const labels: Record<AiEffort, string> = {
    low: c.effortLow,
    medium: c.effortMedium,
    high: c.effortHigh,
  }

  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      <span className="text-xs font-semibold text-slate-400">{c.effortLabel}</span>
      <div role="radiogroup" aria-label={c.effortLabel} className="flex rounded-lg border border-neutral-border p-0.5">
        {AI_EFFORT_LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={value === level}
            disabled={disabled}
            onClick={() => onChange(level)}
            className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors disabled:opacity-60 ${
              value === level ? 'bg-primary text-white' : 'text-slate-300 hover:bg-primary/10'
            }`}
          >
            {labels[level]}
          </button>
        ))}
      </div>
    </div>
  )
}
