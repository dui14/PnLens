import { z } from 'zod'
import { AI_PROVIDERS, AI_API_KEY_MIN_LENGTH, AI_API_KEY_MAX_LENGTH } from '@/lib/ai/providerConfig'

export const AiProviderParamSchema = z.enum(AI_PROVIDERS as [string, ...string[]])

export const AiApiKeySchema = z
  .string()
  .trim()
  .min(AI_API_KEY_MIN_LENGTH)
  .max(AI_API_KEY_MAX_LENGTH)
  .refine((value) => !/\s/.test(value), { message: 'API_KEY_INVALID' })

export const SaveAiProviderKeySchema = z.object({
  apiKey: AiApiKeySchema,
})

export type SaveAiProviderKeyInput = z.infer<typeof SaveAiProviderKeySchema>
