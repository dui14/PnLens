'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { createSupabaseBrowserClient } from '@/lib/db/supabase-browser'
import { useT } from '@/lib/i18n/client'
import { buildResetPasswordSchema } from '@/lib/validators/auth'
import { AutofillSafeInput } from '@/components/ui/AutofillSafeInput'
import { AuthCard } from '@/components/features/auth/AuthCard'

type ResetPasswordValues = { password: string; confirmPassword: string }
type LinkState = 'checking' | 'ready' | 'invalid'

const INPUT_CLASS =
  'block w-full pl-10 pr-3 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-1 focus:ring-primary focus:border-primary transition-all placeholder:text-slate-400 dark:placeholder:text-slate-600'

export function ResetPasswordForm(): React.JSX.Element {
  const { t } = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const linkFailed = searchParams.get('error') !== null
  const schema = useMemo(
    () =>
      buildResetPasswordSchema({
        passwordMin: t.auth.validation.passwordMin,
        passwordMismatch: t.auth.validation.passwordMismatch,
      }),
    [t]
  )
  const [linkState, setLinkState] = useState<LinkState>(linkFailed ? 'invalid' : 'checking')
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordValues>({ resolver: zodResolver(schema) })

  useEffect(() => {
    if (linkFailed) return
    let active = true
    const supabase = createSupabaseBrowserClient()
    supabase.auth
      .getUser()
      .then(({ data }) => {
        if (active) setLinkState(data.user ? 'ready' : 'invalid')
      })
      .catch(() => {
        if (active) setLinkState('invalid')
      })
    return () => {
      active = false
    }
  }, [linkFailed])

  const onSubmit = async (data: ResetPasswordValues): Promise<void> => {
    setUpdateError(null)
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.auth.updateUser({ password: data.password })
    if (error) {
      setUpdateError(error.message || t.auth.reset.updateError)
      return
    }
    router.push('/dashboard')
    router.refresh()
  }

  if (linkState === 'checking') {
    return (
      <AuthCard title={t.auth.reset.title}>
        <p role="status" className="text-center text-sm text-slate-500 dark:text-slate-400">
          {t.auth.reset.checking}
        </p>
      </AuthCard>
    )
  }

  if (linkState === 'invalid') {
    return (
      <AuthCard
        title={t.auth.reset.invalidTitle}
        subtitle={t.auth.reset.invalidBody}
        footer={
          <Link href="/login" className="font-bold text-primary dark:text-accent hover:underline">
            {t.auth.forgot.backToLogin}
          </Link>
        }
      >
        <Link
          href="/forgot-password"
          className="w-full flex justify-center py-3 px-4 rounded-lg shadow-sm text-sm font-bold text-white bg-primary hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition-all"
        >
          {t.auth.reset.requestNew}
        </Link>
      </AuthCard>
    )
  }

  return (
    <AuthCard title={t.auth.reset.title} subtitle={t.auth.reset.subtitle}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {updateError && (
          <div role="alert" className="rounded-lg bg-rose-500/10 border border-rose-500/20 px-4 py-3 text-sm text-rose-400">
            {updateError}
          </div>
        )}
        <div>
          <label
            className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
            htmlFor="password"
          >
            {t.auth.reset.newPassword}
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <span className="material-symbols-outlined text-accent text-xl opacity-80">lock</span>
            </div>
            <AutofillSafeInput
              {...register('password')}
              id="password"
              type={showPassword ? 'text' : 'password'}
              placeholder={t.auth.reset.newPlaceholder}
              autoComplete="new-password"
              className={`${INPUT_CLASS} pr-11`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              aria-label={showPassword ? t.auth.reset.hidePassword : t.auth.reset.showPassword}
              className="absolute inset-y-0 right-0 px-3 flex items-center text-slate-400 hover:text-primary transition-colors"
            >
              <span className="material-symbols-outlined text-xl">
                {showPassword ? 'visibility_off' : 'visibility'}
              </span>
            </button>
          </div>
          {errors.password && <p className="text-xs text-rose-500 mt-1">{errors.password.message}</p>}
        </div>
        <div>
          <label
            className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
            htmlFor="confirmPassword"
          >
            {t.auth.register.confirmPassword}
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <span className="material-symbols-outlined text-accent text-xl opacity-80">shield</span>
            </div>
            <AutofillSafeInput
              {...register('confirmPassword')}
              id="confirmPassword"
              type={showPassword ? 'text' : 'password'}
              placeholder={t.auth.reset.confirmPlaceholder}
              autoComplete="new-password"
              className={INPUT_CLASS}
            />
          </div>
          {errors.confirmPassword && (
            <p className="text-xs text-rose-500 mt-1">{errors.confirmPassword.message}</p>
          )}
        </div>
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full flex justify-center py-3 px-4 rounded-lg shadow-sm text-sm font-bold text-white bg-primary hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition-all disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isSubmitting ? t.auth.reset.submitting : t.auth.reset.submit}
        </button>
      </form>
    </AuthCard>
  )
}
