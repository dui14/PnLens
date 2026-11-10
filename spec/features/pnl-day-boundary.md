# Feature: PNL day boundary

## Behavior

`formatDayKey`, `formatMonthKey`, `formatHourKey`, calendar filters, and `buildBuckets` in `src/lib/engines/pnlEngine.ts` use `getFullYear`, `getMonth`, `getDate`, and `getHours`. `toDateKey` in `src/lib/services/pnlService.ts` does the same. The bucket follows the server's local zone. A trade at `2026-01-01T20:30:00.000Z` is 2 January in Vietnam and 1 January in UTC.

Day, week, month, and year buckets use Vietnam time, fixed UTC+7, with no daylight-saving shift. The offset lives in one module as `APP_UTC_OFFSET_MINUTES = 420`. `pnlEngine` and `pnlService` import that constant. They do not read `process.env.TZ`, `Intl` resolved options, or `Date` local getters. Switching the product to UTC later changes that one constant to `0`.

A bucket instant is `utcMillis + APP_UTC_OFFSET_MINUTES * 60 * 1000`. Year, month, day, and hour are integer divisions of that shifted epoch. They are not `Date` local getters and they are not `getUTC*` used as the product calendar.

## Acceptance Criteria

```powershell
rg -n "APP_UTC_OFFSET_MINUTES = 420" src/lib/time/appUtcOffset.ts
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
rg -n "APP_UTC_OFFSET_MINUTES" src/lib/engines/pnlEngine.ts
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
rg -n "APP_UTC_OFFSET_MINUTES" src/lib/services/pnlService.ts
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
rg -n "getFullYear\(|getMonth\(|getDate\(|getHours\(" src/lib/engines/pnlEngine.ts src/lib/services/pnlService.ts
if ($LASTEXITCODE -eq 0) { exit 1 }
if ($LASTEXITCODE -ne 1) { exit $LASTEXITCODE }
rg -n "getUTCFullYear|getUTCMonth|getUTCDate|getUTCHours" src/lib/engines/pnlEngine.ts src/lib/services/pnlService.ts
if ($LASTEXITCODE -eq 0) { exit 1 }
if ($LASTEXITCODE -ne 1) { exit $LASTEXITCODE }
exit 0
```
