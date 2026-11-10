import { after, NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { claimExchangeScan, type ScanClaimResult } from '@/lib/db/exchangeDb'
import { SCAN_COOLDOWN_MS, SCAN_STALE_AFTER_MS } from '@/lib/scan/scanLimits'
import { runScan } from '@/lib/scan/runScan'
import { SyncExchangeSchema } from '@/lib/validators/exchange'

const CLAIM_STATUS: Record<Exclude<ScanClaimResult, 'claimed'>, { status: number; error: string }> = {
  not_found: { status: 404, error: 'NOT_FOUND' },
  inactive: { status: 400, error: 'ACCOUNT_INACTIVE' },
  in_progress: { status: 409, error: 'SYNC_IN_PROGRESS' },
  rate_limited: { status: 429, error: 'RATE_LIMITED' },
}

export async function POST(req: NextRequest): Promise<NextResponse> {
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

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { success: false, data: null, error: 'VALIDATION_ERROR' },
      { status: 400 }
    )
  }

  const parsed = SyncExchangeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, data: null, error: 'VALIDATION_ERROR' },
      { status: 400 }
    )
  }

  const now = new Date()
  const claim = await claimExchangeScan(
    supabase,
    parsed.data.exchangeAccountId,
    user.id,
    now.toISOString(),
    new Date(now.getTime() - SCAN_COOLDOWN_MS).toISOString(),
    new Date(now.getTime() - SCAN_STALE_AFTER_MS).toISOString()
  )

  if (claim !== 'claimed') {
    const mapped = CLAIM_STATUS[claim]
    return NextResponse.json(
      { success: false, data: null, error: mapped.error },
      { status: mapped.status }
    )
  }

  const exchangeAccountId = parsed.data.exchangeAccountId
  after(() => {
    void runScan(exchangeAccountId).catch(() => {
      console.error('[exchange/sync] background scan failed:', 'EXCHANGE_ERROR')
    })
  })

  return NextResponse.json(
    { success: true, data: { exchangeAccountId, sync_status: 'syncing' }, error: null },
    { status: 202 }
  )
}
