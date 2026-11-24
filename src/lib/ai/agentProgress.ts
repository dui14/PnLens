import { fillTemplate } from '@/lib/i18n/format'
import { getDictionaryFor } from '@/lib/i18n'
import type { Locale } from '@/lib/i18n/locales'

export type AgentProgressTool =
  | 'get_trade_history'
  | 'get_pnl_stats'
  | 'get_market_quotes'
  | 'get_crypto_news'

type ProgressInput = {
  locale: Locale
  tool: AgentProgressTool
  query?: string
  exchange?: string
  count?: number
  winRate?: string
  totalPnl?: string
  symbols?: string[]
}

export function buildToolStartLabel(input: ProgressInput): string {
  const p = getDictionaryFor(input.locale).ai.progress
  if (input.tool === 'get_trade_history') return p.tradeHistoryStart
  if (input.tool === 'get_pnl_stats') return p.pnlStatsStart
  if (input.tool === 'get_market_quotes') {
    const symbols = (input.query ?? p.marketQuotesDefaultTarget).toUpperCase()
    return fillTemplate(p.marketQuotesStart, { symbols })
  }
  const query = (input.query ?? p.newsDefaultQuery).toUpperCase()
  return fillTemplate(p.newsStart, { query })
}

export function buildToolDoneSummary(input: ProgressInput): string {
  const p = getDictionaryFor(input.locale).ai.progress
  const count = input.count ?? 0
  if (input.tool === 'get_trade_history') {
    return fillTemplate(p.tradeHistoryDone, { count, exchange: input.exchange ?? 'all' })
  }
  if (input.tool === 'get_pnl_stats') {
    return fillTemplate(p.pnlStatsDone, {
      winRate: input.winRate ?? '0',
      totalPnl: input.totalPnl ?? '0',
    })
  }
  if (input.tool === 'get_market_quotes') {
    if (count === 0) return p.marketQuotesEmpty
    const symbols = input.symbols ?? []
    const suffix = symbols.length > 0 ? `: ${symbols.join(', ')}` : ''
    return fillTemplate(p.marketQuotesDone, { count, suffix })
  }
  return fillTemplate(p.newsDone, {
    count,
    query: input.query ?? p.newsDefaultQuery,
  })
}

export function buildAnalyzingMessage(locale: Locale): string {
  return getDictionaryFor(locale).ai.progress.analyzing
}

export function buildContinuingMessage(locale: Locale): string {
  return getDictionaryFor(locale).ai.progress.continuing
}

export function buildResponseLanguageDirective(locale: Locale): string {
  const language = getDictionaryFor(locale).ai.progress.responseLanguage
  return `Respond in ${language} by default, matching the user's selected interface language. Switch to another language only if the user writes in it or explicitly asks for it.`
}
