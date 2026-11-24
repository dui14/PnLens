'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { createSupabaseBrowserClient } from '@/lib/db/supabase-browser'
import { writeRememberPreference } from '@/lib/auth/rememberPolicy'
import { useT } from '@/lib/i18n/client'
import { AutofillSafeInput } from '@/components/ui/AutofillSafeInput'
import { AuthCard } from '@/components/features/auth/AuthCard'
import type { Dictionary } from '@/lib/i18n'

function buildLoginSchema(t: Dictionary) {
  return z.object({
    email: z.string().email(t.auth.validation.email),
    password: z.string().min(8, t.auth.validation.passwordMin),
    rememberMe: z.boolean().optional(),
  })
}

type LoginFormValues = z.infer<ReturnType<typeof buildLoginSchema>>

function GoogleIcon(): React.JSX.Element {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  )
}

export function LoginForm(): React.JSX.Element {
  const { t } = useT()
  const router = useRouter()
  const loginSchema = useMemo(() => buildLoginSchema(t), [t])
  const [authError, setAuthError] = useState<string | null>(null)
  const [googleLoading, setGoogleLoading] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
  })

  const handleGoogleSignIn = async (): Promise<void> => {
    setGoogleLoading(true)
    setAuthError(null)
    writeRememberPreference(true)
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/api/auth/callback?next=/dashboard`,
        queryParams: {
          access_type: 'offline',
          prompt: 'select_account',
        },
      },
    })
    if (error) {
      setAuthError(error.message)
      setGoogleLoading(false)
    }
  }

  const onSubmit = async (data: LoginFormValues): Promise<void> => {
    setAuthError(null)
    writeRememberPreference(Boolean(data.rememberMe))
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.auth.signInWithPassword({
      email: data.email.trim().toLowerCase(),
      password: data.password,
    })
    if (error) {
      if (error.message.toLowerCase().includes('invalid login credentials')) {
        setAuthError(t.auth.login.invalidCredentials)
      } else {
        setAuthError(error.message)
      }
      return
    }
    router.push('/dashboard')
    router.refresh()
  }

  return (
    <AuthCard
      title={t.auth.login.title}
      subtitle={t.auth.login.subtitle}
      footer={
        <>
          {t.auth.login.noAccount}{' '}
          <Link href="/register" className="font-bold text-primary dark:text-accent hover:underline">
            {t.auth.login.createAccount}
          </Link>
        </>
      }
    >
        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={googleLoading}
          className="w-full flex items-center justify-center gap-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 py-2.5 rounded-lg text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors mb-6 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <GoogleIcon />
          {googleLoading ? t.auth.login.redirecting : t.auth.continueWithGoogle}
        </button>

        <div className="relative mb-6">
          <div aria-hidden="true" className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-slate-200 dark:border-slate-800" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-slate-50 dark:bg-panel-dark px-2 text-slate-500 dark:text-slate-400">
              {t.auth.login.orContinueWithEmail}
            </span>
          </div>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" autoComplete="on">
          {authError && (
            <div className="rounded-lg bg-rose-500/10 border border-rose-500/20 px-4 py-3 text-sm text-rose-400">
              {authError}
            </div>
          )}
          <div>
            <label
              className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              htmlFor="email"
            >
              {t.auth.emailAddress}
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <span className="material-symbols-outlined text-accent text-xl opacity-80">mail</span>
              </div>
              <AutofillSafeInput
                {...register('email')}
                id="email"
                type="email"
                placeholder={t.auth.login.emailPlaceholder}
                autoComplete="username"
                className="block w-full pl-10 pr-3 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-1 focus:ring-primary focus:border-primary transition-all placeholder:text-slate-400 dark:placeholder:text-slate-600"
              />
            </div>
            {errors.email && (
              <p className="text-xs text-rose-500 mt-1">{errors.email.message}</p>
            )}
          </div>

          <div>
            <label
              className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              htmlFor="password"
            >
              {t.auth.password}
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <span className="material-symbols-outlined text-accent text-xl opacity-80">lock</span>
              </div>
              <AutofillSafeInput
                {...register('password')}
                id="password"
                type="password"
                placeholder="••••••••"
                autoComplete="current-password"
                className="block w-full pl-10 pr-3 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-1 focus:ring-primary focus:border-primary transition-all placeholder:text-slate-400 dark:placeholder:text-slate-600"
              />
            </div>
            {errors.password && (
              <p className="text-xs text-rose-500 mt-1">{errors.password.message}</p>
            )}
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <input
                {...register('rememberMe')}
                id="remember-me"
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 dark:border-slate-700 text-primary focus:ring-primary bg-white dark:bg-slate-900"
              />
              <label
                className="ml-2 block text-xs text-slate-600 dark:text-slate-400"
                htmlFor="remember-me"
              >
                {t.auth.login.rememberMe}
              </label>
            </div>
            <Link
              href="/forgot-password"
              className="text-xs font-semibold text-accent hover:text-accent/80 transition-colors"
            >
              {t.auth.login.forgotPassword}
            </Link>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full flex justify-center py-3 px-4 border border-transparent rounded-lg shadow-sm text-sm font-bold text-white bg-primary hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition-all mt-4 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isSubmitting ? t.auth.login.submitting : t.auth.login.submit}
          </button>
        </form>

    </AuthCard>
  )
}
