'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useT } from '@/lib/i18n/client'
import { fillTemplate } from '@/lib/i18n/format'
import { AI_API_KEY_MAX_LENGTH, AI_PROVIDER_KEY_GUIDE_URLS, AI_PROVIDERS, AI_PROVIDER_LABELS } from '@/lib/ai/providerConfig'
import { AiKeyStatusBadge } from '@/components/features/ai-assistant/AiKeyStatusBadge'
import type { AiProvider, AiProviderSummary } from '@/lib/types'

type ApiEnvelope<T> = { success: boolean; data: T | null; error: string | null }

type AiProvidersSectionProps = {
  focusProvider: AiProvider | null
}

type ProviderBlockProps = {
  summary: AiProviderSummary
  focused: boolean
  onChanged: () => Promise<void>
}

function ProviderBlock({ summary, focused, onChanged }: ProviderBlockProps): React.JSX.Element {
  const { t } = useT()
  const a = t.aiProviders
  const { provider } = summary
  const rootRef = useRef<HTMLDivElement>(null)
  const keyInputRef = useRef<HTMLInputElement>(null)
  const [editingKey, setEditingKey] = useState(!summary.hasKey)
  const [keyValue, setKeyValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  useEffect(() => {
    setEditingKey(!summary.hasKey)
  }, [summary.hasKey])

  useEffect(() => {
    if (!focused) return
    rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    if (!summary.hasKey) keyInputRef.current?.focus({ preventScroll: true })
  }, [focused, summary.hasKey])

  const errorText = useCallback(
    (code: string | null | undefined): string => {
      const known = a.errors as Record<string, string>
      return (code && known[code]) || a.errors.generic
    },
    [a.errors]
  )

  const call = async (
    path: string,
    method: 'PUT' | 'DELETE',
    body?: unknown
  ): Promise<ApiEnvelope<unknown>> => {
    try {
      const res = await fetch(path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      return (await res.json()) as ApiEnvelope<unknown>
    } catch {
      return { success: false, data: null, error: 'INTERNAL_ERROR' }
    }
  }

  const saveKey = async (): Promise<void> => {
    setBusy(true)
    setMessage(null)
    const result = await call(`/api/ai/providers/${provider}`, 'PUT', { apiKey: keyValue })
    setBusy(false)
    if (!result.success) {
      setMessage({ kind: 'error', text: errorText(result.error) })
      return
    }
    setKeyValue('')
    setEditingKey(false)
    setMessage({ kind: 'ok', text: a.keySaved })
    await onChanged()
  }

  const deleteKey = async (): Promise<void> => {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setBusy(true)
    setMessage(null)
    const result = await call(`/api/ai/providers/${provider}`, 'DELETE')
    setBusy(false)
    setConfirmDelete(false)
    if (!result.success) {
      setMessage({ kind: 'error', text: errorText(result.error) })
      return
    }
    setMessage({ kind: 'ok', text: a.keyDeleted })
    await onChanged()
  }

  const inputClass =
    'flex-1 min-w-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-primary focus:border-primary p-3 outline-none disabled:opacity-60'
  const primaryButton =
    'px-5 py-2 bg-primary text-white rounded-lg text-sm font-bold hover:bg-primary/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed'
  const ghostButton =
    'px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 text-sm font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-60'

  return (
    <div
      ref={rootRef}
      id={`ai-provider-${provider}`}
      className={`rounded-xl border p-5 space-y-5 scroll-mt-6 ${
        focused ? 'border-primary' : 'border-slate-200 dark:border-slate-700'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
            {AI_PROVIDER_LABELS[provider]}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {summary.hasKey
              ? fillTemplate(a.keyConnected, { hint: summary.keyHint ?? '' })
              : a.noKey}
          </p>
          <AiKeyStatusBadge summary={summary} showReason />
        </div>
        {summary.hasKey && !editingKey && (
          <div className="flex items-center gap-2">
            <button type="button" className={ghostButton} disabled={busy} onClick={() => setEditingKey(true)}>
              {a.replaceKey}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={deleteKey}
              className={`px-4 py-2 rounded-lg text-sm font-bold transition-all disabled:opacity-60 ${
                confirmDelete
                  ? 'bg-rose-500 text-white'
                  : 'border border-rose-500 text-rose-500 hover:bg-rose-500 hover:text-white'
              }`}
            >
              {confirmDelete ? a.confirmDeleteKey : a.deleteKey}
            </button>
            {confirmDelete && (
              <button type="button" className={ghostButton} onClick={() => setConfirmDelete(false)}>
                {a.cancel}
              </button>
            )}
          </div>
        )}
      </div>

      {editingKey && (
        <div className="space-y-2">
          <label
            htmlFor={`ai-secret-${provider}`}
            className="text-sm font-semibold text-slate-700 dark:text-slate-300"
          >
            {a.keyLabel}
          </label>
          {!summary.hasKey && (
            <a
              href={AI_PROVIDER_KEY_GUIDE_URLS[provider]}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-3 text-xs font-semibold text-primary hover:underline"
            >
              {a.getKeyLink}
            </a>
          )}
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              ref={keyInputRef}
              id={`ai-secret-${provider}`}
              name={`ai-secret-${provider}`}
              type="text"
              inputMode="text"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-1p-ignore
              data-lpignore="true"
              data-form-type="other"
              value={keyValue}
              maxLength={AI_API_KEY_MAX_LENGTH}
              onChange={(e) => setKeyValue(e.target.value)}
              placeholder={a.keyPlaceholder}
              disabled={busy}
              className={`${inputClass} [-webkit-text-security:disc]`}
            />
            <button type="button" className={primaryButton} disabled={busy || keyValue.trim().length === 0} onClick={saveKey}>
              {busy ? a.saving : a.saveKey}
            </button>
            {summary.hasKey && (
              <button
                type="button"
                className={ghostButton}
                disabled={busy}
                onClick={() => {
                  setEditingKey(false)
                  setKeyValue('')
                }}
              >
                {a.cancel}
              </button>
            )}
          </div>
        </div>
      )}

      {message && (
        <p className={`text-sm ${message.kind === 'ok' ? 'text-emerald-500' : 'text-rose-500'}`}>
          {message.text}
        </p>
      )}
    </div>
  )
}

export function AiProvidersSection({ focusProvider }: AiProvidersSectionProps): React.JSX.Element {
  const { t } = useT()
  const a = t.aiProviders
  const [summaries, setSummaries] = useState<AiProviderSummary[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/ai/providers')
      const payload = (await res.json()) as ApiEnvelope<AiProviderSummary[]>
      if (payload.success && payload.data) {
        setSummaries(payload.data)
        setLoadFailed(false)
        return
      }
      setLoadFailed(true)
    } catch {
      setLoadFailed(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <section className="bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
      <div className="px-8 py-6 border-b border-slate-200 dark:border-slate-800">
        <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">{a.title}</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{a.subtitle}</p>
      </div>
      <div className="p-8 space-y-6">
        {loadFailed && <p className="text-sm text-rose-500">{a.errors.generic}</p>}
        {!summaries && !loadFailed
          ? AI_PROVIDERS.map((provider) => (
              <div key={provider} className="h-32 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
            ))
          : (summaries ?? []).map((summary) => (
              <ProviderBlock
                key={summary.provider}
                summary={summary}
                focused={focusProvider === summary.provider}
                onChanged={load}
              />
            ))}
      </div>
    </section>
  )
}
