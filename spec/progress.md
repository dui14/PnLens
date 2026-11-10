# Progress

Rows other than debug route lockdown were not executed in this session. Run curl checks against local `http://localhost:3000` only. Do not point them at production.

| Feature | Spec | Status | Acceptance command |
|---|---|---|---|
| Authentication | `spec/features/authentication.md` | todo | `curl.exe -s -o NUL -w "%{http_code}" http://localhost:3000/api/profile` |
| Dashboard | `spec/features/dashboard.md` | todo | `curl.exe -s -o NUL -w "%{http_code}" http://localhost:3000/api/pnl/overview` |
| PNL engine | `spec/features/pnl-engine.md` | todo | `curl.exe -s -o NUL -w "%{http_code}" "http://localhost:3000/api/pnl/summary?range=all"` |
| Exchange integration | `spec/features/exchange-integration.md` | todo | `curl.exe -s -o NUL -w "%{http_code}" http://localhost:3000/api/exchange/accounts` |
| API key security | `spec/features/api-security.md` | todo | `rg -n "aes-256-gcm" src/lib/adapters/encryption.ts` |
| Demo trading | `spec/features/demo-trading.md` | todo | `curl.exe -s -o NUL -w "%{http_code}" -X POST http://localhost:3000/api/demo/order -H "Content-Type: application/json" --data "{}"` |
| AI assistant | `spec/features/ai-assistant.md` | todo | `curl.exe -s -o NUL -w "%{http_code}" -X POST http://localhost:3000/api/ai/chat -H "Content-Type: application/json" --data "{}"` |
| Profile | `spec/features/profile-management.md` | todo | `curl.exe -s -o NUL -w "%{http_code}" http://localhost:3000/api/profile` |
| Database schema | `spec/features/database-schema.md` | todo | `rg -n "no_direct_key_access" database/schema.sql` |
| Rebrand | `spec/features/rebrand.md` | todo | `rg -n -i -e "track pnl pro" -e "track-pnl-pro" -e "trackpnl" src docs ai-context spec AGENTS.md README.md -g "!spec/features/rebrand.md" -g "!AGENTS.md"; if ($LASTEXITCODE -ne 1) { exit 1 }` |
| FIFO spot PNL | `spec/features/fifo-spot-pnl.md` | todo | `rg -n "export function calculateFIFOPNL" src/lib/engines/pnlEngine.ts` |
| PNL day boundary | `spec/features/pnl-day-boundary.md` | todo | `rg -n "APP_UTC_OFFSET_MINUTES = 420" src/lib/time/appUtcOffset.ts` |
| Static service imports | `spec/features/service-static-imports.md` | todo | `rg -n "import \{ createSupabaseServiceClient \} from '@/lib/db/supabase-server'" src/lib/services/exchangeService.ts` |
| PNL trade column list | `spec/features/pnl-trade-columns.md` | todo | `rg -n "id, symbol, side, quantity, price, fee, realized_pnl, trade_type, traded_at" src/lib/db/tradesDb.ts` |
| Immutable PNL date window | `spec/features/pnl-date-range.md` | todo | `rg -n "now.setFullYear" src/lib/engines/pnlEngine.ts; if ($LASTEXITCODE -ne 1) { exit 1 }` |
| API rate limits | `spec/features/api-rate-limit.md` | todo | `rg -n "RATE_LIMITED" src/app/api/exchange/sync/route.ts` |
| Binance trade pagination | `spec/features/binance-trade-pagination.md` | todo | `rg -n "fromId" src/lib/adapters/binanceAdapter.ts` |
| Exchange 5xx retry | `spec/features/exchange-5xx-retry.md` | todo | `rg -n "status >= 500" src/lib/adapters/binanceAdapter.ts` |
| PNL snapshot cache | `spec/features/pnl-snapshot-cache.md` | todo | `rg -n "upsertPNLSnapshot\(" src/lib/services/pnlService.ts` |
| App route boundaries | `spec/features/app-route-boundaries.md` | todo | `Test-Path -LiteralPath "src/app/(app)/dashboard/loading.tsx"` |
| Atomic demo balance | `spec/features/demo-balance-atomic.md` | todo | `rg -n "deduct_demo_balance" database/schema.sql` |
| Year window is calendar YTD | `spec/features/pnl-year-ytd.md` | todo | `rg -n "APP_UTC_OFFSET_MINUTES" src/lib/engines/pnlEngine.ts` |
| Security headers | `spec/features/security-headers.md` | todo | `rg -n "Content-Security-Policy" src/next.config.ts` |
| Per-exchange API key shape | `spec/features/exchange-key-format.md` | todo | `rg -n "API_KEY_FORMAT" src/lib/validators/exchange.ts` |
| Chat messages in one query | `spec/features/chat-messages-query.md` | todo | `rg -n -U "function getConversationMessages\([\s\S]{0,500}getConversationById" src/lib/db/chatDb.ts; if ($LASTEXITCODE -ne 1) { exit 1 }` |
| OKX symbol normalization | `spec/features/okx-symbol.md` | todo | `rg -n "split\('-'\)\.slice\(0, 2\)\.join\(''\)" src/lib/adapters/okxAdapter.ts` |
| Trade symbol query length | `spec/features/trades-symbol-max.md` | todo | `rg -n "symbol: z\.string\(\)\.max\(20\)\.optional\(\)" src/lib/validators/pnl.ts` |
| PNL summary error status | `spec/features/pnl-summary-status.md` | todo | `rg -n "NOT_FOUND: 404" src/app/api/pnl/summary/route.ts` |
| Exchange key validation | `spec/features/exchange-key-validation.md` | todo | `rg -n "PERMISSIONS_UNVERIFIED" src/lib/services/exchangeService.ts` |
| Scan execution | `spec/features/scan-execution.md` | todo | `rg -n "sync_started_at" src/lib/db/exchangeDb.ts` |
| Debug route lockdown | `spec/features/debug-route-lockdown.md` | done | `node --test tests/exchange-debug-access.test.ts tests/middleware-access.test.ts` |
| Test foundation | `spec/implementation-gap.md` | done | `pnpm test` |

Debug route lockdown and P0.1, 2026-11-09, repo root unless noted. Acceptance commands in `spec/features/debug-route-lockdown.md` exit 0. `node --test tests/exchange-debug-access.test.ts tests/middleware-access.test.ts` exit 0 (8 passed).

Test foundation, 2026-11-09, from `src/`, Node v24.1.0. `pnpm test` exit 0 (55 passed). `pnpm test:node` exit 0 (8 passed). `pnpm exec tsc --noEmit` exit 0. `pnpm lint` exit 0. `pnpm build` exit 0. GitHub Actions was not run.
