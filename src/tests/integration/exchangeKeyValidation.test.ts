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
    return { retCode: 0, retMsg: SECRET, result: { readOnly: 1, permissions: { Custom: ['Nope'] }, ips: ['203.0.113.10'] } }
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
})
