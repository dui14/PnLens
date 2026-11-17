'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { createSupabaseBrowserClient } from '@/lib/db/supabase-browser'
import { useT } from '@/lib/i18n/client'
import { AutofillSafeInput } from '@/components/ui/AutofillSafeInput'
import { AuthCard } from '@/components/features/auth/AuthCard'
import { buildPasswordSchema } from '@/lib/validators/auth'
import { fillTemplate } from '@/lib/i18n/format'
import type { Dictionary } from '@/lib/i18n'

function buildRegisterSchema(t: Dictionary) {
  return z
    .object({
      displayName: z.string().min(2, t.auth.validation.displayNameMin),
      email: z.string().email(t.auth.validation.email),
      password: buildPasswordSchema(t.auth.validation.passwordMin),
      confirmPassword: z.string(),
      terms: z.boolean().refine((val) => val === true, t.auth.validation.termsRequired),
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: t.auth.validation.passwordMismatch,
      path: ['confirmPassword'],
    })
}

type RegisterFormValues = z.infer<ReturnType<typeof buildRegisterSchema>>

function getPasswordStrength(
  password: string,
  labels: readonly string[]
): { level: number; label: string } {
  if (!password) return { level: 0, label: '' }
  let score = 0
  if (password.length >= 8) score++
  if (/[A-Z]/.test(password)) score++
  if (/[0-9]/.test(password)) score++
  if (/[^A-Za-z0-9]/.test(password)) score++
  return { level: score, label: labels[score] ?? '' }
}

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


export function RegisterForm(): React.JSX.Element {
  const { t } = useT()
  const router = useRouter()
  const registerSchema = useMemo(() => buildRegisterSchema(t), [t])
  const [showPassword, setShowPassword] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [googleLoading, setGoogleLoading] = useState(false)

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
  })

  const watchPassword = watch('password', '')
  const strength = getPasswordStrength(watchPassword, t.auth.register.strengthLabels)

  const handleGoogleSignUp = async (): Promise<void> => {
    setGoogleLoading(true)
    setAuthError(null)
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

  const onSubmit = async (data: RegisterFormValues): Promise<void> => {
    setAuthError(null)
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.auth.signUp({
      email: data.email.trim().toLowerCase(),
      password: data.password,
      options: {
        data: { display_name: data.displayName },
        emailRedirectTo: `${window.location.origin}/api/auth/callback?next=/dashboard`,
      },
    })
    if (error) {
      setAuthError(error.message)
      return
    }
    router.push('/login?message=check_email')
  }

  return (
    <div className="bg-background-light dark:bg-background-dark text-slate-900 dark:text-slate-100 min-h-dvh sm:min-h-screen flex items-center justify-center px-4 py-6">
      <AuthCard
        title={t.auth.register.title}
        subtitle={t.auth.register.subtitle}
        maxWidthClass="max-w-xl"
        footer={fillTemplate(t.auth.register.copyright, { year: new Date().getFullYear() })}
      >
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5" autoComplete="off">
          {authError && (
            <div className="rounded-lg bg-rose-500/10 border border-rose-500/20 px-4 py-3 text-sm text-rose-400">
              {authError}
            </div>
          )}
          <div className="flex flex-col gap-2">
            <label className="text-slate-700 dark:text-slate-200 text-sm font-semibold leading-normal">
              {t.auth.displayName}
            </label>
            <div className="relative">
              <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-xl">
                person
              </span>
              <AutofillSafeInput
                {...register('displayName')}
                type="text"
                placeholder={t.auth.register.displayNamePlaceholder}
                autoComplete="off"
                className="flex w-full rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/50 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 h-12 placeholder:text-slate-400 pl-12 pr-4 text-base font-normal transition-all"
              />
            </div>
            {errors.displayName && (
              <p className="text-xs text-rose-500">{errors.displayName.message}</p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-slate-700 dark:text-slate-200 text-sm font-semibold leading-normal">
              {t.auth.emailAddress}
            </label>
            <div className="relative">
              <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-xl">
                mail
              </span>
              <AutofillSafeInput
                {...register('email')}
                type="email"
                placeholder={t.auth.register.emailPlaceholder}
                autoComplete="off"
                className="flex w-full rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/50 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 h-12 placeholder:text-slate-400 pl-12 pr-4 text-base font-normal transition-all"
              />
            </div>
            {errors.email && <p className="text-xs text-rose-500">{errors.email.message}</p>}
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-slate-700 dark:text-slate-200 text-sm font-semibold leading-normal">
              {t.auth.password}
            </label>
            <div className="flex w-full items-stretch rounded-lg">
              <div className="relative flex-1">
                <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-xl">
                  lock
                </span>
                <AutofillSafeInput
                  {...register('password')}
                  type={showPassword ? 'text' : 'password'}
                  placeholder={t.auth.register.passwordPlaceholder}
                  autoComplete="new-password"
                  className="flex w-full rounded-lg rounded-r-none border-r-0 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/50 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 h-12 placeholder:text-slate-400 pl-12 pr-4 text-base font-normal transition-all"
                />
              </div>
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="text-slate-400 flex border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 items-center justify-center px-4 rounded-r-lg border-l-0 hover:text-primary transition-colors"
              >
                <span className="material-symbols-outlined">
                  {showPassword ? 'visibility_off' : 'visibility'}
                </span>
              </button>
            </div>
            {watchPassword && (
              <div className="mt-2 space-y-2">
                <div className="flex gap-1 h-1.5 w-full">
                  {[1, 2, 3, 4].map((level) => (
                    <div
                      key={level}
                      className={`flex-1 rounded-full ${
                        level <= strength.level
                          ? 'bg-primary'
                          : 'bg-slate-200 dark:bg-slate-800'
                      }`}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary text-sm">check_circle</span>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {t.auth.register.strengthPrefix}{' '}
                    <span className="text-primary font-bold">{strength.label}</span>
                  </p>
                </div>
              </div>
            )}
            {errors.password && (
              <p className="text-xs text-rose-500">{errors.password.message}</p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-slate-700 dark:text-slate-200 text-sm font-semibold leading-normal">
              {t.auth.register.confirmPassword}
            </label>
            <div className="relative">
              <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-xl">
                shield
              </span>
              <AutofillSafeInput
                {...register('confirmPassword')}
                type="password"
                placeholder={t.auth.register.confirmPlaceholder}
                autoComplete="new-password"
                className="flex w-full rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/50 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 h-12 placeholder:text-slate-400 pl-12 pr-4 text-base font-normal transition-all"
              />
            </div>
            {errors.confirmPassword && (
              <p className="text-xs text-rose-500">{errors.confirmPassword.message}</p>
            )}
          </div>

          <div className="flex items-start gap-3 py-2">
            <input
              {...register('terms')}
              id="terms"
              type="checkbox"
              className="mt-1 h-5 w-5 rounded border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-primary focus:ring-primary/50"
            />
            <label
              className="text-sm text-slate-500 dark:text-slate-400 leading-snug"
              htmlFor="terms"
            >
              {t.auth.register.agreePrefix}{' '}
              <Link href="/terms" className="text-primary hover:underline">
                {t.auth.register.terms}
              </Link>{' '}
              {t.auth.register.and}{' '}
              <Link href="/privacy" className="text-primary hover:underline">
                {t.auth.register.privacy}
              </Link>
            </label>
          </div>
          {errors.terms && <p className="text-xs text-rose-500">{errors.terms.message}</p>}

          <button
            type="submit"
            disabled={isSubmitting}
            className="flex w-full cursor-pointer items-center justify-center overflow-hidden rounded-xl h-12 bg-primary text-white gap-2 text-base font-bold leading-normal tracking-wide hover:brightness-110 active:scale-[0.98] transition-all shadow-lg shadow-primary/20 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isSubmitting ? t.auth.register.submitting : t.auth.register.submit}
          </button>

          <div className="relative flex items-center py-4">
            <div className="flex-grow border-t border-slate-200 dark:border-slate-800" />
            <span className="flex-shrink mx-4 text-slate-400 text-sm">{t.auth.register.orRegisterWith}</span>
            <div className="flex-grow border-t border-slate-200 dark:border-slate-800" />
          </div>

          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={handleGoogleSignUp}
              disabled={googleLoading}
              className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 dark:border-slate-800 h-12 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <GoogleIcon />
              <span className="text-sm font-semibold">{googleLoading ? t.auth.register.googleLoading : t.auth.continueWithGoogle}</span>
            </button>
          </div>

          <p className="text-center text-slate-500 dark:text-slate-400 text-sm mt-4">
            {t.auth.register.haveAccount}{' '}
            <Link href="/login" className="text-primary font-bold hover:underline ml-1">
              {t.auth.register.logIn}
            </Link>
          </p>
        </form>

      </AuthCard>
    </div>
  )
}
