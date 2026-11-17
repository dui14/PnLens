import { Suspense } from 'react'
import { ResetPasswordForm } from '@/components/features/auth/ResetPasswordForm'

export default function ResetPasswordPage(): React.JSX.Element {
  return (
    <div className="bg-background-light dark:bg-background-dark text-slate-900 dark:text-slate-100 min-h-dvh sm:min-h-screen overflow-x-hidden">
      <div className="flex items-center justify-center min-h-dvh px-4 py-6 sm:min-h-screen">
        <Suspense fallback={null}>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </div>
  )
}
