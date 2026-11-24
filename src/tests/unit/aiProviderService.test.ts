import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const dbState = vi.hoisted(() => ({
  row: null as null | { provider: string; keyEncrypted: string; keyIv: string },
  upserts: [] as unknown[][],
}))

const keyCheck = vi.hoisted(() => ({ result: 'valid' as 'valid' | 'invalid' | 'unreachable' }))

vi.mock('@/lib/db/aiProviderDb', () => ({
  listAiProviderSummaries: vi.fn(async () => [{ provider: 'gemini', hasKey: true, keyHint: 'abc...xyz', status: 'active', lastErrorCode: null }]),
  getAiProviderSecret: vi.fn(async () => dbState.row),
  upsertAiProviderKey: vi.fn(async (...args: unknown[]) => {
    dbState.upserts.push(args)
    return true
  }),
  deleteAiProvider: vi.fn(async () => true),
}))

vi.mock('@/lib/adapters/aiKeyValidation', () => ({
  checkAiProviderKey: vi.fn(async () => keyCheck.result),
}))

import {
  buildKeyHint,
  listAiProviders,
  resolveChatCredentials,
  saveAiProviderKey,
} from '@/lib/services/aiProviderService'
import { encrypt } from '@/lib/adapters/encryption'

const supabase = {} as SupabaseClient
const userId = 'user-1'
const rawKey = 'sk-test-secret-key-9999'

describe('aiProviderService', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_MASTER_KEY = Buffer.alloc(32, 7).toString('base64')
    dbState.row = null
    dbState.upserts = []
    keyCheck.result = 'valid'
  })

  it('builds a hint from the first and last three characters only', () => {
    expect(buildKeyHint('abcdefghij')).toBe('abc...hij')
    expect(buildKeyHint(rawKey)).toBe('sk-...999')
    expect(buildKeyHint(rawKey)).not.toContain('secret')
  })

  it('lists every provider including unconfigured ones without secrets', async () => {
    const result = await listAiProviders(supabase, userId)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.map((item) => item.provider)).toEqual([
      'openrouter',
      'gemini',
      'openai',
      'anthropic',
      'xai',
    ])
    expect(result.data[0]).toEqual({ provider: 'openrouter', hasKey: false, keyHint: null, status: 'active', lastErrorCode: null })
    expect(result.data[1]).toEqual({ provider: 'gemini', hasKey: true, keyHint: 'abc...xyz', status: 'active', lastErrorCode: null })
    expect(JSON.stringify(result.data)).not.toContain('Encrypted')
  })

  it('rejects keys the provider refuses and does not store them', async () => {
    keyCheck.result = 'invalid'
    expect(await saveAiProviderKey(supabase, userId, 'gemini', rawKey)).toEqual({
      success: false,
      error: 'AI_KEY_INVALID',
    })
    keyCheck.result = 'unreachable'
    expect(await saveAiProviderKey(supabase, userId, 'gemini', rawKey)).toEqual({
      success: false,
      error: 'AI_KEY_CHECK_FAILED',
    })
    expect(dbState.upserts).toHaveLength(0)
  })

  it('stores the key encrypted with a prefix and suffix hint', async () => {
    const result = await saveAiProviderKey(supabase, userId, 'anthropic', rawKey)
    expect(result.success).toBe(true)
    const args = dbState.upserts[0]
    expect(args[3]).not.toContain(rawKey)
    expect(args[5]).toBe('sk-...999')
  })

  it('rejects a model outside the catalog before touching the key store', async () => {
    expect(await resolveChatCredentials(supabase, userId, 'gemini', 'other')).toEqual({
      success: false,
      error: 'AI_MODEL_NOT_ALLOWED',
    })
    expect(await resolveChatCredentials(supabase, userId, 'anthropic', 'gpt-6-astra')).toEqual({
      success: false,
      error: 'AI_MODEL_NOT_ALLOWED',
    })
  })

  it('requires a stored key for a catalog model', async () => {
    expect(await resolveChatCredentials(supabase, userId, 'gemini', 'gemini-4-carbon')).toEqual({
      success: false,
      error: 'AI_PROVIDER_KEY_MISSING',
    })
  })

  it('resolves credentials with a decrypted key and the effective effort', async () => {
    const enc = encrypt(rawKey)
    dbState.row = { provider: 'openai', keyEncrypted: enc.encrypted, keyIv: enc.iv }

    expect(await resolveChatCredentials(supabase, userId, 'openai', 'gpt-6-astra')).toEqual({
      success: true,
      data: { provider: 'openai', apiKey: rawKey, model: 'gpt-6-astra', effort: 'medium' },
    })
    expect(await resolveChatCredentials(supabase, userId, 'openai', 'gpt-6-astra', 'high')).toMatchObject({
      success: true,
      data: { effort: 'high' },
    })

    dbState.row = { provider: 'anthropic', keyEncrypted: enc.encrypted, keyIv: enc.iv }
    expect(await resolveChatCredentials(supabase, userId, 'anthropic', 'claude-opus-5-5', 'high')).toMatchObject({
      success: true,
      data: { effort: null },
    })
  })
})
