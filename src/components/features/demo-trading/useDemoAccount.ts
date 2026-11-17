'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DEMO_LOGIN_PATH, DEMO_SYNC_INTERVAL_MS, type DemoSizeMode } from '@/lib/config/demoTrading'
import { sortDemoTradesByActivity } from '@/lib/engines/demoEngine'
import type { DemoMutationOutcome, DemoTrade } from '@/lib/types'

export type DemoOrderPayload = {
  symbol: string
  side: 'buy' | 'sell'
  orderType: 'market' | 'limit'
  leverage: number
  marginMode: 'cross' | 'isolated'
  sizeMode: DemoSizeMode
  size: number
  price: number | null
  takeProfit: number | null
  stopLoss: number | null
}

export type DemoCloseOptions = {
  orderType: 'market' | 'limit'
  price?: number
  closeQuantity?: number
}

export type DemoUpdatePatch = {
  takeProfit?: number | null
  stopLoss?: number | null
  price?: number
}

export function buildLoginRedirectUrl(pathname: string, search: string): string {
  return `${DEMO_LOGIN_PATH}?next=${encodeURIComponent(`${pathname}${search}`)}`
}

let redirecting = false

function redirectToLogin(): void {
  if (redirecting || typeof window === 'undefined') return
  redirecting = true
  window.location.assign(buildLoginRedirectUrl(window.location.pathname, window.location.search))
}

type ApiResult = { success: boolean; error: string | null; data: unknown }

const NETWORK_ERROR = 'INTERNAL_ERROR'

async function callApi(url: string, method: string, body?: unknown): Promise<ApiResult> {
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    if (res.status === 401) {
      redirectToLogin()
      return { success: false, error: 'UNAUTHORIZED', data: null }
    }
    const json = (await res.json()) as ApiResult
    return { success: Boolean(json.success), error: json.error ?? null, data: json.data ?? null }
  } catch {
    return { success: false, error: NETWORK_ERROR, data: null }
  }
}

function isOutcome(data: unknown): data is DemoMutationOutcome {
  if (!data || typeof data !== 'object') return false
  const candidate = data as Partial<DemoMutationOutcome>
  return Boolean(candidate.trade) && typeof candidate.balance === 'number'
}

export type DemoAccount = {
  balance: number | null
  positions: DemoTrade[]
  pendingOrders: DemoTrade[]
  orderHistory: DemoTrade[]
  closedTrades: DemoTrade[]
  placeOrder: (payload: DemoOrderPayload) => Promise<string | null>
  closePosition: (tradeId: string, options?: DemoCloseOptions) => Promise<string | null>
  updateOrder: (tradeId: string, patch: DemoUpdatePatch) => Promise<string | null>
  cancelOrder: (tradeId: string) => Promise<string | null>
  refill: () => Promise<string | null>
}

export function useDemoAccount(): DemoAccount {
  const [balance, setBalance] = useState<number | null>(null)
  const [trades, setTrades] = useState<DemoTrade[]>([])
  const activeRef = useRef(false)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [settingsRes, ordersRes] = await Promise.all([
        fetch('/api/settings'),
        fetch('/api/demo/orders'),
      ])
      if (settingsRes.status === 401 || ordersRes.status === 401) {
        redirectToLogin()
        return
      }
      if (settingsRes.ok) {
        const data = await settingsRes.json()
        if (data.success && data.data) setBalance(Number(data.data.demo_balance))
      }
      if (ordersRes.ok) {
        const data = await ordersRes.json()
        if (data.success) setTrades((data.data ?? []) as DemoTrade[])
      }
    } catch {
      return
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const positions = useMemo(() => trades.filter((trade) => trade.status === 'open'), [trades])
  const pendingOrders = useMemo(() => trades.filter((trade) => trade.status === 'pending'), [trades])
  const orderHistory = useMemo(
    () => sortDemoTradesByActivity(trades.filter((trade) => trade.status !== 'pending')),
    [trades]
  )
  const closedTrades = useMemo(
    () => sortDemoTradesByActivity(trades.filter((trade) => trade.status === 'closed' && !trade.reduce_only)),
    [trades]
  )

  useEffect(() => {
    activeRef.current = positions.length > 0 || pendingOrders.length > 0
  }, [positions, pendingOrders])

  useEffect(() => {
    const timer = window.setInterval(async () => {
      if (!activeRef.current) return
      try {
        const res = await fetch('/api/demo/orders/evaluate', { method: 'POST' })
        if (res.status === 401) {
          window.clearInterval(timer)
          redirectToLogin()
          return
        }
        const json = await res.json()
        if (json.success && (json.data.filled > 0 || json.data.closed > 0)) {
          await refresh()
        }
      } catch {
        return
      }
    }, DEMO_SYNC_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [refresh])

  const applyOutcome = useCallback((outcome: DemoMutationOutcome): void => {
    setBalance(outcome.balance)
    setTrades((previous) => {
      const exists = previous.some((trade) => trade.id === outcome.trade.id)
      return exists
        ? previous.map((trade) => (trade.id === outcome.trade.id ? outcome.trade : trade))
        : [outcome.trade, ...previous]
    })
  }, [])

  const run = useCallback(
    async (url: string, method: string, body?: unknown): Promise<string | null> => {
      const result = await callApi(url, method, body)
      if (!result.success) return result.error ?? NETWORK_ERROR
      if (isOutcome(result.data)) applyOutcome(result.data)
      else await refresh()
      return null
    },
    [applyOutcome, refresh]
  )

  const placeOrder = useCallback(
    (payload: DemoOrderPayload) => run('/api/demo/order', 'POST', payload),
    [run]
  )
  const closePosition = useCallback(
    (tradeId: string, options?: DemoCloseOptions) =>
      run('/api/demo/order', 'PATCH', { tradeId, ...options }),
    [run]
  )
  const updateOrder = useCallback(
    (tradeId: string, patch: DemoUpdatePatch) => run(`/api/demo/order/${tradeId}`, 'PATCH', patch),
    [run]
  )
  const cancelOrder = useCallback(
    (tradeId: string) => run(`/api/demo/order/${tradeId}/cancel`, 'POST'),
    [run]
  )
  const refill = useCallback(() => run('/api/demo/refill', 'POST'), [run])

  return {
    balance,
    positions,
    pendingOrders,
    orderHistory,
    closedTrades,
    placeOrder,
    closePosition,
    updateOrder,
    cancelOrder,
    refill,
  }
}
