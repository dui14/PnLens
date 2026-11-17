import type { AiChatTarget, AiEffort, AiProvider } from '@/lib/types'
import {
  AI_APP_REFERER_FALLBACK,
  AI_APP_TITLE,
  AI_COMPLETION_TOKENS_PROVIDERS,
  AI_NESTED_REASONING_PROVIDERS,
  AI_NO_TEMPERATURE_PROVIDERS,
  AI_REASONING_EFFORT_PROVIDERS,
  AI_REFERER_PROVIDERS,
} from '@/lib/ai/providerConfig'

export function buildEffortFields(
  provider: AiProvider,
  effort: AiEffort | null
): Record<string, unknown> {
  if (!effort) return {}
  if (AI_REASONING_EFFORT_PROVIDERS.includes(provider)) return { reasoning_effort: effort }
  if (AI_NESTED_REASONING_PROVIDERS.includes(provider)) return { reasoning: { effort } }
  return {}
}

export function buildChatHeaders(provider: AiProvider, apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    ...(AI_REFERER_PROVIDERS.includes(provider)
      ? {
          'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? AI_APP_REFERER_FALLBACK,
          'X-Title': AI_APP_TITLE,
        }
      : {}),
  }
}

export function buildChatBodyFields(
  target: AiChatTarget,
  temperature: number,
  maxTokens: number
): Record<string, unknown> {
  const { provider, model, effort } = target
  return {
    model,
    [AI_COMPLETION_TOKENS_PROVIDERS.includes(provider) ? 'max_completion_tokens' : 'max_tokens']: maxTokens,
    ...(AI_NO_TEMPERATURE_PROVIDERS.includes(provider) ? {} : { temperature }),
    ...buildEffortFields(provider, effort),
  }
}
