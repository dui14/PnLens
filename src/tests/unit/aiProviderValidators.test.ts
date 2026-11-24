import { describe, expect, it } from 'vitest'
import { AiProviderParamSchema, SaveAiProviderKeySchema } from '@/lib/validators/aiProvider'
import { ChatMessageSchema } from '@/lib/validators/ai'
import { AI_API_KEY_MAX_LENGTH } from '@/lib/ai/providerConfig'

describe('ai provider validators', () => {
  it('accepts only known providers', () => {
    for (const provider of ['openrouter', 'gemini', 'openai', 'anthropic', 'xai']) {
      expect(AiProviderParamSchema.safeParse(provider).success).toBe(true)
    }
    expect(AiProviderParamSchema.safeParse('mistral').success).toBe(false)
  })

  it('caps and sanitizes api keys', () => {
    expect(SaveAiProviderKeySchema.safeParse({ apiKey: 'a'.repeat(AI_API_KEY_MAX_LENGTH + 1) }).success).toBe(false)
    expect(SaveAiProviderKeySchema.safeParse({ apiKey: 'short' }).success).toBe(false)
    expect(SaveAiProviderKeySchema.safeParse({ apiKey: 'has space inside key' }).success).toBe(false)
    expect(SaveAiProviderKeySchema.safeParse({ apiKey: '  sk-or-valid-key-123  ' })).toMatchObject({
      success: true,
      data: { apiKey: 'sk-or-valid-key-123' },
    })
  })

  it('requires provider and model on chat requests', () => {
    const base = { message: 'hi' }
    expect(ChatMessageSchema.safeParse(base).success).toBe(false)
    expect(ChatMessageSchema.safeParse({ ...base, provider: 'gemini' }).success).toBe(false)
    expect(ChatMessageSchema.safeParse({ ...base, provider: 'gemini', model: 'm' }).success).toBe(true)
    expect(ChatMessageSchema.safeParse({ ...base, provider: 'x', model: 'm' }).success).toBe(false)
  })

  it('accepts an optional effort limited to low, medium, high', () => {
    const base = { message: 'hi', provider: 'openai', model: 'gpt-6-astra' }
    expect(ChatMessageSchema.safeParse(base).success).toBe(true)
    for (const effort of ['low', 'medium', 'high']) {
      expect(ChatMessageSchema.safeParse({ ...base, effort }).success).toBe(true)
    }
    expect(ChatMessageSchema.safeParse({ ...base, effort: 'max' }).success).toBe(false)
  })
})
