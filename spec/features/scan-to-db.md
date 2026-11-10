# Feature: Scan to database

Status: audit of the current `trades` writer. Branch `next` at `82c9ca106160ff00861a069c0e05aaaba805208f`. Written 2026-11-10. No application code was changed. Production was not queried and no migration was applied.

Phase 1 scan writes the existing `trades` table. The behavior is `spec/features/scan-execution.md`. The ledger in `spec/features/canonical-trade-data-contract.md` stays off until Phase 2, because turning it on stops new rows in `trades` and the dashboard would show nothing new until a projection spec exists. The findings below still describe the code that is running.

## Flow

```
POST /api/exchange/sync
  middleware session gate (/api/exchange)
  → sync route getUser()
  → syncExchangeAccount(user client, userId, exchangeAccountId)
      → getExchangeAccountById (id + user_id)
      → updateSyncStatus(syncing)
      → service-role getApiKey + decrypt
      → adapter.validateCredentials*
      → adapter.fetchTrades(credentials, one year before the scan instant)
      → service-role upsertTrades
      → updateLastSynced(synced) on the user client
```

Adapters: `src/lib/adapters/binanceAdapter.ts`, `okxAdapter.ts`, `bybitAdapter.ts`, `bitgetAdapter.ts`, `gateioAdapter.ts`. Persistence: `src/lib/db/tradesDb.ts`. Account status: `src/lib/db/exchangeDb.ts`.

`ExchangeAdapterTrade` is a JavaScript number for quantity, price, fee, realized PnL, and funding fee (`src/lib/types/index.ts`). `raw_data` keeps the exchange payload.

## 1. Existing functionality

- Five exchanges connect, validate, and fetch spot and futures history. Sync requires a session. The account lookup is `id` plus `user_id`. Inactive accounts return `ACCOUNT_INACTIVE` before any exchange call.
- API secrets are read with the service-role client. `api_keys` RLS is `USING (FALSE)` in both `database/schema.sql` and `supabase/migrations/20261108000000_baseline.sql`.
- Sync passes an explicit lower bound: `getSyncLookbackDate()` moves one year earlier with `setUTCFullYear`. That is the current instant math, not the product day boundary. Day buckets are `spec/features/pnl-day-boundary.md`. Each adapter also has a 365-day default, used only when `since` is omitted.
- OKX, Bybit, Bitget, and Gate.io walk about 7-day windows and follow a cursor or page. Binance futures income walks 7-day chunks and requests another page when a page has 1000 rows. Binance futures user trades walk 7-day windows with one request per window. Binance spot is one `myTrades` request per symbol (`limit=1000`, `startTime` only).
- Futures (and Bitget, Bybit, OKX, Gate.io lists) are deduped in memory on `symbol + external_trade_id`. Binance spot is not.
- `upsertTrades` sends one PostgREST upsert with `onConflict: 'exchange_account_id,external_trade_id'` and `ignoreDuplicates: true`. Empty input returns 0. A missing `funding_fee` or `income_type` column retries without those fields.
- Schema files declare `trades` `UNIQUE (exchange_account_id, external_trade_id)`, `NUMERIC(28,10)` for money and size, nullable `realized_pnl`, `funding_fee` default 0, and `side` / `trade_type` checks. RLS policy `users_own_trades` is `auth.uid() = user_id`.
- Failures before a completed upsert set `sync_status=error` for missing key, decrypt failure, credential failure, a thrown `fetchTrades`, and a thrown upsert.
- P1 Vitest covers adapter HTTP mapping with mocked `fetch` (55 tests at the checkpoint). Those tests lock current behavior, including the timestamp bugs below. There is no `tradesDb` or `syncExchangeAccount` test.

## 2. Missing functionality

- No database test proves the unique constraint, a repeated sync, account isolation, or decimal persistence.
- Production uniqueness is unverified. `ai-context/04-database.md` says the 2026-11-08 introspection had columns and one policy per table, and did not include primary keys, unique constraints, or index definitions. `CREATE TABLE IF NOT EXISTS` in the baseline will not add this unique key to a table that already exists.
- Sync is not incremental. `last_synced` is not a cursor.
- HTTP retry is 429 only, up to four extra attempts, with random jitter. 5xx is not retried (`spec/features/exchange-5xx-retry.md` is still todo). `Retry-After` is ignored.
- Binance spot and futures user trades do not follow `fromId` (`spec/features/binance-trade-pagination.md` is still todo).
- There is no sync lock. A second sync may start while the first is `syncing`.
- Upserts are not chunked. One oversized payload fails the whole write.
- `ignoreDuplicates` does not refresh an existing row. A later fee, PnL, or timestamp correction is dropped.
- No route-level rate limit (`spec/features/api-rate-limit.md` is still todo).
- OKX symbol shape in `spec/features/okx-symbol.md` is still todo. `BTC-USDT-SWAP` becomes `BTCUSDTSWAP`.

## 3. Data integrity risks

- Invalid timestamps are sometimes replaced with the current time, so a repeated sync can store a moving `traded_at`. Bitget position history does this. OKX fills and funding bills do this. Bybit `toIsoTimestamp` does this. Gate.io `toIsoFromGateTimestamp` does this. A non-numeric Bitget fill `cTime` throws `RangeError` from `toISOString` and fails the whole fetch. OKX archive bills throw the same way. Binance `new Date(time).toISOString()` throws when `time` is missing.
- Bitget fill `cTime` is always parsed as milliseconds. `1710000000` becomes a 1970 timestamp. Position-history rows in the same adapter multiply values below `1_000_000_000_000` by 1000. Fills do not.
- In-memory dedupe includes `symbol`. The database unique key does not. Two symbols, or spot and futures, that share an external id collapse to one row. Binance ids are `spot_${id}` and `futures_${id}` without the symbol. Binance trade ids are per symbol. Bitget, Bybit, and Gate.io store the venue id with no stable prefix. The row that survives an in-batch conflict is unspecified.
- Fallback ids use `Date.now()` when the venue id is missing (Bitget futures, Gate.io spot, futures, and position close, Bybit closed-PnL timestamp fallback). The next sync inserts a new id.
- `parseFloat` / `Number` loses digits past the JavaScript safe range before Postgres sees them. `NaN` becomes JSON `null`. `quantity` and `price` are `NOT NULL`, so one bad number fails the whole upsert.
- Binance spot only queries assets still in the balance, plus a fixed USDT list. A fully sold symbol outside that list is skipped. A symbol with more than 1000 fills since the lookback keeps the oldest page and drops newer fills.
- Binance futures user-trade history runs only when the recent 1000-row call returns nothing. One recent fill suppresses the year walk. Each 7-day window still keeps only 1000 rows.
- A per-symbol or per-window HTTP error often becomes an empty page and the loop continues. `syncExchangeAccount` then marks the account `synced`.
- `updateLastSynced` and `updateSyncStatus` filter by account id only. They rely on the user-scoped client and RLS. Their errors are not checked. A killed process can leave `syncing`. A later failed sync can overwrite a good `synced` status.
- First write wins. A bad timestamp or a partial PnL value stays forever under `ignoreDuplicates`.

## 4. Duplicate trade scenarios

| Case | What happens |
|---|---|
| Same account, same external id, sync again | Skipped when the unique constraint exists. `new_trades` counts returned ids after `ignore-duplicates`. |
| Same batch, same external id, different symbol | Not removed by symbol-scoped dedupe. Database conflict drops or rejects one of them. |
| Binance fill plus `REALIZED_PNL` income for the same venue trade | Different ids (`futures_*` vs `futures_income_*`). Income is omitted only when that fill is in the same fetch. A later fetch that finally sees the fill inserts a second PnL row. |
| Binance `COMMISSION` income | Stored as its own row with `realized_pnl` set to the commission amount. |
| OKX fill plus funding bill | Different prefixes. Both can be stored. |
| Gate.io spot id and futures id | Same raw id collides on the account. |
| Missing venue id | New `Date.now()` id on every sync. |
| Two accounts | Allowed. The unique key includes `exchange_account_id`. |
| Constraint absent on the live database | PostgREST upsert errors. The code reports `INTERNAL_ERROR`. It does not fall back to blind insert. |

## 5. Ownership and authorization risks

- The route is under `/api/exchange`, so middleware and `getUser()` both run. `getExchangeAccountById` requires `user_id`.
- Trade writes use the service role and the session user id. RLS does not apply to that write. Nothing in the database requires `trades.user_id = exchange_accounts.user_id`.
- `users_own_trades` checks only `auth.uid() = user_id`. Baseline grants `INSERT` on `trades` to `authenticated`. A signed-in user can insert a row whose `exchange_account_id` belongs to someone else, as long as `user_id` is their own. That row occupies `(exchange_account_id, external_trade_id)`. The owner's later sync then skips the real fill because duplicates are ignored. The owner does not see the attacker's row, because reads filter `user_id`.
- `getApiKey` is service-role and is not filtered by `user_id`. It runs only after the ownership check. A delete between the check and the read can still return a key for an account the user no longer owns.
- Status updates do not add `.eq('user_id', userId)`. Today they use the user client. Passing the service client later would update any account id.

## 6. Database constraints and indexes

Declared in `database/schema.sql` and `supabase/migrations/20261108000000_baseline.sql` for `public.trades`:

- Primary key `id`.
- `UNIQUE (exchange_account_id, external_trade_id)`. Both columns are `NOT NULL`, so NULL-distinct uniqueness does not apply.
- Checks: `side IN ('buy','sell')`, `trade_type IN ('spot','futures','margin')`.
- `quantity`, `price`, `fee` not null. `realized_pnl` nullable. `funding_fee` not null default 0. No check that `user_id` matches the account owner.
- Indexes: `user_id`, `exchange_account_id`, `traded_at DESC`, `symbol`. Baseline also has `(user_id, traded_at DESC)`.
- RLS enabled. One policy, `users_own_trades`, `FOR ALL USING (auth.uid() = user_id)`. No `WITH CHECK` on account ownership.

Not verified on production. Do not treat the migration file as proof of the live constraint. Do not run it against production from this work. Any new migration must be additive. `CREATE TABLE IF NOT EXISTS` must not be reused to "add" a unique key. Existing rows must be preserved, including rows that would violate a tighter key. A new unique constraint needs a duplicate report before it is validated.

## 7. Pagination and lookback

| Venue | Window | Page stop | Gap |
|---|---|---|---|
| Binance spot | One year `startTime`, one call | 1000, no `fromId` | Newest fills dropped. Symbol list is incomplete. |
| Binance futures trades | Recent 1000, else 7-day windows | One call per window, no `fromId` | History skipped when any recent fill exists. Full windows truncated. |
| Binance futures income | 7-day chunks, page by max `time` | Next page when length is 1000 | Same-millisecond overflow moves to `time+1` and drops the rest. Failed pages are skipped. |
| OKX fills, funding, bills | 7 days, cursor walks oldest `ts` | 100 rows, 50 pages | Error or bad code breaks the window. `BTC-USDT-SWAP` symbol keeps the contract suffix. |
| Bybit execution and closed PnL | 7 days, `nextPageCursor` | 100 rows, 50 pages | Non-zero `retCode` or HTTP error ends the window. |
| Bitget spot and futures | 7 days, `idLessThan` | 100 rows, 30 pages | HTTP failure of the all-symbol spot path falls back to six hardcoded symbols. |
| Gate.io spot | `from`/`to` in seconds, `page` | 1000 rows, 100 pages | Direct `fetch`, not `fetchExchange`, so the stored proxy is not applied. |
| Gate.io futures and position close | Same windows | 100 rows | Short page ends the window. |

Sync always re-reads the whole year. Adapter page caps are hard stops, not "done" signals.

## 8. Retry and partial failure

- Timeout is 10 seconds. An abort throws. Spot Binance, and any uncaught adapter error, becomes `EXCHANGE_ERROR` and `sync_status=error`. That part is safe.
- 429 retries. 500, 502, 503, and Binance 418 do not. Backoff does not read `Retry-After`. Jitter is random.
- Binance invalid-symbol `-1121` and futures `-4061` return an empty list for that symbol. Other non-OK responses are logged and skipped. Income does the same. The sync is still `synced`.
- OKX, Bybit, Bitget, and Gate.io `break` out of the current window on HTTP or API error, then continue later windows or other markets. The caller cannot tell a short history from a failed page.
- The upsert is one statement, so a database error rolls that statement back. Rows already stored by an earlier successful sync stay. There is no outbox and no watermark, so a failed year sync does not resume at the failed window. The next attempt downloads the year again.
- `synced_trades` is the adapter array length, not the number of rows written. `new_trades` is the select length after ignore-duplicates. A swallowed exchange failure with `[]` is success with zeros.
- `INVALID_API_KEY` is not in the route `statusMap`, so it is returned as HTTP 500.

## Financial data, reported only

`pnlEngine` is out of scope. These storage choices change what that engine will sum later, because it sums `realized_pnl` and ignores `fee` and `funding_fee`.

- Fee on the fill is stored in `fee`. Binance `COMMISSION` income is also stored as `realized_pnl`. Both can exist.
- Funding is stored on `funding_fee` and, for Binance income and OKX funding bills, also as `realized_pnl`.
- Income and position-close rows use `quantity=0` and `price=0`. They still carry `realized_pnl`.
- A fill and a separate income row for the same economic close can both survive, as described above.
- JavaScript numbers are what get written. Exact exchange decimal strings live only in `raw_data` when the adapter kept the payload.
- Side for income is the sign of the amount, not the order side. The check constraint only allows `buy` and `sell`.

## P1 tests that lock the current bugs

Changing the behavior below requires updating these characterization tests in the same change:

- `src/tests/integration/bitgetAdapter.test.ts` expects second `cTime` to stay in 1970 and a non-numeric `cTime` to reject the fetch.
- `src/tests/integration/okxAdapter.test.ts`, `bybitAdapter.test.ts`, and `gateioAdapter.test.ts` expect an invalid timestamp to become the current time.
- `src/tests/integration/binanceAdapter.test.ts` covers futures id dedupe and one extra income page. It does not cover spot id collisions or `fromId`.

## Implementation bounds

Phase 1 is `spec/features/scan-execution.md`. It writes the existing `trades` table. It does not start the ledger writer.

Phase 2 is `spec/features/canonical-trade-data-contract.md`. That writer stays off until a projection spec exists. Production migrations stay out of scope.

## Acceptance criteria

Phase 1 acceptance is the command block in `spec/features/scan-execution.md`. Phase 2 acceptance stays in the canonical contract. Neither block was run for this documentation change.
