# Feature: Scan execution

Phase 1. Writes the existing `trades` table. The ledger writer in `spec/features/canonical-trade-data-contract.md` stays off.

## Behavior

`POST /api/exchange/sync` requires a session. The body is `{ "exchangeAccountId": "<uuid>" }`. The account must belong to that user.

The handler claims the account, then returns `202` with `{ "success": true, "data": { "exchangeAccountId", "sync_status": "syncing" }, "error": null }`. The fetch and the database write continue after the response. The client reads progress from `GET /api/exchange/accounts`.

### Claim, cooldown, stale lock

The claim is one conditional update. It sets `sync_status` to `syncing`, `sync_error` to null, and `sync_started_at` to the request instant, only when the row matches `id` and `user_id` and either:

- `sync_status` is not `syncing` and the cooldown has elapsed since `last_synced`, or
- `sync_status` is `syncing` and `sync_started_at` is older than the stale-lock interval.

Zero updated rows returns `409` `SYNC_IN_PROGRESS` when a live claim exists, or `429` `RATE_LIMITED` when the cooldown has not elapsed. Inactive accounts return `400` `ACCOUNT_INACTIVE` and are not claimed.

`SCAN_COOLDOWN_MS` and `SCAN_STALE_AFTER_MS` are named constants in one module. The exchange guides do not give these durations. This spec does not pick the numbers.

`last_synced` advances only after a full success. A failed scan sets `sync_status` to `error` and leaves `last_synced` unchanged.

### Staging migration proposal

Not a file under `supabase/migrations/`. Do not run it on production.

```sql
ALTER TABLE public.exchange_accounts
  ADD COLUMN IF NOT EXISTS sync_started_at TIMESTAMPTZ;
```

`database/schema.sql` does not have this column. Applying the statement is a later staging decision.

### Windows

The first scan, and any scan whose `last_synced` is null, starts one year before the request instant, shortened when the guide gives a smaller maximum. The next scan starts at `last_synced` minus 2 hours. Pages use the guide's page size. `windowDays` is UNVERIFIED wherever the guide does not state a chunk length. The implementation must not invent a chunk length for those rows; it pages inside the start and end the guide allows.

| Exchange | maxLookbackDays | windowDays | pageSize | Guide source |
|---|---|---|---|---|
| Binance spot `GET /api/v3/myTrades` | UNVERIFIED: confirm in official docs. The guide says history beyond 3 to 6 months needs chunking or a CSV. It does not give one maximum | UNVERIFIED: confirm in official docs | 1000 | Binance guide, max `limit` 1000 |
| Binance USDⓈ-M `GET /fapi/v1/userTrades` and `GET /fapi/v1/income` | UNVERIFIED: confirm in official docs. Same 3-to-6-month sentence | UNVERIFIED: confirm in official docs | 1000 | Binance guide, max `limit` 1000 |
| OKX `GET /api/v5/trade/fills-history` | 90, because the guide says "Last 3 months" and does not give a day count | UNVERIFIED: confirm in official docs | UNVERIFIED: confirm in official docs. The fills-history row does not state `limit` | OKX guide |
| Bybit `GET /v5/execution/list` | UNVERIFIED: confirm in official docs. The guide says queries are bounded and does not give a day count | UNVERIFIED: confirm in official docs | 100 | Bybit guide, `limit=100` |
| Bitget `GET /api/v2/spot/trade/fills` and `GET /api/v2/mix/order/fills` | UNVERIFIED: confirm in official docs. The guide does not state a lookback | UNVERIFIED: confirm in official docs | 500 | Bitget guide, max `limit` 500 |
| Gate.io `GET /api/v4/spot/my_trades` and `GET /api/v4/futures/{settle}/my_trades` | UNVERIFIED: confirm in official docs. The guide does not state a lookback | UNVERIFIED: confirm in official docs | 1000 | Gate.io guide, max `limit` 1000 |

When `maxLookbackDays` is UNVERIFIED, the scan still requests one year and sets warning `LOOKBACK_UNVERIFIED`. It does not shorten the year from the 3-to-6-month example.

When `last_synced` is older than a known maximum, the response warning is `COVERAGE_GAP` and the fetch start is the maximum, not `last_synced` minus 2 hours. Rows the exchange can no longer return are not invented.

### Rows

A malformed row is skipped, counted, and listed as a count on the account. `sync_error` for a finished scan with skips is `ROWS_SKIPPED:<count>`. `sync_status` stays `synced` when the rest of the scan completed.

The scan fails, `sync_status` becomes `error`, and `last_synced` does not move when a whole page is rejected or the same parse failure covers every row in a window. That is the systematic case. A mixed page is not systematic.

Writes go to `trades` through the existing insert-if-absent conflict on `(exchange_account_id, external_trade_id)`. This scan does not insert `exchange_records`.

### Errors

| Code | HTTP | When |
|---|---|---|
| `SYNC_IN_PROGRESS` | 409 | Live claim |
| `RATE_LIMITED` | 429 | Cooldown or app limit |
| `ACCOUNT_INACTIVE` | 400 | Inactive account |
| `NOT_FOUND` | 404 | Account is not the caller's |
| `EXCHANGE_ERROR` | recorded on the account after the 202 | The background fetch failed |
| `ROWS_SKIPPED:<count>` | stored on `sync_error` after success with skips | Non-systematic rejects |
| `COVERAGE_GAP` | warning stored with the result | `last_synced` is older than a known maximum |
| `LOOKBACK_UNVERIFIED` | warning stored with the result | The guide has no maximum |

Background failures are not a second HTTP response. They are visible on the account row. Logs omit secrets, the same way `spec/features/exchange-key-validation.md` requires.

## Acceptance Criteria

```powershell
rg -n "202" src/app/api/exchange/sync/route.ts
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
rg -n "sync_started_at" src/lib/db/exchangeDb.ts
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
rg -n "SCAN_COOLDOWN_MS" src/lib/services/exchangeService.ts
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
rg -n "ROWS_SKIPPED" src/lib/services/exchangeService.ts
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
rg -n "COVERAGE_GAP" src/lib/services/exchangeService.ts
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
rg -n "exchange_records" src/lib/services/exchangeService.ts
if ($LASTEXITCODE -eq 0) { exit 1 }
if ($LASTEXITCODE -ne 1) { exit $LASTEXITCODE }
exit 0
```
