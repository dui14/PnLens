# Architecture

Narrative diagram and module list: `docs/ARCHITECTURE.md`. Key-setup notes (not the scan loop): `docs/HOW IT WORK.md`. This file only records paths in the tree. Do not treat the docs as a second implementation.

## Layers under `src/lib`

| Path | Role in code |
|---|---|
| `src/lib/adapters/` | Venue HTTP adapters, OKX signing, LLM-related adapter file, AES-GCM encrypt/decrypt, shared `httpClient.ts`. Factory: `exchangeFactory.ts`. |
| `src/lib/db/` | Supabase clients and table access: `usersDb.ts`, `exchangeDb.ts`, `tradesDb.ts`, `pnlDb.ts`, `demoDb.ts`, `chatDb.ts`. |
| `src/lib/engines/` | Pure calc: `pnlEngine.ts` (summary, series, calendar), `demoEngine.ts`. |
| `src/lib/services/` | Use-cases: `exchangeService.ts`, `pnlService.ts`, `demoService.ts`, `aiService.ts`, `profileService.ts`. |
| `src/lib/tools/` | Model tools: `definitions.ts`, `trade-tool.ts`, `news-tool.ts`, `market-tool.ts`. |
| `src/lib/validators/` | Zod at the HTTP boundary: `exchange.ts`, `exchangeDebug.ts`, `pnl.ts`, `demo.ts`, `ai.ts`, `profile.ts`. |
| `src/lib/security/` | Request gates that are not venue adapters. `exchangeDebugAccess.ts` decides whether `/api/exchange/debug` is enabled and which official origins a debug `baseUrl` may use. | |
| `src/lib/types/` | Shared types and `EXCHANGES` in `index.ts`. |
| `src/lib/config/` | RSS feed lists in `rss-feeds.ts`. |

`src/lib/agent-loop.ts` sits next to those folders. It is the OpenRouter tool loop, not a `services/` file.

HTTP entry: `src/app/api/**/route.ts`. Pages: `src/app/**/page.tsx`. Session gate: `src/middleware.ts`.

`docs/ARCHITECTURE.md` also draws middleware → API → services → engines and names Supabase Storage. Avatar upload calls storage bucket `avatars` from `src/lib/services/profileService.ts`. Bucket DDL is not in `database/schema.sql` (`Chưa xác minh`).

## Connect and sync

`POST /api/exchange/connect` → `connectExchange` (`src/lib/services/exchangeService.ts`):

1. Build the adapter with `createExchangeAdapter`.
2. `validateCredentials` / detailed validation.
3. `hasWithdrawPermission`. Withdraw-capable keys are rejected in that function (call sites around the two `hasWithdrawPermission` checks in the same file).
4. Encrypt key, secret, optional passphrase and proxy (`src/lib/adapters/encryption.ts`) and insert `exchange_accounts` + `api_keys` (`src/lib/db/exchangeDb.ts`).

`POST /api/exchange/sync` → `syncExchangeAccount` in the same service:

1. Load the account for the user. Inactive → `ACCOUNT_INACTIVE`.
2. Set `sync_status` to `syncing`.
3. Read `api_keys` with `createSupabaseServiceClient` (`getApiKey`). Decrypt.
4. Re-validate credentials.
5. `adapter.fetchTrades` from `getSyncLookbackDate()` (one year before the scan instant). Dashboard day boundaries are fixed UTC+7 in `spec/features/pnl-day-boundary.md`, not this lookback.
6. `upsertTrades` (`src/lib/db/tradesDb.ts`) on the service client.
7. Set `synced` and return `SyncResult`: `synced_trades`, `new_trades`, `last_synced` (`src/lib/types/index.ts`).

Balance and open positions are separate reads: `fetchExchangeBalance` / `fetchExchangePositions` in `exchangeService.ts`, routes `GET /api/exchange/balance/[id]` and `GET /api/exchange/positions/[id]`. They are not part of `syncExchangeAccount`.

Dashboard numbers are computed from `trades` in `src/lib/services/pnlService.ts` via `src/lib/engines/pnlEngine.ts`. `src/lib/db/pnlDb.ts` reads and upserts `pnl_snapshots`, and `tradesDb.ts` deletes that table when removing an account. `Chưa xác minh` which request calls `pnlDb.ts` (no caller under `src/lib/services` in this pass).

## AI chat loop

`docs/ARCHITECTURE.md` shows `POST /api/ai/chat` and SSE. Code path:

1. `src/app/api/ai/chat/route.ts` checks the session, parses `ChatMessageSchema`, returns `text/event-stream`.
2. `startOrContinueChat` in `src/lib/services/aiService.ts` stores the user message (`src/lib/db/chatDb.ts`) and calls `runAgentLoop`.
3. `runAgentLoop` (`src/lib/agent-loop.ts`) posts to OpenRouter with `TOOL_DEFINITIONS`, up to `AGENT_MAX_STEPS` (`5`), history slice of 12. Tools: `get_trade_history`, `get_pnl_stats`, `get_crypto_news`, `get_market_quotes` (`src/lib/tools/definitions.ts`).
4. Events: `thinking_start`, `thinking_step`, `tool_start`, `tool_done`, `content_chunk`, `done`, `error` (`AgentEvent` in `agent-loop.ts`).
5. `src/app/api/chat/route.ts` re-exports that `POST`. It is not listed in `PROTECTED_ROUTES`; the handler still calls `getUser()`.

`docs/ARCHITECTURE.md` names RAG. This pass found tool calls and chat rows, not an embeddings or vector store under `src/`. `Chưa xác minh` for a RAG index outside this repo.

Model id: request `model`, else env `MODELS_*` / `OPENROUTER_MODEL`, else `google/gemini-3-flash-preview` (`resolveAgentModel` in `agent-loop.ts`, options built in `src/app/(app)/ai-assistant/page.tsx`).
