'use client'

import { useState, useEffect, useCallback } from 'react'
import type { ExchangeAccount, Exchange } from '@/lib/types'

type ModalMode = 'connect' | 'edit'
type ModalStep = 1 | 2 | 3

const EXCHANGE_OPTIONS: {
  id: Exchange
  name: string
  bgClass: string
  textClass: string
  abbr: string
}[] = [
  { id: 'binance', name: 'Binance', bgClass: 'bg-yellow-400', textClass: 'text-slate-900', abbr: 'B' },
  { id: 'okx', name: 'OKX', bgClass: 'bg-slate-900 dark:bg-slate-700', textClass: 'text-white', abbr: 'OKX' },
  { id: 'bybit', name: 'Bybit', bgClass: 'bg-orange-500', textClass: 'text-white', abbr: 'BB' },
  { id: 'bitget', name: 'Bitget', bgClass: 'bg-cyan-500', textClass: 'text-white', abbr: 'BG' },
  { id: 'gateio', name: 'Gate.io', bgClass: 'bg-emerald-600', textClass: 'text-white', abbr: 'G' },
]

function ExchangeLogo({ exchange }: { exchange: string }) {
  const brand = EXCHANGE_OPTIONS.find((e) => e.id === exchange)
  return (
    <div
      className={`size-12 rounded-xl ${brand?.bgClass ?? 'bg-slate-500'} ${brand?.textClass ?? 'text-white'} flex items-center justify-center font-black text-sm tracking-tight`}
    >
      {brand?.abbr ?? exchange.slice(0, 2).toUpperCase()}
    </div>
  )
}

function ExchangeLogoSmall({ exchange }: { exchange: string }) {
  const brand = EXCHANGE_OPTIONS.find((e) => e.id === exchange)
  return (
    <div
      className={`size-9 rounded-lg ${brand?.bgClass ?? 'bg-slate-500'} ${brand?.textClass ?? 'text-white'} flex items-center justify-center font-black text-xs tracking-tight`}
    >
      {brand?.abbr ?? exchange.slice(0, 2).toUpperCase()}
    </div>
  )
}

function formatLastSynced(lastSynced: string | null): string {
  if (!lastSynced) return 'Never synced'
  const diff = Date.now() - new Date(lastSynced).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function EmptyState({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-6">
      <div className="flex items-center justify-center size-20 rounded-2xl bg-primary/10 text-primary">
        <span className="material-symbols-outlined text-5xl">account_balance_wallet</span>
      </div>
      <div className="flex flex-col items-center gap-2 text-center">
        <h2 className="text-slate-900 dark:text-slate-100 text-2xl font-black">No exchanges connected</h2>
        <p className="text-slate-500 dark:text-slate-400 text-sm max-w-sm">
          Connect your first exchange to start tracking your portfolio, syncing trades and calculating PnL.
        </p>
      </div>
      <button
        onClick={onConnect}
        className="flex items-center gap-2 rounded-xl h-12 px-8 bg-primary text-accent font-bold text-sm shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all"
      >
        <span className="material-symbols-outlined text-[18px]">add</span>
        Connect Your First Exchange
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
}: {
  account: ExchangeAccount
  onToggleActive: (account: ExchangeAccount) => Promise<void>
  onSync: (account: ExchangeAccount) => Promise<void>
  onEdit: (account: ExchangeAccount) => void
  onDelete: (account: ExchangeAccount) => void
  isSyncing: boolean
  isDeleting: boolean
}) {
  const exchangeName = EXCHANGE_OPTIONS.find((e) => e.id === account.exchange)?.name ?? account.exchange
  const displayName = account.label ?? exchangeName

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 dark:border-primary/20 bg-white dark:bg-[#201f23] p-6 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex justify-between items-start">
        <div className="flex items-center gap-4">
          <ExchangeLogo exchange={account.exchange} />
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
              {account.is_active ? 'Active' : 'Inactive'}
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
          Last Synced
        </p>
        <p className="text-slate-900 dark:text-slate-100 text-lg font-bold">
          {formatLastSynced(account.last_synced)}
        </p>
        <p className="text-slate-400 dark:text-slate-500 text-xs mt-0.5">
          Connected {formatLastSynced(account.created_at)}
        </p>
      </div>

      <div className="flex gap-2 pt-1">
        <button
          onClick={() => onSync(account)}
          disabled={isSyncing || !account.is_active}
          className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-primary/10 dark:bg-primary/20 text-primary dark:text-slate-100 h-10 text-sm font-bold hover:bg-primary hover:text-accent transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <span
            className={`material-symbols-outlined text-[18px] ${isSyncing ? 'animate-spin' : ''}`}
          >
            sync
          </span>
          {isSyncing ? 'Syncing...' : 'Sync Now'}
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
  proxyEnabled,
  proxyValue,
  isSubmitting,
  submitError,
  connectedExchanges,
  onSelectExchange,
  onLabelChange,
  onApiKeyChange,
  onApiSecretChange,
  onPassphraseChange,
  onProxyEnabledChange,
  onProxyValueChange,
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
  proxyEnabled: boolean
  proxyValue: string
  isSubmitting: boolean
  submitError: string | null
  connectedExchanges: string[]
  onSelectExchange: (ex: Exchange) => void
  onLabelChange: (v: string) => void
  onApiKeyChange: (v: string) => void
  onApiSecretChange: (v: string) => void
  onPassphraseChange: (v: string) => void
  onProxyEnabledChange: (v: boolean) => void
  onProxyValueChange: (v: string) => void
  onNext: () => void
  onBack: () => void
  onClose: () => void
}) {
  const isEdit = mode === 'edit'
  const selectedExchangeName =
    EXCHANGE_OPTIONS.find((e) => e.id === selectedExchange)?.name ?? selectedExchange ?? ''

  const requiresPassphrase = selectedExchange === 'okx' || selectedExchange === 'bitget'
  const supportsProxy = selectedExchange === 'binance' || selectedExchange === 'bybit'

  const canNext =
    step === 1
      ? !!selectedExchange
      : step === 2
      ? apiKey.trim().length > 0 && apiSecret.trim().length > 0 && (!requiresPassphrase || passphrase.trim().length > 0)
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
              <ExchangeLogoSmall exchange={selectedExchange} />
            ) : (
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-accent">
                <span className="material-symbols-outlined text-[20px]">account_balance_wallet</span>
              </div>
            )}
            <div>
              <h2 className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-100">
                {isEdit ? `Update ${selectedExchangeName} Keys` : 'Connect Exchange'}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {step === 1
                  ? 'Choose a provider'
                  : step === 2
                  ? 'Enter your API credentials'
                  : 'Successfully connected'}
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
              { num: 1, label: 'Select Exchange' },
              { num: 2, label: 'API Keys' },
              { num: 3, label: 'Done' },
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
                    <div
                      className={`size-12 rounded-xl ${exchange.bgClass} ${exchange.textClass} flex items-center justify-center font-black text-sm`}
                    >
                      {exchange.abbr}
                    </div>
                    <div className="text-center">
                      <p className="font-bold text-slate-900 dark:text-white text-sm">{exchange.name}</p>
                      <p
                        className={`text-[10px] font-semibold uppercase tracking-wider mt-0.5 ${
                          alreadyConnected ? 'text-emerald-500' : 'text-slate-400'
                        }`}
                      >
                        {alreadyConnected ? 'Connected' : 'Available'}
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
                  Account Label <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={label}
                  onChange={(e) => onLabelChange(e.target.value)}
                  placeholder={`e.g. My ${selectedExchangeName} Main`}
                  maxLength={100}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2.5 text-sm focus:ring-2 focus:ring-primary focus:border-primary transition-all outline-none text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                  API Key <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={apiKey}
                  onChange={(e) => onApiKeyChange(e.target.value)}
                  placeholder="Paste your API key here"
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2.5 text-sm font-mono focus:ring-2 focus:ring-primary focus:border-primary transition-all outline-none text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                  API Secret <span className="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  value={apiSecret}
                  onChange={(e) => onApiSecretChange(e.target.value)}
                  placeholder="Paste your API secret here"
                  autoComplete="new-password"
                  spellCheck={false}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2.5 text-sm font-mono focus:ring-2 focus:ring-primary focus:border-primary transition-all outline-none text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
                />
              </div>
              {requiresPassphrase && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                    Passphrase <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="password"
                    value={passphrase}
                    onChange={(e) => onPassphraseChange(e.target.value)}
                    placeholder="Paste your exchange passphrase"
                    autoComplete="new-password"
                    spellCheck={false}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2.5 text-sm font-mono focus:ring-2 focus:ring-primary focus:border-primary transition-all outline-none text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
                  />
                </div>
              )}
              {supportsProxy && (
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex flex-col gap-0.5">
                      <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">Use Proxy</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Enable if your production server region is blocked by exchange.
                      </p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer group flex-shrink-0">
                      <input
                        className="sr-only peer"
                        type="checkbox"
                        checked={proxyEnabled}
                        onChange={(event) => onProxyEnabledChange(event.target.checked)}
                      />
                      <div className="w-11 h-6 bg-slate-300 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary" />
                    </label>
                  </div>
                  {proxyEnabled && (
                    <div className="flex flex-col gap-1.5">
                      <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Proxy</label>
                      <input
                        type="text"
                        value={proxyValue}
                        onChange={(event) => onProxyValueChange(event.target.value)}
                        placeholder="host:port:user:pass or http://user:pass@host:port"
                        autoComplete="off"
                        spellCheck={false}
                        className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm font-mono focus:ring-2 focus:ring-primary focus:border-primary transition-all outline-none text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
                      />
                    </div>
                  )}
                </div>
              )}
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 flex gap-2 text-amber-600 dark:text-amber-400">
                <span className="material-symbols-outlined text-[16px] flex-shrink-0 mt-0.5">shield_lock</span>
                <p className="text-xs">
                  Use <strong>read-only</strong> API keys. Never grant withdrawal permissions.
                  Keys are encrypted with AES-256-GCM.
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
                  {isEdit ? 'Keys Updated' : 'Connection Verified'}
                </h3>
                <p className="text-slate-500 dark:text-slate-400 text-sm">
                  {isEdit
                    ? `Your ${selectedExchangeName} API keys have been updated successfully.`
                    : `Your ${selectedExchangeName} account has been successfully connected.`}
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
            {step === 3 ? 'Close' : step === 1 || isEdit ? 'Cancel' : 'Back'}
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
                  Connecting...
                </>
              ) : step === 2 ? (
                <>
                  <span className="material-symbols-outlined text-[16px]">verified</span>
                  {isEdit ? 'Update Keys' : 'Connect'}
                </>
              ) : (
                <>
                  Next
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
            <h3 className="font-bold text-slate-900 dark:text-slate-100">Remove Exchange</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">This action cannot be undone.</p>
          </div>
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Are you sure you want to remove <strong className="text-slate-900 dark:text-slate-100">{displayName}</strong>?
          All API keys and synced trade data for this exchange will be permanently deleted.
        </p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-5 py-2 rounded-lg font-semibold text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-5 py-2 rounded-lg font-bold text-sm bg-red-500 text-white hover:bg-red-600 transition-colors flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">delete</span>
            Remove
          </button>
        </div>
      </div>
    </div>
  )
}

function SecurityBanner() {
  return (
    <div className="rounded-2xl bg-gradient-to-br from-primary to-[#433362] p-8 text-accent relative overflow-hidden">
      <div className="absolute -right-12 -top-12 size-48 bg-accent/10 rounded-full blur-3xl pointer-events-none" />
      <div className="relative z-10 flex flex-col md:flex-row justify-between items-center gap-6">
        <div className="flex flex-col gap-2 text-center md:text-left">
          <h2 className="text-2xl font-black">Secure API Connection</h2>
          <p className="text-slate-100/80 max-w-md text-sm">
            We use AES-256-GCM encryption to protect your API keys. Your funds remain safe on the
            exchange — we only request read-only access.
          </p>
        </div>
        <div className="flex gap-5 flex-shrink-0">
          {[
            { icon: 'verified_user', label: 'Encrypted' },
            { icon: 'lock', label: 'Read-only' },
            { icon: 'privacy_tip', label: 'No Withdrawal' },
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
  const [accounts, setAccounts] = useState<ExchangeAccount[]>([])
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
  const [proxyEnabled, setProxyEnabled] = useState(false)
  const [proxyValue, setProxyValue] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const [syncingId, setSyncingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ExchangeAccount | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const fetchAccounts = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch('/api/exchange/accounts')
      const data = await res.json()
      if (data.success && Array.isArray(data.data)) {
        setAccounts(data.data)
      }
    } catch {}
    setIsLoading(false)
  }, [])

  useEffect(() => {
    fetchAccounts()
  }, [fetchAccounts])

  const openConnectModal = () => {
    setModalMode('connect')
    setEditAccountId(null)
    setStep(1)
    setSelectedExchange(null)
    setLabel('')
    setApiKey('')
    setApiSecret('')
    setPassphrase('')
    setProxyEnabled(false)
    setProxyValue('')
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
    setProxyEnabled(false)
    setProxyValue('')
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
    setProxyEnabled(false)
    setProxyValue('')
    setSubmitError(null)
  }

  const handleNext = async () => {
    if (step === 1) {
      setStep(2)
      return
    }
    if (step === 2) {
      const requiresPassphrase = selectedExchange === 'okx' || selectedExchange === 'bitget'
      const supportsProxy = selectedExchange === 'binance' || selectedExchange === 'bybit'
      if (!selectedExchange || !apiKey.trim() || !apiSecret.trim() || (requiresPassphrase && !passphrase.trim())) return
      setIsSubmitting(true)
      setSubmitError(null)
      try {
        let res: Response
        const proxyPayload =
          supportsProxy && proxyEnabled && proxyValue.trim().length > 0
            ? proxyValue.trim()
            : undefined
        if (modalMode === 'edit' && editAccountId) {
          res = await fetch(`/api/exchange/accounts/${editAccountId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              apiKey: apiKey.trim(),
              apiSecret: apiSecret.trim(),
              passphrase: passphrase.trim() || undefined,
              proxy: proxyPayload,
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
              proxy: proxyPayload,
              label: label.trim() || null,
            }),
          })
        }
        const data = await res.json()
        const errorMessages: Record<string, string> = {
          CONFLICT: 'This exchange is already connected.',
          INVALID_KEY: 'That API key was rejected. Check the key and try again.',
          INVALID_API_KEY: 'That API key was rejected. Check the key and try again.',
          INVALID_SECRET_OR_PASSPHRASE: 'The secret or passphrase was rejected. Check both and try again.',
          IP_NOT_WHITELISTED: 'The exchange rejected this server IP. Add the platform IP to the key allowlist.',
          TRADE_PERMISSION_DETECTED: 'This key can trade. Create a read-only key and try again.',
          WITHDRAW_PERMISSION_DETECTED: 'This key can withdraw. Create a read-only key with withdrawal disabled.',
          TRANSFER_PERMISSION_DETECTED: 'This key can transfer funds. Create a read-only key with transfers disabled.',
          GEO_BLOCKED: 'The exchange blocked this server region. Try again later.',
          EXCHANGE_REGION_BLOCKED: 'The exchange blocked this server region. Try again later.',
          RATE_LIMITED: 'Too many validation attempts. Wait and try again.',
          EXCHANGE_UNREACHABLE: 'The exchange could not be reached. Try again in a few minutes.',
          EXCHANGE_TIME_DRIFT: 'Server time is out of sync with the exchange. Try again in a moment.',
          PASSPHRASE_REQUIRED: 'Passphrase is required for this exchange.',
          UNKNOWN: 'The exchange could not validate this key. Try again.',
          UNSUPPORTED_EXCHANGE: 'This exchange is not supported.',
          VALIDATION_ERROR: 'Please check your input and try again.',
          PERMISSIONS_UNVERIFIED: 'The key was saved. The exchange did not confirm that it is read-only.',
          FUTURES_PERMISSION_PRESENT: 'This key can trade futures. The app never places orders. Use an IP whitelist.',
          IP_RESTRICT_DISABLED: 'The key was saved. It is not restricted to an IP allowlist.',
          IP_WHITELIST_MISSING: 'The key was saved. No IP allowlist was reported for this key.',
        }
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
          setSubmitError(errorMessages[data.error] ?? 'Connection failed. Please try again.')
        }
      } catch {
        setSubmitError('Network error. Please try again.')
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
    setSyncingId(account.id)
    try {
      await fetch('/api/exchange/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exchangeAccountId: account.id }),
      })
      await fetchAccounts()
    } catch {}
    setSyncingId(null)
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
    <div className="px-6 lg:px-12 xl:px-20 py-8 flex flex-col gap-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-slate-900 dark:text-slate-100 text-3xl font-black leading-tight tracking-tight">
            Exchange Management
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-base">
            Manage your connected exchange accounts and sync settings across your portfolio.
          </p>
        </div>
        <button
          onClick={openConnectModal}
          className="flex items-center gap-2 rounded-xl h-12 px-6 bg-primary text-accent font-bold text-sm shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all whitespace-nowrap"
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
          Connect New Exchange
        </button>
      </div>

      <div className="flex flex-col md:flex-row items-start md:items-center gap-4 rounded-xl border border-primary/20 bg-primary/5 p-5">
        <div className="flex items-center justify-center size-9 rounded-full bg-primary/10 text-primary flex-shrink-0">
          <span className="material-symbols-outlined text-[18px]">info</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <p className="text-slate-900 dark:text-slate-100 text-sm font-bold leading-tight">Sync Notice</p>
          <p className="text-slate-600 dark:text-slate-400 text-sm">
            Toggling off an exchange will exclude its data from your global dashboard analytics and PnL
            calculations.
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
              isSyncing={syncingId === account.id}
              isDeleting={deletingId === account.id}
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
          proxyEnabled={proxyEnabled}
          proxyValue={proxyValue}
          isSubmitting={isSubmitting}
          submitError={submitError}
          connectedExchanges={connectedExchangeIds}
          onSelectExchange={setSelectedExchange}
          onLabelChange={setLabel}
          onApiKeyChange={setApiKey}
          onApiSecretChange={setApiSecret}
          onPassphraseChange={setPassphrase}
          onProxyEnabledChange={setProxyEnabled}
          onProxyValueChange={setProxyValue}
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

