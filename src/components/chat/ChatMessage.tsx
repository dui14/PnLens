'use client'

import { lazy, Suspense } from 'react'
import type { ChatMessage as ChatMessageModel } from '@/lib/types'
import { AppLogo } from '@/components/ui/AppLogo'
import { collectToolLinkUrls } from '@/lib/ai/safeLinks'
import { AgentThinkingPanel, type AgentThinkingStep } from '@/components/chat/AgentThinkingPanel'

const MarkdownContent = lazy(() =>
  import('@/components/chat/MarkdownContent').then((m) => ({ default: m.MarkdownContent }))
)

export type ChatMessageProps = {
  message: ChatMessageModel
  errorText?: string
  showThinkingPanel?: boolean
  thinkingSteps?: AgentThinkingStep[]
  isThinking?: boolean
  elapsedTime?: number
  thinkingCollapsed?: boolean
  onToggleThinkingCollapsed?: () => void
}

export function ChatMessage({
  message,
  errorText,
  showThinkingPanel = false,
  thinkingSteps = [],
  isThinking = false,
  elapsedTime = 0,
  thinkingCollapsed = false,
  onToggleThinkingCollapsed,
}: ChatMessageProps): React.JSX.Element {
  if (message.role === 'user') {
    return (
      <div className="flex gap-2 md:gap-4 justify-end">
        <div className="max-w-[85%] md:max-w-2xl rounded-2xl px-4 py-3 text-[13px] md:text-sm leading-relaxed bg-primary text-white rounded-tr-none">
          {message.content}
        </div>
        <div className="size-7 md:size-8 rounded-lg bg-primary/20 flex items-center justify-center shrink-0 mt-1">
          <span className="material-symbols-outlined text-primary text-base">person</span>
        </div>
      </div>
    )
  }

  const shouldShowThinkingPanel =
    showThinkingPanel && (isThinking || thinkingSteps.length > 0) && Boolean(onToggleThinkingCollapsed)
  const handleToggleThinkingCollapsed = onToggleThinkingCollapsed ?? (() => undefined)
  const hasAssistantContent = message.content.trim().length > 0
  const toolUrls = collectToolLinkUrls([...(message.analysis_meta?.steps ?? []), ...thinkingSteps])

  return (
    <div className="flex gap-2 md:gap-4 justify-start">
      <AppLogo size={32} className="size-7 md:size-8 mt-1" />
      <div className="min-w-0 max-w-[calc(100%-2.5rem)] md:max-w-2xl flex-1 space-y-2">
        {shouldShowThinkingPanel ? (
          <AgentThinkingPanel
            steps={thinkingSteps}
            isThinking={isThinking}
            elapsedTime={elapsedTime}
            isCollapsed={thinkingCollapsed}
            onToggleCollapsed={handleToggleThinkingCollapsed}
          />
        ) : null}
        <div
          className={`rounded-2xl px-4 py-3 text-[13px] md:text-sm leading-relaxed rounded-tl-none ${
            errorText
              ? 'bg-rose-500/10 border border-rose-500/40 text-rose-200'
              : 'bg-neutral-dark border border-neutral-border text-slate-200'
          }`}
        >
          {errorText ? (
            <p role="alert" className="flex items-start gap-2">
              <span className="material-symbols-outlined text-base text-rose-400 shrink-0">error</span>
              <span>{errorText}</span>
            </p>
          ) : hasAssistantContent ? (
            <div className="prose prose-sm prose-invert max-w-none prose-p:my-0 prose-headings:my-0">
              <Suspense fallback={<span className="whitespace-pre-wrap">{message.content}</span>}>
                <MarkdownContent content={message.content} toolUrls={toolUrls} />
              </Suspense>
            </div>
          ) : (
            <span className="inline-flex gap-1 items-center text-slate-400">
              <span className="size-1.5 rounded-full bg-primary/60 animate-bounce [animation-delay:0ms]" />
              <span className="size-1.5 rounded-full bg-primary/60 animate-bounce [animation-delay:150ms]" />
              <span className="size-1.5 rounded-full bg-primary/60 animate-bounce [animation-delay:300ms]" />
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
