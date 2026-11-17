import type { Exchange } from '@/lib/types'

export type ExchangeBrand = {
  name: string
  logo: string
}

export const EXCHANGE_BRANDING: Record<Exchange, ExchangeBrand> = {
  binance: { name: 'Binance', logo: '/assets/Binance_Logo.webp' },
  okx: { name: 'OKX', logo: '/assets/OKX_Logo.webp' },
  bybit: { name: 'Bybit', logo: '/assets/Bybit_Logo.webp' },
  bitget: { name: 'Bitget', logo: '/assets/Bigtet_Logo.webp' },
  gateio: { name: 'Gate.io', logo: '/assets/Gate_Logo.webp' },
}

export const APP_NAME = 'PnLens'
export const APP_LOGO_PATH = '/assets/Pnlens_Mark.png'

export function getExchangeBrand(exchange: string): ExchangeBrand | null {
  return exchange in EXCHANGE_BRANDING ? EXCHANGE_BRANDING[exchange as Exchange] : null
}
