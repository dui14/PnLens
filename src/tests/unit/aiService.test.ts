import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

type LoopOutcome =
  | { success: true; data: { content: string; tokensUsed: number } }
  | { success: false; error: string }
  | 'throw'

type CredentialOutcome = { success: true; data: unknown } | { success: false; error: string }

const state = vi.hoisted(() => ({
  messages: [] as unknown[][],
  conversations: [] as unknown[][],
  failures: [] as unknown[][],
  successes: [] as unknown[][],
  credentials: null as unknown,
  loop: null as unknown,
}))

vi.mock('@/lib/db/chatDb', () => ({
  createConversation: vi.fn(async (...args: unknown[]) => {
    state.conversations.push(args)
    return { id: 'conv-1', user_id: 'user-1', title: 't', created_at: '', updated_at: '' }
  }),
  getConversations: vi.fn(async () => []),
  getConversationById: vi.fn(async () => null),
  getConversationMessages: vi.fn(async () => []),
  createChatMessage: vi.fn(async (...args: unknown[]) => {
    state.messages.push(args)
    return { id: `msg-${state.messages.length}` }
  }),
  updateConversationTitle: vi.fn(async () => undefined),
  deleteConversation: vi.fn(async () => true),
  renameConversation: vi.fn(async (_s: unknown, id: string) => id === 'conv-1'),
}))

vi.mock('@/lib/services/aiProviderService', () => ({
  resolveChatCredentials: vi.fn(async () => state.credentials),
  recordProviderFailure: vi.fn(async (...args: unknown[]) => {
    state.failures.push(args)
  }),
  recordProviderSuccess: vi.fn(async (...args: unknown[]) => {
    state.successes.push(args)
  }),
}))

vi.mock('@/lib/agent-loop', () => ({
  runAgentLoop: vi.fn(
    async (_m: unknown, _h: unknown, _u: unknown, onEvent: (e: unknown) => void) => {
      const loop = state.loop as LoopOutcome
      if (loop === 'throw') throw new Error('fetch failed')
      if (!loop.success) {
        onEvent({ type: 'error', payload: { message: loop.error } })
      }
      return loop
    }
  ),
}))

import { startOrContinueChat } from '@/lib/services/aiService'

const supabase = {} as SupabaseClient
const okCredentials: CredentialOutcome = {
  success: true,
  data: { provider: 'openrouter', apiKey: 'k', model: 'm', effort: null },
}

type Captured = { type: string; payload: Record<string, unknown> }

async function run(): Promise<{
  result: Awaited<ReturnType<typeof startOrContinueChat>>
  events: Captured[]
}> {
  const events: Captured[] = []
  const result = await startOrContinueChat(
    supabase,
    'user-1',
    'hello',
    null,
    'openrouter',
    'm',
    undefined,
    (event) => events.push(event as Captured)
  )
  return { result, events }
}

describe('aiService failed turns', () => {
  beforeEach(() => {
    state.messages = []
    state.conversations = []
    state.failures = []
    state.successes = []
    state.credentials = okCredentials
    state.loop = { success: false, error: 'AI_REQUEST_FAILED:401:nope' }
  })

  it('stores the user message and an error row, and flags the key', async () => {
    const { result, events } = await run()

    expect(result).toEqual({ success: false, error: 'AI_KEY_INVALID' })
    expect(state.conversations).toHaveLength(1)
    expect(state.messages).toHaveLength(2)
    expect(state.messages[0].slice(1, 4)).toEqual(['conv-1', 'user', 'hello'])
    expect(state.messages[1]).toEqual([
      supabase,
      'conv-1',
      'assistant',
      'AI_KEY_INVALID',
      undefined,
      null,
      'AI_KEY_INVALID',
    ])
    expect(state.failures).toEqual([[supabase, 'user-1', 'openrouter', 'AI_KEY_INVALID']])
    expect(state.successes).toHaveLength(0)

    const errors = events.filter((event) => event.type === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0].payload).toMatchObject({
      message: 'AI_KEY_INVALID',
      conversationId: 'conv-1',
    })
    expect(JSON.stringify(events)).not.toContain('nope')
  })

  it('persists the thread even when credentials cannot be resolved', async () => {
    state.credentials = { success: false, error: 'AI_PROVIDER_KEY_MISSING' }

    const { result, events } = await run()

    expect(result).toEqual({ success: false, error: 'AI_PROVIDER_KEY_MISSING' })
    expect(state.messages).toHaveLength(2)
    expect(state.messages[1][6]).toBe('AI_PROVIDER_KEY_MISSING')
    expect(events[events.length - 1].payload).toMatchObject({ conversationId: 'conv-1' })
  })

  it('classifies a thrown network failure as provider unavailable', async () => {
    state.loop = 'throw'

    const { result } = await run()

    expect(result).toEqual({ success: false, error: 'AI_PROVIDER_UNAVAILABLE' })
    expect(state.messages[1][6]).toBe('AI_PROVIDER_UNAVAILABLE')
  })

  it('marks the key active again after a successful reply', async () => {
    state.loop = { success: true, data: { content: 'hi', tokensUsed: 3 } }

    const { result } = await run()

    expect(result).toEqual({ success: true, data: { conversationId: 'conv-1' } })
    expect(state.successes).toEqual([[supabase, 'user-1', 'openrouter']])
    expect(state.failures).toHaveLength(0)
    expect(state.messages[1][6]).toBeUndefined()
  })
})
