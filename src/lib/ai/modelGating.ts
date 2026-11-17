import type { AiEffort, AiModelEntry, AiProvider, AiProviderSummary } from '@/lib/types'
import {
  AI_DEFAULT_EFFORT,
  AI_EFFORT_LEVELS,
  AI_MODEL_CATALOG,
  AI_PROVIDERS,
} from '@/lib/ai/providerConfig'

export type ProviderGate = 'key_missing' | 'ready'

export type ChatSelection = {
  provider: AiProvider
  model: string
  effort: AiEffort
}

export function getProviderGate(summary: AiProviderSummary | undefined): ProviderGate {
  return summary?.hasKey ? 'ready' : 'key_missing'
}

export function findModelEntry(provider: AiProvider, model: string): AiModelEntry | null {
  return AI_MODEL_CATALOG[provider]?.find((entry) => entry.id === model) ?? null
}

export function isModelAllowed(provider: AiProvider, model: string): boolean {
  return findModelEntry(provider, model) !== null
}

export function modelSupportsEffort(provider: AiProvider, model: string): boolean {
  return findModelEntry(provider, model)?.supportsEffort ?? false
}

export function resolveEffort(
  provider: AiProvider,
  model: string,
  requested: AiEffort | null | undefined
): AiEffort | null {
  if (!modelSupportsEffort(provider, model)) return null
  return requested ?? AI_DEFAULT_EFFORT
}

export function isSelectionUsable(
  summaries: AiProviderSummary[],
  selection: ChatSelection | null
): boolean {
  if (!selection) return false
  const summary = summaries.find((item) => item.provider === selection.provider)
  if (getProviderGate(summary) !== 'ready') return false
  return isModelAllowed(selection.provider, selection.model)
}

export function pickDefaultSelection(summaries: AiProviderSummary[]): ChatSelection | null {
  for (const summary of summaries) {
    if (getProviderGate(summary) === 'ready') {
      const first = AI_MODEL_CATALOG[summary.provider][0]
      if (first) {
        return { provider: summary.provider, model: first.id, effort: AI_DEFAULT_EFFORT }
      }
    }
  }
  return null
}

export function buildSettingsHref(path: string, section: string, provider: AiProvider): string {
  const params = new URLSearchParams({ section, provider })
  return `${path}?${params.toString()}`
}

export function parseStoredSelection(raw: string | null): ChatSelection | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<ChatSelection> | null
    if (!parsed || typeof parsed !== 'object') return null
    const provider = (AI_PROVIDERS as readonly string[]).includes(parsed.provider as string)
      ? (parsed.provider as AiProvider)
      : null
    if (!provider || typeof parsed.model !== 'string' || !isModelAllowed(provider, parsed.model)) {
      return null
    }
    const effort = (AI_EFFORT_LEVELS as readonly string[]).includes(parsed.effort as string)
      ? (parsed.effort as AiEffort)
      : AI_DEFAULT_EFFORT
    return { provider, model: parsed.model, effort }
  } catch {
    return null
  }
}
