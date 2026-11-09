import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildPublicDebugVerifyData,
  isExchangeDebugPath,
  isExchangeDebugVerifyEnabled,
  publicDebugRequestPath,
  resolveDebugBaseUrl,
} from '../src/lib/security/exchangeDebugAccess.ts'

test('debug routes stay closed in production even when the flag is true', () => {
  assert.equal(isExchangeDebugVerifyEnabled({ NODE_ENV: 'production' }), false)
  assert.equal(
    isExchangeDebugVerifyEnabled({
      NODE_ENV: 'production',
      EXCHANGE_DEBUG_VERIFY_ENABLED: 'true',
    }),
    false
  )
  assert.equal(
    isExchangeDebugVerifyEnabled({
      NODE_ENV: 'production',
      EXCHANGE_DEBUG_VERIFY_ENABLED: 'false',
    }),
    false
  )
  assert.equal(isExchangeDebugVerifyEnabled({ NODE_ENV: 'development' }), true)
  assert.equal(
    isExchangeDebugVerifyEnabled({
      NODE_ENV: 'development',
      EXCHANGE_DEBUG_VERIFY_ENABLED: 'false',
    }),
    false
  )
})

test('only the exchange debug prefix matches', () => {
  assert.equal(isExchangeDebugPath('/api/exchange/debug/verify'), true)
  assert.equal(isExchangeDebugPath('/api/exchange/debug'), true)
  assert.equal(isExchangeDebugPath('/api/exchange/debug/verify/extra'), true)
  assert.equal(isExchangeDebugPath('/api/exchange/accounts'), false)
  assert.equal(isExchangeDebugPath('/api/exchange/debugger'), false)
})

test('base URL must be the official https origin for that exchange', () => {
  assert.deepEqual(resolveDebugBaseUrl('binance', undefined), {
    ok: true,
    baseUrl: 'https://api.binance.com',
  })
  assert.deepEqual(resolveDebugBaseUrl('binance', 'https://fapi.binance.com/'), {
    ok: true,
    baseUrl: 'https://fapi.binance.com',
  })
  assert.deepEqual(resolveDebugBaseUrl('okx', 'https://aws.okx.com'), {
    ok: true,
    baseUrl: 'https://aws.okx.com',
  })
  assert.equal(resolveDebugBaseUrl('binance', 'http://api.binance.com').ok, false)
  assert.equal(resolveDebugBaseUrl('binance', 'https://api.binance.com.evil.example').ok, false)
  assert.equal(resolveDebugBaseUrl('binance', 'https://evil.example').ok, false)
  assert.equal(resolveDebugBaseUrl('binance', 'https://user:pass@api.binance.com').ok, false)
  assert.equal(resolveDebugBaseUrl('binance', 'https://api.binance.com/api/v3/account').ok, false)
  assert.equal(resolveDebugBaseUrl('binance', 'https://api.binance.com/?q=1').ok, false)
  assert.equal(resolveDebugBaseUrl('binance', 'https://api.binance.com:4443').ok, false)
  assert.equal(resolveDebugBaseUrl('bybit', 'https://api.binance.com').ok, false)
})

test('public debug data omits account payloads and signed query strings', () => {
  const signature = 'a'.repeat(64)
  const signedPath = `/api/v3/account?recvWindow=5000&timestamp=1710000000000&signature=${signature}`
  const data = buildPublicDebugVerifyData({
    exchange: 'binance',
    verified: false,
    upstreamStatus: 400,
    exchangeCode: -1022,
    exchangeMessage: `Signature for this request is not valid. signature=${signature}`,
    requestPath: signedPath,
    hints: ['Sai signature. Kiem tra apiSecret va cach ky query string.'],
  })

  assert.equal(publicDebugRequestPath(signedPath), '/api/v3/account')
  assert.equal(data.requestPath, '/api/v3/account')
  assert.equal(Object.hasOwn(data, 'payload'), false)
  const serialized = JSON.stringify(data)
  assert.equal(serialized.includes(signature), false)
  assert.equal(serialized.includes('recvWindow='), false)
  assert.equal(serialized.includes('balances'), false)
  assert.equal(data.exchangeMessage?.includes('signature=redacted'), true)
})

test('unsigned debug paths keep non-secret query parameters', () => {
  assert.equal(
    publicDebugRequestPath('/api/v5/account/balance?ccy=USDT'),
    '/api/v5/account/balance?ccy=USDT'
  )
  assert.equal(publicDebugRequestPath('/api/v2/spot/account/assets'), '/api/v2/spot/account/assets')
})
