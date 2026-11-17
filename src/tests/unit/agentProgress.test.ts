import { describe, expect, it } from 'vitest'
import {
  buildAnalyzingMessage,
  buildResponseLanguageDirective,
  buildToolDoneSummary,
  buildToolStartLabel,
} from '@/lib/ai/agentProgress'
import { buildAgentSystemPrompt } from '@/lib/agent-loop'

describe('agent progress messages', () => {
  it('formats start labels per locale', () => {
    expect(buildToolStartLabel({ locale: 'en', tool: 'get_trade_history' })).toBe(
      'Fetching trade history...'
    )
    expect(buildToolStartLabel({ locale: 'vi', tool: 'get_trade_history' })).toBe(
      'Đang lấy lịch sử giao dịch...'
    )
    expect(buildToolStartLabel({ locale: 'en', tool: 'get_crypto_news', query: 'btc' })).toBe(
      'Searching news for BTC...'
    )
  })

  it('interpolates numbers in done summaries', () => {
    const input = { tool: 'get_pnl_stats' as const, winRate: '20.94', totalPnl: '-91.85' }
    expect(buildToolDoneSummary({ ...input, locale: 'en' })).toBe(
      'Win rate 20.94%, total PNL -91.85 USDT'
    )
    expect(buildToolDoneSummary({ ...input, locale: 'vi' })).toBe(
      'Win rate 20.94%, tổng PNL -91.85 USDT'
    )
    expect(
      buildToolDoneSummary({ locale: 'en', tool: 'get_trade_history', count: 20, exchange: 'all' })
    ).toBe('Fetched 20 trades from all')
  })

  it('handles empty market quotes and suffix', () => {
    expect(buildToolDoneSummary({ locale: 'en', tool: 'get_market_quotes', count: 0 })).toBe(
      'No price data found for the requested symbols'
    )
    expect(
      buildToolDoneSummary({ locale: 'en', tool: 'get_market_quotes', count: 2, symbols: ['A', 'B'] })
    ).toBe('Fetched 2 market quotes: A, B')
  })

  it('localizes the analyzing message', () => {
    expect(buildAnalyzingMessage('en')).toBe('Analyzing your question...')
    expect(buildAnalyzingMessage('vi')).toBe('Đang phân tích câu hỏi...')
  })
})

describe('agent system prompt', () => {
  it('includes the locale language directive', () => {
    expect(buildAgentSystemPrompt('en')).toContain(buildResponseLanguageDirective('en'))
    expect(buildAgentSystemPrompt('en')).toContain('Respond in English')
    expect(buildAgentSystemPrompt('vi')).toContain('Respond in Vietnamese')
    expect(buildAgentSystemPrompt('en')).not.toContain('Respond in Vietnamese')
  })
})
