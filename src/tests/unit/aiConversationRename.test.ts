import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@/lib/db/chatDb', () => ({
  createConversation: vi.fn(),
  getConversations: vi.fn(),
  getConversationById: vi.fn(),
  getConversationMessages: vi.fn(),
  createChatMessage: vi.fn(),
  updateConversationTitle: vi.fn(),
  deleteConversation: vi.fn(),
  renameConversation: vi.fn(async (_s: unknown, id: string) => id === 'owned'),
}))

import { RenameConversationSchema } from '@/lib/validators/ai'
import { AI_CONVERSATION_TITLE_MAX_LENGTH } from '@/lib/ai/guardrails'
import { renameConversationTitle } from '@/lib/services/aiService'

const supabase = {} as SupabaseClient

describe('RenameConversationSchema', () => {
  it('trims and accepts titles up to the max length', () => {
    expect(RenameConversationSchema.safeParse({ title: '  Hello  ' })).toMatchObject({
      success: true,
      data: { title: 'Hello' },
    })
    expect(
      RenameConversationSchema.safeParse({ title: 'a'.repeat(AI_CONVERSATION_TITLE_MAX_LENGTH) }).success
    ).toBe(true)
  })

  it('rejects empty, blank, too long and non-string titles', () => {
    expect(RenameConversationSchema.safeParse({ title: '' }).success).toBe(false)
    expect(RenameConversationSchema.safeParse({ title: '   ' }).success).toBe(false)
    expect(
      RenameConversationSchema.safeParse({ title: 'a'.repeat(AI_CONVERSATION_TITLE_MAX_LENGTH + 1) }).success
    ).toBe(false)
    expect(RenameConversationSchema.safeParse({ title: 5 }).success).toBe(false)
  })
})

describe('renameConversationTitle', () => {
  it('returns the new title for an owned conversation', async () => {
    const result = await renameConversationTitle(supabase, 'user-1', 'owned', 'New')
    expect(result).toEqual({ success: true, data: { id: 'owned', title: 'New' } })
  })

  it('returns NOT_FOUND when the conversation is not the users', async () => {
    const result = await renameConversationTitle(supabase, 'user-1', 'other', 'New')
    expect(result).toEqual({ success: false, error: 'NOT_FOUND' })
  })
})
