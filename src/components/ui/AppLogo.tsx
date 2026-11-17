import Image from 'next/image'
import { APP_LOGO_PATH, APP_NAME } from '@/lib/exchangeBranding'

type AppLogoProps = {
  size?: number
  className?: string
}

export function AppLogo({ size = 32, className = '' }: AppLogoProps): React.JSX.Element {
  return (
    <Image
      src={APP_LOGO_PATH}
      alt={APP_NAME}
      width={size}
      height={size}
      priority
      className={`shrink-0 rounded-lg object-contain ${className}`}
    />
  )
}
