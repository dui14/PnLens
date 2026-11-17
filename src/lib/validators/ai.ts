import { z } from 'zod'
import { SUPPORTED_LOCALES } from '@/lib/i18n/locales'
import { AI_CONVERSATION_TITLE_MAX_LENGTH, AI_MESSAGE_MAX_LENGTH } from '@/lib/ai/guardrails'
import { AI_EFFORT_LEVELS, AI_MODEL_ID_MAX_LENGTH, AI_PROVIDERS } from '@/lib/ai/providerConfig'

export const ChatMessageSchema = z.object({
  conversationId: z.string().uuid().nullable().optional(),
  message: z.string().trim().min(1).max(AI_MESSAGE_MAX_LENGTH),
  provider: z.enum(AI_PROVIDERS as [string, ...string[]]),
  model: z.string().trim().min(1).max(AI_MODEL_ID_MAX_LENGTH),
  effort: z.enum(AI_EFFORT_LEVELS).optional(),
  locale: z.enum(SUPPORTED_LOCALES).optional(),
})

export type ChatMessageInput = z.infer<typeof ChatMessageSchema>

export const RenameConversationSchema = z.object({
  title: z.string().trim().min(1).max(AI_CONVERSATION_TITLE_MAX_LENGTH),
})

export type RenameConversationInput = z.infer<typeof RenameConversationSchema>
