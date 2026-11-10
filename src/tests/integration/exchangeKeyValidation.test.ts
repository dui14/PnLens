import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { credentials, installFastSleep, jsonResponse } from './support/http'

process.env.ENCRYPTION_MASTER_KEY = Buffer.alloc(32, 3).toString('base64')
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'
delete process.env.EXCHANGE_PROXY_URL
delete process.env.EXCHANGE_PROXY

const httpState = vi.hoisted(() => ({
  requests: [] as string[],
  proxies: [] as Array<string | null | undefined>,
  respond: (_url: string): Response => jsonResponse({ msg: 'test-api-secret' }, 500),
}))

const authState = vi.hoisted(() => ({
  userId: 'user-1',
}))

const db = vi.hoisted(() => ({
  createExchangeAccount: vi.fn(),
  createApiKey: vi.fn(),
  deleteExchangeAccount: vi.fn(),
  exchangeAccountExists: vi.fn(),
  getExchangeAccounts: vi.fn(),
  getExchangeAccountById: vi.fn(),
  getApiKey: vi.fn(),
  updateLastSynced: vi.fn(),
  updateExchangeActive: vi.fn(),
  updateApiKeyRecord: vi.fn(),
  updateSyncStatus: vi.fn(),
}))

vi.mock('@/lib/db/exchangeDb', () => db)

vi.mock('@/lib/db/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: authState.userId } } }),
    },
  }),
  createSupabaseServiceClient: () => ({ role: 'service' }),
}))

vi.mock('@/lib/adapters/httpClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/adapters/httpClient')>('@/lib/adapters/httpClient')
  return {
    ...actual,
    fetchExchange: (url: string, options?: { proxy?: string | null }) => {
      httpState.requests.push(String(url))
      httpState.proxies.push(options?.proxy)
      return httpState.respond(String(url))
    },
  }
})

import { POST } from '@/app/api/exchange/connect/route'
import { PUT } from '@/app/api/exchange/accounts/[id]/route'
import { syncExchangeAccount } from '@/lib/services/exchangeService'
import { interpretGateAccountDetail } from '@/lib/adapters/credentialValidation'
import { resolveExchangeProxy } from '@/lib/adapters/httpClient'
import type { SupabaseClient } from '@supabase/supabase-js'

installFastSleep()

const USER_PROXY = 'http://evil.example:8080'
const SECRET = credentials.apiSecret

type ExchangeName = 'binance' | 'okx' | 'bybit' | 'bitget' | 'gateio'

const probePaths: Record<ExchangeName, string> = {
  binance: '/sapi/v1/account/apiRestrictions',
  okx: '/api/v5/account/config',
  bybit: '/v5/user/query-api',
  bitget: '/api/v2/user/apikey-info',
  gateio: '/api/v4/account/detail',
}

function readOnlyBody(exchange: ExchangeName): unknown {
  if (exchange === 'binance') {
    return {
      ipRestrict: true,
      enableReading: true,
      enableSpotAndMarginTrading: false,
      enableWithdrawals: false,
      enableInternalTransfer: false,
      permitsUniversalTransfer: false,
    }
  }
  if (exchange === 'okx') return { code: '0', data: [{ perm: 'read_only' }], msg: SECRET }
  if (exchange === 'bybit') return { retCode: 0, retMsg: SECRET, result: { readOnly: 1, ips: ['203.0.113.10'] } }
  if (exchange === 'bitget') {
    return {
      code: '00000',
      msg: SECRET,
      data: { authorities: ['readonly'], status: 'normal', ipList: ['203.0.113.10'] },
    }
  }
  return {
    read_only: true,
    'spot.write': false,
    'futures.write': false,
    'withdraw.write': false,
    'transfer.write': false,
    message: SECRET,
  }
}

function invalidKeyBody(exchange: ExchangeName): { status: number; body: unknown } {
  if (exchange === 'binance') return { status: 400, body: { code: -2014, msg: `format ${SECRET}` } }
  if (exchange === 'okx') return { status: 401, body: { code: '50111', msg: SECRET } }
  if (exchange === 'bybit') return { status: 401, body: { retCode: 10003, retMsg: SECRET } }
  if (exchange === 'bitget') return { status: 200, body: { code: '40001', msg: SECRET } }
  return { status: 401, body: { label: 'INVALID_KEY', message: SECRET } }
}

function tradeBody(exchange: ExchangeName): unknown {
  if (exchange === 'binance') {
    return {
      enableReading: true,
      enableSpotAndMarginTrading: true,
      enableWithdrawals: false,
      enableInternalTransfer: false,
      permitsUniversalTransfer: false,
    }
  }
  if (exchange === 'okx') return { code: '0', data: [{ perm: 'read_only,trade' }] }
  if (exchange === 'bybit') return { retCode: 0, result: { readOnly: 0, ips: ['203.0.113.10'] } }
  if (exchange === 'bitget') {
    return { code: '00000', data: { authorities: ['readonly', 'trade'], status: 'normal', ipList: ['203.0.113.10'] } }
  }
  return { read_only: true, 'spot.write': true, 'futures.write': false, 'withdraw.write': false, 'transfer.write': false }
}

function withdrawBody(exchange: ExchangeName): unknown {
  if (exchange === 'binance') {
    return {
      enableReading: true,
      enableSpotAndMarginTrading: false,
      enableWithdrawals: true,
      enableInternalTransfer: false,
      permitsUniversalTransfer: false,
    }
  }
  if (exchange === 'okx') return { code: '0', data: [{ perm: 'read_only,withdraw' }] }
  if (exchange === 'bybit') {
    return { retCode: 0, result: { readOnly: 1, permissions: { Wallet: ['Withdraw'] }, ips: ['203.0.113.10'] } }
  }
  if (exchange === 'bitget') {
    return { code: '00000', data: { authorities: ['readonly', 'withdraw'], status: 'normal', ipList: ['203.0.113.10'] } }
  }
  return { read_only: true, 'spot.write': false, 'futures.write': false, 'withdraw.write': true, 'transfer.write': false }
}

function unknownBody(exchange: ExchangeName): unknown {
  if (exchange === 'binance') return { enableFutures: true, msg: SECRET }
  if (exchange === 'okx') return { code: '0', data: [{}], msg: SECRET }
  if (exchange === 'bybit') {
    return { retCode: 0, retMsg: SECRET, result: { permissions: { Custom: ['Nope'] }, ips: ['203.0.113.10'] } }
  }
  if (exchange === 'bitget') {
    return {
      code: '00000',
      msg: SECRET,
      data: { authorities: ['readonly', 'mystery'], status: 'normal', ipList: ['203.0.113.10'] },
    }
  }
  return { user_id: '1', message: SECRET }
}

function connectBody(exchange: ExchangeName): Record<string, string> {
  return {
    exchange,
    apiKey: credentials.apiKey,
    apiSecret: SECRET,
    passphrase: credentials.passphrase,
    label: 'desk',
    proxy: USER_PROXY,
  }
}

async function postConnect(body: Record<string, string>): Promise<Response> {
  return POST(
    new NextRequest('http://localhost/api/exchange/connect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  )
}

function assertNoSecret(value: unknown): void {
  const text = JSON.stringify(value)
  expect(text).not.toContain(SECRET)
  expect(text).not.toContain(credentials.passphrase)
  expect(text).not.toContain('evil.example')
}

describe('exchange key validation', () => {
  beforeEach(() => {
    httpState.requests.length = 0
    httpState.proxies.length = 0
    authState.userId = `user-${crypto.randomUUID()}`
    db.createExchangeAccount.mockReset()
    db.createApiKey.mockReset()
    db.deleteExchangeAccount.mockReset()
    db.exchangeAccountExists.mockReset()
    db.exchangeAccountExists.mockResolvedValue(false)
    db.deleteExchangeAccount.mockResolvedValue(true)
    db.createApiKey.mockResolvedValue(true)
    db.updateApiKeyRecord.mockReset()
    db.updateApiKeyRecord.mockResolvedValue(true)
    db.getApiKey.mockReset()
    db.updateSyncStatus.mockReset()
    db.getExchangeAccountById.mockReset()
    db.getExchangeAccountById.mockImplementation(async () => ({
      id: 'acc-1',
      user_id: authState.userId,
      exchange: 'binance',
      label: 'desk',
      is_active: true,
      sync_status: 'pending',
      sync_error: null,
      last_synced: null,
      created_at: '2026-01-01T00:00:00.000Z',
    }))
    db.createExchangeAccount.mockImplementation(async (_client: unknown, userId: string, exchange: string, label: string | null) => ({
      id: 'acc-1',
      user_id: userId,
      exchange,
      label,
      is_active: true,
      sync_status: 'pending',
      sync_error: null,
      last_synced: null,
      created_at: '2026-01-01T00:00:00.000Z',
    }))
    vi.stubGlobal('fetch', async (url: string) => {
      httpState.requests.push(String(url))
      return httpState.respond(String(url))
    })
  })

  const exchanges: ExchangeName[] = ['binance', 'okx', 'bybit', 'bitget', 'gateio']

  for (const exchange of exchanges) {
    describe(exchange, () => {
      it('accepts a read-only key and does not store the user proxy', async () => {
        httpState.respond = () => jsonResponse(readOnlyBody(exchange))
        const response = await postConnect(connectBody(exchange))
        const payload = await response.json()

        expect(response.status).toBe(201)
        expect(payload.success).toBe(true)
        expect(payload.warnings).toEqual([])
        assertNoSecret(payload)
        expect(httpState.requests.filter((url) => url.includes(probePaths[exchange]))).toHaveLength(1)
        expect(db.createExchangeAccount).toHaveBeenCalledTimes(1)
        expect(db.createApiKey).toHaveBeenCalledTimes(1)
        const keyArgs = db.createApiKey.mock.calls[0]
        expect(keyArgs[8]).toBeNull()
        expect(keyArgs[9]).toBeNull()
        assertNoSecret(db.createApiKey.mock.calls)
        if (exchange === 'binance' || exchange === 'bybit') {
          expect(httpState.proxies.every((proxy) => proxy == null)).toBe(true)
        }
      })

      it('rejects an invalid key and writes nothing', async () => {
        const failure = invalidKeyBody(exchange)
        httpState.respond = () => jsonResponse(failure.body, failure.status)
        const response = await postConnect(connectBody(exchange))
        const payload = await response.json()

        expect(response.status).toBe(400)
        expect(payload).toEqual({ success: false, data: null, error: 'INVALID_KEY' })
        assertNoSecret(payload)
        expect(db.createExchangeAccount).not.toHaveBeenCalled()
        expect(db.createApiKey).not.toHaveBeenCalled()
      })

      it('rejects trade permission and writes nothing', async () => {
        httpState.respond = () => jsonResponse(tradeBody(exchange))
        const response = await postConnect(connectBody(exchange))
        const payload = await response.json()

        expect(payload).toEqual({ success: false, data: null, error: 'TRADE_PERMISSION_DETECTED' })
        assertNoSecret(payload)
        expect(db.createExchangeAccount).not.toHaveBeenCalled()
        expect(db.createApiKey).not.toHaveBeenCalled()
      })

      it('rejects withdraw permission and writes nothing', async () => {
        httpState.respond = () => jsonResponse(withdrawBody(exchange))
        const response = await postConnect(connectBody(exchange))
        const payload = await response.json()

        expect(payload).toEqual({ success: false, data: null, error: 'WITHDRAW_PERMISSION_DETECTED' })
        assertNoSecret(payload)
        expect(db.createExchangeAccount).not.toHaveBeenCalled()
        expect(db.createApiKey).not.toHaveBeenCalled()
      })

      it('stores a key when permissions are unverified', async () => {
        httpState.respond = () => jsonResponse(unknownBody(exchange))
        const response = await postConnect(connectBody(exchange))
        const payload = await response.json()

        expect(response.status).toBe(201)
        expect(payload.success).toBe(true)
        expect(payload.warnings).toContain('PERMISSIONS_UNVERIFIED')
        assertNoSecret(payload)
        expect(db.createExchangeAccount).toHaveBeenCalledTimes(1)
        expect(db.createApiKey).toHaveBeenCalledTimes(1)
        expect(db.createApiKey.mock.calls[0][8]).toBeNull()
        expect(db.createApiKey.mock.calls[0][9]).toBeNull()
      })

      it('maps an upstream 500 to EXCHANGE_UNREACHABLE and writes nothing', async () => {
        httpState.respond = () => jsonResponse({ msg: SECRET, message: SECRET }, 500)
        const response = await postConnect(connectBody(exchange))
        const payload = await response.json()

        expect(response.status).toBe(502)
        expect(payload).toEqual({ success: false, data: null, error: 'EXCHANGE_UNREACHABLE' })
        assertNoSecret(payload)
        expect(db.createExchangeAccount).not.toHaveBeenCalled()
        expect(db.createApiKey).not.toHaveBeenCalled()
      })
    })
  }

  it('removes the account when the key insert fails', async () => {
    httpState.respond = () => jsonResponse(readOnlyBody('binance'))
    db.createApiKey.mockResolvedValue(false)
    const response = await postConnect(connectBody('binance'))
    const payload = await response.json()

    expect(payload).toEqual({ success: false, data: null, error: 'INTERNAL_ERROR' })
    expect(db.deleteExchangeAccount).toHaveBeenCalledWith(expect.anything(), 'acc-1', authState.userId)
    assertNoSecret(payload)
  })

  it('returns CONFLICT before calling the exchange when the account already exists', async () => {
    db.exchangeAccountExists.mockResolvedValue(true)
    httpState.respond = () => jsonResponse(readOnlyBody('binance'))
    const response = await postConnect(connectBody('binance'))
    const payload = await response.json()

    expect(response.status).toBe(409)
    expect(payload).toEqual({ success: false, data: null, error: 'CONFLICT' })
    expect(httpState.requests).toHaveLength(0)
    expect(db.createExchangeAccount).not.toHaveBeenCalled()
  })

  it('accepts Binance futures permission only with FUTURES_PERMISSION_PRESENT', async () => {
    httpState.respond = () => jsonResponse({
      ...readOnlyBody('binance') as Record<string, boolean>,
      enableFutures: true,
      msg: SECRET,
    })
    const response = await postConnect(connectBody('binance'))
    const payload = await response.json()

    expect(response.status).toBe(201)
    expect(payload.warnings).toEqual(['FUTURES_PERMISSION_PRESENT'])
    assertNoSecret(payload)
    expect(db.createApiKey).toHaveBeenCalledTimes(1)
  })

  it('does not treat nested Gate.io flags as a read-only proof', () => {
    const result = interpretGateAccountDetail(200, {
      key: {
        read_only: true,
        'spot.write': false,
        'futures.write': false,
        'withdraw.write': false,
        'transfer.write': false,
      },
      message: SECRET,
    })
    expect(result.ok).toBe(true)
    expect(result.warnings).toEqual(['PERMISSIONS_UNVERIFIED'])
    expect(JSON.stringify(result)).not.toContain(SECRET)
  })

  it('uses only EXCHANGE_PROXY_URL and ignores a stored or legacy proxy', () => {
    const previousUrl = process.env.EXCHANGE_PROXY_URL
    const previousLegacy = process.env.EXCHANGE_PROXY
    process.env.EXCHANGE_PROXY_URL = 'http://platform.example:8080'
    process.env.EXCHANGE_PROXY = 'http://legacy.example:8080'
    const selected = resolveExchangeProxy(USER_PROXY)
    delete process.env.EXCHANGE_PROXY_URL
    const withoutPlatform = resolveExchangeProxy(USER_PROXY)
    if (previousUrl === undefined) delete process.env.EXCHANGE_PROXY_URL
    else process.env.EXCHANGE_PROXY_URL = previousUrl
    if (previousLegacy === undefined) delete process.env.EXCHANGE_PROXY
    else process.env.EXCHANGE_PROXY = previousLegacy

    expect(selected).toContain('platform.example')
    expect(selected).not.toContain('evil.example')
    expect(selected).not.toContain('legacy.example')
    expect(withoutPlatform).toBeNull()
  })

  it('returns NO_KEY when scan finds an account without a key', async () => {
    db.getApiKey.mockResolvedValue(null)
    const result = await syncExchangeAccount({} as SupabaseClient, authState.userId, 'acc-1')
    expect(result).toEqual({ success: false, error: 'NO_KEY' })
    expect(httpState.requests).toHaveLength(0)
  })

  it('still returns INTERNAL_ERROR when deleting an orphan account throws', async () => {
    httpState.respond = () => jsonResponse(readOnlyBody('binance'))
    db.createApiKey.mockResolvedValue(false)
    db.deleteExchangeAccount.mockRejectedValue(new Error('delete failed'))
    const response = await postConnect(connectBody('binance'))
    const payload = await response.json()
    expect(response.status).toBe(500)
    expect(payload).toEqual({ success: false, data: null, error: 'INTERNAL_ERROR' })
    assertNoSecret(payload)
  })

  it('stops calling the exchange after the validation attempt limit', async () => {
    authState.userId = 'rate-limit-user'
    httpState.respond = () => jsonResponse({ code: -2014, msg: SECRET }, 400)
    let lastStatus = 0
    for (let attempt = 0; attempt < 11; attempt += 1) {
      const response = await postConnect(connectBody('binance'))
      lastStatus = response.status
      assertNoSecret(await response.json())
    }
    expect(lastStatus).toBe(429)
    expect(httpState.requests).toHaveLength(10)
    expect(db.createExchangeAccount).not.toHaveBeenCalled()
  })

  describe('PUT /api/exchange/accounts/:id', () => {
  function putBody(): Record<string, string> {
    return {
      apiKey: credentials.apiKey,
      apiSecret: SECRET,
      passphrase: credentials.passphrase,
      proxy: USER_PROXY,
    }
  }

  async function putKeys(): Promise<Response> {
    return PUT(
      new NextRequest('http://localhost/api/exchange/accounts/acc-1', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(putBody()),
      }),
      { params: Promise.resolve({ id: 'acc-1' }) }
    )
  }

  it('validates a changed key and does not write proxy columns', async () => {
    httpState.respond = () => jsonResponse(readOnlyBody('binance'))
    const response = await putKeys()
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.success).toBe(true)
    assertNoSecret(payload)
    expect(db.updateApiKeyRecord).toHaveBeenCalledTimes(1)
    assertNoSecret(db.updateApiKeyRecord.mock.calls)
    expect(JSON.stringify(db.updateApiKeyRecord.mock.calls)).not.toContain('proxy')
    expect(httpState.requests.filter((url) => url.includes('/sapi/v1/account/apiRestrictions'))).toHaveLength(1)
  })

  it('stores nothing when validation fails', async () => {
    httpState.respond = () => jsonResponse({ code: -2014, msg: SECRET }, 400)
    const response = await putKeys()
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload).toEqual({ success: false, data: null, error: 'INVALID_KEY' })
    expect(db.updateApiKeyRecord).not.toHaveBeenCalled()
    assertNoSecret(payload)
  })

  it('maps an upstream 500 to EXCHANGE_UNREACHABLE and writes nothing', async () => {
    httpState.respond = () => jsonResponse({ msg: SECRET }, 500)
    const response = await putKeys()
    const payload = await response.json()

    expect(response.status).toBe(502)
    expect(payload).toEqual({ success: false, data: null, error: 'EXCHANGE_UNREACHABLE' })
    expect(db.updateApiKeyRecord).not.toHaveBeenCalled()
    assertNoSecret(payload)
  })

  it('shares the validation attempt limit and does not call the exchange when exceeded', async () => {
    authState.userId = 'put-rate-limit-user'
    httpState.respond = () => jsonResponse({ code: -2014, msg: SECRET }, 400)
    let lastStatus = 0
    for (let attempt = 0; attempt < 11; attempt += 1) {
      const response = await putKeys()
      lastStatus = response.status
      assertNoSecret(await response.json())
    }
    expect(lastStatus).toBe(429)
    expect(httpState.requests).toHaveLength(10)
    expect(db.updateApiKeyRecord).not.toHaveBeenCalled()
  })
  })
})
