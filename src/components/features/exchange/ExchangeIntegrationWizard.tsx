'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useT } from '@/lib/i18n/client'
import { fillTemplate } from '@/lib/i18n/format'
import type { Dictionary } from '@/lib/i18n'
import { latestAvailableAt } from '@/lib/cooldown/cooldown'
import { useCooldown } from '@/lib/hooks/useCooldown'
import { EXCHANGES } from '@/lib/types'
import type { ExchangeAccount, ExchangeAccountWithStats, Exchange } from '@/lib/types'
import { EXCHANGE_BRANDING } from '@/lib/exchangeBranding'
import { ExchangeLogo } from '@/components/ui/ExchangeLogo'
import { SCAN_POLL_INTERVAL_MS, SCAN_POLL_MAX_WAIT_MS } from '@/lib/scan/scanLimits'

type ModalMode = 'connect' | 'edit'
type SyncNotice = { kind: 'success' | 'error'; text: string }

function syncErrorMessage(
  syncError: string | null,
  messages: Record<string, string>,
  fallback: string
): string {
  const head = (syncError ?? '').split(',')[0] ?? ''
  const code = head.split(':')[0] ?? ''
  return messages[code] ?? fallback
}

type ModalStep = 1 | 2 | 3

const EXCHANGE_OPTIONS = EXCHANGES.map((id) => ({ id, name: EXCHANGE_BRANDING[id].name }))

function formatLastSynced(lastSynced: string | null, labels: Dictionary['exchange']): string {
  if (!lastSynced) return labels.neverSynced
  const diff = Date.now() - new Date(lastSynced).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return labels.justNow
  if (minutes < 60) return fillTemplate(labels.minutesAgo, { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return fillTemplate(labels.hoursAgo, { count: hours })
  return fillTemplate(labels.daysAgo, { count: Math.floor(hours / 24) })
}

function EmptyState({ onConnect }: { onConnect: () => void }) {
  const { t } = useT()
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-6">
      <div className="flex items-center justify-center size-20 rounded-2xl bg-primary/10 text-primary">
        <span className="material-symbols-outlined text-5xl">account_balance_wallet</span>
      </div>
      <div className="flex flex-col items-center gap-2 text-center">
        <h2 className="text-slate-900 dark:text-slate-100 text-2xl font-black">{t.exchange.emptyTitle}</h2>
        <p className="text-slate-500 dark:text-slate-400 text-sm max-w-sm">
          {t.exchange.emptyDescription}
        </p>
      </div>
      <button
        onClick={onConnect}
        className="flex items-center gap-2 rounded-xl h-12 px-8 bg-primary text-accent font-bold text-sm shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all"
      >
        <span className="material-symbols-outlined text-[18px]">add</span>
        {t.exchange.connectFirst}
      </button>
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="rounded-2xl border border-slate-200 dark:border-primary/20 bg-white dark:bg-[#201f23] p-6 shadow-sm animate-pulse"
        >
          <div className="flex justify-between items-start mb-4">
            <div className="flex items-center gap-4">
              <div className="size-12 rounded-xl bg-slate-200 dark:bg-slate-700" />
              <div className="flex flex-col gap-2">
                <div className="h-4 w-24 rounded bg-slate-200 dark:bg-slate-700" />
                <div className="h-3 w-16 rounded bg-slate-200 dark:bg-slate-700" />
              </div>
            </div>
            <div className="h-6 w-16 rounded-full bg-slate-200 dark:bg-slate-700" />
          </div>
          <div className="py-4 border-y border-slate-100 dark:border-primary/10 space-y-2">
            <div className="h-3 w-28 rounded bg-slate-200 dark:bg-slate-700" />
            <div className="h-8 w-36 rounded bg-slate-200 dark:bg-slate-700" />
          </div>
          <div className="flex gap-2 pt-4">
            <div className="flex-1 h-10 rounded-lg bg-slate-200 dark:bg-slate-700" />
            <div className="h-10 w-10 rounded-lg bg-slate-200 dark:bg-slate-700" />
            <div className="h-10 w-10 rounded-lg bg-slate-200 dark:bg-slate-700" />
          </div>
        </div>
      ))}
    </div>
  )
}

function ExchangeCard({
  account,
  onToggleActive,
  onSync,
  onEdit,
  onDelete,
  isSyncing,
  isDeleting,
  notice,
  retryAt,
}: {
  account: ExchangeAccountWithStats
  onToggleActive: (account: ExchangeAccount) => Promise<void>
  onSync: (account: ExchangeAccount) => Promise<void>
  onEdit: (account: ExchangeAccount) => void
  onDelete: (account: ExchangeAccount) => void
  isSyncing: boolean
  isDeleting: boolean
  notice: SyncNotice | undefined
  retryAt: string | undefined
}) {
  const { t } = useT()
  const cooldown = useCooldown(latestAvailableAt(account.syncAvailableAt, retryAt))
  const exchangeName = EXCHANGE_OPTIONS.find((e) => e.id === account.exchange)?.name ?? account.exchange
  const displayName = account.label ?? exchangeName

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 dark:border-primary/20 bg-white dark:bg-[#201f23] p-6 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex justify-between items-start">
        <div className="flex items-center gap-4">
          <ExchangeLogo exchange={account.exchange} size={48} />
          <div className="flex flex-col">
            <h3 className="text-slate-900 dark:text-slate-100 font-bold text-lg leading-tight">{displayName}</h3>
            {account.label && (
              <p className="text-slate-400 text-xs capitalize">{account.exchange}</p>
            )}
            <div
              className={`flex items-center gap-1.5 text-xs font-semibold mt-1 ${
                account.is_active ? 'text-emerald-500' : 'text-slate-400'
              }`}
            >
              <span
                className={`size-2 rounded-full ${account.is_active ? 'bg-emerald-500' : 'bg-slate-400'}`}
              />
              {account.is_active ? t.exchange.active : t.exchange.inactive}
            </div>
          </div>
        </div>
        <label className="relative inline-flex items-center cursor-pointer group flex-shrink-0 mt-1">
          <input
            className="sr-only peer"
            type="checkbox"
            checked={account.is_active}
            onChange={() => onToggleActive(account)}
          />
          <div className="w-11 h-6 bg-slate-300 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary" />
        </label>
      </div>

      <div className="py-4 border-y border-slate-100 dark:border-primary/10 flex flex-col gap-1">
        <p className="text-slate-500 dark:text-slate-400 text-xs font-medium uppercase tracking-widest">
          {t.exchange.lastSynced}
        </p>
        <p className="text-slate-900 dark:text-slate-100 text-lg font-bold">
          {formatLastSynced(account.last_synced, t.exchange)}
        </p>
        <p className="text-slate-400 dark:text-slate-500 text-xs mt-0.5">
          {fillTemplate(t.exchange.connectedAgo, { time: formatLastSynced(account.created_at, t.exchange) })}
        </p>
        {account.secret_format && (
          <p className="flex items-center gap-1 text-slate-500 dark:text-slate-400 text-xs mt-1">
            <span className="material-symbols-outlined text-[14px]">key</span>
            {t.exchange.secretFormats[account.secret_format]}
          </p>
        )}
        {notice && !isSyncing && (
          <p
            className={`text-xs mt-1 ${notice.kind === 'error' ? 'text-rose-500' : 'text-emerald-500'}`}
          >
            {notice.text}
          </p>
        )}
      </div>

      <div className="flex gap-2 pt-1">
        <button
          onClick={() => onSync(account)}
          disabled={isSyncing || !account.is_active || cooldown.active}
          className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-primary/10 dark:bg-primary/20 text-primary dark:text-slate-100 h-10 text-sm font-bold hover:bg-primary hover:text-accent transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <span
            className={`material-symbols-outlined text-[18px] ${isSyncing ? 'animate-spin' : ''}`}
          >
            sync
          </span>
          {isSyncing
            ? t.exchange.syncing
            : cooldown.active
              ? fillTemplate(t.exchange.syncAvailableIn, { time: cooldown.label })
              : t.exchange.syncNow}
        </button>
        <button
          onClick={() => onEdit(account)}
          className="w-10 h-10 flex items-center justify-center rounded-lg border border-slate-200 dark:border-primary/20 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-primary/10 transition-all"
        >
          <span className="material-symbols-outlined text-[20px]">edit</span>
        </button>
        <button
          onClick={() => onDelete(account)}
          disabled={isDeleting}
          className="w-10 h-10 flex items-center justify-center rounded-lg border border-slate-200 dark:border-red-500/20 text-slate-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all disabled:opacity-40"
        >
          <span className="material-symbols-outlined text-[20px]">
            {isDeleting ? 'hourglass_top' : 'delete'}
          </span>
        </button>
      </div>
    </div>
  )
}

function ConnectModal({
  mode,
  step,
  selectedExchange,
  label,
  apiKey,
  apiSecret,
  passphrase,
  isSubmitting,
  submitError,
  connectedExchanges,
  onSelectExchange,
  onLabelChange,
  onApiKeyChange,
  onApiSecretChange,
  onPassphraseChange,
  onNext,
  onBack,
  onClose,
}: {
  mode: ModalMode
  step: ModalStep
  selectedExchange: Exchange | null
  label: string
  apiKey: string
  apiSecret: string
  passphrase: string
  isSubmitting: boolean
  submitError: string | null
  connectedExchanges: string[]
  onSelectExchange: (ex: Exchange) => void
  onLabelChange: (v: string) => void
  onApiKeyChange: (v: string) => void
  onApiSecretChange: (v: string) => void
  onPassphraseChange: (v: string) => void
  onNext: () => void
  onBack: () => void
  onClose: () => void
}) {
  const { t } = useT()
  const ex = t.exchange
  const isEdit = mode === 'edit'
  const selectedExchangeName =
    EXCHANGE_OPTIONS.find((e) => e.id === selectedExchange)?.name ?? selectedExchange ?? ''

  const requiresPassphrase = selectedExchange === 'okx' || selectedExchange === 'bitget'
  const requiresPrivateKey = selectedExchange === 'binance' || selectedExchange === 'bybit' || selectedExchange === 'bitget'
  const requiresSecret = selectedExchange === 'okx' || selectedExchange === 'gateio'

  const canNext =
    step === 1
      ? !!selectedExchange
      : step === 2
      ? apiKey.trim().length > 0 &&
        (!requiresPrivateKey || apiSecret.includes('BEGIN ')) &&
        (!requiresSecret || apiSecret.trim().length > 0) &&
        (!requiresPassphrase || passphrase.trim().length > 0)
      : true

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-lg bg-white dark:bg-[#1c1a22] rounded-2xl shadow-2xl border border-slate-200 dark:border-primary/20 overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-primary/20 px-6 py-5 flex-shrink-0">
          <div className="flex items-center gap-3">
            {selectedExchange && step > 1 ? (
              <ExchangeLogo exchange={selectedExchange} size={36} />
            ) : (
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-accent">
                <span className="material-symbols-outlined text-[20px]">account_balance_wallet</span>
              </div>
            )}
            <div>
              <h2 className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-100">
                {isEdit
                  ? fillTemplate(ex.updateKeysTitle, { exchange: selectedExchangeName })
                  : ex.connectTitle}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {step === 1
                  ? ex.stepChoose
                  : step === 2
                  ? ex.stepCredentials
                  : ex.stepConnected}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center size-8 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-primary/10 transition-colors"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {!isEdit && (
          <div className="px-6 py-3 bg-slate-50 dark:bg-primary/5 border-b border-slate-200 dark:border-primary/10 flex items-center gap-2 flex-shrink-0">
            {[
              { num: 1, label: ex.wizardSteps.select },
              { num: 2, label: ex.wizardSteps.keys },
              { num: 3, label: ex.wizardSteps.done },
            ].map((s, i) => (
              <div key={s.num} className="flex items-center gap-1.5">
                {i > 0 && (
                  <span className="material-symbols-outlined text-slate-300 dark:text-slate-600 text-base">
                    chevron_right
                  </span>
                )}
                <div className={`flex items-center gap-1.5 ${step < s.num ? 'opacity-40' : ''}`}>
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white ${
                      step >= s.num ? 'bg-primary' : 'bg-slate-400'
                    }`}
                  >
                    {step > s.num ? (
                      <span className="material-symbols-outlined text-[11px]">check</span>
                    ) : (
                      s.num
                    )}
                  </span>
                  <span
                    className={`text-xs ${
                      step === s.num ? 'font-semibold text-primary' : 'font-medium text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {s.label}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="p-6 overflow-y-auto flex-1">
          {step === 1 && !isEdit && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {EXCHANGE_OPTIONS.map((exchange) => {
                const alreadyConnected = connectedExchanges.includes(exchange.id)
                return (
                  <button
                    key={exchange.id}
                    onClick={() => !alreadyConnected && onSelectExchange(exchange.id)}
                    disabled={alreadyConnected}
                    className={`flex flex-col items-center gap-3 p-5 rounded-xl border-2 transition-all ${
                      selectedExchange === exchange.id
                        ? 'border-primary bg-primary/5'
                        : alreadyConnected
                        ? 'border-slate-200 dark:border-slate-800 opacity-40 cursor-not-allowed'
                        : 'border-slate-200 dark:border-slate-800 hover:border-primary/50 bg-white dark:bg-slate-900/50 cursor-pointer'
                    }`}
                  >
                    <ExchangeLogo exchange={exchange.id} size={48} className="rounded-xl" />
                    <div className="text-center">
                      <p className="font-bold text-slate-900 dark:text-white text-sm">{exchange.name}</p>
                      <p
                        className={`text-[10px] font-semibold uppercase tracking-wider mt-0.5 ${
                          alreadyConnected ? 'text-emerald-500' : 'text-slate-400'
                        }`}
                      >
                        {alreadyConnected ? ex.connected : ex.available}
                      </p>
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-4">
              {submitError && (
                <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-red-400 text-sm flex items-start gap-2">
                  <span className="material-symbols-outlined text-[18px] flex-shrink-0 mt-0.5">error</span>
                  {submitError}
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                  {ex.accountLabel} <span className="text-slate-400 font-normal">{ex.optional}</span>
                </label>
                <input
                  type="text"
                  value={label}
                  onChange={(e) => onLabelChange(e.target.value)}
                  placeholder={fillTemplate(ex.labelPlaceholder, { exchange: selectedExchangeName })}
                  maxLength={100}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2.5 text-sm focus:ring-2 focus:ring-primary focus:border-primary transition-all outline-none text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                  {ex.apiKey} <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={apiKey}
                  onChange={(e) => onApiKeyChange(e.target.value)}
                  placeholder={ex.apiKeyPlaceholder}
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2.5 text-sm font-mono focus:ring-2 focus:ring-primary focus:border-primary transition-all outline-none text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
                />
              </div>
              {requiresPrivateKey && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                    {ex.privateKey} <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={apiSecret}
                    onChange={(e) => onApiSecretChange(e.target.value)}
                    placeholder="-----BEGIN PRIVATE KEY-----"
                    rows={6}
                    spellCheck={false}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2.5 text-xs font-mono focus:ring-2 focus:ring-primary focus:border-primary transition-all outline-none text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
                  />
                  {selectedExchange && ex.privateKeyHints[selectedExchange as keyof typeof ex.privateKeyHints] && (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {ex.privateKeyHints[selectedExchange as keyof typeof ex.privateKeyHints]}
                    </p>
                  )}
                </div>
              )}

              {requiresSecret && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                    {ex.apiSecret} <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="password"
                    value={apiSecret}
                    onChange={(e) => onApiSecretChange(e.target.value)}
                    placeholder={ex.apiSecretPlaceholder}
                    autoComplete="new-password"
                    spellCheck={false}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2.5 text-sm font-mono focus:ring-2 focus:ring-primary focus:border-primary transition-all outline-none text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
                  />
                </div>
              )}
              {requiresPassphrase && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                    {ex.passphrase} <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="password"
                    value={passphrase}
                    onChange={(e) => onPassphraseChange(e.target.value)}
                    placeholder={ex.passphrasePlaceholder}
                    autoComplete="new-password"
                    spellCheck={false}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2.5 text-sm font-mono focus:ring-2 focus:ring-primary focus:border-primary transition-all outline-none text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
                  />
                </div>
              )}
              <p className="text-xs text-slate-500 dark:text-slate-400">{ex.noIpWhitelist}</p>
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 flex gap-2 text-amber-600 dark:text-amber-400">
                <span className="material-symbols-outlined text-[16px] flex-shrink-0 mt-0.5">shield_lock</span>
                <p className="text-xs">
                  {ex.readOnlyNotice}
                </p>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col items-center py-8 text-center gap-4">
              <div className="size-16 rounded-full bg-emerald-500/10 flex items-center justify-center">
                <span className="material-symbols-outlined text-emerald-500 text-4xl">check_circle</span>
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-1">
                  {isEdit ? ex.keysUpdated : ex.connectionVerified}
                </h3>
                <p className="text-slate-500 dark:text-slate-400 text-sm">
                  {isEdit
                    ? fillTemplate(ex.keysUpdatedBody, { exchange: selectedExchangeName })
                    : fillTemplate(ex.connectedBody, { exchange: selectedExchangeName })}
                </p>
                {submitError && (
                  <p className="text-slate-500 dark:text-slate-400 text-sm max-w-sm mt-2">{submitError}</p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900/80 border-t border-slate-200 dark:border-primary/20 flex items-center justify-between flex-shrink-0">
          <button
            onClick={onBack}
            className="px-5 py-2 rounded-lg font-semibold text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
          >
            {step === 3 ? ex.close : step === 1 || isEdit ? ex.cancel : ex.back}
          </button>
          {step !== 3 && (
            <button
              onClick={onNext}
              disabled={!canNext || isSubmitting}
              className="px-6 py-2 rounded-lg font-bold text-sm bg-primary text-accent hover:bg-primary/90 shadow-md shadow-primary/20 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <span className="material-symbols-outlined text-[16px] animate-spin">
                    progress_activity
                  </span>
                  {ex.connecting}
                </>
              ) : step === 2 ? (
                <>
                  <span className="material-symbols-outlined text-[16px]">verified</span>
                  {isEdit ? ex.updateKeys : ex.connect}
                </>
              ) : (
                <>
                  {ex.next}
                  <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function ConfirmDeleteModal({
  account,
  onConfirm,
  onCancel,
}: {
  account: ExchangeAccount
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t } = useT()
  const exchangeName = EXCHANGE_OPTIONS.find((e) => e.id === account.exchange)?.name ?? account.exchange
  const displayName = account.label ?? exchangeName

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-white dark:bg-[#1c1a22] rounded-2xl shadow-2xl border border-slate-200 dark:border-primary/20 p-6 flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center size-10 rounded-full bg-red-500/10 text-red-500 flex-shrink-0">
            <span className="material-symbols-outlined text-[22px]">delete_forever</span>
          </div>
          <div>
            <h3 className="font-bold text-slate-900 dark:text-slate-100">{t.exchange.removeTitle}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{t.exchange.cannotUndo}</p>
          </div>
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {t.exchange.removeConfirmPrefix}{' '}
          <strong className="text-slate-900 dark:text-slate-100">{displayName}</strong>
          {t.exchange.removeConfirmSuffix}
        </p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-5 py-2 rounded-lg font-semibold text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            {t.exchange.cancel}
          </button>
          <button
            onClick={onConfirm}
            className="px-5 py-2 rounded-lg font-bold text-sm bg-red-500 text-white hover:bg-red-600 transition-colors flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">delete</span>
            {t.exchange.remove}
          </button>
        </div>
      </div>
    </div>
  )
}

function SecurityBanner() {
  const { t } = useT()
  return (
    <div className="rounded-2xl bg-gradient-to-br from-primary to-[#433362] p-8 text-accent relative overflow-hidden">
      <div className="absolute -right-12 -top-12 size-48 bg-accent/10 rounded-full blur-3xl pointer-events-none" />
      <div className="relative z-10 flex flex-col md:flex-row justify-between items-center gap-6">
        <div className="flex flex-col gap-2 text-center md:text-left">
          <h2 className="text-2xl font-black">{t.exchange.securityTitle}</h2>
          <p className="text-slate-100/80 max-w-md text-sm">
            {t.exchange.securityBody}
          </p>
        </div>
        <div className="flex gap-5 flex-shrink-0">
          {[
            { icon: 'verified_user', label: t.exchange.encrypted },
            { icon: 'lock', label: t.exchange.readOnly },
            { icon: 'privacy_tip', label: t.exchange.noWithdrawal },
          ].map((item) => (
            <div key={item.label} className="flex flex-col items-center gap-1 text-accent/80">
              <span className="material-symbols-outlined text-[22px]">{item.icon}</span>
              <span className="text-xs font-semibold">{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function ExchangeIntegrationWizard(): React.JSX.Element {
  const { t } = useT()
  const [accounts, setAccounts] = useState<ExchangeAccountWithStats[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState<ModalMode>('connect')
  const [editAccountId, setEditAccountId] = useState<string | null>(null)
  const [step, setStep] = useState<ModalStep>(1)
  const [selectedExchange, setSelectedExchange] = useState<Exchange | null>(null)
  const [label, setLabel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const [syncStartedAt, setSyncStartedAt] = useState<Record<string, number>>({})
  const [syncNotices, setSyncNotices] = useState<Record<string, SyncNotice>>({})
  const [syncRetryAt, setSyncRetryAt] = useState<Record<string, string>>({})
  const [syncRequests, setSyncRequests] = useState<Record<string, true>>({})
  const syncStartedAtRef = useRef<Record<string, number>>({})
  const [deleteTarget, setDeleteTarget] = useState<ExchangeAccount | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const updateSyncStartedAt = useCallback((update: (prev: Record<string, number>) => Record<string, number>) => {
    const next = update(syncStartedAtRef.current)
    syncStartedAtRef.current = next
    setSyncStartedAt(next)
  }, [])

  const setSyncNotice = useCallback((id: string, notice: SyncNotice | null) => {
    setSyncNotices((prev) => {
      const next = { ...prev }
      if (notice) next[id] = notice
      else delete next[id]
      return next
    })
  }, [])

  const startTracking = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return
      const now = Date.now()
      updateSyncStartedAt((prev) => {
        const next = { ...prev }
        for (const id of ids) if (!(id in next)) next[id] = now
        return next
      })
    },
    [updateSyncStartedAt]
  )

  const fetchAccounts = useCallback(async (): Promise<ExchangeAccountWithStats[] | null> => {
    try {
      const res = await fetch('/api/exchange/accounts')
      const data = await res.json()
      if (data.success && Array.isArray(data.data)) {
        setAccounts(data.data)
        return data.data as ExchangeAccountWithStats[]
      }
    } catch {}
    return null
  }, [])

  useEffect(() => {
    let active = true
    void (async () => {
      const loaded = await fetchAccounts()
      if (!active) return
      if (loaded) startTracking(loaded.filter((a) => a.sync_status === 'syncing').map((a) => a.id))
      setIsLoading(false)
    })()
    return () => {
      active = false
    }
  }, [fetchAccounts, startTracking])

  const pollSyncing = useCallback(async () => {
    const tracked = syncStartedAtRef.current
    if (Object.keys(tracked).length === 0) return
    const loaded = await fetchAccounts()
    if (!loaded) return
    const now = Date.now()
    const finished: string[] = []
    for (const [id, startedAt] of Object.entries(tracked)) {
      const account = loaded.find((a) => a.id === id)
      if (!account) {
        finished.push(id)
      } else if (account.sync_status !== 'syncing') {
        finished.push(id)
        setSyncNotice(
          id,
          account.sync_status === 'error'
            ? { kind: 'error', text: syncErrorMessage(account.sync_error, t.exchange.syncErrors, t.exchange.syncFailed) }
            : { kind: 'success', text: t.exchange.syncComplete }
        )
      } else if (now - startedAt >= SCAN_POLL_MAX_WAIT_MS) {
        finished.push(id)
        setSyncNotice(id, { kind: 'error', text: t.exchange.syncTimeout })
      }
    }
    if (finished.length > 0) {
      updateSyncStartedAt((prev) => {
        const next = { ...prev }
        for (const id of finished) delete next[id]
        return next
      })
    }
  }, [fetchAccounts, setSyncNotice, updateSyncStartedAt, t])

  const hasTracked = Object.keys(syncStartedAt).length > 0

  useEffect(() => {
    if (!hasTracked) return
    const timer = setInterval(() => void pollSyncing(), SCAN_POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [hasTracked, pollSyncing])

  const openConnectModal = () => {
    setModalMode('connect')
    setEditAccountId(null)
    setStep(1)
    setSelectedExchange(null)
    setLabel('')
    setApiKey('')
    setApiSecret('')
    setPassphrase('')
    setSubmitError(null)
    setModalOpen(true)
  }

  const openEditModal = (account: ExchangeAccount) => {
    setModalMode('edit')
    setEditAccountId(account.id)
    setSelectedExchange(account.exchange)
    setLabel(account.label ?? '')
    setApiKey('')
    setApiSecret('')
    setPassphrase('')
    setSubmitError(null)
    setStep(2)
    setModalOpen(true)
  }

  const closeModal = () => {
    setModalOpen(false)
    setStep(1)
    setSelectedExchange(null)
    setLabel('')
    setApiKey('')
    setApiSecret('')
    setPassphrase('')
    setSubmitError(null)
  }

  const handleNext = async () => {
    if (step === 1) {
      setStep(2)
      return
    }
    if (step === 2) {
      const requiresPassphrase = selectedExchange === 'okx' || selectedExchange === 'bitget'
      const requiresSecret = selectedExchange === 'okx' || selectedExchange === 'gateio'
      if (!selectedExchange || !apiKey.trim() || (requiresSecret && !apiSecret.trim()) || (requiresPassphrase && !passphrase.trim())) return
      setIsSubmitting(true)
      setSubmitError(null)
      try {
        let res: Response
        if (modalMode === 'edit' && editAccountId) {
          res = await fetch(`/api/exchange/accounts/${editAccountId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              apiKey: apiKey.trim(),
              apiSecret: apiSecret.trim(),
              passphrase: passphrase.trim() || undefined,
              label: label.trim() || null,
            }),
          })
        } else {
          res = await fetch('/api/exchange/connect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              exchange: selectedExchange,
              apiKey: apiKey.trim(),
              apiSecret: apiSecret.trim(),
              passphrase: passphrase.trim() || undefined,
              label: label.trim() || null,
            }),
          })
        }
        const data = await res.json()
        const errorMessages: Record<string, string> = t.exchange.connectErrors
        if (data.success) {
          await fetchAccounts()
          const warnings = Array.isArray(data.warnings) ? data.warnings : []
          const warningText = warnings
            .map((code: string) => errorMessages[code])
            .filter((message: string | undefined) => Boolean(message))
            .join(' ')
          setSubmitError(warningText || null)
          setStep(3)
        } else {
          setSubmitError(errorMessages[data.error] ?? t.exchange.connectionFailed)
        }
      } catch {
        setSubmitError(t.exchange.networkError)
      } finally {
        setIsSubmitting(false)
      }
      return
    }
    if (step === 3) {
      closeModal()
    }
  }

  const handleBack = () => {
    if (step === 2 && modalMode === 'connect') {
      setStep(1)
      setSubmitError(null)
    } else {
      closeModal()
    }
  }

  const handleToggleActive = async (account: ExchangeAccount) => {
    const newActive = !account.is_active
    setAccounts((prev) =>
      prev.map((a) => (a.id === account.id ? { ...a, is_active: newActive } : a))
    )
    try {
      const res = await fetch(`/api/exchange/accounts/${account.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: newActive }),
      })
      const data = await res.json()
      if (!data.success) {
        setAccounts((prev) =>
          prev.map((a) => (a.id === account.id ? { ...a, is_active: account.is_active } : a))
        )
      }
    } catch {
      setAccounts((prev) =>
        prev.map((a) => (a.id === account.id ? { ...a, is_active: account.is_active } : a))
      )
    }
  }

  const handleSync = async (account: ExchangeAccount) => {
    setSyncNotice(account.id, null)
    setSyncRequests((prev) => ({ ...prev, [account.id]: true }))
    try {
      const res = await fetch('/api/exchange/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exchangeAccountId: account.id }),
      })
      const data = await res.json()
      if (res.ok || data.error === 'SYNC_IN_PROGRESS') {
        startTracking([account.id])
        await fetchAccounts()
        return
      }
      const code = typeof data.error === 'string' ? data.error : ''
      if (typeof data.retryAt === 'string') {
        const retryAt: string = data.retryAt
        setSyncRetryAt((prev) => ({ ...prev, [account.id]: retryAt }))
        setSyncNotice(account.id, null)
        return
      }
      setSyncNotice(account.id, { kind: 'error', text: (t.exchange.syncErrors as Record<string, string>)[code] ?? t.exchange.syncFailed })
    } catch {
      setSyncNotice(account.id, { kind: 'error', text: t.exchange.networkError })
    } finally {
      setSyncRequests((prev) => {
        const next = { ...prev }
        delete next[account.id]
        return next
      })
    }
  }

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return
    setDeletingId(deleteTarget.id)
    setDeleteTarget(null)
    try {
      const res = await fetch(`/api/exchange/accounts/${deleteTarget.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.success) {
        setAccounts((prev) => prev.filter((a) => a.id !== deleteTarget.id))
      }
    } catch {}
    setDeletingId(null)
  }

  const connectedExchangeIds = accounts.map((a) => a.exchange)

  return (
    <div className="p-4 sm:p-6 lg:p-8 flex flex-col gap-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-slate-900 dark:text-slate-100 text-2xl sm:text-3xl font-black leading-tight tracking-tight">
            {t.exchange.pageTitle}
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-base">
            {t.exchange.pageSubtitle}
          </p>
        </div>
        <button
          onClick={openConnectModal}
          className="flex items-center gap-2 rounded-xl h-12 px-6 bg-primary text-accent font-bold text-sm shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all whitespace-nowrap"
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
          {t.exchange.connectNew}
        </button>
      </div>

      <div className="flex flex-col md:flex-row items-start md:items-center gap-4 rounded-xl border border-primary/20 bg-primary/5 p-5">
        <div className="flex items-center justify-center size-9 rounded-full bg-primary/10 text-primary flex-shrink-0">
          <span className="material-symbols-outlined text-[18px]">info</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <p className="text-slate-900 dark:text-slate-100 text-sm font-bold leading-tight">{t.exchange.syncNoticeTitle}</p>
          <p className="text-slate-600 dark:text-slate-400 text-sm">
            {t.exchange.syncNoticeBody}
          </p>
        </div>
      </div>

      {isLoading ? (
        <LoadingSkeleton />
      ) : accounts.length === 0 ? (
        <EmptyState onConnect={openConnectModal} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {accounts.map((account) => (
            <ExchangeCard
              key={account.id}
              account={account}
              onToggleActive={handleToggleActive}
              onSync={handleSync}
              onEdit={openEditModal}
              onDelete={(a) => setDeleteTarget(a)}
              isSyncing={account.id in syncRequests || account.id in syncStartedAt || account.sync_status === 'syncing'}
              isDeleting={deletingId === account.id}
              notice={syncNotices[account.id]}
              retryAt={syncRetryAt[account.id]}
            />
          ))}
        </div>
      )}

      {accounts.length > 0 && <SecurityBanner />}

      {modalOpen && (
        <ConnectModal
          mode={modalMode}
          step={step}
          selectedExchange={selectedExchange}
          label={label}
          apiKey={apiKey}
          apiSecret={apiSecret}
          passphrase={passphrase}
          isSubmitting={isSubmitting}
          submitError={submitError}
          connectedExchanges={connectedExchangeIds}
          onSelectExchange={setSelectedExchange}
          onLabelChange={setLabel}
          onApiKeyChange={setApiKey}
          onApiSecretChange={setApiSecret}
          onPassphraseChange={setPassphrase}
          onNext={handleNext}
          onBack={handleBack}
          onClose={closeModal}
        />
      )}

      {deleteTarget && (
        <ConfirmDeleteModal
          account={deleteTarget}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}

