import { createHmac, createPublicKey, generateKeyPairSync, verify } from 'crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  keyObjectFromSecret,
  normalizePrivateKeyPem,
  prepareVenuePrivateKey,
  signAsymmetricKey,
} from '@/lib/adapters/pemPrivateKey'
import { ConnectExchangeSchema, exchangeKeyErrorCode } from '@/lib/validators/exchange'

const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env.local')

function readPrivateKeyPem(filePath: string): string | null {
  if (!existsSync(filePath)) return null
  const match = readFileSync(filePath, 'utf8').match(/^PRIVATE_KEY="([\s\S]*?)"/m)
  if (!match || match[1].trim().length === 0) return null
  return match[1].replace(/\\n/g, '\n')
}

function generatedPem(type: 'rsa' | 'ed25519'): string {
  const { privateKey } =
    type === 'rsa' ? generateKeyPairSync('rsa', { modulusLength: 2048 }) : generateKeyPairSync('ed25519')
  return privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
}

const envPem = readPrivateKeyPem(envPath)
const keySources: Array<[string, string]> = [
  ['generated ed25519', generatedPem('ed25519')],
  ['generated rsa', generatedPem('rsa')],
  ...(envPem ? ([['env PRIVATE_KEY', envPem]] as Array<[string, string]>) : []),
]

function verifies(signature: string, payload: string, pem: string, algorithm: 'rsa' | 'ed25519'): boolean {
  const publicKey = createPublicKey(normalizePrivateKeyPem(pem).key)
  return verify(
    algorithm === 'ed25519' ? null : 'sha256',
    Buffer.from(payload),
    publicKey,
    Buffer.from(signature, 'base64')
  )
}

const allVenues = ['binance', 'bybit', 'bitget'] as const

describe.each(keySources)('PEM private key pipeline (%s)', (_label, pem) => {
  const normalized = normalizePrivateKeyPem(pem)
  const venues = normalized.algorithm === 'ed25519' ? (['binance'] as const) : allVenues

  it('strips PEM armor and whitespace, then decodes DER', () => {
    expect(normalized.base64.includes('BEGIN')).toBe(false)
    expect(normalized.base64.includes('END')).toBe(false)
    expect(/\s/.test(normalized.base64)).toBe(false)
    expect(normalized.der.length).toBeGreaterThan(0)
    expect(normalized.der.equals(Buffer.from(normalized.base64, 'base64'))).toBe(true)
  })

  it('reads the same DER from a textarea paste with CRLF, spaces, and literal \\n', () => {
    const lines = pem.trim().split('\n')
    const crlf = `  ${lines.join('\r\n')}\r\n`
    const spaced = lines.map((line) => `${line}  `).join('\n')
    const escaped = lines.join('\\n').replace(/\\n/g, '\n')
    for (const pasted of [crlf, spaced, escaped]) {
      expect(normalizePrivateKeyPem(pasted).der.equals(normalized.der)).toBe(true)
    }
  })

  it('builds a private KeyObject for RSA or Ed25519', () => {
    expect(normalized.key.type).toBe('private')
    expect(normalized.algorithm === 'rsa' || normalized.algorithm === 'ed25519').toBe(true)
    expect(normalized.key.asymmetricKeyType).toBe(normalized.algorithm)
  })

  it('signs Binance, Bybit, and Bitget payloads with the key object, not HMAC', () => {
    const payload = 'timestamp=1&recvWindow=5000'
    const hmacBase64 = createHmac('sha256', normalized.base64).update(payload).digest('base64')
    const hmacHex = createHmac('sha256', normalized.base64).update(payload).digest('hex')
    for (const venue of venues) {
      const signature = signAsymmetricKey(venue, payload, normalized.key)
      expect(signature).not.toBe(hmacBase64)
      expect(signature).not.toBe(hmacHex)
      expect(signature.includes(normalized.base64)).toBe(false)
      expect(verifies(signature, payload, pem, normalized.algorithm)).toBe(true)
    }
  })

  it('stores base64 PKCS#8 DER that signs again after it is read back', () => {
    const payload = '1700000000000key5000'
    for (const venue of venues) {
      const prepared = prepareVenuePrivateKey(venue, pem)
      expect(prepared.algorithm).toBe(normalized.algorithm)
      expect(prepared.stored).toBe(normalized.pkcs8Base64)
      expect(prepared.stored.includes('-----')).toBe(false)
      const reloaded = keyObjectFromSecret(prepared.stored)
      const signature = signAsymmetricKey(venue, payload, reloaded)
      expect(verifies(signature, payload, pem, prepared.algorithm)).toBe(true)
    }
  })

  it('accepts the env key through the connect validator for each venue', () => {
    for (const exchange of venues) {
      const parsed = ConnectExchangeSchema.safeParse({
        exchange,
        apiKey: 'live-api-key-value',
        apiSecret: pem,
        passphrase: exchange === 'bitget' ? 'phrase' : undefined,
      })
      expect(parsed.success).toBe(true)
    }
  })
})

describe('PEM private key formats', () => {
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const ed25519 = generateKeyPairSync('ed25519')
  const rsaPkcs8 = rsa.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const rsaPkcs1 = rsa.privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()
  const edPkcs8 = ed25519.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

  it('converts a PKCS#1 RSA PEM to the same stored PKCS#8 DER', () => {
    expect(prepareVenuePrivateKey('bybit', rsaPkcs1).stored).toBe(
      prepareVenuePrivateKey('bybit', rsaPkcs8).stored
    )
  })

  it('allows Ed25519 for Binance only', () => {
    expect(prepareVenuePrivateKey('binance', edPkcs8).algorithm).toBe('ed25519')
    expect(() => prepareVenuePrivateKey('bybit', edPkcs8)).toThrow('UNSUPPORTED_SIGNING_KEY')
    expect(() => prepareVenuePrivateKey('bitget', edPkcs8)).toThrow('UNSUPPORTED_SIGNING_KEY')
    expect(() =>
      signAsymmetricKey('bybit', 'x', ed25519.privateKey)
    ).toThrow('UNSUPPORTED_SIGNING_KEY')
  })

  it('rejects a PEM with missing footer, mismatched armor, bad base64, or non-key body', () => {
    const body = rsaPkcs8.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').trim()
    const cases = [
      rsaPkcs8.replace('-----END PRIVATE KEY-----', ''),
      rsaPkcs8.replace('-----END PRIVATE KEY-----', '-----END RSA PRIVATE KEY-----'),
      `-----BEGIN PRIVATE KEY-----\n${body}!!\n-----END PRIVATE KEY-----`,
      `-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----`,
      `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----`,
    ]
    for (const pem of cases) {
      expect(() => normalizePrivateKeyPem(pem)).toThrow('PRIVATE_KEY_INVALID')
    }
  })

  it('maps validator issues to PEM error codes', () => {
    const invalid = ConnectExchangeSchema.safeParse({
      exchange: 'binance',
      apiKey: 'live-api-key-value',
      apiSecret: 'not a pem',
    })
    const unsupported = ConnectExchangeSchema.safeParse({
      exchange: 'bybit',
      apiKey: 'live-api-key-value',
      apiSecret: edPkcs8,
    })
    expect(invalid.success).toBe(false)
    expect(unsupported.success).toBe(false)
    if (!invalid.success) expect(exchangeKeyErrorCode(invalid.error)).toBe('PRIVATE_KEY_INVALID')
    if (!unsupported.success) {
      expect(exchangeKeyErrorCode(unsupported.error)).toBe('PRIVATE_KEY_ALGORITHM_UNSUPPORTED')
    }
  })
})
