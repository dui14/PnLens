import Link from 'next/link'
import { AppLogo } from '@/components/ui/AppLogo'
import { APP_NAME } from '@/lib/exchangeBranding'
import { LANDING_PATHS, type LandingCopy } from '@/lib/content/landing'

type LandingHeaderProps = {
  copy: LandingCopy['nav']
  signedIn: boolean
}

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:focus-visible:ring-accent'

export function LandingHeader({ copy, signedIn }: LandingHeaderProps): React.JSX.Element {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-background-light/90 backdrop-blur dark:border-neutral-border dark:bg-background-dark/90">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link
          href="/"
          aria-label={copy.homeLabel}
          className={`flex items-center gap-3 rounded-lg ${FOCUS_RING}`}
        >
          <AppLogo size={32} />
          <span className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">{APP_NAME}</span>
        </Link>
        <nav aria-label={copy.menuLabel} className="flex items-center gap-1 sm:gap-2">
          <Link
            href={LANDING_PATHS.howItWorks}
            className={`hidden rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 transition-colors hover:text-slate-900 dark:text-slate-300 dark:hover:text-white sm:block ${FOCUS_RING}`}
          >
            {copy.howItWorks}
          </Link>
          {signedIn ? (
            <Link
              href={LANDING_PATHS.dashboard}
              className={`rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-primary/90 ${FOCUS_RING}`}
            >
              {copy.dashboard}
            </Link>
          ) : (
            <>
              <Link
                href={LANDING_PATHS.login}
                className={`rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 transition-colors hover:text-slate-900 dark:text-slate-300 dark:hover:text-white sm:px-4 ${FOCUS_RING}`}
              >
                {copy.signIn}
              </Link>
              <Link
                href={LANDING_PATHS.register}
                className={`rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-primary/90 ${FOCUS_RING}`}
              >
                {copy.getStarted}
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  )
}
