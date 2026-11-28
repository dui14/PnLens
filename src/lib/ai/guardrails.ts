export const AI_MESSAGE_MAX_LENGTH = 4000
export const AI_CONVERSATION_TITLE_MAX_LENGTH = 30
export const AI_CONVERSATION_RENAMED_EVENT = 'pnlens:ai-conversation-renamed'
export const AI_HISTORY_MAX_MESSAGES = 12
export const AI_VALIDATION_ERROR_CODE = 'VALIDATION_ERROR'

export const AGENT_MAX_TOOL_STEPS = 5
export const AGENT_TOOL_CHOICE_AUTO = 'auto'
export const AGENT_TOOL_CHOICE_NONE = 'none'

export const TOOL_TRADE_LIMIT_DEFAULT = 20
export const TOOL_TRADE_LIMIT_MIN = 1
export const TOOL_TRADE_LIMIT_MAX = 50
export const TOOL_NEWS_LIMIT_DEFAULT = 8
export const TOOL_NEWS_LIMIT_MIN = 1
export const TOOL_NEWS_LIMIT_MAX = 12
export const TOOL_SYMBOL_MAX_LENGTH = 20
export const TOOL_SYMBOLS_LIST_MAX_LENGTH = 120
export const TOOL_QUERY_MAX_LENGTH = 120
export const TOOL_PNL_STATS_MAX_ROWS = 5000
export const TOOL_RESULT_MAX_CHARS = 24000

export const ESCAPED_LESS_THAN = `${String.fromCharCode(92)}u003c`
export const TOOL_RESULT_TAG = 'tool_data'
export const TOOL_RESULT_TRUST_LEVEL = 'untrusted'
export const TOOL_RESULT_TRUNCATED_MARKER = '...[truncated]'

export const TRADE_SYMBOL_PATTERN = /^[A-Z0-9_\-/.]+$/

export function limitHistory<T>(history: readonly T[]): T[] {
  return history.slice(-AI_HISTORY_MAX_MESSAGES)
}

export function isValidChatMessage(message: string): boolean {
  const trimmed = message.trim()
  return trimmed.length > 0 && trimmed.length <= AI_MESSAGE_MAX_LENGTH
}

export function wrapToolResult(tool: string, result: unknown): string {
  const escaped = JSON.stringify(result).replace(/</g, ESCAPED_LESS_THAN)
  const body =
    escaped.length > TOOL_RESULT_MAX_CHARS
      ? `${escaped.slice(0, TOOL_RESULT_MAX_CHARS)}${TOOL_RESULT_TRUNCATED_MARKER}`
      : escaped

  return `<${TOOL_RESULT_TAG} name="${tool}" trust="${TOOL_RESULT_TRUST_LEVEL}">\n${body}\n</${TOOL_RESULT_TAG}>`
}
