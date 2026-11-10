import type {
  ExchangeAdapterTrade,
  ExchangeCredentials,
  AssetBalance,
  UnrealizedPosition,
} from '@/lib/types'
import type { CredentialProbeResult } from './credentialValidation'
import type { TradeRejectCounts } from './tradeFields'

export interface ExchangeAdapter {
  validateCredentials(credentials: ExchangeCredentials): Promise<CredentialProbeResult>
  hasWithdrawPermission(credentials: ExchangeCredentials): Promise<boolean>
  rejectedTradeCounts(): TradeRejectCounts
  fetchTrades(
    credentials: ExchangeCredentials,
    since?: Date
  ): Promise<ExchangeAdapterTrade[]>
  fetchOpenPositions(
    credentials: ExchangeCredentials
  ): Promise<UnrealizedPosition[]>
  fetchBalances(
    credentials: ExchangeCredentials
  ): Promise<AssetBalance[]>
}

export async function createExchangeAdapter(exchange: string): Promise<ExchangeAdapter> {
  switch (exchange) {
    case 'binance': {
      const { BinanceAdapter } = await import('./binanceAdapter')
      return new BinanceAdapter()
    }
    case 'okx': {
      const { OKXAdapter } = await import('./okxAdapter')
      return new OKXAdapter()
    }
    case 'bybit': {
      const { BybitAdapter } = await import('./bybitAdapter')
      return new BybitAdapter()
    }
    case 'bitget': {
      const { BitgetAdapter } = await import('./bitgetAdapter')
      return new BitgetAdapter()
    }
    case 'gateio': {
      const { GateioAdapter } = await import('./gateioAdapter')
      return new GateioAdapter()
    }
    default:
      throw new Error(`Unsupported exchange: ${exchange}`)
  }
}
