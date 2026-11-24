export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="bg-background-light dark:bg-background-dark text-slate-900 dark:text-slate-100 min-h-dvh sm:min-h-screen overflow-x-hidden">
      {children}
    </div>
  )
}
