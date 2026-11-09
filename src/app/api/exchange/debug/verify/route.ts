import { createHash, createHmac } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { signOkxRequest } from '@/lib/adapters/okxApi'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import {
  isExchangeDebugVerifyEnabled,
  resolveDebugBaseUrl,
} from '@/lib/security/exchangeDebugAccess'
import {
  ExchangeDebugVerifySchema,
  type ExchangeDebugVerifyInput,
} from '@/lib/validators/exchangeDebug'

type DebugVerifyResult = {
  ok: boolean
  upstreamStatus: number
  exchangeCode: string | number | null
  exchangeMessage: string | null
  requestPath: string
  payload: unknown
}

function signBinance(query: string, secret: string): string {
  return createHmac('sha256', secret).update(query).digest('hex')
}

function signBybit(
  apiKey: string,
  secret: string,
  timestamp: number,
  recvWindow: number,
  queryString: string
): string {
  const payload = `${timestamp}${apiKey}${recvWindow}${queryString}`
  return createHmac('sha256', secret).update(payload).digest('hex')
}

function signBitget(
  timestamp: string,
  method: string,
  requestPath: string,
  body: string,
  secret: string
): string {
  const payload = `${timestamp}${method.toUpperCase()}${requestPath}${body}`
  return createHmac('sha256', secret).update(payload).digest('base64')
}

function signGateio(
  secret: string,
  method: string,
  requestPath: string,
  queryString: string,
  body: string,
  timestamp: string
): string {
  const bodyHash = createHash('sha512').update(body).digest('hex')
  const payload = `${method.toUpperCase()}\n/api/v4${requestPath}\n${queryString}\n${bodyHash}\n${timestamp}`
  return createHmac('sha512', secret).update(payload).digest('hex')
}

async function fetchJson(
  url: string,
  init: RequestInit
): Promise<{ status: number; ok: boolean; body: unknown }> {
  const response = await fetch(url, { ...init, redirect: 'manual' })
  if (response.status >= 300 && response.status < 400) {
    return { status: response.status, ok: false, body: null }
  }
  const text = await response.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }

  return {
    status: response.status,
    ok: response.ok,
    body,
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

async function verifyBinance(input: ExchangeDebugVerifyInput): Promise<DebugVerifyResult> {
  const baseUrl = input.baseUrl ?? 'https://api.binance.com'
  const recvWindow = input.recvWindow ?? 5000
  const timestamp = Date.now()
  const query = new URLSearchParams({
    recvWindow: String(recvWindow),
    timestamp: String(timestamp),
  })
  query.append('signature', signBinance(query.toString(), input.apiSecret))

  const requestPath = `/api/v3/account?${query.toString()}`
  const { ok, status, body } = await fetchJson(
    `${baseUrl}${requestPath}`,
    {
      method: 'GET',
      headers: {
        'X-MBX-APIKEY': input.apiKey,
      },
      cache: 'no-store',
    }
  )

  const record = asRecord(body)
  const exchangeCode = record?.code ?? null
  const exchangeMessage = typeof record?.msg === 'string' ? record.msg : null

  return {
    ok: ok && exchangeCode === null,
    upstreamStatus: status,
    exchangeCode: typeof exchangeCode === 'number' ? exchangeCode : null,
    exchangeMessage,
    requestPath,
    payload: body,
  }
}

async function verifyOkx(input: ExchangeDebugVerifyInput): Promise<DebugVerifyResult> {
  const baseUrl = input.baseUrl ?? 'https://www.okx.com'
  const ccy = input.ccy?.trim()
  const requestPath = ccy
    ? `/api/v5/account/balance?ccy=${encodeURIComponent(ccy)}`
    : '/api/v5/account/balance'
  const timestamp = new Date().toISOString()
  const signature = signOkxRequest(timestamp, 'GET', requestPath, '', input.apiSecret)

  const { ok, status, body } = await fetchJson(
    `${baseUrl}${requestPath}`,
    {
      method: 'GET',
      headers: {
        'OK-ACCESS-KEY': input.apiKey,
        'OK-ACCESS-SIGN': signature,
        'OK-ACCESS-TIMESTAMP': timestamp,
        'OK-ACCESS-PASSPHRASE': input.passphrase ?? '',
      },
      cache: 'no-store',
    }
  )

  const record = asRecord(body)
  const exchangeCode = record?.code ?? null
  const exchangeMessage = typeof record?.msg === 'string' ? record.msg : null

  return {
    ok: ok && exchangeCode === '0',
    upstreamStatus: status,
    exchangeCode: typeof exchangeCode === 'string' ? exchangeCode : null,
    exchangeMessage,
    requestPath,
    payload: body,
  }
}

async function verifyBybit(input: ExchangeDebugVerifyInput): Promise<DebugVerifyResult> {
  const baseUrl = input.baseUrl ?? 'https://api.bybit.com'
  const recvWindow = input.recvWindow ?? 5000
  const accountType = (input.accountType ?? 'UNIFIED').trim()
  const queryString = `accountType=${encodeURIComponent(accountType)}`
  const requestPath = `/v5/account/wallet-balance?${queryString}`
  const timestamp = Date.now()
  const signature = signBybit(input.apiKey, input.apiSecret, timestamp, recvWindow, queryString)

  const { ok, status, body } = await fetchJson(
    `${baseUrl}${requestPath}`,
    {
      method: 'GET',
      headers: {
        'X-BAPI-API-KEY': input.apiKey,
        'X-BAPI-SIGN': signature,
        'X-BAPI-SIGN-TYPE': '2',
        'X-BAPI-TIMESTAMP': String(timestamp),
        'X-BAPI-RECV-WINDOW': String(recvWindow),
      },
      cache: 'no-store',
    }
  )

  const record = asRecord(body)
  const exchangeCode = record?.retCode ?? null
  const exchangeMessage = typeof record?.retMsg === 'string' ? record.retMsg : null

  return {
    ok: ok && exchangeCode === 0,
    upstreamStatus: status,
    exchangeCode: typeof exchangeCode === 'number' ? exchangeCode : null,
    exchangeMessage,
    requestPath,
    payload: body,
  }
}

async function verifyBitget(input: ExchangeDebugVerifyInput): Promise<DebugVerifyResult> {
  const baseUrl = input.baseUrl ?? 'https://api.bitget.com'
  const requestPath = '/api/v2/spot/account/assets'
  const timestamp = Date.now().toString()
  const signature = signBitget(timestamp, 'GET', requestPath, '', input.apiSecret)

  const { ok, status, body } = await fetchJson(
    `${baseUrl}${requestPath}`,
    {
      method: 'GET',
      headers: {
        'ACCESS-KEY': input.apiKey,
        'ACCESS-SIGN': signature,
        'ACCESS-TIMESTAMP': timestamp,
        'ACCESS-PASSPHRASE': input.passphrase ?? '',
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    }
  )

  const record = asRecord(body)
  const exchangeCode = record?.code ?? null
  const exchangeMessage =
    typeof record?.msg === 'string'
      ? record.msg
      : typeof record?.message === 'string'
        ? record.message
        : null

  return {
    ok: ok && exchangeCode === '00000',
    upstreamStatus: status,
    exchangeCode: typeof exchangeCode === 'string' ? exchangeCode : null,
    exchangeMessage,
    requestPath,
    payload: body,
  }
}

async function verifyGateio(input: ExchangeDebugVerifyInput): Promise<DebugVerifyResult> {
  const baseUrl = input.baseUrl ?? 'https://api.gateio.ws'
  const apiPath = '/api/v4/spot/accounts'
  const signPath = '/spot/accounts'
  const queryString = 'currency=USDT'
  const requestPath = `${apiPath}?${queryString}`
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const signature = signGateio(input.apiSecret, 'GET', signPath, queryString, '', timestamp)

  const { ok, status, body } = await fetchJson(
    `${baseUrl}${requestPath}`,
    {
      method: 'GET',
      headers: {
        KEY: input.apiKey,
        Timestamp: timestamp,
        SIGN: signature,
        Accept: 'application/json',
      },
      cache: 'no-store',
    }
  )

  const record = asRecord(body)
  const exchangeCode =
    typeof record?.label === 'string'
      ? record.label
      : typeof record?.code === 'string' || typeof record?.code === 'number'
        ? (record.code as string | number)
        : null
  const exchangeMessage =
    typeof record?.message === 'string'
      ? record.message
      : typeof record?.detail === 'string'
        ? record.detail
        : null
  const payloadOk = Array.isArray(body)

  return {
    ok: ok && payloadOk,
    upstreamStatus: status,
    exchangeCode,
    exchangeMessage,
    requestPath,
    payload: body,
  }
}

function buildHints(exchange: string, result: DebugVerifyResult): string[] {
  const hints: string[] = []
  if (exchange === 'binance' && result.upstreamStatus === 451) {
    hints.push('Binance chan theo khu vuc IP server. Thu doi region server hoac cap nhat IP whitelist tren san.')
  }

  if (exchange === 'bybit' && result.upstreamStatus === 403) {
    hints.push('Bybit tu choi IP server. Kiem tra IP whitelist hoac doi region server.')
  }

  if (result.upstreamStatus === 401 || result.upstreamStatus === 403) {
    hints.push('API key khong hop le, bi khoa, hoac bi chan boi IP whitelist.')
  }

  if (exchange === 'binance' && result.exchangeCode === -1021) {
    hints.push('Lech thoi gian may. Dong bo gio he thong hoac tang recvWindow.')
  }

  if (exchange === 'binance' && result.exchangeCode === -1022) {
    hints.push('Sai signature. Kiem tra apiSecret va cach ky query string.')
  }

  if (exchange === 'okx' && result.exchangeCode === '50120') {
    hints.push('Passphrase khong dung voi API key hien tai.')
  }

  if (exchange === 'bybit' && result.exchangeCode === 10003) {
    hints.push('Sai key/secret hoac key khong thuoc domain API dang dung.')
  }

  if (exchange === 'bitget' && result.exchangeCode === '40036') {
    hints.push('Invalid ACCESS-SIGN. Kiem tra timestamp, prehash va secret.')
  }

  if (exchange === 'bitget' && result.exchangeCode === '30032') {
    hints.push('Bitget V1 endpoint da ngung hoat dong. Chuyen sang API v2.')
  }

  if (exchange === 'gateio' && result.exchangeCode === 'INVALID_KEY') {
    hints.push('Gate.io API key khong hop le hoac bi revoke.')
  }

  if (exchange === 'gateio' && result.exchangeCode === 'INVALID_SIGNATURE') {
    hints.push('Gate.io signature sai. Kiem tra secret va prehash string.')
  }

  if (result.upstreamStatus >= 500) {
    hints.push('Loi ket noi upstream. Thu lai sau it phut va kiem tra outbound network cua server.')
  }

  if (!result.ok && hints.length === 0) {
    hints.push('Kiem tra quyen Read-only, IP whitelist va server time.')
  }

  return hints
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isExchangeDebugVerifyEnabled(process.env)) {
    return NextResponse.json(
      { success: false, data: null, error: 'NOT_FOUND' },
      { status: 404 }
    )
  }

  let user: { id: string } | null = null
  try {
    const supabase = await createSupabaseServerClient()
    const authResult = await supabase.auth.getUser()
    user = authResult.data.user
  } catch (error) {
    console.error('[exchange/debug/verify] auth service unavailable:', error)
    return NextResponse.json(
      { success: false, data: null, error: 'AUTH_SERVICE_UNAVAILABLE' },
      { status: 503 }
    )
  }

  if (!user) {
    return NextResponse.json(
      { success: false, data: null, error: 'UNAUTHORIZED' },
      { status: 401 }
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { success: false, data: null, error: 'VALIDATION_ERROR' },
      { status: 400 }
    )
  }

  const parsed = ExchangeDebugVerifySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, data: null, error: 'VALIDATION_ERROR' },
      { status: 400 }
    )
  }

  const input = parsed.data
  const resolvedBaseUrl = resolveDebugBaseUrl(input.exchange, input.baseUrl)
  if (!resolvedBaseUrl.ok) {
    return NextResponse.json(
      { success: false, data: null, error: 'VALIDATION_ERROR' },
      { status: 400 }
    )
  }
  input.baseUrl = resolvedBaseUrl.baseUrl

  if ((input.exchange === 'okx' || input.exchange === 'bitget') && !input.passphrase) {
    return NextResponse.json(
      { success: false, data: null, error: 'PASSPHRASE_REQUIRED' },
      { status: 400 }
    )
  }

  try {
    const result =
      input.exchange === 'binance'
        ? await verifyBinance(input)
        : input.exchange === 'okx'
          ? await verifyOkx(input)
          : input.exchange === 'bybit'
            ? await verifyBybit(input)
            : input.exchange === 'bitget'
              ? await verifyBitget(input)
              : await verifyGateio(input)

    const hints = buildHints(input.exchange, result)

    return NextResponse.json(
      {
        success: true,
        data: {
          exchange: input.exchange,
          verified: result.ok,
          upstreamStatus: result.upstreamStatus,
          exchangeCode: result.exchangeCode,
          exchangeMessage: result.exchangeMessage,
          requestPath: result.requestPath,
          hints,
          payload: result.payload,
        },
        error: null,
      },
      { status: result.ok ? 200 : 400 }
    )
  } catch {
    return NextResponse.json(
      {
        success: false,
        data: null,
        error: 'EXCHANGE_UNREACHABLE',
      },
      { status: 502 }
    )
  }
}
