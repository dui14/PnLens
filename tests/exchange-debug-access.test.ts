import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  isExchangeDebugPath,
  isExchangeDebugVerifyEnabled,
  resolveDebugBaseUrl,
} from '../src/lib/security/exchangeDebugAccess.ts'

test('debug routes are closed in production unless explicitly enabled', () => {
  assert.equal(isExchangeDebugVerifyEnabled({ NODE_ENV: 'production' }), false)
  assert.equal(
    isExchangeDebugVerifyEnabled({
      NODE_ENV: 'production',
      EXCHANGE_DEBUG_VERIFY_ENABLED: 'true',
    }),
    true
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
