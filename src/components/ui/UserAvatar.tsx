const INITIALS_MAX = 2

function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, INITIALS_MAX)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
}

type UserAvatarProps = {
  src: string | null
  name: string
  alt: string
  className?: string
  textClassName?: string
}

export function UserAvatar({
  src,
  name,
  alt,
  className = '',
  textClassName = 'text-sm',
}: UserAvatarProps): React.JSX.Element {
  const initials = initialsOf(name)
  return (
    <div
      className={`rounded-full overflow-hidden bg-primary/20 flex items-center justify-center shrink-0 ${className}`}
    >
      {src ? (
        <img src={src} alt={alt} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
      ) : initials ? (
        <span className={`font-bold text-primary ${textClassName}`} aria-hidden="true">
          {initials}
        </span>
      ) : (
        <span className="material-symbols-outlined text-primary" aria-hidden="true">
          person
        </span>
      )}
    </div>
  )
}
