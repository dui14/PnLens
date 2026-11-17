import { describe, expect, it } from 'vitest'
import {
  buildSettingsHref,
  findModelEntry,
  getProviderGate,
  isModelAllowed,
  isSelectionUsable,
  modelSupportsEffort,
  parseStoredSelection,
  pickDefaultSelection,
  resolveEffort,
} from '@/lib/ai/modelGating'
import { AI_MODEL_CATALOG, AI_PROVIDERS } from '@/lib/ai/providerConfig'
import type { AiProviderSummary } from '@/lib/types'

const none: AiProviderSummary = { provider: 'openrouter', hasKey: false, keyHint: null, status: 'active', lastErrorCode: null }
const gemini: AiProviderSummary = { provider: 'gemini', hasKey: true, keyHint: 'abc...xyz', status: 'active', lastErrorCode: null }
const anthropic: AiProviderSummary = { provider: 'anthropic', hasKey: true, keyHint: 'sk-...wxy', status: 'active', lastErrorCode: null }

describe('model catalog', () => {
  it('covers the five providers with the fixed model lists', () => {
    expect(AI_PROVIDERS).toEqual(['openrouter', 'gemini', 'openai', 'anthropic', 'xai'])
    expect(AI_MODEL_CATALOG.openrouter.map((m) => m.id)).toEqual([
      'nvidia/nemotron-3.5-super-vl:free',
      'google/gemma-4-26b-a4b-it:free',
      'z-ai/glm-5.3-flash',
      'deepseek/deepseek-v4.1-flash-1017',
      'xiaomi/mimo-v2.6-flash',
      'moonshotai/kimi-k3.1-pro',
    ])
    expect(AI_MODEL_CATALOG.gemini).toHaveLength(5)
    expect(AI_MODEL_CATALOG.openai).toHaveLength(5)
    expect(AI_MODEL_CATALOG.anthropic.map((m) => m.id)).toEqual([
      'claude-fable-5-2',
      'claude-opus-5-5',
      'claude-sonnet-5-5',
      'claude-haiku-5-5',
    ])
    expect(AI_MODEL_CATALOG.xai).toHaveLength(4)
  })

  it('exposes display labels', () => {
    expect(findModelEntry('anthropic', 'claude-opus-5-5')?.label).toBe('Claude Opus 5.5')
    expect(findModelEntry('openai', 'gpt-6.1-sol')?.label).toBe('GPT-6.1 Sol')
    expect(findModelEntry('xai', 'grok-4.7')?.label).toBe('Grok 4.7')
  })

  it('rejects models outside the provider catalog', () => {
    expect(isModelAllowed('anthropic', 'claude-opus-5-5')).toBe(true)
    expect(isModelAllowed('anthropic', 'gpt-6-astra')).toBe(false)
    expect(isModelAllowed('openrouter', 'made-up/model')).toBe(false)
  })
})

describe('model gating', () => {
  it('classifies provider state', () => {
    expect(getProviderGate(undefined)).toBe('key_missing')
    expect(getProviderGate(none)).toBe('key_missing')
    expect(getProviderGate(gemini)).toBe('ready')
  })

  it('accepts only selections backed by a key and a catalog model', () => {
    const all = [none, gemini]
    expect(isSelectionUsable(all, null)).toBe(false)
    expect(isSelectionUsable(all, { provider: 'openrouter', model: 'z-ai/glm-5.3-flash', effort: 'medium' })).toBe(false)
    expect(isSelectionUsable(all, { provider: 'gemini', model: 'nope', effort: 'medium' })).toBe(false)
    expect(isSelectionUsable(all, { provider: 'gemini', model: 'gemini-4-carbon', effort: 'medium' })).toBe(true)
  })

  it('picks the first catalog model of the first keyed provider', () => {
    expect(pickDefaultSelection([none])).toBeNull()
    expect(pickDefaultSelection([none, anthropic])).toEqual({
      provider: 'anthropic',
      model: 'claude-fable-5-2',
      effort: 'medium',
    })
  })

  it('builds deep links', () => {
    expect(buildSettingsHref('/settings', 'ai', 'xai')).toBe('/settings?section=ai&provider=xai')
  })

  it('restores a stored selection only when valid', () => {
    expect(parseStoredSelection(null)).toBeNull()
    expect(parseStoredSelection('{bad')).toBeNull()
    expect(parseStoredSelection(JSON.stringify({ provider: 'openai', model: 'nope', effort: 'low' }))).toBeNull()
    expect(parseStoredSelection(JSON.stringify({ provider: 'openai', model: 'gpt-6-luna', effort: 'high' }))).toEqual({
      provider: 'openai',
      model: 'gpt-6-luna',
      effort: 'high',
    })
    expect(parseStoredSelection(JSON.stringify({ provider: 'openai', model: 'gpt-6-luna', effort: 'max' }))).toMatchObject({
      effort: 'medium',
    })
  })
})

describe('effort support', () => {
  it('flags effort per model', () => {
    expect(modelSupportsEffort('openai', 'gpt-6-astra')).toBe(true)
    expect(modelSupportsEffort('openrouter', 'google/gemma-4-26b-a4b-it:free')).toBe(false)
    expect(modelSupportsEffort('anthropic', 'claude-opus-5-5')).toBe(false)
    expect(modelSupportsEffort('xai', 'grok-4.7')).toBe(false)
  })

  it('defaults to medium and drops effort for unsupported models', () => {
    expect(resolveEffort('openai', 'gpt-6-astra', undefined)).toBe('medium')
    expect(resolveEffort('openai', 'gpt-6-astra', 'low')).toBe('low')
    expect(resolveEffort('anthropic', 'claude-opus-5-5', 'high')).toBeNull()
  })
})
