'use client'

import { useEffect, useState } from 'react'
import { COOLDOWN_TICK_MS, formatCountdown, remainingCooldownMs } from '@/lib/cooldown/cooldown'

export type CooldownState = {
  active: boolean
  remainingMs: number
  label: string
}

export function useCooldown(availableAt: string | null | undefined): CooldownState {
  const [nowMs, setNowMs] = useState<number>(() => Date.now())
  const remainingMs = remainingCooldownMs(availableAt, nowMs)
  const active = remainingMs > 0

  useEffect(() => {
    if (!availableAt) return
    setNowMs(Date.now())
    const timer = setInterval(() => {
      const current = Date.now()
      setNowMs(current)
      if (remainingCooldownMs(availableAt, current) <= 0) clearInterval(timer)
    }, COOLDOWN_TICK_MS)
    return () => clearInterval(timer)
  }, [availableAt])

  return { active, remainingMs, label: formatCountdown(remainingMs) }
}
