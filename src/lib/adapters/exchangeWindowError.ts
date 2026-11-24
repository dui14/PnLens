export class ExchangeWindowError extends Error {
  readonly code = 'EXCHANGE_ERROR' as const

  constructor() {
    super('EXCHANGE_ERROR')
    this.name = 'ExchangeWindowError'
  }
}

export function throwOnServerPage(response: Response): void {
  if (response.status >= 500) throw new ExchangeWindowError()
}
