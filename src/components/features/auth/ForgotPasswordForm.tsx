'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { createSupabaseBrowserClient } from '@/lib/db/supabase-browser'
import { getClientAppOrigin } from '@/lib/auth-origin'
import { useT } from '@/lib/i18n/client'
import { buildForgotPasswordSchema } from '@/lib/validators/auth'
import { AutofillSafeInput } from '@/components/ui/AutofillSafeInput'
import { AuthCard } from '@/components/features/auth/AuthCard'

type ForgotPasswordValues = { email: string }

const RESET_REDIRECT_PATH = '/api/auth/callback?next=/reset-password'

export function ForgotPasswordForm(): React.JSX.Element {
  const { t } = useT()
  const schema = useMemo(() => buildForgotPasswordSchema(t.auth.validation.email), [t])
  const [sent, setSent] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordValues>({ resolver: zodResolver(schema) })

  const onSubmit = async (data: ForgotPasswordValues): Promise<void> => {
    setSendError(null)
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.auth.resetPasswordForEmail(
      data.email.trim().toLowerCase(),
      { redirectTo: `${getClientAppOrigin()}${RESET_REDIRECT_PATH}` }
    )
    if (error && (error.status === undefined || error.status >= 500 || error.status === 429)) {
      setSendError(t.auth.forgot.sendError)
      return
    }
    setSent(true)
  }

  const backLink = (
    <Link href="/login" className="font-bold text-primary dark:text-accent hover:underline">
      {t.auth.forgot.backToLogin}
    </Link>
  )

  if (sent) {
    return (
      <AuthCard title={t.auth.forgot.sentTitle} footer={backLink}>
        <div
          role="status"
          className="rounded-lg bg-primary/10 border border-primary/30 px-4 py-3 text-sm text-slate-700 dark:text-slate-200 text-pretty"
        >
          {t.auth.forgot.sentBody}
        </div>
      </AuthCard>
    )
  }

  return (
    <AuthCard title={t.auth.forgot.title} subtitle={t.auth.forgot.subtitle} footer={backLink}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {sendError && (
          <div role="alert" className="rounded-lg bg-rose-500/10 border border-rose-500/20 px-4 py-3 text-sm text-rose-400">
            {sendError}
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
              autoComplete="email"
              className="block w-full pl-10 pr-3 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-1 focus:ring-primary focus:border-primary transition-all placeholder:text-slate-400 dark:placeholder:text-slate-600"
            />
          </div>
          {errors.email && <p className="text-xs text-rose-500 mt-1">{errors.email.message}</p>}
        </div>
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full flex justify-center py-3 px-4 rounded-lg shadow-sm text-sm font-bold text-white bg-primary hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition-all disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isSubmitting ? t.auth.forgot.submitting : t.auth.forgot.submit}
        </button>
      </form>
    </AuthCard>
  )
}
