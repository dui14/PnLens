'use client'

import {
  Calculator,
  CheckCircle2,
  Database,
  LineChart,
  Loader2,
  Newspaper,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { useT } from '@/lib/i18n/client'
import { fillTemplate } from '@/lib/i18n/format'

export type AgentThinkingLink = {
  title: string
  url: string
  source?: string
}

export type AgentThinkingStep =
  | {
      id: string
      type: 'thinking_start'
      message: string
    }
  | {
      id: string
      type: 'thinking_step'
      message: string
    }
  | {
      id: string
      type: 'tool'
      tool: string
      label: string
      status: 'loading' | 'done'
      summary?: string
      links?: AgentThinkingLink[]
    }

export type AgentThinkingPanelProps = {
  steps: AgentThinkingStep[]
  isThinking: boolean
  elapsedTime: number
  isCollapsed: boolean
  onToggleCollapsed: () => void
}

function getToolIcon(tool: string): LucideIcon {
  if (tool === 'get_trade_history') return Database
  if (tool === 'get_pnl_stats') return Calculator
  if (tool === 'get_crypto_news') return Newspaper
  if (tool === 'get_market_quotes') return LineChart
  return Wrench
}

export function AgentThinkingPanel({
  steps,
  isThinking,
  elapsedTime,
  isCollapsed,
  onToggleCollapsed,
}: AgentThinkingPanelProps): React.JSX.Element {
  const { t } = useT()
  const seconds = Math.max(1, elapsedTime)
  const isCompleted = !isThinking && steps.length > 0
  const title = isCompleted
    ? fillTemplate(t.ai.analysisDone, { seconds })
    : fillTemplate(t.ai.analysis, { seconds })

  if (!isThinking && isCollapsed) {
    return (
      <button
        type="button"
        onClick={onToggleCollapsed}
        className="inline-flex w-full items-center gap-2 rounded-xl border border-neutral-border bg-neutral-dark/70 px-3 py-2 text-left text-sm text-slate-300 transition-colors hover:bg-neutral-dark"
      >
        <span className="w-4 text-center text-base leading-none">▾</span>
        <span>{title}</span>
      </button>
    )
  }

  const renderedSteps: AgentThinkingStep[] =
    steps.length === 0 && isThinking
      ? [
          {
            id: 'pending',
            type: 'thinking_start',
            message: t.ai.thinking,
          },
        ]
      : steps

  const visibleSteps = isThinking
    ? renderedSteps
    : renderedSteps.filter((step) => step.type === 'tool')

  return (
    <div className="w-full rounded-xl border border-neutral-border bg-neutral-dark/70 px-3 py-3">
      <button
        type="button"
        onClick={onToggleCollapsed}
        disabled={isThinking}
        className="mb-2 inline-flex w-full items-center gap-2 text-left text-sm font-medium text-slate-200 disabled:cursor-default"
      >
        {isThinking ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary/80" />
        ) : isCompleted ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
        ) : (
          <span className="w-4 text-center text-base leading-none">▾</span>
        )}
        <span>{title}</span>
      </button>

      <div className="space-y-2">
        {visibleSteps.map((step) => {
          if (step.type === 'thinking_step') {
            return (
              <p key={step.id} className="text-xs italic text-slate-400">
                {step.message}
              </p>
            )
          }

          if (step.type === 'thinking_start') {
            return (
              <div key={step.id} className="flex items-start gap-2 text-slate-400">
                <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
                <p className="text-xs">{step.message}</p>
              </div>
            )
          }

          const ToolIcon = getToolIcon(step.tool)

          return (
            <div key={step.id} className="flex items-start gap-2">
              <ToolIcon className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-200">{step.label}</p>
                {step.summary ? <p className="mt-1 text-xs text-slate-400">{step.summary}</p> : null}
                {step.links && step.links.length > 0 ? (
                  <div className="mt-1 space-y-1">
                    {step.links.map((link, index) => (
                      <a
                        key={`${step.id}-link-${index}`}
                        href={link.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="block truncate text-xs text-blue-400 underline underline-offset-2 hover:text-blue-300"
                      >
                        {link.source ? `${link.source}: ${link.title}` : link.title}
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>
              {step.status === 'loading' ? (
                <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary/80" />
              ) : (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
              )}
            </div>
          )
        })}
        {!isThinking && visibleSteps.length === 0 ? (
          <p className="text-xs text-slate-400">{t.ai.analysisFinished}</p>
        ) : null}
      </div>
    </div>
  )
}
