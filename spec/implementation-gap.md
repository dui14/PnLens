# Implementation gap

Audit date: 2026-11-09. Branch: `next`. This file records the audit. It does not replace `spec/features/`.

## P0 — Debug route lockdown

Status after P0.1: implemented, including the follow-up below. Live HTTP was not exercised. Proof is the commands in `spec/features/debug-route-lockdown.md`.

Previous behavior:

- `POST /api/exchange/debug/verify` (`src/app/api/exchange/debug/verify/route.ts`) was the only debug route. `src/middleware.ts` listed it in `PUBLIC_API_ROUTES` and returned before the session check.
- The handler did not call `getUser()`.
- Responses set `Access-Control-Allow-Origin: *`, and `OPTIONS` returned 204 with that policy.
- `baseUrl` was any URL. The server signed the call with the posted secret and returned the upstream body, including account data.
- `fetch` followed redirects.

Current behavior:

- `src/lib/security/exchangeDebugAccess.ts` closes `/api/exchange/debug` whenever `NODE_ENV` is `production`, including when `EXCHANGE_DEBUG_VERIFY_ENABLED=true`. Outside production, `true` opens it, `false` closes it, and an unset variable leaves it open.
- Middleware and the handler return `404` `NOT_FOUND` while closed.
- While open, `/api/exchange` stays on the session gate and the handler calls `getUser()` (`401` / `503`).
- Wildcard CORS and `OPTIONS` are removed.
- `baseUrl` must be the official `https` origin for that exchange. Redirects are not followed.
- The JSON data has no upstream account payload. A request path that contains a `signature` or `sign` query parameter is returned as the path only. Auth failures are logged without the error object.
- Middleware auth failure is fail-closed. `decideMiddlewareAccess` does not take a cookie. A protected API call whose `getUser()` throws returns `503`. A protected page returns the login redirect. A cookie named like `sb-*-auth-token` is not read.
- `src/scripts/tmp-prod-exchange-debug.cjs` was removed. It was unreferenced, read `keydata.env`, and posted secrets to `https://track-pnl.duii.dev`. It was not executed.

Acceptance: `spec/features/debug-route-lockdown.md`.

## P1 — Vitest, CI, and test baseline

Status after this change: implemented. Financial formulas were not changed.

- Vitest `5.1.0` and `@vitest/coverage-v8` are dev dependencies in `src/package.json`. Scripts: `test`, `test:watch`, `test:coverage`, and `test:node`.
- Unit tests live in `src/tests/unit/`. Integration tests that mock HTTP live in `src/tests/integration/`. Shared HTTP helpers live in `src/tests/integration/support/` and are not collected as tests.
- P0 Node tests stay at `tests/*.test.ts` and run with `node --test` through `pnpm test:node`. Vitest does not collect them.
- `.gitignore` no longer ignores `src/**/*.test.ts`. `git check-ignore` does not ignore the new test files.
- `.github/workflows/main.yml` runs on push and pull request for `next` and `main`: frozen install, `pnpm test`, `pnpm test:node`, lint, `tsc --noEmit`, and build. Node is 22 because Vitest 5 requires `^22.12.0 || ^24.0.0`. The workflow sets placeholder public Supabase values and does not read GitHub secrets.
- `pnlEngine` tests lock the current aggregator. It sums `realized_pnl`. It does not derive long, short, partial-close, fee, or unrealized results from quantity and price.
- Adapter tests mock HTTP. They do not call live exchange APIs. Fixtures use `test-api-key` and `test-api-secret`.

## P1 suspected calculation behavior

These were not changed:

- `fee` and `funding_fee` are ignored by `calculatePNLSummary`. A `null` `realized_pnl` stays in `trade_count` and out of `total_pnl`.
- A non-numeric `realized_pnl` becomes `NaN` and poisons `total_pnl`.
- Summary money is rounded to 8 decimal places. Calendar money is rounded to 4.
- Chart and calendar keys use local date fields. With `TZ=Asia/Bangkok`, `2026-01-01T20:30:00.000Z` lands on `2026-01-02`. `spec/features/pnl-utc-buckets.md` is still todo.
- `getDateRangeForPeriod('year')` is a rolling year via `setFullYear`, not calendar year-to-date. An unknown range leaves `startDate` undefined.
- Bitget `cTime` of `1710000000` is parsed as milliseconds, so the timestamp is in 1970. A non-numeric Bitget `cTime` throws `RangeError` from `toISOString` and fails `fetchTrades`. OKX, Bybit, and Gate substitute the current time.
- OKX `BTC-USDT-SWAP` becomes `BTCUSDTSWAP`. Bitget `BTCUSDT_UMCBL` becomes `BTCUSDTUMCBL`.
- Binance spot fills are not deduplicated. Futures fills are. Spot `myTrades` is one request; futures income requests another page when the first page has 1000 rows.

## P2 — Scan to database and duplicate trades

Classification: partially implemented.

- `POST /api/exchange/sync` calls `syncExchangeAccount` (`src/lib/services/exchangeService.ts`): load account, decrypt `api_keys` with the service client, `fetchTrades`, `upsertTrades`.
- `src/lib/db/tradesDb.ts` upserts on `exchange_account_id,external_trade_id`.
- No automated test proves duplicate database rows stay unique. Adapter HTTP mapping is covered by P1. The one-year lookback is not.

## P3 — AI hardening, user isolation, IDOR

Classification: partially implemented, and the isolation proof is missing.

- `POST /api/ai/chat` and `src/app/api/chat/route.ts` (re-export) call `getUser()`. Chat reads in `src/lib/db/chatDb.ts` filter `user_id`.
- RLS on `chat_conversations` and `chat_messages` is in `database/schema.sql`.
- `/api/chat` is not in `PROTECTED_ROUTES`. The handler is the only gate.
- No IDOR tests.

## P4 — Dashboard backed by the database

Classification: partially implemented.

- Pages and PnL routes exist (`src/app/(app)/dashboard/page.tsx`, `src/app/api/pnl/*`).
- `src/lib/services/pnlService.ts` computes from `trades`. `pnl_snapshots` RLS is commented out in `database/schema.sql`.
- No route or UI test.

## P5 — AI RAG and vectors

Classification: missing.

- `src/lib/agent-loop.ts` calls OpenRouter tools. No embedding or vector store under `src/`.

## P6 — AI user configuration and BYOK

Classification: missing as a user-owned key.

- `src/lib/adapters/llmAdapter.ts` and `src/lib/agent-loop.ts` read the server `OPENROUTER_API_KEY`. No per-user key store or BYOK UI was found.

## P7 — Production database alignment

Classification: blocked on an explicit production decision.

- `database/schema.sql` and `supabase/migrations/20261108000000_baseline.sql` exist.
- `pnl_snapshots` RLS is commented out in `database/schema.sql`.
- Do not apply migrations to production from this audit.

## P8 — Rebrand and domain

Classification: partially implemented.

- `spec/features/rebrand.md` still has status `todo`.
- `src/package.json` name is `track-pnl-pro`.
- `src/scripts/tmp-prod-exchange-debug.cjs` was removed in P0.1. It was not run.

## Bugs and security risks still open

- While the debug route is enabled outside production, an authenticated caller can still submit a read key. The handler no longer returns the account payload or a signed Binance query. The upstream account call still happens.
- `pnl_snapshots` has no active RLS policy in `database/schema.sql`.
- `/api/chat` is protected only inside the handler.
- Security headers and app-level rate limits remain `todo` in `spec/progress.md`.

## Sequence

P0 and P0.1 are the security checkpoint. P1 (Vitest, CI, pnlEngine and adapter tests) is in place. P2 can use that runner. P3 and P4 can follow P1. P5 depends on P3. P6 depends on P3 and a decision about where user keys are stored. P7 stays blocked until a production migration plan is approved. P8 is independent and should not land in the same commit as schema or auth changes.

## P0.1 and P1 checks run this session

From the repo root, the acceptance block in `spec/features/debug-route-lockdown.md` exited 0. `node --test tests/exchange-debug-access.test.ts tests/middleware-access.test.ts` exited 0 (8 passed).

From `src/`, Node `v24.1.0`:

- `pnpm test` exited 0. Vitest 6 files, 55 passed.
- `pnpm test:node` exited 0. 8 passed.
- `pnpm exec tsc --noEmit` exited 0.
- `pnpm lint` exited 0. Warnings were the existing `_req`, font, and `<img>` warnings.
- `pnpm build` exited 0. This machine also loaded `src/.env.local`. The workflow itself sets only `http://127.0.0.1:54321` and `ci-public-anon-key`. GitHub Actions was not executed from here.

## P0 tests run in the previous session

From the repo root:

- Acceptance `rg` commands in `spec/features/debug-route-lockdown.md`: exit 0.
- `node --test tests/exchange-debug-access.test.ts`: exit 0, 3 passed, 0 failed.

From `src/`:

- `pnpm exec tsc --noEmit`: exit 0.
- `pnpm lint`: exit 0. Warnings were existing files only (`_req` unused, font, `<img>`). None were in the P0 files.

`pnpm install --frozen-lockfile` was required first because `src/node_modules` was incomplete (`styled-jsx` missing, `tsc` could not resolve packages). The lockfile was already current.
