# Implementation gap

Audit date: 2026-11-09. Branch: `next`. This file records the audit. It does not replace `spec/features/`.

## P0 — Debug route lockdown

Status after this change: implemented for the specified lockdown. Live HTTP was not exercised; proof is the commands in `spec/features/debug-route-lockdown.md`.

Previous behavior:

- `POST /api/exchange/debug/verify` (`src/app/api/exchange/debug/verify/route.ts`) was the only debug route. `src/middleware.ts` listed it in `PUBLIC_API_ROUTES` and returned before the session check.
- The handler did not call `getUser()`.
- Responses set `Access-Control-Allow-Origin: *`, and `OPTIONS` returned 204 with that policy.
- `baseUrl` was any URL. The server signed the call with the posted secret and returned the upstream body, including account data.
- `fetch` followed redirects.

Current behavior:

- `src/lib/security/exchangeDebugAccess.ts` closes `/api/exchange/debug` unless `EXCHANGE_DEBUG_VERIFY_ENABLED=true`, or the variable is unset and `NODE_ENV` is not `production`. `false` closes it in every environment.
- Middleware and the handler return `404` `NOT_FOUND` while closed.
- While open, `/api/exchange` stays on the session gate and the handler calls `getUser()` (`401` / `503`).
- Wildcard CORS and `OPTIONS` are removed.
- `baseUrl` must be the official `https` origin for that exchange. Redirects are not followed.

Acceptance: `spec/features/debug-route-lockdown.md`.

## P1 — Vitest, CI, and test baseline

Classification: missing.

- `src/package.json` has `dev`, `build`, `start`, and `lint`. No Vitest, no `test` script.
- `.github/workflows/main.yml` runs `pnpm install` and `pnpm build` on `main` only.
- P0 tests live in `tests/exchange-debug-access.test.ts` and run with `node --test`, because `src/**/*.test.ts` is gitignored.

Depends on nothing in P0. Do not start until P0 is accepted.

## P2 — Scan to database and duplicate trades

Classification: partially implemented.

- `POST /api/exchange/sync` calls `syncExchangeAccount` (`src/lib/services/exchangeService.ts`): load account, decrypt `api_keys` with the service client, `fetchTrades`, `upsertTrades`.
- `src/lib/db/tradesDb.ts` upserts on `exchange_account_id,external_trade_id`.
- No automated test proves duplicate rows stay unique. Adapters and the one-year lookback are unverified here.

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
- `src/scripts/tmp-prod-exchange-debug.cjs` still targets `https://track-pnl.duii.dev/api/exchange/debug/verify`. It was not run.

## Bugs and security risks still open

- Middleware fail-open: in `src/middleware.ts`, a protected request with a cookie shaped like `sb-*-auth-token` continues when `getUser()` throws. Route handlers that call `getUser()` still fail closed. The debug handler does. Routes that only trust middleware do not.
- While the debug route is enabled, an authenticated caller can submit any read key and receive the upstream account payload. `requestPath` for Binance still includes the query signature.
- `src/scripts/tmp-prod-exchange-debug.cjs` reads `keydata.env` and posts exchange secrets to the old public production URL. Do not run it.
- `pnl_snapshots` has no active RLS policy in `database/schema.sql`.
- `/api/chat` is protected only inside the handler.
- Security headers and app-level rate limits remain `todo` in `spec/progress.md`.

## Sequence

P0 is the checkpoint in this session. Next is P1 (Vitest, CI, pnlEngine and adapter tests). P2 depends on that test runner. P3 and P4 can follow P1. P5 depends on P3. P6 depends on P3 and a decision about where user keys are stored. P7 stays blocked until a production migration plan is approved. P8 is independent and should not land in the same commit as schema or auth changes.

## P0 tests run this session

From the repo root:

- Acceptance `rg` commands in `spec/features/debug-route-lockdown.md`: exit 0.
- `node --test tests/exchange-debug-access.test.ts`: exit 0, 3 passed, 0 failed.

From `src/`:

- `pnpm exec tsc --noEmit`: exit 0.
- `pnpm lint`: exit 0. Warnings were existing files only (`_req` unused, font, `<img>`). None were in the P0 files.

`pnpm install --frozen-lockfile` was required first because `src/node_modules` was incomplete (`styled-jsx` missing, `tsc` could not resolve packages). The lockfile was already current.
