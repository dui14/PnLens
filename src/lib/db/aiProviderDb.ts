import type { SupabaseClient } from '@supabase/supabase-js'
import type { AiProvider, AiProviderStatus, AiProviderSummary } from '@/lib/types'

const TABLE = 'user_ai_providers'
const SUMMARY_COLUMNS = 'provider, key_hint, status, last_error_code'
const ACTIVE_STATUS: AiProviderStatus = 'active'
const SECRET_COLUMNS = 'provider, key_encrypted, key_iv'

export type AiProviderSecretRow = {
  provider: AiProvider
  keyEncrypted: string
  keyIv: string
}

type SummaryRow = {
  provider: AiProvider
  key_hint: string | null
  status: AiProviderStatus | null
  last_error_code: string | null
}

type SecretRow = {
  provider: AiProvider
  key_encrypted: string
  key_iv: string
}

export async function listAiProviderSummaries(
  supabase: SupabaseClient,
  userId: string
): Promise<AiProviderSummary[] | null> {
  const { data, error } = await supabase.from(TABLE).select(SUMMARY_COLUMNS).eq('user_id', userId)
  if (error) return null
  return ((data ?? []) as SummaryRow[]).map((row) => ({
    provider: row.provider,
    hasKey: true,
    keyHint: row.key_hint,
    status: row.status ?? ACTIVE_STATUS,
    lastErrorCode: row.last_error_code,
  }))
}

export async function getAiProviderSecret(
  supabase: SupabaseClient,
  userId: string,
  provider: AiProvider
): Promise<AiProviderSecretRow | null | 'ERROR'> {
  const { data, error } = await supabase
    .from(TABLE)
    .select(SECRET_COLUMNS)
    .eq('user_id', userId)
    .eq('provider', provider)
    .maybeSingle()
  if (error) return 'ERROR'
  if (!data) return null
  const row = data as SecretRow
  return {
    provider: row.provider,
    keyEncrypted: row.key_encrypted,
    keyIv: row.key_iv,
  }
}

export async function upsertAiProviderKey(
  supabase: SupabaseClient,
  userId: string,
  provider: AiProvider,
  keyEncrypted: string,
  keyIv: string,
  keyHint: string
): Promise<boolean> {
  const { error } = await supabase.from(TABLE).upsert(
    {
      user_id: userId,
      provider,
      key_encrypted: keyEncrypted,
      key_iv: keyIv,
      key_hint: keyHint,
      status: ACTIVE_STATUS,
      last_error_code: null,
      last_error_at: null,
      last_checked_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,provider' }
  )
  return !error
}

export async function deleteAiProvider(
  supabase: SupabaseClient,
  userId: string,
  provider: AiProvider
): Promise<boolean> {
  const { error } = await supabase.from(TABLE).delete().eq('user_id', userId).eq('provider', provider)
  return !error
}

export async function markAiProviderFailed(
  supabase: SupabaseClient,
  userId: string,
  provider: AiProvider,
  status: AiProviderStatus,
  errorCode: string
): Promise<boolean> {
  const now = new Date().toISOString()
  const { error } = await supabase
    .from(TABLE)
    .update({ status, last_error_code: errorCode, last_error_at: now, last_checked_at: now })
    .eq('user_id', userId)
    .eq('provider', provider)
  return !error
}

export async function markAiProviderActive(
  supabase: SupabaseClient,
  userId: string,
  provider: AiProvider
): Promise<boolean> {
  const { error } = await supabase
    .from(TABLE)
    .update({
      status: ACTIVE_STATUS,
      last_error_code: null,
      last_error_at: null,
      last_checked_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('provider', provider)
  return !error
}
