import { z } from 'zod'
import { EXCHANGES } from '@/lib/types'
import { hasPrivateKeyArmor, isAsymmetricVenue, prepareVenuePrivateKey } from '@/lib/adapters/pemPrivateKey'

const apiKeyField = z.string().trim().min(10).max(512).refine((value) => !/\s/.test(value), {
  message: 'API_KEY_INVALID',
})

const apiSecretField = z.string().max(16384).optional()

const passphraseField = z.string().trim().min(1).max(100).optional()

const proxyField = z.string().trim().min(3).max(1024).refine((value) => !/\s/.test(value), {
  message: 'PROXY_INVALID',
}).optional()

function secretRequired(exchange: string): boolean {
  return exchange === 'okx' || exchange === 'gateio'
}

function privateKeyIssue(exchange: string, secret: string): string | null {
  if (!isAsymmetricVenue(exchange)) return null
  if (!hasPrivateKeyArmor(secret)) return 'PRIVATE_KEY_INVALID'
  try {
    prepareVenuePrivateKey(exchange, secret)
    return null
  } catch (error) {
    return error instanceof Error && error.message === 'UNSUPPORTED_SIGNING_KEY'
      ? 'PRIVATE_KEY_ALGORITHM_UNSUPPORTED'
      : 'PRIVATE_KEY_INVALID'
  }
}

function rejectSecret(exchange: string, apiSecret: string | undefined, ctx: z.RefinementCtx) {
  const secret = apiSecret ?? ''
  if (secretRequired(exchange)) {
    const compact = secret.trim()
    if (compact.length < 10 || compact.length > 512 || /\s/.test(compact)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'API_SECRET_INVALID',
        path: ['apiSecret'],
      })
    }
    return
  }
  const issue = privateKeyIssue(exchange, secret)
  if (issue) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: issue,
      path: ['apiSecret'],
    })
  }
}

function rejectPassphrase(exchange: string, passphrase: string | undefined, ctx: z.RefinementCtx) {
  if ((exchange === 'okx' || exchange === 'bitget') && !passphrase) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'PASSPHRASE_REQUIRED',
      path: ['passphrase'],
    })
  }
}

export const ConnectExchangeSchema = z.object({
  exchange: z.enum(EXCHANGES),
  apiKey: apiKeyField,
  apiSecret: apiSecretField,
  passphrase: passphraseField,
  proxy: proxyField,
  label: z.string().trim().min(1).max(50).optional(),
}).superRefine((data, ctx) => {
  rejectSecret(data.exchange, data.apiSecret, ctx)
  rejectPassphrase(data.exchange, data.passphrase, ctx)
})

export const SyncExchangeSchema = z.object({
  exchangeAccountId: z.string().uuid(),
})

export const UpdateExchangeActiveSchema = z.object({
  is_active: z.boolean(),
})

export const UpdateExchangeKeysSchema = z.object({
  apiKey: apiKeyField,
  apiSecret: apiSecretField,
  passphrase: passphraseField,
  proxy: proxyField,
  label: z.string().max(50).nullable().optional(),
  exchange: z.enum(EXCHANGES).optional(),
}).superRefine((data, ctx) => {
  if (data.exchange) {
    rejectSecret(data.exchange, data.apiSecret, ctx)
    rejectPassphrase(data.exchange, data.passphrase, ctx)
  }
})

export type ConnectExchangeInput = z.infer<typeof ConnectExchangeSchema>
export type SyncExchangeInput = z.infer<typeof SyncExchangeSchema>
export type UpdateExchangeActiveInput = z.infer<typeof UpdateExchangeActiveSchema>
export type UpdateExchangeKeysInput = z.infer<typeof UpdateExchangeKeysSchema>

const KEY_ERROR_CODES = new Set(['PRIVATE_KEY_INVALID', 'PRIVATE_KEY_ALGORITHM_UNSUPPORTED'])

export function exchangeKeyErrorCode(error: z.ZodError): string {
  const match = error.issues.find((issue) => KEY_ERROR_CODES.has(issue.message))
  return match ? match.message : 'VALIDATION_ERROR'
}
