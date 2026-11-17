'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useT } from '@/lib/i18n/client'
import { fillTemplate } from '@/lib/i18n/format'
import {
  AI_DEFAULT_EFFORT,
  AI_MODEL_CATALOG,
  AI_PROVIDERS,
  AI_PROVIDER_KEY_GUIDE_URLS,
  AI_PROVIDER_LABELS,
  AI_SETTINGS_PATH,
  AI_SETTINGS_SECTION,
} from '@/lib/ai/providerConfig'
import {
  buildSettingsHref,
  findModelEntry,
  getProviderGate,
  modelSupportsEffort,
  type ChatSelection,
} from '@/lib/ai/modelGating'
import { AiEffortControl } from './AiEffortControl'
import { AiKeyStatusBadge } from './AiKeyStatusBadge'
import type { AiProvider, AiProviderSummary } from '@/lib/types'

type AiModelPickerProps = {
  summaries: AiProviderSummary[] | null
  selection: ChatSelection | null
  disabled: boolean
  onSelect: (selection: ChatSelection) => void
}

export function AiModelPicker({
  summaries,
  selection,
  disabled,
  onSelect,
}: AiModelPickerProps): React.JSX.Element {
  const { t } = useT()
  const c = t.aiProviders.chat
  const [open, setOpen] = useState(false)
  const [browsing, setBrowsing] = useState<AiProvider | null>(null)

  if (!summaries) {
    return <span className="text-xs text-slate-500">{c.loadingProviders}</span>
  }

  const expanded = open || !selection
  const activeProvider: AiProvider = browsing ?? selection?.provider ?? AI_PROVIDERS[0]
  const activeSummary = summaries.find((item) => item.provider === activeProvider)
  const activeGate = getProviderGate(activeSummary)
  const selectedLabel = selection ? findModelEntry(selection.provider, selection.model)?.label : null

  return (
    <div className="w-full rounded-xl border border-neutral-border bg-background-dark/60">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={expanded}
        className="w-full flex items-center justify-between gap-3 px-3.5 py-2.5 text-left"
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className="material-symbols-outlined text-primary text-lg">neurology</span>
          <span className="text-sm font-semibold text-slate-200">{c.modelsTitle}</span>
          {selectedLabel && selection && (
            <span className="truncate rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-bold text-primary">
              {AI_PROVIDER_LABELS[selection.provider]} · {selectedLabel}
            </span>
          )}
        </span>
        <span className="material-symbols-outlined text-slate-400 text-lg">
          {expanded ? 'expand_less' : 'expand_more'}
        </span>
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-neutral-border px-3.5 py-3">
          <div role="tablist" aria-label={c.providerRow} className="flex flex-wrap gap-2">
            {AI_PROVIDERS.map((provider) => {
              const tabSummary = summaries.find((item) => item.provider === provider)
              const gate = getProviderGate(tabSummary)
              const isActive = provider === activeProvider
              return (
                <button
                  key={provider}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  disabled={disabled}
                  onClick={() => setBrowsing(provider)}
                  className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60 ${
                    isActive
                      ? 'border-primary bg-primary/15 text-primary'
                      : 'border-neutral-border text-slate-300 hover:border-primary/60'
                  }`}
                >
                  {AI_PROVIDER_LABELS[provider]}
                  {gate === 'ready' &&
                    (tabSummary?.status === 'active' ? (
                      <span className="material-symbols-outlined text-sm text-emerald-400">check_circle</span>
                    ) : (
                      <span className="material-symbols-outlined text-sm text-rose-400">warning</span>
                    ))}
                </button>
              )
            })}
          </div>

          {activeGate !== 'ready' ? (
            <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-neutral-border p-4">
              <p className="text-xs text-slate-400">
                {fillTemplate(c.addApiKeyHint, { provider: AI_PROVIDER_LABELS[activeProvider] })}
              </p>
              <Link
                href={buildSettingsHref(AI_SETTINGS_PATH, AI_SETTINGS_SECTION, activeProvider)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-bold text-white hover:bg-primary/90 transition-colors"
              >
                <span className="material-symbols-outlined text-sm">key</span>
                {c.addApiKey}
              </Link>
              <a
                href={AI_PROVIDER_KEY_GUIDE_URLS[activeProvider]}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-semibold text-primary hover:underline"
              >
                {t.aiProviders.getKeyLink}
              </a>
            </div>
          ) : (
            <>
              <AiKeyStatusBadge summary={activeSummary} showReason />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {AI_MODEL_CATALOG[activeProvider].map((entry) => {
                const isSelected =
                  selection?.provider === activeProvider && selection.model === entry.id
                return (
                  <button
                    key={entry.id}
                    type="button"
                    disabled={disabled}
                    onClick={() =>
                      onSelect({
                        provider: activeProvider,
                        model: entry.id,
                        effort: selection?.effort ?? AI_DEFAULT_EFFORT,
                      })
                    }
                    className={`flex items-center justify-between gap-2 rounded-lg border px-3.5 py-2.5 text-left text-sm transition-colors disabled:opacity-60 ${
                      isSelected
                        ? 'border-primary bg-primary/15 text-slate-100'
                        : 'border-neutral-border text-slate-300 hover:border-primary/60'
                    }`}
                  >
                    <span className="font-semibold">{entry.label}</span>
                    {isSelected && (
                      <span className="material-symbols-outlined text-primary text-lg">check_circle</span>
                    )}
                  </button>
                )
              })}
            </div>
            </>
          )}
        </div>
      )}
      {selection && modelSupportsEffort(selection.provider, selection.model) && (
        <div className="border-t border-neutral-border px-3.5 py-2">
          <AiEffortControl
            value={selection.effort}
            disabled={disabled}
            onChange={(effort) => onSelect({ ...selection, effort })}
          />
        </div>
      )}
    </div>
  )
}
