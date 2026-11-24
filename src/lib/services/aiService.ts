import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  AiEffort,
  AiProvider,
  AgentAnalysisStep,
  AgentReferenceLink,
  ChatConversation,
  ChatMessage,
  ChatMessageAnalysisMeta,
  Result,
} from '@/lib/types'
import {
  createConversation,
  getConversations,
  getConversationById,
  getConversationMessages,
  createChatMessage,
  updateConversationTitle,
  deleteConversation,
  renameConversation,
} from '@/lib/db/chatDb'
import { classifyAiError, type AiChatErrorCode } from '@/lib/ai/chatErrors'
import {
  recordProviderFailure,
  recordProviderSuccess,
  resolveChatCredentials,
} from '@/lib/services/aiProviderService'
import { runAgentLoop, type AgentEvent } from '@/lib/agent-loop'
import { AI_VALIDATION_ERROR_CODE, isValidChatMessage, limitHistory } from '@/lib/ai/guardrails'
import { getDictionaryFor } from '@/lib/i18n'
import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/locales'

type StreamCallback = (event: AgentEvent) => void

function emitServiceError(
  onEvent: StreamCallback,
  message: string,
  conversationId?: string
): void {
  const payload: Record<string, unknown> = { message, code: message }
  if (conversationId) {
    payload.conversationId = conversationId
  }

  onEvent({
    type: 'error',
    payload,
  })
}

function readText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function readReferenceLinks(value: unknown, locale: Locale): AgentReferenceLink[] | undefined {
  if (!Array.isArray(value)) return undefined

  const links: AgentReferenceLink[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue
    }

    const record = item as Record<string, unknown>
    const url = readText(record.url)
    if (!url) {
      continue
    }

    links.push({
      title: readText(record.title) ?? getDictionaryFor(locale).ai.progress.newsLinkTitle,
      url,
      source: readText(record.source) ?? undefined,
    })
  }

  return links.length > 0 ? links : undefined
}

async function persistFailedTurn(
  supabase: SupabaseClient,
  conversationId: string,
  code: AiChatErrorCode
): Promise<void> {
  const stored = await createChatMessage(supabase, conversationId, 'assistant', code, undefined, null, code)
  if (!stored) {
    console.error('[aiService] failed to persist error message:', code)
  }
}

export async function startOrContinueChat(
  supabase: SupabaseClient,
  userId: string,
  message: string,
  conversationId: string | null | undefined,
  provider: AiProvider,
  model: string,
  effort: AiEffort | undefined,
  onEvent: StreamCallback,
  locale: Locale = DEFAULT_LOCALE
): Promise<Result<{ conversationId: string }>> {
  if (!isValidChatMessage(message)) {
    emitServiceError(onEvent, AI_VALIDATION_ERROR_CODE, conversationId ?? undefined)
    return { success: false, error: AI_VALIDATION_ERROR_CODE }
  }

  let conversation: ChatConversation | null = null

  if (conversationId) {
    conversation = await getConversationById(supabase, conversationId, userId)
    if (!conversation) {
      emitServiceError(onEvent, 'CONVERSATION_NOT_FOUND', conversationId)
      return { success: false, error: 'CONVERSATION_NOT_FOUND' }
    }
  } else {
    const title = message.slice(0, 60)
    conversation = await createConversation(supabase, userId, title)
    if (!conversation) {
      emitServiceError(onEvent, 'INTERNAL_ERROR')
      return { success: false, error: 'INTERNAL_ERROR' }
    }
  }

  const history = await getConversationMessages(supabase, conversation.id, userId)
  const historyForAgent = limitHistory(history
    .filter((item) => (item.role === 'user' || item.role === 'assistant') && item.status !== 'error')
    .map((item) => ({
      role: item.role as 'user' | 'assistant',
      content: item.content,
    })))

  const userMessage = await createChatMessage(supabase, conversation.id, 'user', message)
  if (!userMessage) {
    emitServiceError(onEvent, 'INTERNAL_ERROR', conversation.id)
    return { success: false, error: 'INTERNAL_ERROR' }
  }

  const turnConversationId = conversation.id

  const failTurn = async (rawError: unknown): Promise<Result<{ conversationId: string }>> => {
    const code = classifyAiError(rawError)
    console.error('[aiService] chat turn failed:', rawError)
    await persistFailedTurn(supabase, turnConversationId, code)
    await recordProviderFailure(supabase, userId, provider, code)
    emitServiceError(onEvent, code, turnConversationId)
    return { success: false, error: code }
  }

  const credentials = await resolveChatCredentials(supabase, userId, provider, model, effort)
  if (!credentials.success) {
    return failTurn(credentials.error)
  }

  let assistantContent = ''
  const analysisStartedAt = Date.now()
  let analysisCompletedAt: string | undefined
  const analysisSteps: AgentAnalysisStep[] = []

  const agentResult = await runAgentLoop(
    message,
    historyForAgent,
    { supabase, userId },
    (event) => {
      if (event.type === 'tool_start') {
        const tool = readText(event.payload.tool)
        const label = readText(event.payload.label)
        if (tool && label) {
          analysisSteps.push({
            type: 'tool',
            tool,
            label,
            status: 'loading',
          })
        }
      }

      if (event.type === 'tool_done') {
        const tool = readText(event.payload.tool)
        if (tool) {
          const summary = readText(event.payload.summary) ?? undefined
          const links = readReferenceLinks(event.payload.links, locale)
          let patched = false

          for (let idx = analysisSteps.length - 1; idx >= 0; idx -= 1) {
            const step = analysisSteps[idx]
            if (step.type === 'tool' && step.tool === tool && step.status === 'loading') {
              analysisSteps[idx] = {
                ...step,
                status: 'done',
                summary,
                links,
              }
              patched = true
              break
            }
          }

          if (!patched) {
            analysisSteps.push({
              type: 'tool',
              tool,
              label: tool,
              status: 'done',
              summary,
              links,
            })
          }
        }
      }

      if (event.type === 'done') {
        analysisCompletedAt = new Date().toISOString()
      }

      if (event.type === 'content_chunk') {
        const text = typeof event.payload.text === 'string' ? event.payload.text : ''
        assistantContent += text
      }

      if (event.type === 'error') {
        return
      }

      const payload =
        event.type === 'done'
          ? event.payload
          : {
              ...event.payload,
              conversationId: conversation.id,
            }

      onEvent({
        type: event.type,
        payload,
      })
    },
    credentials.data,
    locale
  ).catch((error: unknown): Result<never> => ({
    success: false,
    error: error instanceof Error ? error.message : String(error),
  }))

  if (!agentResult.success) {
    return failTurn(agentResult.error)
  }

  const finalAssistantContent = assistantContent.trim() || agentResult.data.content
  const elapsedSeconds = Math.max(1, Math.floor((Date.now() - analysisStartedAt) / 1000))
  const assistantAnalysisMeta: ChatMessageAnalysisMeta | null =
    analysisSteps.length > 0
      ? {
          steps: analysisSteps,
          elapsedSeconds,
          completedAt: analysisCompletedAt ?? new Date().toISOString(),
        }
      : null

  const assistantMessage = await createChatMessage(
    supabase,
    conversation.id,
    'assistant',
    finalAssistantContent,
    agentResult.data.tokensUsed,
    assistantAnalysisMeta
  )

  if (!assistantMessage) {
    emitServiceError(onEvent, 'INTERNAL_ERROR', conversation.id)
    return { success: false, error: 'INTERNAL_ERROR' }
  }

  await recordProviderSuccess(supabase, userId, provider)

  if (history.length === 0) {
    await updateConversationTitle(supabase, conversation.id, message.slice(0, 60))
  }

  return { success: true, data: { conversationId: conversation.id } }
}

export async function listConversations(
  supabase: SupabaseClient,
  userId: string
): Promise<Result<ChatConversation[]>> {
  const conversations = await getConversations(supabase, userId)
  return { success: true, data: conversations }
}

export async function fetchConversationMessages(
  supabase: SupabaseClient,
  userId: string,
  conversationId: string
): Promise<Result<ChatMessage[]>> {
  const conversation = await getConversationById(supabase, conversationId, userId)
  if (!conversation) {
    return { success: false, error: 'NOT_FOUND' }
  }

  const messages = await getConversationMessages(supabase, conversationId, userId)
  return { success: true, data: messages }
}

export async function removeConversation(
  supabase: SupabaseClient,
  userId: string,
  conversationId: string
): Promise<Result<null>> {
  const conversation = await getConversationById(supabase, conversationId, userId)
  if (!conversation) {
    return { success: false, error: 'NOT_FOUND' }
  }

  const deleted = await deleteConversation(supabase, conversationId, userId)
  if (!deleted) return { success: false, error: 'INTERNAL_ERROR' }
  return { success: true, data: null }
}

export async function renameConversationTitle(
  supabase: SupabaseClient,
  userId: string,
  conversationId: string,
  title: string
): Promise<Result<{ id: string; title: string }>> {
  const renamed = await renameConversation(supabase, conversationId, userId, title)
  if (!renamed) return { success: false, error: 'NOT_FOUND' }
  return { success: true, data: { id: conversationId, title } }
}
