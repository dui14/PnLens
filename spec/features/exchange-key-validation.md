# Feature: Exchange key validation

Phase 1. Nothing in this spec starts the ledger writer.

## Behavior

`POST /api/exchange/connect` requires a session. The handler finishes every check below before it encrypts or inserts. A failed check stores nothing.

Order:

1. Format check, local, no network.
2. App rate limit. Excess returns `429` `RATE_LIMITED` and does not call the exchange.
3. Live read-only probe through the same HTTP path the scan uses for that exchange, including the request proxy when the body contains one.
4. Permission check on the probe body.
5. Encrypt the key, secret, passphrase, and proxy. Insert `exchange_accounts` and `api_keys` together. If either insert fails, delete both rows before the handler returns.

Passphrase is required for OKX and Bitget because those guides send it on signed requests (`OK-ACCESS-PASSPHRASE`, `ACCESS-PASSPHRASE`). Gate.io's guide does not use a passphrase.

Shapes already listed in `spec/features/exchange-key-format.md` still apply to Binance, OKX, and Bybit. The exchange guides do not state those character counts. Bitget and Gate.io key patterns are not in the guides.

| Exchange | Format | Guide |
|---|---|---|
| Binance | 64 alphanumeric characters, from `spec/features/exchange-key-format.md` | UNVERIFIED: confirm in official docs. The Binance guide does not state a length |
| OKX | UUID, from `spec/features/exchange-key-format.md` | UNVERIFIED: confirm in official docs. The OKX guide does not state a pattern |
| Bybit | 18 alphanumeric characters, from `spec/features/exchange-key-format.md` | UNVERIFIED: confirm in official docs. The Bybit guide does not state a length |
| Bitget | UNVERIFIED: confirm in official docs | The guide names `BITGET_API_KEY`, `BITGET_PASSPHRASE`, and `BITGET_RSA_PRIVATE_KEY`, and it specifies RSA-SHA256. It does not specify an HMAC secret pattern |
| Gate.io | UNVERIFIED: confirm in official docs | The guide names `GATEIO_API_SECRET` and does not state a key pattern |

A format mismatch returns `400` `VALIDATION_ERROR` with message `API_KEY_FORMAT` and does not call the exchange.

### Probe

The probe calls the permission endpoint in the table below, then one read-only endpoint that scan will call for that exchange. Both calls use the scan HTTP client for that venue. A transport failure, HTTP 418, or a signature failure does not store the key.

| Exchange | Permission endpoint | Read probe used by scan | Base URL in the guide |
|---|---|---|---|
| Binance | `GET /sapi/v1/account/apiRestrictions` on `https://api.binance.com` | `GET /api/v3/account` | `https://api.binance.com` |
| OKX | `GET /api/v5/account/config` | `GET /api/v5/account/balance` is not named as the scan read. Scan reads are `GET /api/v5/trade/fills-history`. Use that path with `instType=SPOT` and `limit=1` | Sample base `https://openapi.okx.com` |
| Bybit | `GET /v5/user/query-api` | `GET /v5/execution/list` with `category=spot` and `limit=1` | `api.bybit.com` in the guide's request example |
| Bitget | `GET /api/v2/user/apikey-info` | `GET /api/v2/spot/trade/fills` with `limit=1` | `https://api.bitget.com` |
| Gate.io | `GET /api/v4/account/detail` | `GET /api/v4/spot/my_trades` with `limit=1` | `https://api.gateio.ws` |

OKX `GET /api/v5/account/balance` is not the probe. The fills-history path is the one the OKX guide assigns to trade history.

### Permission check

Reject when the exchange reports a trade or withdraw right. If the probe HTTP call succeeds and the documented permission fields are absent, accept the key and return warning `PERMISSIONS_UNVERIFIED`. Do not treat a network error as that warning.

| Exchange | Reject when the body reports | Fields |
|---|---|---|
| Binance | `enableSpotAndMarginTrading`, `enableWithdrawals`, `enableInternalTransfer`, or `permitsUniversalTransfer` is true. `enableReading` must be true | Those names, from the Binance guide. `enableFutures`: the guide allows `true` for reading futures and also says to reject futures execution. It does not name a separate execution flag. UNVERIFIED: confirm in official docs. Do not reject `enableFutures: true` from this guide alone. `ipRestrict` false is a warning, not a reject |
| OKX | `perm` contains `trade` or `withdraw`. `read_only` must be present | `perm` values `read_only`, `trade`, `withdraw` |
| Bybit | `result.readOnly` is `0` | `result.readOnly`. The guide also says to reject write rights inside `result.permissions` and does not name those keys. UNVERIFIED: confirm in official docs. Do not guess the keys. A body that includes `result.permissions` without those confirmed names returns `PERMISSIONS_UNVERIFIED` and still enforces `result.readOnly`. `result.ips` missing the server egress IP is a warning, not a reject |
| Bitget | `authorities` does not contain `readonly`, or `status` is not `normal` | `authorities`, `status`. The sample value is `readonly`. Any other authority token is UNVERIFIED: confirm in official docs. Do not guess it. Presence of a token other than `readonly` returns `PERMISSIONS_UNVERIFIED` after the `readonly` and `status` checks |
| Gate.io | A documented flag that is present and enabled: `spot.write`, `futures.write`, `withdraw.write`, or `transfer.write`. Read permission must be enabled when the field is present | Names as written in the Gate.io guide. The guide does not give the JSON path. UNVERIFIED: confirm in official docs. If none of those names appear in the body, return `PERMISSIONS_UNVERIFIED` |

### Errors

| Code | HTTP | When |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Body or `API_KEY_FORMAT` |
| `PASSPHRASE_REQUIRED` | 400 | OKX or Bitget without passphrase |
| `RATE_LIMITED` | 429 | App limit, or the exchange returned 429 after the probe retries |
| `INVALID_API_KEY` | 400 | Probe rejected the signature or the key |
| `TRADE_PERMISSION_DETECTED` | 400 | A trade right is reported |
| `WITHDRAW_PERMISSION_DETECTED` | 400 | A withdraw right is reported |
| `TRANSFER_PERMISSION_DETECTED` | 400 | A transfer right is reported |
| `EXCHANGE_UNREACHABLE` | 502 | Probe could not complete |
| `EXCHANGE_TIME_DRIFT` | 400 | The guide's clock-drift rejection (`-1021` on Binance, OKX `50102`, Bitget `40005`) |
| `CONFLICT` | 409 | That user already has this exchange. `UNIQUE (user_id, exchange)` is in the baseline migration |
| `PERMISSIONS_UNVERIFIED` | 201 | Stored. Warning only. The success body includes `warnings: ["PERMISSIONS_UNVERIFIED"]` |

Exchange 429 handling from the guides: Binance can follow with HTTP 418. OKX uses `50011`. Bitget uses `40014` and `Retry-After`. Gate.io uses HTTP 429. The probe retries those the same way scan does, then fails closed.

Logs and JSON bodies omit `apiKey`, `apiSecret`, passphrase, proxy credentials, `signature`, and `sign`. A thrown exchange error is logged as a code, not the raw object.

The numeric app rate-limit threshold is not in the guides. The handler uses one named constant shared with scan. This spec does not pick the number.

## Acceptance Criteria

```powershell
rg -n "PERMISSIONS_UNVERIFIED" src/lib/services/exchangeService.ts
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
rg -n "TRADE_PERMISSION_DETECTED" src/lib/services/exchangeService.ts
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
rg -n "apiRestrictions" src/lib/adapters/binanceAdapter.ts
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
rg -n "/api/v5/account/config" src/lib/adapters/okxAdapter.ts
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
rg -n "/v5/user/query-api" src/lib/adapters/bybitAdapter.ts
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
rg -n "/api/v2/user/apikey-info" src/lib/adapters/bitgetAdapter.ts
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
rg -n "/api/v4/account/detail" src/lib/adapters/gateioAdapter.ts
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
exit 0
```
