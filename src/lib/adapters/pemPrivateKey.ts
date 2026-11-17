import { createPrivateKey, sign as cryptoSign, type KeyObject } from 'crypto'
import type { SecretFormat } from '@/lib/types'

const ARMOR = /-----(BEGIN|END) ([A-Z0-9 ]+)-----/g
const PKCS1_LABEL = 'RSA PRIVATE KEY'
const PKCS8_LABEL = 'PRIVATE KEY'
const BASE64_BODY = /^[A-Za-z0-9+/]+={0,2}$/

export type PrivateKeyAlgorithm = 'rsa' | 'ed25519'
export type AsymmetricVenue = 'binance' | 'bybit' | 'bitget'
export type { SecretFormat }

export const ASYMMETRIC_VENUES: readonly AsymmetricVenue[] = ['binance', 'bybit', 'bitget']

export const VENUE_ALGORITHMS: Record<AsymmetricVenue, readonly PrivateKeyAlgorithm[]> = {
  binance: ['rsa', 'ed25519'],
  bybit: ['rsa'],
  bitget: ['rsa'],
}

export type NormalizedPrivateKey = {
  base64: string
  der: Buffer
  pkcs8Base64: string
  key: KeyObject
  algorithm: PrivateKeyAlgorithm
}

export function isAsymmetricVenue(exchange: string): exchange is AsymmetricVenue {
  return (ASYMMETRIC_VENUES as readonly string[]).includes(exchange)
}

export function hasPrivateKeyArmor(value: string): boolean {
  return value.includes(`BEGIN ${PKCS8_LABEL}-----`) || value.includes(`BEGIN ${PKCS1_LABEL}-----`)
}

function armorLabel(pem: string): string {
  const labels = [...pem.matchAll(ARMOR)].map((match) => `${match[1]} ${match[2]}`)
  if (labels.length !== 2) throw new Error('PRIVATE_KEY_INVALID')
  const [begin, end] = labels
  const label = begin.replace(/^BEGIN /, '')
  if (!begin.startsWith('BEGIN ') || end !== `END ${label}`) throw new Error('PRIVATE_KEY_INVALID')
  if (label !== PKCS8_LABEL && label !== PKCS1_LABEL) throw new Error('PRIVATE_KEY_INVALID')
  return label
}

function asAlgorithm(key: KeyObject): PrivateKeyAlgorithm {
  const algorithm = key.asymmetricKeyType
  if (algorithm !== 'rsa' && algorithm !== 'ed25519') throw new Error('UNSUPPORTED_SIGNING_KEY')
  return algorithm
}

function parseDer(der: Buffer, type: 'pkcs8' | 'pkcs1'): KeyObject {
  try {
    return createPrivateKey({ key: der, format: 'der', type })
  } catch {
    throw new Error('PRIVATE_KEY_INVALID')
  }
}

export function normalizePrivateKeyPem(pem: string): NormalizedPrivateKey {
  const label = armorLabel(pem)
  const base64 = pem.replace(ARMOR, '').replace(/\s+/g, '')
  if (base64.length === 0 || !BASE64_BODY.test(base64)) throw new Error('PRIVATE_KEY_INVALID')
  const der = Buffer.from(base64, 'base64')
  if (der.length === 0) throw new Error('PRIVATE_KEY_INVALID')
  const key = parseDer(der, label === PKCS1_LABEL ? 'pkcs1' : 'pkcs8')
  const algorithm = asAlgorithm(key)
  const pkcs8Base64 = key.export({ format: 'der', type: 'pkcs8' }).toString('base64')
  return { base64, der, pkcs8Base64, key, algorithm }
}

export function assertVenueAlgorithm(venue: AsymmetricVenue, algorithm: PrivateKeyAlgorithm): void {
  if (!VENUE_ALGORITHMS[venue].includes(algorithm)) throw new Error('UNSUPPORTED_SIGNING_KEY')
}

export function prepareVenuePrivateKey(
  venue: AsymmetricVenue,
  pem: string
): { stored: string; algorithm: PrivateKeyAlgorithm } {
  const normalized = normalizePrivateKeyPem(pem)
  assertVenueAlgorithm(venue, normalized.algorithm)
  return { stored: normalized.pkcs8Base64, algorithm: normalized.algorithm }
}

export function keyObjectFromSecret(material: string): KeyObject {
  try {
    const trimmed = material.trim()
    if (trimmed.includes('-----BEGIN ')) return normalizePrivateKeyPem(trimmed).key
    const base64 = trimmed.replace(/\s+/g, '')
    if (base64.length === 0 || !BASE64_BODY.test(base64)) throw new Error('PRIVATE_KEY_INVALID')
    const key = parseDer(Buffer.from(base64, 'base64'), 'pkcs8')
    asAlgorithm(key)
    return key
  } catch {
    throw new Error('UNSUPPORTED_SIGNING_KEY')
  }
}

export function signAsymmetricKey(venue: AsymmetricVenue, payload: string, key: KeyObject): string {
  const algorithm = asAlgorithm(key)
  assertVenueAlgorithm(venue, algorithm)
  const data = Buffer.from(payload, 'utf8')
  const digest = algorithm === 'ed25519' ? null : 'sha256'
  return cryptoSign(digest, data, key).toString('base64')
}
