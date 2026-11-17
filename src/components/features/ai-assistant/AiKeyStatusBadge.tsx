'use client'

import { useT } from '@/lib/i18n/client'
import { AI_CHAT_ERROR_FALLBACK } from '@/lib/ai/chatErrors'
import type { AiProviderSummary } from '@/lib/types'

type AiKeyStatusBadgeProps = {
  summary: AiProviderSummary | undefined
  showReason?: boolean
}

export function AiKeyStatusBadge({
  summary,
  showReason = false,
}: AiKeyStatusBadgeProps): React.JSX.Element | null {
  const { t } = useT()
  if (!summary || !summary.hasKey || summary.status === 'active') return null

  const errors = t.aiProviders.errors as Record<string, string>
  const label = t.aiProviders.status[summary.status]
  const reason = errors[summary.lastErrorCode ?? ''] ?? errors[AI_CHAT_ERROR_FALLBACK]

  return (
    <span className="inline-flex flex-col gap-1">
      <span className="inline-flex w-fit items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 text-[11px] font-bold text-rose-400">
        <span className="material-symbols-outlined text-sm">warning</span>
        {label}
      </span>
      {showReason && <span className="text-xs text-rose-400">{reason}</span>}
    </span>
  )
}
