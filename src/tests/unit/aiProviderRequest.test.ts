import { describe, expect, it } from 'vitest'
import { buildChatBodyFields, buildChatHeaders, buildEffortFields } from '@/lib/ai/providerRequest'
import { buildKeyCheckHeaders } from '@/lib/adapters/aiKeyValidation'
import {
  AI_PROVIDER_CHAT_URLS,
  AI_PROVIDER_KEY_CHECK_URLS,
} from '@/lib/ai/providerConfig'

describe('effort mapping per provider', () => {
  it('uses reasoning_effort for openai, xai and gemini', () => {
    for (const provider of ['openai', 'xai', 'gemini'] as const) {
      expect(buildEffortFields(provider, 'high')).toEqual({ reasoning_effort: 'high' })
    }
  })

  it('nests effort under reasoning for openrouter', () => {
    expect(buildEffortFields('openrouter', 'low')).toEqual({ reasoning: { effort: 'low' } })
  })

  it('sends nothing for anthropic or when effort is null', () => {
    expect(buildEffortFields('anthropic', 'high')).toEqual({})
    expect(buildEffortFields('openai', null)).toEqual({})
  })
})

describe('chat request shaping', () => {
  it('keeps temperature and max_tokens for openrouter with nested reasoning', () => {
    expect(
      buildChatBodyFields({ provider: 'openrouter', apiKey: 'k', model: 'z-ai/glm-5.3-flash', effort: 'medium' }, 0.3, 2048)
    ).toEqual({
      model: 'z-ai/glm-5.3-flash',
      max_tokens: 2048,
      temperature: 0.3,
      reasoning: { effort: 'medium' },
    })
  })

  it('uses max_completion_tokens and no temperature for openai', () => {
    expect(
      buildChatBodyFields({ provider: 'openai', apiKey: 'k', model: 'gpt-6-astra', effort: 'low' }, 0.3, 2048)
    ).toEqual({ model: 'gpt-6-astra', max_completion_tokens: 2048, reasoning_effort: 'low' })
  })

  it('omits temperature and effort for anthropic', () => {
    expect(
      buildChatBodyFields({ provider: 'anthropic', apiKey: 'k', model: 'claude-opus-5-5', effort: null }, 0.3, 2048)
    ).toEqual({ model: 'claude-opus-5-5', max_tokens: 2048 })
  })

  it('adds app headers only for openrouter', () => {
    expect(buildChatHeaders('openrouter', 'k')['X-Title']).toBe('PnLens')
    expect(buildChatHeaders('openai', 'k')).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer k',
    })
  })
})

describe('provider endpoints and key checks', () => {
  it('points each provider at its chat completions url', () => {
    expect(AI_PROVIDER_CHAT_URLS.openai).toBe('https://api.openai.com/v1/chat/completions')
    expect(AI_PROVIDER_CHAT_URLS.xai).toBe('https://api.x.ai/v1/chat/completions')
    expect(AI_PROVIDER_CHAT_URLS.anthropic).toBe('https://api.anthropic.com/v1/chat/completions')
  })

  it('checks keys with a cheap models listing', () => {
    expect(AI_PROVIDER_KEY_CHECK_URLS.openai).toBe('https://api.openai.com/v1/models')
    expect(AI_PROVIDER_KEY_CHECK_URLS.anthropic).toBe('https://api.anthropic.com/v1/models')
    expect(AI_PROVIDER_KEY_CHECK_URLS.xai).toBe('https://api.x.ai/v1/models')
  })

  it('uses provider specific key check headers', () => {
    expect(buildKeyCheckHeaders('anthropic', 'k')).toEqual({
      'x-api-key': 'k',
      'anthropic-version': '2023-06-01',
    })
    expect(buildKeyCheckHeaders('gemini', 'k')).toEqual({ 'x-goog-api-key': 'k' })
    expect(buildKeyCheckHeaders('openai', 'k')).toEqual({ Authorization: 'Bearer k' })
  })
})
