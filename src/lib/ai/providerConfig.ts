import type { AiEffort, AiModelEntry, AiProvider } from '@/lib/types'

export const AI_PROVIDERS: readonly AiProvider[] = ['openrouter', 'gemini', 'openai', 'anthropic', 'xai']

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  openrouter: 'OpenRouter',
  gemini: 'Gemini',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  xai: 'xAI',
}

export const AI_PROVIDER_BASE_URLS: Record<AiProvider, string> = {
  openrouter: 'https://openrouter.ai/api/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  xai: 'https://api.x.ai/v1',
}

export const AI_CHAT_COMPLETIONS_PATH = '/chat/completions'

export const AI_PROVIDER_CHAT_URLS: Record<AiProvider, string> = {
  openrouter: `${AI_PROVIDER_BASE_URLS.openrouter}${AI_CHAT_COMPLETIONS_PATH}`,
  gemini: `${AI_PROVIDER_BASE_URLS.gemini}${AI_CHAT_COMPLETIONS_PATH}`,
  openai: `${AI_PROVIDER_BASE_URLS.openai}${AI_CHAT_COMPLETIONS_PATH}`,
  anthropic: `${AI_PROVIDER_BASE_URLS.anthropic}${AI_CHAT_COMPLETIONS_PATH}`,
  xai: `${AI_PROVIDER_BASE_URLS.xai}${AI_CHAT_COMPLETIONS_PATH}`,
}

export const AI_PROVIDER_KEY_CHECK_URLS: Record<AiProvider, string> = {
  openrouter: `${AI_PROVIDER_BASE_URLS.openrouter}/key`,
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models',
  openai: `${AI_PROVIDER_BASE_URLS.openai}/models`,
  anthropic: `${AI_PROVIDER_BASE_URLS.anthropic}/models`,
  xai: `${AI_PROVIDER_BASE_URLS.xai}/models`,
}

export const AI_PROVIDER_KEY_GUIDE_URLS: Record<AiProvider, string> = {
  openrouter: 'https://openrouter.ai/workspaces/default/keys',
  gemini: 'https://aistudio.google.com/api-keys',
  openai: 'https://platform.openai.com/api-keys',
  anthropic: 'https://platform.claude.com/settings/keys',
  xai: 'https://grok.com/dashboard/api-keys',
}

export const AI_ANTHROPIC_VERSION = '2023-06-01'

export const AI_MODEL_CATALOG: Record<AiProvider, readonly AiModelEntry[]> = {
  openrouter: [
    { id: 'nvidia/nemotron-3.5-super-vl:free', label: 'Nemotron 3.5 Super VL (free)', supportsEffort: true },
    { id: 'google/gemma-4-26b-a4b-it:free', label: 'Gemma 4 26B A4B (free)', supportsEffort: false },
    { id: 'z-ai/glm-5.3-flash', label: 'GLM 5.3 Flash', supportsEffort: true },
    { id: 'deepseek/deepseek-v4.1-flash-1017', label: 'DeepSeek V4.1 Flash', supportsEffort: true },
    { id: 'xiaomi/mimo-v2.6-flash', label: 'MiMo V2.6 Flash', supportsEffort: true },
    { id: 'moonshotai/kimi-k3.1-pro', label: 'Kimi K3.1 Pro', supportsEffort: true },
  ],
  gemini: [
    { id: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen', supportsEffort: true },
    { id: 'gemini-4-carbon', label: 'Gemini 4 Carbon', supportsEffort: true },
    { id: 'gemini-4-argon', label: 'Gemini 4 Argon', supportsEffort: true },
    { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', supportsEffort: true },
    { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', supportsEffort: true },
  ],
  openai: [
    { id: 'gpt-6-astra', label: 'GPT-6 Astra', supportsEffort: true },
    { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', supportsEffort: true },
    { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra', supportsEffort: true },
    { id: 'gpt-6-luna', label: 'GPT-6 Luna', supportsEffort: true },
    { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', supportsEffort: true },
  ],
  anthropic: [
    { id: 'claude-fable-5-2', label: 'Claude Fable 5.2', supportsEffort: false },
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', supportsEffort: false },
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', supportsEffort: false },
    { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', supportsEffort: false },
  ],
  xai: [
    { id: 'grok-4.7', label: 'Grok 4.7', supportsEffort: false },
    { id: 'grok-4.6', label: 'Grok 4.6', supportsEffort: false },
    { id: 'grok-4.5', label: 'Grok 4.5', supportsEffort: false },
    { id: 'grok-4.3', label: 'Grok 4.3', supportsEffort: false },
  ],
}

export const AI_EFFORT_LEVELS = ['low', 'medium', 'high'] as const
export const AI_DEFAULT_EFFORT: AiEffort = 'medium'

export const AI_REASONING_EFFORT_PROVIDERS: readonly AiProvider[] = ['openai', 'xai', 'gemini']
export const AI_NESTED_REASONING_PROVIDERS: readonly AiProvider[] = ['openrouter']
export const AI_NO_TEMPERATURE_PROVIDERS: readonly AiProvider[] = ['openai', 'anthropic']
export const AI_COMPLETION_TOKENS_PROVIDERS: readonly AiProvider[] = ['openai']
export const AI_REFERER_PROVIDERS: readonly AiProvider[] = ['openrouter']

export const AI_KEY_CHECK_TIMEOUT_MS = 10_000
export const AI_API_KEY_MIN_LENGTH = 10
export const AI_API_KEY_MAX_LENGTH = 512
export const AI_MODEL_ID_MAX_LENGTH = 120
export const AI_KEY_HINT_PREFIX_LENGTH = 3
export const AI_KEY_HINT_SUFFIX_LENGTH = 3
export const AI_KEY_HINT_SEPARATOR = '...'
export const AI_SETTINGS_PATH = '/settings'
export const AI_SETTINGS_SECTION = 'ai'
export const AI_APP_REFERER_FALLBACK = 'http://localhost:3000'
export const AI_APP_TITLE = 'PnLens'
export const AI_SELECTION_STORAGE_PREFIX = 'pnlens.ai.selection.'
