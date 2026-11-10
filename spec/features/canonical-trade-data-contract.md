# Canonical trade data contract

Status: finalized design, P2.0. 2026-11-10. Option B is approved for Phase 2. Not implemented. No application code, schema, or migration was changed. Production was not queried and no database write was run. `pnlEngine` stays unchanged.

## Phase gating

The ledger writer in this document stays off in Phase 1.

Phase 1 goal: the user adds an exchange key, the backend validates it with a live read-only probe and a permission check before anything is stored, the user presses Scan, and the last year of trades (or the exchange's shorter maximum) is written to the existing `trades` table. The dashboard and the AI read only from that database. Scan behavior is `spec/features/scan-execution.md`. Key validation is `spec/features/exchange-key-validation.md`.

Reason: once this ledger writer is on, `trades` stops receiving events and the dashboard shows nothing new until a projection spec exists. That projection is not written.

Everything after this section is Phase 2. It does not change the Phase 1 writer.

Normative Phase 2 sections replace the earlier proposal, including `NUMERIC(38,18)` and persisting Bybit closed PnL as its own financial row. `spec/features/scan-to-db.md` remains the audit of the current `trades` writer.

## Approved decisions

1. Append-only `exchange_records` is the ledger.
2. Legacy `trades` is not altered.
3. `pnlEngine` is not altered.
4. Ledger rows are not copied into `trades`.
5. The same economic event is not written to both tables.
6. Unrecognized venue types stay `unknown`.
7. Immutable source events are insert-if-absent.
8. Bybit order-level `closedPnl` is not copied onto executions and is not stored as its own financial event.
9. Decimal text is stored without rounding or truncation.
10. `raw_payload` is the venue object only, with secret-bearing keys removed.
11. `exchange_sync_cursors` is a separate table. It is part of the first staging migration because incremental scan has nowhere else to record progress.
12. No production access and no production migration.

Consequence of 4 and 5: once the ledger writer is turned on, sync stops inserting those events into `trades`. Existing `trades` rows stay. Dashboard PnL does not see new events until a later financial specification projects a reviewed subset. That projection is not part of this design.

## Capability matrix

`Ledger` is the approved write. `Current trades writer` is what the code does today and must not be copied forward.

| Namespace | Market | Endpoint in code | Ledger row | Current trades writer |
|---|---|---|---|---|
| `binance:spot:myTrades` | spot | `GET /api/v3/myTrades` | `fill`. Fee from `commission`, sign kept | Fill. `realized_pnl` null |
| `binance:futures-usdm:userTrades` | futures | `GET /fapi/v1/userTrades` | `fill`. Fee from `commission`. `realizedPnl` on `cashflow_amount` when the string is present | Fill plus `realizedPnl` |
| `binance:futures-usdm:income` | futures | `GET /fapi/v1/income` | `FUNDING_FEE` only, category `funding`. `REALIZED_PNL` and `COMMISSION` are not inserted. Any other type is `unknown` and is not given a realized-pnl meaning | All three requested types become rows whose `realized_pnl` is the income amount |
| `okx:spot:fills-history` | spot | `GET /api/v5/trade/fills-history` `instType=SPOT` | `fill`. `symbol_raw` keeps hyphens | Hyphens stripped. Fee passed through `Math.abs` |
| `okx:swap:fills-history` | futures | same path, `instType=SWAP` | `fill`. Quantity stays the venue `fillSz` string. Contract scaling is not applied in the ledger | Quantity may be multiplied by `ctVal` |
| `okx:futures:fills-history` | futures | same path, `instType=FUTURES` | `fill`, same rule | Same scaling |
| `okx:account:bills-archive` | null | `GET /api/v5/account/bills-archive` | Type `8` is `funding`. Types `2` and `14`, and any other type, are `unknown`. `pnl` and `fee` are not added together | Funding path stores `pnl + fee` as `realized_pnl`. Fallback keeps types `2`, `8`, `14` only when fills and funding are both empty |
| `bybit:spot:execution` | spot | `GET /v5/execution/list` `category=spot` | `fill`. `closedPnl` is ignored even if present on the object | `closedPnl` parsed onto the fill when non-empty |
| `bybit:linear:execution` | futures | same path, `category=linear` | `fill`. `closedPnl` ignored | Closed-pnl value copied onto every matched fill that lacks PnL |
| `bybit:inverse:execution` | futures | same path, `category=inverse` | `fill`. `closedPnl` ignored | Same copy |
| `bybit:linear:closed-pnl` and `bybit:inverse:closed-pnl` | futures | `GET /v5/position/closed-pnl` | No row | Synthetic rows and per-fill copies |
| `bitget:spot:fills` | spot | `GET /api/v2/spot/trade/fills` | `fill` | Fill. Fallback symbol list is a coverage bug, not a second namespace |
| `bitget:futures-usdt:fill-history` | futures | `GET /api/v2/mix/order/fill-history` `productType=USDT-FUTURES` | `fill`. Fee sign kept | Absolute fee |
| `bitget:futures-coin:fill-history` | futures | `productType=COIN-FUTURES` | `fill` | Absolute fee |
| `bitget:futures-usdc:fill-history` | futures | `productType=USDC-FUTURES` | `fill` | Absolute fee |
| `bitget:futures:history-position` | futures | `GET /api/v2/mix/position/history-position` | `position_event` when `positionId` is present. Not a substitute that suppresses fills | Inserted only when no futures fill has `realized_pnl` |
| `gateio:spot:my_trades` | spot | `GET /spot/my_trades` | `fill`. Fee sign kept | Absolute fee |
| `gateio:futures-usdt:my_trades` | futures | `GET /futures/usdt/my_trades` | `fill`. Quantity is the venue size string, not the multiplier product | Size may be multiplied by `quanto_multiplier` |
| `gateio:futures-btc:my_trades` | futures | `GET /futures/btc/my_trades` | `fill` | Same |
| `gateio:futures-usdt:position_close` | futures | `GET /futures/usdt/position_close` | `position_event` | Always written, quantity and price 0 |
| `gateio:futures-btc:position_close` | futures | `GET /futures/btc/position_close` | `position_event` | Same |
| Margin, liquidation, settlement, adjustment | margin or null | No request in the adapters | No row. The category values exist so a later endpoint can use them | `trade_type` allows `margin`. No adapter sets it |

OKX, Bitget, and Gate.io use global `fetch`. Binance and Bybit use `fetchExchange`. A stored proxy reaches only the latter two.

Position-close and history-position rows are a different endpoint from fills. They are stored. Nothing in this phase adds their cashflow to a fill or to `trades`. A future PnL reader must not add them to fill `cashflow_amount` until those sources are shown to be distinct.

## Identity

A row is unique on:

`(exchange_account_id, source_namespace, source_record_id)`

`source_namespace` is the first column of the matrix. It already separates venue, endpoint, and market, including USDT versus coin futures and Gate.io USDT versus BTC settle. Spot, margin, and futures cannot share a namespace.

`source_record_id` is ASCII text:

| Namespace family | `source_record_id` | Reject the row when |
|---|---|---|
| Binance spot and USD-M user trades | `{symbol}:{id}` | `symbol` or `id` is missing. `id` is per symbol |
| Binance income | `{incomeType}:{tranId}:{symbol or "-"}` | `tranId` is missing. `time` is not part of the id |
| OKX fills | `{instId}:{tradeId}` | `instId` or `tradeId` is missing. `ordId` and the timestamp are not ids |
| OKX bills | `{billId}` | `billId` is missing |
| Bybit executions | `{symbol}:{execId}` | `symbol` or `execId` is missing |
| Bitget spot and futures fills | `{symbol}:{tradeId}` | `symbol` or `tradeId` is missing. `orderId` is not a fill id |
| Bitget position history | `{symbol}:{positionId}` | `symbol` or `positionId` is missing |
| Gate.io spot and futures fills | `{currency_pair or contract}:{id}` | the instrument or `id` is missing |
| Gate.io position close | `{contract}:{id}` | `contract` or `id` is missing. `order_id` is not the id |

Category is a column, not part of the key. One source event is one row. The fill's fee stays on that row. A second fee row is not created from the same field.

Ids are not prefixed with the ingest clock. Rows that fail the table above are not inserted. The window that contained them does not advance its cursor.

## Append-only behavior

The unique constraint is the conflict target. The write is `INSERT ... ON CONFLICT DO NOTHING`. There is no `UPDATE` privilege on `exchange_records`.

| Situation | Behavior |
|---|---|
| Same identity inserted again | No change. The first row remains. `new` count does not include it |
| Late row whose identity is new, inside the overlap or the initial year | Insert |
| Venue correction of fee or PnL for an identity already stored | Not applied. The first observation stands |
| Missing or unstable id | No insert. Cursor stays |
| Two different namespaces, same venue id | Two rows. That is required for spot versus futures |
| Bybit `closedPnl` | Not a row and not a column value. It may remain inside `raw_payload` of an execution object if the venue included it |

A correction with the same identity is invisible in this version. No fixture shows a version or amendment id. A later design can add an amendment table. It must not update the original row.

Account removal is the only delete path. A `SECURITY DEFINER` trigger on `exchange_accounts` deletes that account's ledger and cursor rows. Callers do not get `DELETE` on the ledger. There is no per-row correction delete.

## Decimal precision

There is no separate fixture directory. The only samples are the strings built in `src/tests/integration/*Adapter.test.ts`. Adapters then parse those strings with `parseFloat` or `Number`. This repository's exchange guides do not state a venue maximum.

| Sample | Field | Fractional digits | Integer digits |
|---|---|---|---|
| Binance spot fixture | `price` `65000.12345678` | 8 | 5 |
| Binance spot fixture | `qty`, `commission` `0.00000001` | 8 | 1 |
| Binance futures fixture | `price` `2400.50`, `realizedPnl` `-3.25` | 2 | 4 |
| OKX fixture | `fillPx` `65000.1200`, `fillSz` `0.1250`, `fillFee` `-0.30` | 4 | 5 |
| Bybit fixture | `execQty` `0.01000000` | 8 | 1 |
| Bybit fixture | `execPrice` `65000.125` | 3 | 5 |
| Bitget fixture | `priceAvg` `65000.12000000`, `size` `0.01000000` | 8 | 5 |
| Gate.io fixture | `amount` `-0.01500000` | 8 | 1 |
| Gate.io fixture | `price` `65000.2500` | 4 | 5 |

Observed maximum: 8 fractional digits and 5 integer digits. That is the test sample, not a venue limit. `trades` uses `NUMERIC(28,10)`. Assignment to that type rounds past 10 fractional digits. `NUMERIC(38,18)` is not used. Nothing in the fixtures or guides shows 18 fractional digits, and a declared scale would still round the next digit.

Ledger money and size columns are unconstrained `NUMERIC`. PostgreSQL stores the exact decimal it is given, up to its implementation limit. The writer sends the venue string. It does not send a JavaScript number. A string must match `^-?\d+(\.\d+)?$`. Exponent form, blank, and non-digits reject the row. There is no application cap that truncates a longer fraction. `raw_payload` keeps the same strings.

`quantity` and `price`, when present, are greater than or equal to zero. Sign of a venue size is represented as `side`, not as a negative quantity. `fee_amount` and `cashflow_amount` keep their sign. `Math.abs` is not used.

## Schema proposal

```sql
-- Design only. Do not save this as a migration and do not run it.

CREATE UNIQUE INDEX IF NOT EXISTS exchange_accounts_id_user_id_key
  ON public.exchange_accounts (id, user_id);

CREATE TABLE public.exchange_records (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL,
  exchange_account_id UUID NOT NULL,
  source_namespace    TEXT NOT NULL,
  source_record_id    TEXT NOT NULL,
  category            TEXT NOT NULL,
  market              TEXT,
  symbol_raw          TEXT,
  side                TEXT,
  quantity            NUMERIC,
  price               NUMERIC,
  fee_amount          NUMERIC,
  fee_asset           TEXT,
  cashflow_amount     NUMERIC,
  cashflow_asset      TEXT,
  occurred_at         TIMESTAMPTZ NOT NULL,
  raw_payload         JSONB NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT exchange_records_owner_fk
    FOREIGN KEY (exchange_account_id, user_id)
    REFERENCES public.exchange_accounts (id, user_id)
    ON DELETE CASCADE,
  CONSTRAINT exchange_records_identity_key
    UNIQUE (exchange_account_id, source_namespace, source_record_id),
  CONSTRAINT exchange_records_category_check
    CHECK (category IN (
      'fill', 'fee', 'funding', 'realized_pnl', 'liquidation',
      'position_event', 'settlement', 'adjustment', 'unknown'
    )),
  CONSTRAINT exchange_records_market_check
    CHECK (market IS NULL OR market IN ('spot', 'margin', 'futures')),
  CONSTRAINT exchange_records_side_check
    CHECK (side IS NULL OR side IN ('buy', 'sell')),
  CONSTRAINT exchange_records_quantity_check
    CHECK (quantity IS NULL OR quantity >= 0),
  CONSTRAINT exchange_records_price_check
    CHECK (price IS NULL OR price >= 0),
  CONSTRAINT exchange_records_id_check
    CHECK (char_length(source_namespace) > 0 AND char_length(source_record_id) > 0)
);

CREATE TABLE public.exchange_sync_cursors (
  exchange_account_id UUID NOT NULL,
  user_id             UUID NOT NULL,
  source_namespace    TEXT NOT NULL,
  window_end          TIMESTAMPTZ,
  last_success_at     TIMESTAMPTZ,
  last_error          TEXT,
  PRIMARY KEY (exchange_account_id, source_namespace),
  CONSTRAINT exchange_sync_cursors_owner_fk
    FOREIGN KEY (exchange_account_id, user_id)
    REFERENCES public.exchange_accounts (id, user_id)
    ON DELETE CASCADE
);
```

`exchange_sync_cursors` has no money columns. `window_end` is the end of the last window whose rows were committed. Null means the initial scan has not completed a window.

No backfill from `trades`. No trigger copies ledger rows into `trades`.

## Indexes and constraints

- Primary key `exchange_records.id`.
- Unique identity key above. That is the insert-if-absent target. An application conflict option without this constraint is not sufficient.
- Composite foreign key to `exchange_accounts (id, user_id)`, so a row cannot name one person's account and another person's `user_id`.
- Checks for category, market, side, non-negative quantity and price, and non-empty identity text.
- Read index `(user_id, occurred_at DESC)`.
- Read index `(exchange_account_id, source_namespace, occurred_at DESC)`.
- Cursor primary key `(exchange_account_id, source_namespace)`.

`trades` keeps `UNIQUE (exchange_account_id, external_trade_id)` as declared in `database/schema.sql` and the baseline migration. This design does not drop or replace it. Production presence of that constraint was not checked.

## RLS, grants, and raw payload

RLS is enabled on both new tables.

- `exchange_records`: `SELECT` for `authenticated` only where `auth.uid() = user_id` and a visible `exchange_accounts` row exists for that account and user. No insert, update, or delete policy for `authenticated`.
- `exchange_sync_cursors`: same `SELECT` predicate. No write policy for `authenticated`.
- `service_role`: `SELECT` and `INSERT` on `exchange_records`. `SELECT`, `INSERT`, and `UPDATE` on `exchange_sync_cursors`. No `UPDATE` and no `DELETE` on `exchange_records`.
- `anon`: no privileges.
- Account deletion uses the security-definer trigger, not a user `DELETE` grant.

`raw_payload` is the venue JSON object for that one record. Keys whose names match `apiKey`, `apiSecret`, `secret`, `passphrase`, `signature`, `sign`, or `proxy`, at any depth, are removed before insert. Request URLs, headers, and signed query strings are not stored. If the remaining JSON is larger than 16 KiB, the row is rejected. The payload is not cut down to fit.

## Sync

Lookback for an account with no cursor is one year before the scan instant. That interval is not a dashboard day boundary. Day, month, and year buckets use `APP_UTC_OFFSET_MINUTES = 420` (`spec/features/pnl-day-boundary.md`).

Overlap constant: `SYNC_OVERLAP = 2 hours`. The next request for a namespace starts at `window_end - SYNC_OVERLAP`. Insert-if-absent makes the repeated slice cheap. The constant is application configuration, not a column default, so changing it does not need a migration.

Per namespace:

1. Read the cursor. Missing cursor means initial scan from the lookback.
2. Walk venue pages for one time window. Page size stays the venue limit already used by that adapter. A short page ends the window. A full page must request the next page. Hitting a hard page cap, an HTTP error, or a 429 that exhausts retries fails the window.
3. Normalize the page. Any rejected identity, timestamp, or decimal fails the window.
4. Insert the accepted rows in batches of 200, `ON CONFLICT DO NOTHING`, in one database transaction per window.
5. After that transaction commits, set `window_end` to the window end and clear `last_error`.
6. On failure, leave `window_end` where it was, set `last_error`, and do not report the account sync as success.

Retry: 429 and status 500 and above, up to 3 attempts, using `Retry-After` when it is a positive number of seconds, otherwise exponential backoff without random jitter. Timeout stays 10 seconds. A timeout fails the window.

Initial scan and incremental scan use the same loop. Incremental scan is the loop after `window_end` is non-null. Deleting a cursor row is the rescan control. It does not delete ledger rows. Only `service_role` can delete a cursor, through a later explicit rescan action. That action is not in this migration.

Bybit closed-pnl requests are not part of the scan. OKX quantity is not rewritten with `ctVal` before insert. The instrument snapshot can sit in `raw_payload` only when it was part of the fill object. A second public-instrument document is not copied onto every fill.

## Exact staging migration plan

Do not add a file under `supabase/migrations/` and do not run this against any database until a later approval. Target is an empty or disposable staging database after a backup. Production is excluded.

1. Confirm the target URL is the staging project. Refuse the script if it is the production ref.
2. Add unique index `exchange_accounts (id, user_id)` if that pair is not already unique. `id` is the primary key in the schema file, so the pair is unique wherever that primary key exists.
3. Create `exchange_records` and `exchange_sync_cursors` as specified above.
4. Create the two read indexes on `exchange_records`.
5. Enable RLS and create the `SELECT` policies.
6. Grant `SELECT` on both tables to `authenticated`. Grant `SELECT` and `INSERT` on `exchange_records` to `service_role`. Grant `SELECT`, `INSERT`, and `UPDATE` on `exchange_sync_cursors` to `service_role`. Grant the trigger function what it needs to delete child rows. Do not grant `INSERT` or `UPDATE` on the ledger to `authenticated`. Do not grant the ledger to `anon`.
7. Create the security-definer delete trigger on `exchange_accounts`.
8. Do not `INSERT`, `UPDATE`, or `DELETE` existing `trades` rows. Do not backfill the ledger from `trades`.
9. Stop. Application code that writes the ledger is a separate approved change.

## Test acceptance

Vitest and mocked HTTP only. No live exchange call. A database test runs only when `PNLENS_TEST_DATABASE_URL` is set and the test has printed that host and confirmed it is not the production host. Otherwise the database cases are skipped.

| Case | Expected |
|---|---|
| Binance spot, two symbols, same numeric `id`, price `65000.12345678`, qty `0.00000001` | Two rows. Ids differ by symbol. `NUMERIC` equals those strings |
| Binance commission `-0.00000001` | `fee_amount` stays negative. One `fill` row |
| Binance `FUNDING_FEE` plus a fill `REALIZED_PNL` and `COMMISSION` income for the same trade | One fill and one funding row. No income realized-pnl row and no second fee row |
| Binance income type outside the known set | `unknown`, or rejected if `tranId` is missing. `cashflow_amount` is not labeled realized PnL |
| OKX `BTC-USDT-SWAP` fill | `symbol_raw` is `BTC-USDT-SWAP`. Quantity is the `fillSz` string |
| OKX bill type `8` with both `pnl` and `fee` | `funding`. The two strings stay on their own columns. They are not summed |
| OKX bill types `2` and `14` | `unknown` |
| OKX non-numeric `ts`, missing `tradeId` | No row. Cursor unchanged |
| Bybit two executions, one closed-pnl for that `orderId` | Two fill rows. No closed-pnl row. Neither fill `cashflow_amount` is the order `closedPnl` |
| Bybit non-numeric `execTime` | No row |
| Bitget `cTime` `1710000000` on a fill | Rejected. It is not stored as 1970 and not replaced with the test clock |
| Bitget `BTCUSDT_UMCBL` | `symbol_raw` keeps `_UMCBL` |
| Gate.io seconds field and milliseconds field | `occurred_at` uses the unit of the field that was present |
| Gate.io fill and `position_close` | Two namespaces. Cashflows are not added |
| Same batch inserted twice | One row when the isolated database is configured |
| Same venue id on two accounts | Two rows |
| Insert with another user's `exchange_account_id` | Database rejects it |
| HTTP 500 then success | Retries, then inserts |
| Full page without a following page, or a rejected row in the page | `window_end` unchanged. Sync result is not success |
| Payload containing `signature` or `apiSecret` | Those keys are absent from `raw_payload` |
| `trades` row count | Unchanged by the ledger tests |

Adapter tests that expect the current clock, `Math.abs` fees, or Bitget seconds-as-milliseconds are updated in the implementation change that follows this contract. This design does not edit them.

Commands for that later implementation, from `src/` unless noted:

```powershell
pnpm test
pnpm test:node
pnpm lint
pnpm exec tsc --noEmit
pnpm build
```

From the repo root, after implementation, `rg` must show the ledger writer and must not show a new migration already applied by this design task:

```powershell
rg -n "exchange_records" src/lib/db
rg -n "ON CONFLICT DO NOTHING" src/lib/db
rg -n "CREATE TABLE public.exchange_records" supabase/migrations; if ($LASTEXITCODE -ne 1) { exit 1 }
```

The third command stays at exit 1 until a later approval adds the migration file. This design task does not add that file.

## Backward compatibility

| Surface | Effect |
|---|---|
| Existing `trades` rows | Unchanged. Not deleted, not rewritten, not backfilled |
| `pnlEngine` and PnL routes | Same formula, same table. New venue activity is absent from PnL after the ledger writer replaces the `trades` insert |
| `GET /api/pnl/trades`, dashboard table, AI trade tools | Still read `trades`. They already drop zero-quantity income because of `executedOnly` or `quantity > 0` and `price > 0` |
| `upsertTrades` | Not used for events that go to the ledger |
| Account delete | Must keep working through the definer trigger once the migration exists. Until that code and migration ship together, do not apply the migration |
| `demo_trades` | Out of scope |

## Risks and unresolved decisions

Risks that are accepted with the decisions above:

- Dashboard PnL stops growing when sync no longer writes `trades`. That is required by the ban on dual-write.
- The first stored decimal wins. A venue correction with the same id is dropped.
- Events older than `window_end - 2 hours` are not fetched again after the initial year scan.
- Binance `REALIZED_PNL` and `COMMISSION` income are omitted so a later fill cannot double them. A fill that never arrives leaves that PnL and fee only in the exchange, not in the ledger.
- Gate.io position close and Bitget position history can describe the same close as a fill. Both can exist in the ledger. No current reader sums the ledger.
- Unconstrained `NUMERIC` can store a larger value than `trades` ever did. That is intentional. It is also larger than the 8 fractional digits observed in fixtures.
- The 16 KiB payload cap rejects an oversized object instead of trimming it.
- Production `trades` uniqueness is still unverified. This design does not depend on changing it.

Unresolved, and blocking implementation:

1. Confirm `SYNC_OVERLAP = 2 hours`. It is a cost choice. It is not measured from venue delay.
2. Confirm that a service-role rescan is "delete the cursor row", with no product control specified yet.
3. Confirm Binance income identity `{incomeType}:{tranId}:{symbol}`. Fixtures do not prove `tranId` is unique across income types. The type prefix is the guard.
4. OKX bill types `2` and `14` stay `unknown`. Their public names are not defined in this repository. Do not rename them during implementation.
5. No fixture shows a venue amendment id. Corrections stay first-write-wins until a later spec.

## Code paths inspected

- `spec/features/scan-to-db.md`, `spec/implementation-gap.md`
- `database/schema.sql`, `supabase/migrations/20261108000000_baseline.sql`
- `src/lib/db/tradesDb.ts`, `src/lib/services/exchangeService.ts`, `src/lib/services/pnlService.ts`, `src/lib/engines/pnlEngine.ts`, `src/lib/tools/trade-tool.ts`
- `src/app/api/pnl/trades/route.ts`, `src/app/api/pnl/summary/route.ts`
- `src/lib/adapters/binanceAdapter.ts`, `okxAdapter.ts`, `bybitAdapter.ts`, `bitgetAdapter.ts`, `gateioAdapter.ts`
- `src/tests/integration/binanceAdapter.test.ts`, `okxAdapter.test.ts`, `bybitAdapter.test.ts`, `bitgetAdapter.test.ts`, `gateioAdapter.test.ts`
