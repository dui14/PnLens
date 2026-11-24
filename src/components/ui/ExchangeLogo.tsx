import Image from 'next/image'
import { getExchangeBrand } from '@/lib/exchangeBranding'

type ExchangeLogoProps = {
  exchange: string
  size?: number
  className?: string
}

export function ExchangeLogo({ exchange, size = 24, className = '' }: ExchangeLogoProps): React.JSX.Element {
  const brand = getExchangeBrand(exchange)
  if (!brand) {
    return (
      <span
        style={{ width: size, height: size }}
        className={`inline-flex shrink-0 items-center justify-center rounded-md bg-slate-500 text-[10px] font-black text-white ${className}`}
      >
        {exchange.slice(0, 2).toUpperCase()}
      </span>
    )
  }
  return (
    <Image
      src={brand.logo}
      alt={brand.name}
      width={size}
      height={size}
      className={`shrink-0 rounded-md object-cover ${className}`}
    />
  )
}
