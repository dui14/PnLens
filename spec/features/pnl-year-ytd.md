# Feature: Year window is calendar YTD

## Behavior

`getDateRangeForPeriod` for `year` sets the start to `now` minus one year (`setFullYear(getFullYear() - 1)`). The chart `year` range is the last 12 local months, not January through the current month.

The year starts at 1 January 00:00:00 in Vietnam (fixed UTC+7) of the current Vietnam year and ends at the request instant. Chart month buckets for `year` cover January through the current Vietnam month of that year only. The offset is `APP_UTC_OFFSET_MINUTES` from `src/lib/time/appUtcOffset.ts` (`spec/features/pnl-day-boundary.md`). The start is not `Date.UTC(year, 0, 1)` and it is not the server's local 1 January.

## Acceptance Criteria

```powershell
rg -n "setFullYear\(now.getFullYear\(\) - 1\)" src/lib/engines/pnlEngine.ts
if ($LASTEXITCODE -eq 0) { exit 1 }
if ($LASTEXITCODE -ne 1) { exit $LASTEXITCODE }
rg -n "Date\.UTC\(now\.getUTCFullYear\(\), 0, 1\)" src/lib/engines/pnlEngine.ts
if ($LASTEXITCODE -eq 0) { exit 1 }
if ($LASTEXITCODE -ne 1) { exit $LASTEXITCODE }
rg -n "APP_UTC_OFFSET_MINUTES" src/lib/engines/pnlEngine.ts
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
exit 0
```
