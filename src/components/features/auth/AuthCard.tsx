import { AppLogo } from '@/components/ui/AppLogo'
import { APP_NAME } from '@/lib/exchangeBranding'

type AuthCardProps = {
  title: string
  subtitle?: string
  children: React.ReactNode
  footer?: React.ReactNode
  maxWidthClass?: string
}

export function AuthCard({
  title,
  subtitle,
  children,
  footer,
  maxWidthClass = 'max-w-md',
}: AuthCardProps): React.JSX.Element {
  return (
    <div className={`relative w-full ${maxWidthClass} p-4 sm:p-6`}>
      <div className="pointer-events-none absolute -top-24 -left-24 w-64 h-64 bg-primary/20 rounded-full blur-[100px]" />
      <div className="pointer-events-none absolute -bottom-24 -right-24 w-64 h-64 bg-primary/10 rounded-full blur-[100px]" />

      <div className="relative bg-slate-50 dark:bg-panel-dark border border-slate-200 dark:border-neutral-border shadow-2xl rounded-xl p-6 sm:p-8">
        <div className="flex flex-col items-center text-center mb-8">
          <AppLogo size={56} className="mb-3" />
          <span className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">
            {APP_NAME}
          </span>
          <h1 className="mt-5 text-2xl font-bold tracking-tight text-slate-900 dark:text-white text-balance">
            {title}
          </h1>
          {subtitle ? (
            <p className="text-slate-500 dark:text-slate-400 text-sm mt-1.5 text-pretty">{subtitle}</p>
          ) : null}
        </div>
        {children}
        {footer ? (
          <div className="mt-8 text-center text-xs text-slate-500 dark:text-slate-400">{footer}</div>
        ) : null}
      </div>
    </div>
  )
}
