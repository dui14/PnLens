# Feature: Immutable PNL date window

## Behavior

`getDateRangeForPeriod` mutates one `Date` with `setHours`, `setDate`, or `setFullYear` and then reads it back. `endDate` is captured before the mutation today. A later edit that reads `now` after the switch would change the window end.

Each branch copies the request instant and derives the window from `APP_UTC_OFFSET_MINUTES` (`spec/features/pnl-day-boundary.md`). `now` is not passed to `setHours`, `setDate`, or `setFullYear`. The window is not built with UTC setters and it is not built with the server's local setters.

## Acceptance Criteria

```powershell
rg -n "now\.setHours\(|now\.setDate\(|now\.setFullYear\(" src/lib/engines/pnlEngine.ts
if ($LASTEXITCODE -eq 0) { exit 1 }
if ($LASTEXITCODE -ne 1) { exit $LASTEXITCODE }
rg -n "export function getDateRangeForPeriod" src/lib/engines/pnlEngine.ts
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
rg -n "APP_UTC_OFFSET_MINUTES" src/lib/engines/pnlEngine.ts
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
exit 0
```
