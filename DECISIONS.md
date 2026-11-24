# Design decisions and tradeoffs

The problems that shaped PnLens, what I decided, and what each decision costs.

| Challenge | Decision | Tradeoff accepted |
|---|---|---|
| **Five exchanges, five data models.** Endpoints, symbols, decimals, fee assets and contract types all differ. | One adapter per exchange behind a shared interface, normalized into a single `trades` schema. The original payload is kept in `raw_data`. | Every new exchange needs a full adapter. Futures PNL uses each exchange's own per-trade realized PNL, so its exact definition differs slightly between exchanges. |
| **Spot cost basis is unknowable.** Spot assets can be withdrawn to or deposited from external wallets. | Spot trades are stored with `realized_pnl = null`. PNL is shown for futures, where the position lives on the exchange; spot shows fees and volume. | No spot PNL. Users who mainly trade spot see costs and volume, not profit. |
| **Users must trust the app with exchange keys.** | Read-only keys are enough for spot and futures history. On connect, PnLens asks each exchange for the key's permissions and rejects trade, withdraw and transfer rights. Secrets are encrypted with AES-256-GCM, with row-level security on user data. | No trading or automation features. One gap: a Binance key with Enable Futures is only warned about, not rejected. |
| **Regional restrictions.** Some exchanges block requests by region. | All calls go from the server to each exchange's global API. Region blocks (HTTP 451) surface as a clear `EXCHANGE_REGION_BLOCKED` error. | No fallback to regional domains. Keys cannot be locked to an IP whitelist, so they are less restricted. |
| **Short history limits.** Binance and Bybit return 180 days, OKX, Bitget and Gate.io 90 days. | Every sync re-fetches the full window and upserts. Rows from earlier syncs are kept. | More API calls and slower syncs. Trades older than the window exist only if they were synced earlier. |
| **Syncs take minutes, HTTP requests time out.** | Return 202 and run the sync in the background with Next.js `after()`, an atomic claim and a 15-minute cooldown. A sync stuck for 30 minutes can be reclaimed. | No external queue: a server restart kills a running sync until the stale window passes, and users cannot re-sync during the cooldown. |
| **Mocks cannot prove the numbers.** | 530+ tests with stubbed exchange responses, plus live tests that call each exchange with real keys. | Live tests need real keys and network, so they cannot run in CI and can fail for reasons outside the code. |
