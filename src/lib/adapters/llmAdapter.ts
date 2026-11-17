import type { AiChatTarget } from '@/lib/types'
import { AI_PROVIDER_CHAT_URLS } from '@/lib/ai/providerConfig'
import { buildChatBodyFields, buildChatHeaders } from '@/lib/ai/providerRequest'

const LLM_TIMEOUT = 30_000
const LLM_TEMPERATURE = 0.7
const LLM_MAX_TOKENS = 2048

type LLMMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

type StreamChunk = {
  type: 'delta' | 'done' | 'error'
  content?: string
  conversationId?: string
  tokensUsed?: number
}

type SSEChunk = {
  choices?: {
    delta?: { content?: string }
    finish_reason?: string | null
  }[]
  usage?: {
    total_tokens?: number
  }
}

export async function streamChatCompletion(
  messages: LLMMessage[],
  onChunk: (chunk: StreamChunk) => void,
  credentials: AiChatTarget
): Promise<{ content: string; tokensUsed: number }> {
  const { provider, apiKey } = credentials

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT)

  try {
    const response = await fetch(AI_PROVIDER_CHAT_URLS[provider], {
      method: 'POST',
      headers: buildChatHeaders(provider, apiKey),
      body: JSON.stringify({
        ...buildChatBodyFields(credentials, LLM_TEMPERATURE, LLM_MAX_TOKENS),
        messages,
        stream: true,
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`AI_REQUEST_FAILED:${response.status}:${error.slice(0, 180)}`)
    }

    const reader = response.body?.getReader()
    if (!reader) throw new Error('No response body')

    const decoder = new TextDecoder()
    let fullContent = ''
    let tokensUsed = 0
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data: ')) continue
        const data = trimmed.slice(6).trim()
        if (data === '[DONE]') continue
        if (!data) continue

        try {
          const parsed = JSON.parse(data) as SSEChunk
          const content = parsed.choices?.[0]?.delta?.content
          if (content) {
            fullContent += content
            onChunk({ type: 'delta', content })
          }
          if (parsed.usage?.total_tokens) {
            tokensUsed = parsed.usage.total_tokens
          }
        } catch {}
      }
    }

    return { content: fullContent, tokensUsed }
  } finally {
    clearTimeout(timer)
  }
}

export function buildSystemPrompt(): string {
  return `You are an expert crypto trading assistant for PnLens platform. You help traders analyze their performance, understand PNL, interpret trading metrics, and improve their strategies.
Be concise, data-driven, and educational. Always remind users that crypto trading involves significant risk.
Never provide specific buy/sell signals or guarantee returns.`
}
