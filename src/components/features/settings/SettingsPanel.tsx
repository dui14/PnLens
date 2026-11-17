'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { createSupabaseBrowserClient } from '@/lib/db/supabase-browser'
import { AutofillSafeInput } from '@/components/ui/AutofillSafeInput'
import { LanguageSelect } from '@/components/features/settings/LanguageSelect'
import { ChangePasswordSection } from '@/components/features/settings/ChangePasswordSection'
import { AvatarSection } from '@/components/features/settings/AvatarSection'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { useProviderAvatarUrl } from '@/lib/avatar/useAvatarUrl'
import { AiProvidersSection } from '@/components/features/settings/AiProvidersSection'
import { AI_PROVIDERS, AI_SETTINGS_SECTION } from '@/lib/ai/providerConfig'
import { useT } from '@/lib/i18n/client'
import { SETTINGS_HELP_PATH } from '@/lib/content/howItWorks'
import { fillTemplate } from '@/lib/i18n/format'
import type { Dictionary } from '@/lib/i18n'
import type { AiProvider, UserProfile, ExchangeAccount } from '@/lib/types'

function buildProfileSchema(t: Dictionary) {
  return z.object({
    displayName: z.string().min(2, t.auth.validation.displayNameMin).max(100).trim(),
  })
}

type ProfileFormValues = z.infer<ReturnType<typeof buildProfileSchema>>

type SettingsTab = 'general' | 'security' | 'exchanges' | 'ai'

const SETTINGS_TABS: { key: SettingsTab; icon: string }[] = [
  { key: 'general', icon: 'person' },
  { key: 'security', icon: 'shield' },
  { key: 'exchanges', icon: 'currency_exchange' },
  { key: 'ai', icon: 'smart_toy' },
]

const EXCHANGE_LABELS: Record<string, string> = {
  binance: 'Binance',
  okx: 'OKX',
  bybit: 'Bybit',
  bitget: 'Bitget',
  gateio: 'Gate.io',
}

function formatMemberSince(dateStr: string, intlLocale: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString(intlLocale, { month: 'short', year: 'numeric' })
}

export function SettingsPanel(): React.JSX.Element {
  const { t, intlLocale } = useT()
  const p = t.settings
  const profileSchema = useMemo(() => buildProfileSchema(t), [t])
  const router = useRouter()
  const searchParams = useSearchParams()
  const sectionParam = searchParams.get('section')
  const providerParam = searchParams.get('provider')
  const focusProvider = AI_PROVIDERS.find((item) => item === providerParam) as AiProvider | undefined
  const [activeTab, setActiveTab] = useState<SettingsTab>(
    sectionParam === AI_SETTINGS_SECTION ? 'ai' : 'general'
  )
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const providerAvatar = useProviderAvatarUrl()
  const [exchanges, setExchanges] = useState<ExchangeAccount[]>([])
  const [loadingProfile, setLoadingProfile] = useState(true)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [isDeletingAccount, setIsDeletingAccount] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { displayName: '' },
  })

  const loadProfile = useCallback(async (): Promise<void> => {
    setLoadingProfile(true)
    try {
      const [profileRes, exchangesRes] = await Promise.all([
        fetch('/api/settings'),
        fetch('/api/exchange/accounts'),
      ])

      if (profileRes.ok) {
        const profileData = await profileRes.json()
        if (profileData.success && profileData.data) {
          setProfile(profileData.data)
          reset({
            displayName: profileData.data.display_name ?? '',
          })
        }
      }

      if (exchangesRes.ok) {
        const exchangesData = await exchangesRes.json()
        if (exchangesData.success) {
          setExchanges(exchangesData.data ?? [])
        }
      }
    } finally {
      setLoadingProfile(false)
    }
  }, [reset])

  useEffect(() => {
    loadProfile()
  }, [loadProfile])

  const onSubmit = async (data: ProfileFormValues): Promise<void> => {
    setSaveSuccess(false)
    setSaveError(null)

    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: data.displayName }),
    })

    const result = await res.json()

    if (res.ok && result.success) {
      setProfile(result.data)
      reset({ displayName: result.data.display_name ?? '' })
      window.location.reload()
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    } else {
      setSaveError(result.error ?? p.updateFailed)
    }
  }

  const handleLogout = async (): Promise<void> => {
    setIsLoggingOut(true)
    const supabase = createSupabaseBrowserClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  const handleDeleteAccount = async (): Promise<void> => {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setIsDeletingAccount(true)
    const res = await fetch('/api/auth/account', { method: 'DELETE' })
    if (res.ok) {
      const supabase = createSupabaseBrowserClient()
      await supabase.auth.signOut()
      router.push('/login')
    } else {
      setIsDeletingAccount(false)
      setConfirmDelete(false)
    }
  }

  const displayName = profile?.display_name ?? profile?.email?.split('@')[0] ?? ''
  const shownAvatar = profile?.avatar_url ?? providerAvatar

  return (
    <div className="h-full overflow-y-auto">
      <main className="max-w-7xl mx-auto w-full px-6 py-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <aside className="lg:col-span-3 flex flex-col gap-6">
            <div className="bg-white dark:bg-slate-900/50 rounded-xl p-4 border border-slate-200 dark:border-slate-800">
              <nav className="flex flex-col gap-1">
                {SETTINGS_TABS.map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-all ${
                      activeTab === tab.key
                        ? 'bg-primary text-white font-medium shadow-lg shadow-primary/20'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span className="material-symbols-outlined">{tab.icon}</span>
                    <span>{tab.key === 'ai' ? t.aiProviders.tabLabel : p.tabs[tab.key]}</span>
                  </button>
                ))}
              </nav>
            </div>
          </aside>

          <div className="lg:col-span-9 space-y-6">
            <section className="bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-xl p-6">
              <div className="flex flex-col sm:flex-row items-center gap-8">
                <div className="size-32 rounded-full border-4 border-primary/20 p-1 shrink-0">
                  <UserAvatar
                    src={shownAvatar}
                    name={displayName}
                    alt={t.nav.avatarAlt}
                    className="w-full h-full"
                    textClassName="text-4xl"
                  />
                </div>

                <div className="flex-1 text-center sm:text-left">
                  {loadingProfile ? (
                    <div className="h-8 w-48 bg-slate-200 dark:bg-slate-700 rounded animate-pulse mb-2" />
                  ) : (
                    <h1 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-slate-100 tracking-tight">
                      {displayName}
                    </h1>
                  )}
                  {loadingProfile ? (
                    <div className="h-4 w-64 bg-slate-200 dark:bg-slate-700 rounded animate-pulse mt-2" />
                  ) : (
                    <p className="text-slate-500 dark:text-slate-400 font-medium">
                      {profile?.email} &bull;{' '}
                      {profile
                        ? fillTemplate(p.memberSince, {
                            date: formatMemberSince(profile.created_at, intlLocale),
                          })
                        : ''}
                    </p>
                  )}
                </div>
              </div>
            </section>

            {activeTab === 'general' && (
              <section className="bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                <div className="px-8 py-6 border-b border-slate-200 dark:border-slate-800">
                  <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                    {p.generalTitle}
                  </h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                    {p.generalSubtitle}
                  </p>
                </div>

                <div className="px-8 pt-8">
                  <AvatarSection
                    avatarUrl={shownAvatar}
                    storedAvatarUrl={profile?.avatar_url ?? null}
                    name={displayName}
                    onChange={(url) => setProfile((prev) => (prev ? { ...prev, avatar_url: url } : prev))}
                  />
                </div>

                <form onSubmit={handleSubmit(onSubmit)}>
                  <div className="p-8">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                          {p.displayName}
                        </label>
                        <AutofillSafeInput
                          {...register('displayName')}
                          type="text"
                          autoComplete="off"
                          disabled={loadingProfile}
                          className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-primary focus:border-primary transition-all p-3 outline-none disabled:opacity-60"
                        />
                        {errors.displayName && (
                          <p className="text-xs text-rose-500">{errors.displayName.message}</p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                          {p.emailAddress}
                        </label>
                        <p className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 p-3 break-all">
                          {profile?.email ?? ''}
                        </p>
                      </div>
                    </div>

                    {saveError && (
                      <p className="mt-4 text-sm text-rose-500">{saveError}</p>
                    )}
                    {saveSuccess && (
                      <p className="mt-4 text-sm text-emerald-500">{p.saved}</p>
                    )}
                  </div>

                  <div className="px-8 pb-8">
                    <LanguageSelect />
                  </div>

                  <div className="px-8 py-6 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-4">
                    <button
                      type="button"
                      disabled={!isDirty || isSubmitting}
                      onClick={() =>
                        reset({
                          displayName: profile?.display_name ?? '',
                        })
                      }
                      className="px-6 py-2 rounded-lg text-slate-600 dark:text-slate-400 font-semibold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {p.reset}
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmitting || !isDirty || loadingProfile}
                      className="px-8 py-2 bg-primary text-white rounded-lg font-bold hover:bg-primary/90 transition-all shadow-lg shadow-primary/20 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {isSubmitting ? p.saving : p.saveChanges}
                    </button>
                  </div>
                </form>

                <div className="pt-6 border-t border-slate-200 dark:border-slate-800">
                  <ChangePasswordSection />
                </div>
              </section>
            )}

            {activeTab === 'general' && (
              <section className="bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                    {p.helpTitle}
                  </h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{p.helpHint}</p>
                </div>
                <Link
                  href={SETTINGS_HELP_PATH}
                  className="inline-flex items-center justify-center gap-2 px-5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <span className="material-symbols-outlined text-xl" aria-hidden="true">
                    help
                  </span>
                  {p.helpLink}
                </Link>
              </section>
            )}

            {activeTab === 'ai' && <AiProvidersSection focusProvider={focusProvider ?? null} />}

            {activeTab === 'security' && (
              <section className="bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                <div className="px-8 py-6 border-b border-slate-200 dark:border-slate-800">
                  <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                    {p.securityTitle}
                  </h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                    {p.securitySubtitle}
                  </p>
                </div>

                <div className="p-8 space-y-4">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-5 rounded-xl border border-slate-200 dark:border-slate-700">
                    <div className="flex items-center gap-4">
                      <div className="size-10 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                        <span className="material-symbols-outlined text-slate-500">logout</span>
                      </div>
                      <div>
                        <p className="text-sm font-bold text-slate-800 dark:text-slate-200">
                          {p.signOut}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {p.signOutHint}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={handleLogout}
                      disabled={isLoggingOut}
                      className="px-5 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 text-sm font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {isLoggingOut ? p.signingOut : p.signOut}
                    </button>
                  </div>
                </div>
              </section>
            )}

            {activeTab === 'exchanges' && (
              <section className="bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                <div className="px-8 py-6 border-b border-slate-200 dark:border-slate-800">
                  <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                    {p.exchangesTitle}
                  </h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                    {p.exchangesSubtitle}
                  </p>
                </div>

                <div className="p-8">
                  {loadingProfile ? (
                    <div className="space-y-3">
                      {[1, 2].map((i) => (
                        <div
                          key={i}
                          className="h-16 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse"
                        />
                      ))}
                    </div>
                  ) : exchanges.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                      <span className="material-symbols-outlined text-slate-300 dark:text-slate-600 text-6xl mb-4">
                        link_off
                      </span>
                      <h3 className="text-base font-bold text-slate-600 dark:text-slate-400">
                        {p.noExchanges}
                      </h3>
                      <p className="text-sm text-slate-400 mt-1 mb-6">
                        {p.noExchangesHint}
                      </p>
                      <a
                        href="/exchange"
                        className="px-6 py-2 bg-primary text-white rounded-lg text-sm font-bold hover:bg-primary/90 transition-colors shadow-md shadow-primary/20"
                      >
                        {p.connectExchange}
                      </a>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {exchanges.map((account) => (
                        <div
                          key={account.id}
                          className="flex items-center justify-between p-4 rounded-xl border border-slate-200 dark:border-slate-700"
                        >
                          <div className="flex items-center gap-4">
                            <div className="size-10 rounded-lg bg-primary/10 flex items-center justify-center">
                              <span className="material-symbols-outlined text-primary text-lg">
                                account_balance_wallet
                              </span>
                            </div>
                            <div>
                              <p className="text-sm font-bold text-slate-800 dark:text-slate-200">
                                {EXCHANGE_LABELS[account.exchange] ?? account.exchange}
                                {account.label ? ` — ${account.label}` : ''}
                              </p>
                              <p className="text-xs text-slate-400">
                                {account.last_synced
                                  ? fillTemplate(p.lastSynced, {
                                      date: new Date(account.last_synced).toLocaleDateString(intlLocale),
                                    })
                                  : p.neverSynced}
                              </p>
                            </div>
                          </div>
                          <span
                            className={`px-3 py-1 rounded-full text-xs font-bold ${
                              account.is_active
                                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                                : 'bg-slate-100 text-slate-500 dark:bg-slate-800 border border-slate-200 dark:border-slate-700'
                            }`}
                          >
                            {account.is_active ? p.active : p.inactive}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            )}

            <section className="bg-rose-500/5 border border-rose-500/20 rounded-xl p-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                  <h3 className="text-rose-600 dark:text-rose-400 font-bold">{p.deleteAccount}</h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {p.deleteDescription}
                  </p>
                </div>
                <button
                  onClick={handleDeleteAccount}
                  disabled={isDeletingAccount}
                  className={`px-4 py-2 rounded-lg text-sm font-bold transition-all disabled:opacity-60 disabled:cursor-not-allowed ${
                    confirmDelete
                      ? 'bg-rose-500 text-white'
                      : 'border border-rose-500 text-rose-500 hover:bg-rose-500 hover:text-white'
                  }`}
                >
                  {isDeletingAccount
                    ? p.deleting
                    : confirmDelete
                    ? p.confirmDelete
                    : p.deleteAccount}
                </button>
              </div>
              {confirmDelete && !isDeletingAccount && (
                <p className="mt-3 text-xs text-rose-400">
                  {p.deleteConfirmHint}{' '}
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="underline font-semibold"
                  >
                    {p.cancel}
                  </button>
                </p>
              )}
            </section>
          </div>
        </div>
      </main>
    </div>
  )
}
