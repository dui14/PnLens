'use client'

import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { createSupabaseBrowserClient } from '@/lib/db/supabase-browser'
import { getClientAppOrigin } from '@/lib/auth-origin'
import { CHANGE_PASSWORD_ENDPOINT, RESET_REDIRECT_PATH } from '@/lib/auth/constants'
import { hasPasswordLogin } from '@/lib/auth/passwordIdentity'
import { useT } from '@/lib/i18n/client'
import { fillTemplate } from '@/lib/i18n/format'
import { buildChangePasswordSchema } from '@/lib/validators/auth'
import { AutofillSafeInput } from '@/components/ui/AutofillSafeInput'

type ChangePasswordValues = {
  currentPassword: string
  newPassword: string
  confirmPassword: string
}

type AccountState = { email: string; hasPassword: boolean } | null
type ResetState = 'idle' | 'sending' | 'sent' | 'error'

const INPUT_CLASS =
  'w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-primary focus:border-primary transition-all p-3 outline-none'
const LABEL_CLASS = 'text-sm font-semibold text-slate-700 dark:text-slate-300'

export function ChangePasswordSection(): React.JSX.Element | null {
  const { t } = useT()
  const p = t.settings.changePassword
  const [account, setAccount] = useState<AccountState>(null)
  const [resetState, setResetState] = useState<ResetState>('idle')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  const schema = useMemo(
    () =>
      buildChangePasswordSchema({
        currentRequired: p.currentRequired,
        passwordMin: t.auth.validation.passwordMin,
        passwordMismatch: t.auth.validation.passwordMismatch,
        sameAsCurrent: p.sameAsCurrent,
      }),
    [t, p]
  )

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordValues>({ resolver: zodResolver(schema) })

  useEffect(() => {
    let active = true
    createSupabaseBrowserClient()
      .auth.getUser()
      .then(({ data }) => {
        if (!active || !data.user) return
        setAccount({ email: data.user.email ?? '', hasPassword: hasPasswordLogin(data.user) })
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  const onSubmit = async (values: ChangePasswordValues): Promise<void> => {
    setSubmitError(null)
    setSubmitted(false)
    const res = await fetch(CHANGE_PASSWORD_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    })
    const result = await res.json().catch(() => null)
    if (res.ok && result?.success) {
      reset()
      setSubmitted(true)
      return
    }
    const code: string = result?.error ?? ''
    const known = p.errors as Record<string, string>
    setSubmitError(known[code] ?? p.errors.DEFAULT)
  }

  const sendResetEmail = async (): Promise<void> => {
    if (!account?.email) return
    setResetState('sending')
    const { error } = await createSupabaseBrowserClient().auth.resetPasswordForEmail(
      account.email,
      { redirectTo: `${getClientAppOrigin()}${RESET_REDIRECT_PATH}` }
    )
    if (error && (error.status === undefined || error.status >= 500 || error.status === 429)) {
      setResetState('error')
      return
    }
    setResetState('sent')
  }

  if (!account) return null

  const resetStatus = (
    <>
      {resetState === 'sent' && (
        <p role="status" className="text-sm text-emerald-500">
          {fillTemplate(p.resetSent, { email: account.email })}
        </p>
      )}
      {resetState === 'error' && (
        <p role="alert" className="text-sm text-rose-500">
          {p.resetError}
        </p>
      )}
    </>
  )

  if (!account.hasPassword) {
    return (
      <div className="px-8 pb-8">
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-5 space-y-3">
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
            {p.noPasswordTitle}
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 text-pretty">{p.noPasswordBody}</p>
          <button
            type="button"
            onClick={sendResetEmail}
            disabled={resetState === 'sending'}
            className="px-5 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 text-sm font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {resetState === 'sending' ? p.sending : p.noPasswordAction}
          </button>
          {resetStatus}
        </div>
      </div>
    )
  }

  return (
    <div className="px-8 pb-8">
      <form
        onSubmit={handleSubmit(onSubmit)}
        noValidate
        className="rounded-xl border border-slate-200 dark:border-slate-700 p-5 space-y-4"
      >
        <div>
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">{p.title}</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{p.subtitle}</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <label htmlFor="current-password" className={LABEL_CLASS}>
              {p.current}
            </label>
            <AutofillSafeInput
              {...register('currentPassword')}
              id="current-password"
              type="password"
              autoComplete="current-password"
              className={INPUT_CLASS}
            />
            {errors.currentPassword && (
              <p className="text-xs text-rose-500">{errors.currentPassword.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <label htmlFor="new-password" className={LABEL_CLASS}>
              {p.new}
            </label>
            <AutofillSafeInput
              {...register('newPassword')}
              id="new-password"
              type="password"
              autoComplete="new-password"
              className={INPUT_CLASS}
            />
            {errors.newPassword && (
              <p className="text-xs text-rose-500">{errors.newPassword.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <label htmlFor="confirm-new-password" className={LABEL_CLASS}>
              {p.confirm}
            </label>
            <AutofillSafeInput
              {...register('confirmPassword')}
              id="confirm-new-password"
              type="password"
              autoComplete="new-password"
              className={INPUT_CLASS}
            />
            {errors.confirmPassword && (
              <p className="text-xs text-rose-500">{errors.confirmPassword.message}</p>
            )}
          </div>
        </div>
        {submitError && (
          <p role="alert" className="text-sm text-rose-500">
            {submitError}
          </p>
        )}
        {submitted && (
          <p role="status" className="text-sm text-emerald-500">
            {p.success}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={sendResetEmail}
            disabled={resetState === 'sending'}
            className="text-sm font-semibold text-accent hover:text-accent/80 transition-colors disabled:opacity-60"
          >
            {resetState === 'sending' ? p.sending : p.forgot}
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="px-6 py-2 bg-primary text-white rounded-lg font-bold hover:bg-primary/90 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isSubmitting ? p.submitting : p.submit}
          </button>
        </div>
        {resetStatus}
      </form>
    </div>
  )
}
