import type { AiProvider } from '@/lib/types'
import {
  AI_ANTHROPIC_VERSION,
  AI_KEY_CHECK_TIMEOUT_MS,
  AI_PROVIDER_KEY_CHECK_URLS,
} from '@/lib/ai/providerConfig'

export type AiKeyCheck = 'valid' | 'invalid' | 'unreachable'

export function buildKeyCheckHeaders(provider: AiProvider, apiKey: string): Record<string, string> {
  if (provider === 'gemini') return { 'x-goog-api-key': apiKey }
  if (provider === 'anthropic') {
    return { 'x-api-key': apiKey, 'anthropic-version': AI_ANTHROPIC_VERSION }
  }
  return { Authorization: `Bearer ${apiKey}` }
}

export async function checkAiProviderKey(provider: AiProvider, apiKey: string): Promise<AiKeyCheck> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), AI_KEY_CHECK_TIMEOUT_MS)
  try {
    const response = await fetch(AI_PROVIDER_KEY_CHECK_URLS[provider], {
      method: 'GET',
      headers: buildKeyCheckHeaders(provider, apiKey),
      signal: controller.signal,
    })
    if (response.ok) return 'valid'
    if (response.status === 400 || response.status === 401 || response.status === 403) return 'invalid'
    return 'unreachable'
  } catch {
    return 'unreachable'
  } finally {
    clearTimeout(timer)
  }
}
