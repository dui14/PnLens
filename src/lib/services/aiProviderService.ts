import type { SupabaseClient } from '@supabase/supabase-js'
import type { AiChatTarget, AiEffort, AiProvider, AiProviderSummary, Result } from '@/lib/types'
import { decrypt, encrypt } from '@/lib/adapters/encryption'
import { checkAiProviderKey } from '@/lib/adapters/aiKeyValidation'
import {
  AI_KEY_HINT_PREFIX_LENGTH,
  AI_KEY_HINT_SEPARATOR,
  AI_KEY_HINT_SUFFIX_LENGTH,
  AI_PROVIDERS,
} from '@/lib/ai/providerConfig'
import { keyStatusForError, type AiChatErrorCode } from '@/lib/ai/chatErrors'
import { isModelAllowed, resolveEffort } from '@/lib/ai/modelGating'
import {
  deleteAiProvider,
  getAiProviderSecret,
  listAiProviderSummaries,
  markAiProviderActive,
  markAiProviderFailed,
  upsertAiProviderKey,
} from '@/lib/db/aiProviderDb'

export function buildKeyHint(apiKey: string): string {
  return `${apiKey.slice(0, AI_KEY_HINT_PREFIX_LENGTH)}${AI_KEY_HINT_SEPARATOR}${apiKey.slice(-AI_KEY_HINT_SUFFIX_LENGTH)}`
}

export async function listAiProviders(
  supabase: SupabaseClient,
  userId: string
): Promise<Result<AiProviderSummary[]>> {
  const stored = await listAiProviderSummaries(supabase, userId)
  if (!stored) return { success: false, error: 'INTERNAL_ERROR' }

  const summaries = AI_PROVIDERS.map<AiProviderSummary>(
    (provider) =>
      stored.find((item) => item.provider === provider) ?? {
        provider,
        hasKey: false,
        keyHint: null,
        status: 'active',
        lastErrorCode: null,
      }
  )
  return { success: true, data: summaries }
}

export async function saveAiProviderKey(
  supabase: SupabaseClient,
  userId: string,
  provider: AiProvider,
  apiKey: string
): Promise<Result<null>> {
  const check = await checkAiProviderKey(provider, apiKey)
  if (check === 'invalid') return { success: false, error: 'AI_KEY_INVALID' }
  if (check === 'unreachable') return { success: false, error: 'AI_KEY_CHECK_FAILED' }

  let encrypted: { encrypted: string; iv: string }
  try {
    encrypted = encrypt(apiKey)
  } catch {
    return { success: false, error: 'INTERNAL_ERROR' }
  }

  const saved = await upsertAiProviderKey(
    supabase,
    userId,
    provider,
    encrypted.encrypted,
    encrypted.iv,
    buildKeyHint(apiKey)
  )
  if (!saved) return { success: false, error: 'INTERNAL_ERROR' }
  return { success: true, data: null }
}

export async function removeAiProvider(
  supabase: SupabaseClient,
  userId: string,
  provider: AiProvider
): Promise<Result<null>> {
  const deleted = await deleteAiProvider(supabase, userId, provider)
  if (!deleted) return { success: false, error: 'INTERNAL_ERROR' }
  return { success: true, data: null }
}

export async function resolveChatCredentials(
  supabase: SupabaseClient,
  userId: string,
  provider: AiProvider,
  model: string,
  effort?: AiEffort | null
): Promise<Result<AiChatTarget>> {
  if (!isModelAllowed(provider, model)) return { success: false, error: 'AI_MODEL_NOT_ALLOWED' }

  const row = await getAiProviderSecret(supabase, userId, provider)
  if (row === 'ERROR') return { success: false, error: 'INTERNAL_ERROR' }
  if (!row) return { success: false, error: 'AI_PROVIDER_KEY_MISSING' }

  try {
    const apiKey = decrypt(row.keyEncrypted, row.keyIv)
    return {
      success: true,
      data: { provider, apiKey, model, effort: resolveEffort(provider, model, effort) },
    }
  } catch {
    return { success: false, error: 'AI_PROVIDER_KEY_MISSING' }
  }
}

export async function recordProviderFailure(
  supabase: SupabaseClient,
  userId: string,
  provider: AiProvider,
  code: AiChatErrorCode
): Promise<void> {
  const status = keyStatusForError(code)
  if (!status) return
  await markAiProviderFailed(supabase, userId, provider, status, code)
}

export async function recordProviderSuccess(
  supabase: SupabaseClient,
  userId: string,
  provider: AiProvider
): Promise<void> {
  await markAiProviderActive(supabase, userId, provider)
}
