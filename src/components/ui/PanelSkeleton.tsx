export function PanelSkeleton({ heightClassName }: { heightClassName: string }): React.JSX.Element {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-xl border border-slate-200 dark:border-primary/20 bg-slate-100/60 dark:bg-primary/5 ${heightClassName}`}
    />
  )
}
