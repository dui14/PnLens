# Feature: Debug route lockdown

## Behavior

`/api/exchange/debug` is not a public API.

`isExchangeDebugVerifyEnabled` in `src/lib/security/exchangeDebugAccess.ts` is the switch. `EXCHANGE_DEBUG_VERIFY_ENABLED=true` enables the route. `EXCHANGE_DEBUG_VERIFY_ENABLED=false` disables it. When the variable is unset, the route is enabled only if `NODE_ENV` is not `production`.

Middleware and `POST /api/exchange/debug/verify` both return `404` `NOT_FOUND` while the route is disabled. While it is enabled, the path stays under the `/api/exchange` session gate, and the handler calls `getUser()`. Missing user is `401` `UNAUTHORIZED`. Auth service failure is `503` `AUTH_SERVICE_UNAVAILABLE`.

The handler does not set `Access-Control-Allow-Origin`. It does not expose `OPTIONS`. `fetch` uses `redirect: 'manual'` and does not return a redirect body.

`baseUrl`, when present, must be `https`, default port, no userinfo, no path, query, or hash, and a host listed for that exchange in `exchangeDebugAccess.ts`. Anything else is `400` `VALIDATION_ERROR`. An omitted `baseUrl` uses that exchange's default official origin.

## Acceptance Criteria

```powershell
rg -n "PUBLIC_API_ROUTES" src/middleware.ts; if ($LASTEXITCODE -ne 1) { exit 1 }
rg -n "Access-Control-Allow-Origin" src/app/api/exchange/debug/verify/route.ts; if ($LASTEXITCODE -ne 1) { exit 1 }
rg -n "getUser" src/app/api/exchange/debug/verify/route.ts
rg -n "isExchangeDebugVerifyEnabled" src/middleware.ts
rg -n "redirect: 'manual'" src/app/api/exchange/debug/verify/route.ts
node --test tests/exchange-debug-access.test.ts
```
