'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChatMessage } from '@/components/chat/ChatMessage'
import { useT } from '@/lib/i18n/client'
import { fillTemplate } from '@/lib/i18n/format'
import { AiModelPicker } from '@/components/features/ai-assistant/AiModelPicker'
import { createSupabaseBrowserClient } from '@/lib/db/supabase-browser'
import { AI_SELECTION_STORAGE_PREFIX } from '@/lib/ai/providerConfig'
import { classifyAiError } from '@/lib/ai/chatErrors'
import { AI_CONVERSATION_RENAMED_EVENT } from '@/lib/ai/guardrails'
import {
  isSelectionUsable,
  modelSupportsEffort,
  parseStoredSelection,
  pickDefaultSelection,
  type ChatSelection,
} from '@/lib/ai/modelGating'
import { AppLogo } from '@/components/ui/AppLogo'
import type { Dictionary } from '@/lib/i18n'
import type { AgentThinkingLink, AgentThinkingStep } from '@/components/chat/AgentThinkingPanel'
import type {
  AgentAnalysisStep,
  ChatConversation,
  ChatMessage as ChatMessageModel,
  ChatMessageAnalysisMeta,
  AiProviderSummary,
} from '@/lib/types'

type StreamEvent = {
  type?: string
  payload?: Record<string, unknown>
  content?: string
  conversationId?: string
  error?: string
}

function readText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function getEventPayload(event: StreamEvent): Record<string, unknown> {
  if (event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)) {
    return event.payload
  }

  return event as Record<string, unknown>
}

function getFallbackToolLabel(tool: string, labels: Dictionary['ai']['tools']): string {
  if (tool === 'get_trade_history') return labels.tradeHistory
  if (tool === 'get_pnl_stats') return labels.pnlStats
  if (tool === 'get_market_quotes') return labels.marketQuotes
  if (tool === 'get_crypto_news') return labels.news
  return fillTemplate(labels.running, { tool })
}

function getElapsedSeconds(startedAt: number): number {
  return Math.max(1, Math.floor((Date.now() - startedAt) / 1000))
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  return null
}

function readThinkingLinks(value: unknown, detailsLabel: string): AgentThinkingLink[] | undefined {
  if (!Array.isArray(value)) return undefined

  const links: AgentThinkingLink[] = []
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
      title: readText(record.title) ?? detailsLabel,
      url,
      source: readText(record.source) ?? undefined,
    })
  }

  return links.length > 0 ? links : undefined
}

function readAnalysisMeta(value: unknown, detailsLabel: string): ChatMessageAnalysisMeta | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const raw = value as Record<string, unknown>
  const rawSteps = Array.isArray(raw.steps) ? raw.steps : []
  const steps: AgentAnalysisStep[] = []

  for (const rawStep of rawSteps) {
    if (!rawStep || typeof rawStep !== 'object' || Array.isArray(rawStep)) {
      continue
    }

    const step = rawStep as Record<string, unknown>
    const type = readText(step.type)

    if (type === 'thinking_start' || type === 'thinking_step') {
      const message = readText(step.message)
      if (message) {
        steps.push({ type, message })
      }
      continue
    }

    if (type === 'tool') {
      const tool = readText(step.tool)
      const label = readText(step.label)
      const status = readText(step.status)
      if (!tool || !label || (status !== 'loading' && status !== 'done')) {
        continue
      }

      steps.push({
        type: 'tool',
        tool,
        label,
        status,
        summary: readText(step.summary) ?? undefined,
        links: readThinkingLinks(step.links, detailsLabel),
      })
    }
  }

  if (steps.length === 0) {
    return null
  }

  const elapsedSeconds = readNumber(raw.elapsedSeconds)
  const completedAt = readText(raw.completedAt) ?? undefined
  const normalizedElapsedSeconds =
    typeof elapsedSeconds === 'number' && elapsedSeconds > 0 ? elapsedSeconds : undefined

  return {
    steps,
    elapsedSeconds: normalizedElapsedSeconds,
    completedAt,
  }
}

function mapAnalysisStepsToThinkingSteps(
  steps: AgentAnalysisStep[],
  messageId: string
): AgentThinkingStep[] {
  return steps.map((step, index) => {
    const id = `analysis-${messageId}-${index}`

    if (step.type === 'thinking_start' || step.type === 'thinking_step') {
      return {
        id,
        type: step.type,
        message: step.message,
      }
    }

    return {
      id,
      type: 'tool',
      tool: step.tool,
      label: step.label,
      status: step.status,
      summary: step.summary,
      links: step.links,
    }
  })
}

export function AIChatInterface(): React.JSX.Element {
  const { t, locale } = useT()
  const ai = t.ai

  const router = useRouter()
  const searchParams = useSearchParams()
  const convParam = searchParams.get('conv')

  const [activeConvId, setActiveConvId] = useState<string | null>(convParam)
  const [messages, setMessages] = useState<ChatMessageModel[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [convTitle, setConvTitle] = useState<string | null>(null)
  const [thinkingSteps, setThinkingSteps] = useState<AgentThinkingStep[]>([])
  const [isThinking, setIsThinking] = useState(false)
  const [elapsedTime, setElapsedTime] = useState(0)
  const [collapsedByMessageId, setCollapsedByMessageId] = useState<Record<string, boolean>>({})
  const [thinkingMessageId, setThinkingMessageId] = useState<string | null>(null)
  const [providerSummaries, setProviderSummaries] = useState<AiProviderSummary[] | null>(null)
  const [selection, setSelection] = useState<ChatSelection | null>(null)
  const [selectionUserId, setSelectionUserId] = useState<string | null | undefined>(undefined)
  const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false)
  const [mobileConversations, setMobileConversations] = useState<ChatConversation[]>([])
  const [mobileConversationsLoading, setMobileConversationsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const thinkingStartedAtRef = useRef<number | null>(null)

  const loadMobileConversations = useCallback(async (): Promise<void> => {
    setMobileConversationsLoading(true)
    try {
      const res = await fetch('/api/ai/conversations')
      if (!res.ok) {
        setMobileConversations([])
        return
      }

      const data = (await res.json()) as {
        success?: boolean
        data?: ChatConversation[]
      }

      if (data.success) {
        setMobileConversations(data.data ?? [])
      } else {
        setMobileConversations([])
      }
    } catch {
      setMobileConversations([])
    } finally {
      setMobileConversationsLoading(false)
    }
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    setActiveConvId(convParam)
  }, [convParam])

  useEffect(() => {
    if (!activeConvId) {
      setMessages([])
      setConvTitle(null)
      return
    }
    setLoadingMessages(true)
    fetch(`/api/ai/conversations/${activeConvId}/messages`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setMessages(data.data ?? [])
        else setMessages([])
      })
      .catch(() => setMessages([]))
      .finally(() => setLoadingMessages(false))
  }, [activeConvId])

  useEffect(() => {
    if (!isThinking) return
    const intervalId = window.setInterval(() => {
      const startedAt = thinkingStartedAtRef.current
      if (!startedAt) return
      setElapsedTime(getElapsedSeconds(startedAt))
    }, 250)

    return () => window.clearInterval(intervalId)
  }, [isThinking])

  useEffect(() => {
    if (messages.length === 0) return

    setCollapsedByMessageId((prev) => {
      let changed = false
      const next = { ...prev }

      for (const message of messages) {
        const analysisMeta = readAnalysisMeta(message.analysis_meta, ai.details)
        if (!analysisMeta) {
          continue
        }

        if (typeof next[message.id] !== 'boolean') {
          next[message.id] = true
          changed = true
        }
      }

      return changed ? next : prev
    })
  }, [messages, ai.details])

  useEffect(() => {
    let cancelled = false
    const loadProviders = async (): Promise<void> => {
      try {
        const res = await fetch('/api/ai/providers')
        const payload = (await res.json()) as { success: boolean; data: AiProviderSummary[] | null }
        if (cancelled) return
        setProviderSummaries(payload.success && payload.data ? payload.data : [])
      } catch {
        if (!cancelled) setProviderSummaries([])
      }
    }
    void loadProviders()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const loadUser = async (): Promise<void> => {
      try {
        const { data } = await createSupabaseBrowserClient().auth.getUser()
        if (!cancelled) setSelectionUserId(data.user?.id ?? null)
      } catch {
        if (!cancelled) setSelectionUserId(null)
      }
    }
    void loadUser()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!providerSummaries || selectionUserId === undefined) return
    let stored: ChatSelection | null = null
    if (selectionUserId) {
      try {
        stored = parseStoredSelection(
          window.localStorage.getItem(`${AI_SELECTION_STORAGE_PREFIX}${selectionUserId}`)
        )
      } catch {
        stored = null
      }
    }
    setSelection((prev) => {
      if (prev && isSelectionUsable(providerSummaries, prev)) return prev
      if (stored && isSelectionUsable(providerSummaries, stored)) return stored
      return pickDefaultSelection(providerSummaries)
    })
  }, [providerSummaries, selectionUserId])

  const updateSelection = useCallback(
    (next: ChatSelection): void => {
      setSelection(next)
      if (!selectionUserId) return
      try {
        window.localStorage.setItem(
          `${AI_SELECTION_STORAGE_PREFIX}${selectionUserId}`,
          JSON.stringify(next)
        )
      } catch {}
    },
    [selectionUserId]
  )

  const describeChatError = useCallback(
    (code: string): string => {
      const known = t.aiProviders.errors as Record<string, string>
      return known[code] ?? known[classifyAiError(code)] ?? known.generic
    },
    [t]
  )

  useEffect(() => {
    if (!mobileHistoryOpen) {
      return
    }

    void loadMobileConversations()
  }, [mobileHistoryOpen, loadMobileConversations])

  useEffect(() => {
    const handler = (): void => {
      void loadMobileConversations()
    }

    window.addEventListener('ai-conv-change', handler)
    return () => window.removeEventListener('ai-conv-change', handler)
  }, [loadMobileConversations])

  useEffect(() => {
    const handler = (event: Event): void => {
      const detail = (event as CustomEvent<{ id: string; title: string }>).detail
      if (detail.id === activeConvId) setConvTitle(detail.title)
      setMobileConversations((prev) =>
        prev.map((c) => (c.id === detail.id ? { ...c, title: detail.title } : c))
      )
    }

    window.addEventListener(AI_CONVERSATION_RENAMED_EVENT, handler)
    return () => window.removeEventListener(AI_CONVERSATION_RENAMED_EVENT, handler)
  }, [activeConvId])

  const handleMobileConversationSelect = (conversationId: string): void => {
    router.push(`/ai-assistant?conv=${conversationId}`)
    setMobileHistoryOpen(false)
  }

  const handleMobileNewChat = (): void => {
    router.push('/ai-assistant')
    setMobileHistoryOpen(false)
  }

  const toggleThinkingCollapsed = useCallback(
    (messageId: string): void => {
      if (isThinking && thinkingMessageId === messageId) {
        return
      }

      setCollapsedByMessageId((prev) => ({
        ...prev,
        [messageId]: !(prev[messageId] ?? false),
      }))
    },
    [isThinking, thinkingMessageId]
  )

  const handleSend = useCallback(async (): Promise<void> => {
    const trimmed = inputValue.trim()
    if (!trimmed || isSending || !selection) return

    const tempUserMsg: ChatMessageModel = {
      id: `temp-${Date.now()}`,
      conversation_id: activeConvId ?? '',
      role: 'user',
      content: trimmed,
      tokens_used: null,
      created_at: new Date().toISOString(),
    }

    setMessages((prev) => [...prev, tempUserMsg])
    setInputValue('')
    setIsSending(true)

    const tempAssistantMsg: ChatMessageModel = {
      id: `temp-assistant-${Date.now()}`,
      conversation_id: activeConvId ?? '',
      role: 'assistant',
      content: '',
      tokens_used: null,
      created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, tempAssistantMsg])

    const turnStartedAt = Date.now()
    let stepIndex = 0
    let contentFlushTimeoutId: number | null = null
    let queuedAssistantContent: string | null = null
    let lastPatchedAssistantContent = ''

    const makeStepId = (prefix: string): string => {
      stepIndex += 1
      return `${prefix}-${turnStartedAt}-${stepIndex}`
    }

    const setThinkingPanelCollapsed = (collapsed: boolean): void => {
      setCollapsedByMessageId((prev) => {
        if (prev[tempAssistantMsg.id] === collapsed) {
          return prev
        }

        return {
          ...prev,
          [tempAssistantMsg.id]: collapsed,
        }
      })
    }

    const patchTempAssistantMessage = (nextContent: string): void => {
      if (nextContent === lastPatchedAssistantContent) {
        return
      }

      lastPatchedAssistantContent = nextContent

      setMessages((prev) => {
        const index = prev.findIndex((message) => message.id === tempAssistantMsg.id)
        if (index < 0) {
          return prev
        }

        const currentMessage = prev[index]
        if (currentMessage.content === nextContent) {
          return prev
        }

        const next = [...prev]
        next[index] = {
          ...currentMessage,
          content: nextContent,
        }

        return next
      })
    }

    const markTempAssistantFailed = (rawError: string): void => {
      const code = classifyAiError(rawError)
      lastPatchedAssistantContent = code
      setMessages((prev) =>
        prev.map((message) =>
          message.id === tempAssistantMsg.id
            ? { ...message, content: code, status: 'error', error_code: code }
            : message
        )
      )
    }

    const flushQueuedAssistantContent = (): void => {
      if (queuedAssistantContent === null) {
        return
      }

      const nextContent = queuedAssistantContent
      queuedAssistantContent = null
      patchTempAssistantMessage(nextContent)
    }

    const scheduleAssistantContentFlush = (): void => {
      if (contentFlushTimeoutId !== null) {
        return
      }

      contentFlushTimeoutId = window.setTimeout(() => {
        contentFlushTimeoutId = null
        flushQueuedAssistantContent()
      }, 16)
    }

    const stopAssistantContentFlush = (): void => {
      if (contentFlushTimeoutId !== null) {
        window.clearTimeout(contentFlushTimeoutId)
        contentFlushTimeoutId = null
      }

      flushQueuedAssistantContent()
    }

    setThinkingMessageId(tempAssistantMsg.id)
    setThinkingSteps([])
    setIsThinking(true)
    setElapsedTime(0)
    setThinkingPanelCollapsed(false)
    thinkingStartedAtRef.current = turnStartedAt

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          conversationId: activeConvId,
          locale,
          provider: selection.provider,
          model: selection.model,
          ...(modelSupportsEffort(selection.provider, selection.model)
            ? { effort: selection.effort }
            : {}),
        }),
      })

      if (!res.ok) {
        let apiError = 'CHAT_REQUEST_FAILED'
        try {
          const payload = (await res.json()) as { error?: string }
          if (typeof payload.error === 'string' && payload.error.length > 0) {
            apiError = payload.error
          }
        } catch {}
        throw new Error(apiError)
      }

      if (!res.body) {
        throw new Error('EMPTY_STREAM')
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let fullContent = ''
      let newConvId: string | null = null
      let streamError: string | null = null
      let doneReceived = false
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const rawLine of lines) {
          const line = rawLine.trim()
          if (!line.startsWith('data:')) continue

          const payloadText = line.slice(5).trim()
          if (!payloadText) continue
          if (payloadText === '[DONE]') {
            doneReceived = true
            setIsThinking(false)
            setThinkingPanelCollapsed(true)
            setElapsedTime(getElapsedSeconds(turnStartedAt))
            thinkingStartedAtRef.current = null
            continue
          }

          try {
            const parsed = JSON.parse(payloadText) as unknown
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
              continue
            }

            const event = parsed as StreamEvent
            const eventPayload = getEventPayload(event)

            const conversationId =
              typeof eventPayload.conversationId === 'string'
                ? eventPayload.conversationId
                : typeof event.conversationId === 'string'
                  ? event.conversationId
                  : null

            if (conversationId && conversationId.length > 0) {
              newConvId = conversationId
            }

            if (event.type === 'error') {
              const payloadMessage = readText(eventPayload.message)
              const eventMessage = readText(event.error)
              if (payloadMessage) {
                streamError = payloadMessage
              } else if (eventMessage) {
                streamError = eventMessage
              }
              setIsThinking(false)
              setElapsedTime(getElapsedSeconds(turnStartedAt))
              thinkingStartedAtRef.current = null
            }

            if (event.type === 'thinking_start') {
              const message = readText(eventPayload.message) ?? ai.thinking
              setThinkingSteps((prev) => [
                ...prev,
                {
                  id: makeStepId('thinking-start'),
                  type: 'thinking_start',
                  message,
                },
              ])
            }

            if (event.type === 'thinking_step') {
              const message = readText(eventPayload.message)
              if (message) {
                setThinkingSteps((prev) => [
                  ...prev,
                  {
                    id: makeStepId('thinking-step'),
                    type: 'thinking_step',
                    message,
                  },
                ])
              }
            }

            if (event.type === 'tool_start') {
              const tool = readText(eventPayload.tool) ?? 'tool'
              const label = readText(eventPayload.label) ?? getFallbackToolLabel(tool, ai.tools)

              setThinkingSteps((prev) => [
                ...prev,
                {
                  id: makeStepId('tool'),
                  type: 'tool',
                  tool,
                  label,
                  status: 'loading',
                },
              ])
            }

            if (event.type === 'tool_done') {
              const tool = readText(eventPayload.tool) ?? 'tool'
              const summary = readText(eventPayload.summary) ?? undefined
              const links = readThinkingLinks(eventPayload.links, ai.details)

              setThinkingSteps((prev) => {
                const next = [...prev]

                for (let idx = next.length - 1; idx >= 0; idx -= 1) {
                  const step = next[idx]
                  if (step.type === 'tool' && step.tool === tool && step.status === 'loading') {
                    next[idx] = {
                      ...step,
                      status: 'done',
                      summary,
                      links,
                    }
                    return next
                  }
                }

                return [
                  ...next,
                  {
                    id: makeStepId('tool'),
                    type: 'tool',
                    tool,
                    label: getFallbackToolLabel(tool, ai.tools),
                    status: 'done',
                    summary,
                    links,
                  },
                ]
              })
            }

            const contentPart =
              event.type === 'content_chunk' && typeof eventPayload.text === 'string'
                ? eventPayload.text
                : typeof event.content === 'string'
                  ? event.content
                  : ''

            if (contentPart) {
              fullContent += contentPart
              queuedAssistantContent = fullContent
              scheduleAssistantContentFlush()
            }

            if (event.type === 'done') {
              doneReceived = true
              setIsThinking(false)
              setThinkingPanelCollapsed(true)
              setElapsedTime(getElapsedSeconds(turnStartedAt))
              thinkingStartedAtRef.current = null
            }
          } catch {}
        }
      }

      stopAssistantContentFlush()

      if (!doneReceived && !streamError && fullContent.length === 0) {
        streamError = 'STREAM_TERMINATED'
      }

      if (streamError && fullContent.length === 0) {
        markTempAssistantFailed(streamError)
      }

      if (newConvId) {
        if (newConvId !== activeConvId) {
          setActiveConvId(newConvId)
          router.replace(`/ai-assistant?conv=${newConvId}`)
          if (!convTitle) setConvTitle(trimmed.slice(0, 60))
        }
        window.dispatchEvent(new CustomEvent('ai-conv-change'))
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'INTERNAL_ERROR'
      stopAssistantContentFlush()
      markTempAssistantFailed(message)
    } finally {
      stopAssistantContentFlush()
      setIsThinking(false)
      setElapsedTime((prev) => (prev > 0 ? prev : getElapsedSeconds(turnStartedAt)))
      thinkingStartedAtRef.current = null
      setIsSending(false)
    }
  }, [inputValue, isSending, activeConvId, convTitle, router, selection, ai, locale])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="relative flex flex-col h-full bg-background-dark overflow-hidden">
      <header className="h-14 border-b border-neutral-border flex items-center px-3 md:px-6 shrink-0 bg-background-dark/80 backdrop-blur-md z-10">
        <button
          type="button"
          onClick={() => setMobileHistoryOpen(true)}
          className="md:hidden size-8 flex items-center justify-center rounded-lg border border-neutral-border bg-neutral-dark text-slate-300"
          aria-label={ai.openConversations}
        >
          <span className="material-symbols-outlined text-base">menu</span>
        </button>
        <AppLogo size={24} className="mr-3" />
        <h2 className="text-slate-100 font-bold text-sm tracking-tight truncate flex-1">
          {convTitle ?? (activeConvId ? ai.conversation : ai.newConversation)}
        </h2>
        <button
          type="button"
          onClick={handleMobileNewChat}
          className="md:hidden size-8 flex items-center justify-center rounded-lg border border-neutral-border bg-neutral-dark text-slate-300"
          aria-label={ai.newConversationAria}
        >
          <span className="material-symbols-outlined text-base">add</span>
        </button>
      </header>

      {mobileHistoryOpen && (
        <div className="md:hidden fixed inset-0 z-[70]">
          <button
            type="button"
            onClick={() => setMobileHistoryOpen(false)}
            className="absolute inset-0 bg-black/50"
            aria-label={ai.closeConversations}
          />

          <aside className="absolute left-0 top-0 h-full w-[86%] max-w-sm bg-background-dark border-r border-neutral-border flex flex-col">
            <div className="h-14 px-4 border-b border-neutral-border flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-100">{ai.historyTitle}</h3>
              <button
                type="button"
                onClick={() => setMobileHistoryOpen(false)}
                className="size-8 flex items-center justify-center rounded-lg border border-neutral-border bg-neutral-dark text-slate-300"
                aria-label={ai.closeHistory}
              >
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            </div>

            <div className="p-3 border-b border-neutral-border">
              <button
                type="button"
                onClick={handleMobileNewChat}
                className="w-full h-10 rounded-lg bg-primary/10 text-primary font-semibold text-sm border border-primary/30"
              >
                {t.nav.newChat}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {mobileConversationsLoading && (
                <div className="flex justify-center py-6">
                  <span className="material-symbols-outlined animate-spin text-primary/40">refresh</span>
                </div>
              )}

              {!mobileConversationsLoading && mobileConversations.length === 0 && (
                <p className="text-xs text-slate-500 px-2 py-2">{t.nav.noConversations}</p>
              )}

              {!mobileConversationsLoading &&
                mobileConversations.slice(0, 40).map((conversation) => {
                  const isActive = activeConvId === conversation.id

                  return (
                    <button
                      key={conversation.id}
                      type="button"
                      onClick={() => handleMobileConversationSelect(conversation.id)}
                      className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left ${
                        isActive
                          ? 'bg-primary/10 text-primary'
                          : 'text-slate-300 hover:bg-neutral-dark'
                      }`}
                    >
                      <span className="material-symbols-outlined text-base shrink-0">chat_bubble</span>
                      <span className="text-xs font-medium truncate">
                        {conversation.title ?? t.nav.untitled}
                      </span>
                    </button>
                  )
                })}
            </div>
          </aside>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3 md:p-6 space-y-4 md:space-y-6 pb-6">
        {loadingMessages && (
          <div className="flex justify-center py-8">
            <span className="material-symbols-outlined animate-spin text-primary/40 text-3xl">
              refresh
            </span>
          </div>
        )}
        {!loadingMessages && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
            <AppLogo size={72} className="opacity-70" />
            <p className="text-slate-500 text-sm max-w-sm leading-relaxed">
              {ai.emptyPrompt}
            </p>
          </div>
        )}
        {messages.map((message) => {
          const analysisMeta = readAnalysisMeta(message.analysis_meta, ai.details)
          const isActiveThinkingMessage =
            message.role === 'assistant' && message.id === thinkingMessageId
          const shouldShowStoredAnalysis =
            message.role === 'assistant' && !isActiveThinkingMessage && Boolean(analysisMeta)
          const showThinkingPanel =
            isActiveThinkingMessage
              ? isThinking || thinkingSteps.length > 0
              : shouldShowStoredAnalysis

          const panelSteps = isActiveThinkingMessage
            ? thinkingSteps
            : analysisMeta
              ? mapAnalysisStepsToThinkingSteps(analysisMeta.steps, message.id)
              : []

          const panelElapsedTime = isActiveThinkingMessage
            ? elapsedTime
            : analysisMeta?.elapsedSeconds ?? 1

          const panelCollapsed =
            collapsedByMessageId[message.id] ??
            (isActiveThinkingMessage ? false : Boolean(analysisMeta))

          const toggleCollapsed = (): void => {
            toggleThinkingCollapsed(message.id)
          }

          return (
            <ChatMessage
              key={message.id}
              message={message}
              errorText={
                message.status === 'error'
                  ? describeChatError(message.error_code ?? message.content)
                  : undefined
              }
              showThinkingPanel={showThinkingPanel}
              thinkingSteps={showThinkingPanel ? panelSteps : []}
              isThinking={showThinkingPanel ? isActiveThinkingMessage && isThinking : false}
              elapsedTime={showThinkingPanel ? panelElapsedTime : 0}
              thinkingCollapsed={showThinkingPanel ? panelCollapsed : false}
              onToggleThinkingCollapsed={showThinkingPanel ? toggleCollapsed : undefined}
            />
          )
        })}
        <div ref={messagesEndRef} />
      </div>

      <div className="sticky bottom-0 z-20 p-3 md:p-4 bg-gradient-to-t from-background-dark via-background-dark/95 to-transparent">
        <div className="max-w-3xl mx-auto flex flex-wrap items-center gap-2 md:gap-3 bg-neutral-dark border border-neutral-border rounded-2xl px-3 md:px-4 py-2.5 md:py-3 shadow-xl">
          {providerSummaries && !selection && (
            <p className="w-full text-xs text-slate-400">{t.aiProviders.chat.noUsable}</p>
          )}
          <AiModelPicker
            summaries={providerSummaries}
            selection={selection}
            disabled={isSending}
            onSelect={updateSelection}
          />
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={ai.placeholder}
            className="flex-1 min-w-[40%] bg-transparent text-sm text-slate-200 placeholder-slate-500 outline-none"
          />
          <button
            onClick={handleSend}
            disabled={!inputValue.trim() || isSending || !selection}
            className="size-9 flex items-center justify-center rounded-xl bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          >
            <span className="material-symbols-outlined text-base">
              {isSending ? 'hourglass_top' : 'send'}
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}
