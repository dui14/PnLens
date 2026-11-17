import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createExchangeAdapter } from '@/lib/adapters/exchangeFactory'
import { DAY_MS, EXCHANGE_SCAN_LIMITS } from '@/lib/scan/scanLimits'
import type { ExchangeCredentials } from '@/lib/types'

delete process.env.EXCHANGE_PROXY_URL
delete process.env.EXCHANGE_PROXY
delete process.env.EXCHANGE_PROXY_USERNAME
delete process.env.EXCHANGE_PROXY_PASSWORD

const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env.local')

function loadEnvFile(filePath: string): Record<string, string> {
  const values: Record<string, string> = {}
  let text = ''
  try {
    text = readFileSync(filePath, 'utf8')
  } catch {
    return values
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
    const separator = trimmed.indexOf('=')
    const key = trimmed.slice(0, separator).trim()
    const raw = trimmed.slice(separator + 1).trim()
    const quoted =
      (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))
    values[key] = quoted ? raw.slice(1, -1) : raw
  }
  return values
}

const envFile = loadEnvFile(envPath)

function envValue(name: string): string {
  const fromFile = envFile[name] ?? ''
  return fromFile.length > 0 ? fromFile : (process.env[name] ?? '')
}

function readPrivateKeyPem(filePath: string): string {
  let text = ''
  try {
    text = readFileSync(filePath, 'utf8')
  } catch {
    return ''
  }
  const match = text.match(/^PRIVATE_KEY="([\s\S]*?)"/m)
  if (!match || match[1].trim().length === 0) return ''
  return match[1].replace(/\\n/g, '\n')
}

const privateKeyPem = readPrivateKeyPem(envPath)

function present(names: string[]): boolean {
  return names.every((name) => (name === 'PRIVATE_KEY' ? privateKeyPem.length > 0 : envValue(name).length > 0))
}

const secretValues = [
  ...Object.values(envFile).filter((value) => value.length >= 8),
  ...(privateKeyPem.length >= 8 ? [privateKeyPem] : []),
]

function redact(body: string): string {
  let text = body
  for (const secret of secretValues) {
    text = text.split(secret).join('[redacted]')
  }
  return text.replace(/\s+/g, ' ').slice(0, 400)
}

type CapturedResponse = {
  status: number
  body: string
}

let lastResponse: CapturedResponse | null = null
const nativeFetch = globalThis.fetch.bind(globalThis)

const authenticatedCodes = new Set([
  'OK',
  'TRADE_PERMISSION_DETECTED',
  'WITHDRAW_PERMISSION_DETECTED',
  'TRANSFER_PERMISSION_DETECTED',
])

type VenueCase = {
  exchange: 'binance' | 'bybit' | 'okx' | 'bitget' | 'gateio'
  fields: string[]
  credentials: () => ExchangeCredentials
}

const venues: VenueCase[] = [
  {
    exchange: 'binance',
    fields: ['BINANCE_API_KEY', 'PRIVATE_KEY'],
    credentials: () => ({
      apiKey: envValue('BINANCE_API_KEY'),
      apiSecret: privateKeyPem,
    }),
  },
  {
    exchange: 'bybit',
    fields: ['BYBIT_API_KEY', 'PRIVATE_KEY'],
    credentials: () => ({
      apiKey: envValue('BYBIT_API_KEY'),
      apiSecret: privateKeyPem,
    }),
  },
  {
    exchange: 'okx',
    fields: ['OKX_API_KEY', 'OKX_API_SECRET', 'OKX_PASSPHRASE'],
    credentials: () => ({
      apiKey: envValue('OKX_API_KEY'),
      apiSecret: envValue('OKX_API_SECRET'),
      passphrase: envValue('OKX_PASSPHRASE'),
    }),
  },
  {
    exchange: 'bitget',
    fields: ['BITGET_API_KEY', 'BITGET_PASSPHRASE', 'PRIVATE_KEY'],
    credentials: () => ({
      apiKey: envValue('BITGET_API_KEY'),
      apiSecret: privateKeyPem,
      passphrase: envValue('BITGET_PASSPHRASE'),
    }),
  },
  {
    exchange: 'gateio',
    fields: ['GATEIO_API_KEY', 'GATEIO_API_SECRET'],
    credentials: () => ({
      apiKey: envValue('GATEIO_API_KEY'),
      apiSecret: envValue('GATEIO_API_SECRET'),
    }),
  },
]

beforeAll(() => {
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await nativeFetch(input, init)
    const body = await response.clone().text()
    lastResponse = { status: response.status, body }
    return response
  }
})

afterAll(() => {
  globalThis.fetch = nativeFetch
})

describe('live exchange credentials from src/.env.local', () => {
  for (const venue of venues) {
    const ready = present(venue.fields)
    it.skipIf(!ready)(
      `${venue.exchange} accepts ${venue.fields.length} configured field(s) from ${envPath}`,
      async () => {
        lastResponse = null
        const adapter = await createExchangeAdapter(venue.exchange)
        const result = await adapter.validateCredentials(venue.credentials())
        const captured = lastResponse as CapturedResponse | null
        const detail = captured
          ? `status=${captured.status} body=${redact(captured.body)}`
          : 'no HTTP response captured'
        expect(
          authenticatedCodes.has(result.code),
          `${venue.exchange} code=${result.code} permissions=${result.permissions.join(',')} warnings=${result.warnings.join(',')} ${detail}`
        ).toBe(true)
      },
      60_000
    )
    it.skipIf(!ready)(
      `${venue.exchange} fetches trades over the full lookback`,
      async () => {
        const days = EXCHANGE_SCAN_LIMITS[venue.exchange].maxLookbackDays
        const end = new Date()
        const adapter = await createExchangeAdapter(venue.exchange)
        const trades = await adapter.fetchTrades(venue.credentials(), new Date(end.getTime() - days * DAY_MS), end)
        const times = trades.map((trade) => new Date(trade.traded_at).getTime()).filter((time) => Number.isFinite(time))
        const earliest = times.length > 0 ? new Date(Math.min(...times)).toISOString() : 'none'
        console.log(`[live] ${venue.exchange} lookbackDays=${days} trades=${trades.length} earliest=${earliest}`)
        expect(Array.isArray(trades)).toBe(true)
      },
      600_000
    )
  }
})
