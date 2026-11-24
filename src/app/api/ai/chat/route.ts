import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { ChatMessageSchema } from '@/lib/validators/ai'
import type { AiProvider } from '@/lib/types'
import type { AgentEvent } from '@/lib/agent-loop'
import { classifyAiError } from '@/lib/ai/chatErrors'
import { getLocale } from '@/lib/i18n/server'
import { startOrContinueChat } from '@/lib/services/aiService'

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json(
      { success: false, data: null, error: 'UNAUTHORIZED' },
      { status: 401 }
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { success: false, data: null, error: 'VALIDATION_ERROR' },
      { status: 400 }
    )
  }

  const parsed = ChatMessageSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, data: null, error: 'VALIDATION_ERROR' },
      { status: 400 }
    )
  }

  const locale = parsed.data.locale ?? (await getLocale())

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false

      const sendEvent = (event: AgentEvent) => {
        if (closed) return
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }

      try {
        await startOrContinueChat(
          supabase,
          user.id,
          parsed.data.message,
          parsed.data.conversationId,
          parsed.data.provider as AiProvider,
          parsed.data.model,
          parsed.data.effort,
          (event) => {
            sendEvent(event)
          },
          locale
        )
      } catch (error) {
        console.error('[api/ai/chat] unhandled stream error:', error)
        const code = classifyAiError(error)
        sendEvent({
          type: 'error',
          payload: { message: code, code },
        })
      } finally {
        closed = true
        controller.close()
      }
    },
  })

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
