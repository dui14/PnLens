'use client'

import { useEffect, useRef } from 'react'
import { toPnlJob } from '@/lib/pnl/jobMapper'
import { decideJobWatch } from '@/lib/pnl/jobWatch'
import {
  PNL_JOB_FALLBACK_POLL_INTERVAL_MS,
  PNL_JOB_POLL_MAX_WAIT_MS,
  PNL_JOB_REALTIME_EVENT,
  PNL_JOB_TABLE,
} from '@/lib/pnl/snapshotLimits'
import type { PnlJob } from '@/lib/types'

export type PnlJobWatcherHandlers = {
  onUpdate: (job: PnlJob) => void
  onCompleted: (job: PnlJob) => void
  onFailed: (job: PnlJob) => void
  onTimeout: () => void
  onMissing: () => void
}

const CHANNEL_DEAD_STATES = ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED']

export function usePnlJobWatcher(jobId: string | null, handlers: PnlJobWatcherHandlers): void {
  const handlersRef = useRef(handlers)
  useEffect(() => {
    handlersRef.current = handlers
  })

  useEffect(() => {
    if (!jobId) return
    const controller = new AbortController()
    const startedAt = Date.now()
    let removeChannel: (() => void) | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let finished = false

    const stop = (): void => {
      finished = true
      if (timer) clearTimeout(timer)
      timer = null
      removeChannel?.()
      removeChannel = null
    }

    const apply = (job: PnlJob | null): void => {
      if (finished) return
      const outcome = decideJobWatch(job, Date.now() - startedAt, PNL_JOB_POLL_MAX_WAIT_MS)
      if (job) handlersRef.current.onUpdate(job)
      if (outcome === 'completed' && job) {
        stop()
        handlersRef.current.onCompleted(job)
      } else if (outcome === 'failed' && job) {
        stop()
        handlersRef.current.onFailed(job)
      } else if (outcome === 'timeout') {
        stop()
        handlersRef.current.onTimeout()
      }
    }

    const fetchLatest = async (): Promise<void> => {
      try {
        const response = await fetch('/api/pnl/jobs/latest', { signal: controller.signal })
        const payload = await response.json()
        if (finished) return
        const next = payload.success ? ((payload.data.job as PnlJob | null) ?? null) : null
        if (!next) {
          stop()
          handlersRef.current.onMissing()
          return
        }
        apply(next)
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === 'AbortError') return
        apply(null)
      }
    }

    const schedule = (): void => {
      if (finished) return
      timer = setTimeout(async () => {
        await fetchLatest()
        schedule()
      }, PNL_JOB_FALLBACK_POLL_INTERVAL_MS)
    }

    const subscribe = async (): Promise<void> => {
      const { createSupabaseBrowserClient } = await import('@/lib/db/supabase-browser')
      if (finished || controller.signal.aborted) return
      const supabase = createSupabaseBrowserClient()
      const channel = supabase.channel(`pnl-job-${jobId}`)
      removeChannel = () => {
        void supabase.removeChannel(channel)
      }
      channel
        .on(
          'postgres_changes',
          { event: PNL_JOB_REALTIME_EVENT, schema: 'public', table: PNL_JOB_TABLE, filter: `id=eq.${jobId}` },
          (payload) => apply(toPnlJob(payload.new as Record<string, unknown>))
        )
        .subscribe((status) => {
          if (finished) return
          if (status === 'SUBSCRIBED' || CHANNEL_DEAD_STATES.includes(status)) void fetchLatest()
        })
    }

    subscribe().catch(() => fetchLatest())
    schedule()

    return () => {
      controller.abort()
      stop()
    }
  }, [jobId])
}
