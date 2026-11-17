import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { TradesQuerySchema } from '@/lib/validators/pnl'
import { fetchRecentTradesPerExchange } from '@/lib/services/pnlService'
import { RECENT_TRADES_PER_EXCHANGE_LIMIT } from '@/lib/config/recentTrades'
import { pnlTimeFields } from '@/lib/time/dayBoundary'

const PNL_ERROR_STATUS = {
  NOT_FOUND: 404,
  UNAUTHORIZED: 401,
} as const

function statusFor(error: string): number {
  if (error === 'NOT_FOUND') return PNL_ERROR_STATUS.NOT_FOUND
  if (error === 'UNAUTHORIZED') return PNL_ERROR_STATUS.UNAUTHORIZED
  return 500
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json(
      { success: false, data: null, error: 'UNAUTHORIZED' },
      { status: 401 }
    )
  }

  const { searchParams } = req.nextUrl
  const parsed = TradesQuerySchema.safeParse({
    cursor: searchParams.get('cursor') ?? undefined,
    limit: searchParams.get('limit') ?? undefined,
    exchangeAccountId: searchParams.get('exchangeAccountId') ?? undefined,
    exchange: searchParams.get('exchange') ?? undefined,
    symbol: searchParams.get('symbol') ?? undefined,
    segment: searchParams.get('segment') ?? undefined,
  })

  if (!parsed.success) {
    return NextResponse.json(
      { success: false, data: null, error: 'VALIDATION_ERROR' },
      { status: 400 }
    )
  }

  const { exchangeAccountId, exchange, symbol, segment } = parsed.data
  const result = await fetchRecentTradesPerExchange(supabase, user.id, {
    exchangeAccountId,
    exchange,
    symbol,
    segment,
    executedOnly: true,
  })

  if (!result.success) {
    return NextResponse.json(
      { success: false, data: null, error: result.error, ...pnlTimeFields() },
      { status: statusFor(result.error) }
    )
  }

  return NextResponse.json({
    success: true,
    data: result.data,
    meta: { perExchangeLimit: RECENT_TRADES_PER_EXCHANGE_LIMIT },
    error: null,
    ...pnlTimeFields(),
  })
}
