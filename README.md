<div align="center">

<img src="src/public/assets/Pnlens_Mark.png" alt="PnLens" width="72" />

# PnLens

**One read-only view of your real PNL across Binance, OKX, Bybit, Bitget and Gate.io.**

Connect a read-only API key, sync your full trade history, and see profit, fees and volume in one dashboard. Practice in a risk-free futures sandbox and ask an AI assistant about your own numbers.

[Live app](https://pnlens.duii.dev) · [How it works](https://pnlens.duii.dev/how-it-works) · [Architecture](ARCHITECTURE.md)

![Next.js](https://img.shields.io/badge/Next.js-15-000000?logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%7C%20Auth-3FCF8E?logo=supabase&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3-06B6D4?logo=tailwindcss&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-blue)

<br />

<img src="src/public/screenshots/Hero.png" alt="Create a read-only key, choose an exchange, connect, sync, and see your PNL" width="100%" />

</div>

---

## Contents

- [Why PnLens](#why-pnlens)
- [Features](#features)
- [Supported exchanges](#supported-exchanges)
- [Security model](#security-model)
- [Tech stack](#tech-stack)
- [Roadmap](#roadmap)
- [Documentation](#documentation)
- [Contact](#contact)
- [License](#license)

## Why PnLens

Traders who use several exchanges end up with several partial pictures: each venue reports its own PNL, its own fees and its own time zone. PnLens pulls the raw trade history from every connected exchange, normalizes it, and computes PNL, fees and volume the same way for all of them.

- **Read-only by design.** Keys that can trade, withdraw or transfer are rejected before they are stored.
- **Full history, every sync.** Each sync fetches the exchange's maximum lookback window and upserts it, so gaps fill themselves.
- **Spot and futures together.** Filter by market type and by exchange, or view everything combined.

## Features

### Dashboard

PNL for today, 7, 30 and 90 days and the year to date, plus total fees, win rate, trade count and traded volume. Every card can be filtered by Spot / Futures and by exchange.

<img src="src/public/screenshots/dashboard.png" alt="Dashboard with PNL, fee, win rate and trade count cards" width="100%" />

### Performance and PNL calendar

A cumulative PNL chart with daily bars (week, month or year view) and a calendar that shows the result of every day or month.

<img src="src/public/screenshots/Your_performance_trading.png" alt="Cumulative PNL chart and daily PNL calendar" width="100%" />

### Trading costs and volume

See what trading actually costs you: total fees, fee rate against volume, and a split by exchange and by Spot / Futures.

<img src="src/public/screenshots/analyze_fee_and_volume.png" alt="Fees and trading volume by exchange" width="100%" />

Compare fees and volume across exchanges, market types and periods on one chart.

<img src="src/public/screenshots/Trading_data-comparison.png" alt="Fee and volume comparison chart across exchanges" width="100%" />

### Recent trades

The latest executed trades with side, price, size, value and realized PNL, filterable by exchange and market type.

<img src="src/public/screenshots/Recent_trades.png" alt="Recent executed trades table" width="100%" />

### Exchange connections

Each connected account shows its status, last sync, and key type (HMAC secret or RSA / Ed25519 private key). Syncs run in the background with a cooldown between runs.

<img src="src/public/screenshots/connect_and_sync_successfully.png" alt="Five connected exchange accounts after a successful sync" width="100%" />

### Demo trading

A futures sandbox on live prices: market and limit orders, cross or isolated margin, leverage from 1x to 200x, take profit and stop loss, and a 0.1% simulated fee. Positions, open orders, order history and trade history update as prices move.

<img src="src/public/screenshots/Demo_trading.png" alt="Demo trading with chart, order panel and open position" width="100%" />

### AI assistant

Ask about your trades, PNL and the market. The assistant calls tools that read your trade history and PNL stats, live market quotes and crypto news, and streams the answer back. Bring your own key for OpenRouter, Gemini, OpenAI, Anthropic or xAI and pick the model and reasoning effort per message.

<img src="src/public/screenshots/AI.png" alt="AI assistant chat with model picker" width="100%" />

### Settings

Profile and avatar, password, connected exchanges, and AI provider keys. Provider keys are verified before saving, encrypted at rest, and never shown again.

<p align="center">
  <img src="src/public/screenshots/Settings.png" alt="Settings page with AI provider keys" width="560" />
</p>

## Supported exchanges

| Exchange | Credentials | Max history per sync |
|---|---|---|
| Binance | API key + Ed25519 / RSA private key | 180 days |
| Bybit | API key + RSA private key | 180 days |
| OKX | API key + secret + passphrase | 90 days |
| Bitget | API key + passphrase + RSA private key | 90 days |
| Gate.io | API key + secret | 90 days |

> [!IMPORTANT]
> Create keys with **read permission only**. Keys with trade, withdraw or transfer permission are rejected.
> Do **not** enable an IP whitelist on the key: PnLens calls the exchange from its own servers, so a key locked to your home IP may be refused.

## Security model

- **Read-only enforcement.** On connect, PnLens asks each exchange for the key's permissions and refuses anything beyond read access.
- **Encryption at rest.** API keys, secrets, passphrases and AI provider keys are encrypted with AES-256-GCM before they reach the database. The master key lives only in server environment variables.
- **Row-level security.** Every user table in Supabase Postgres is protected by RLS. Background scans use the service role on the server only.
- **Server-side sessions.** Supabase Auth (email/password and Google OAuth) with route protection in Next.js middleware.

## Tech stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router, Route Handlers, `after()` background work) |
| Language | TypeScript (strict) |
| UI | React 18, Tailwind CSS 3, Lucide icons |
| Charts | Recharts, Lightweight Charts, TradingView widget |
| State and forms | TanStack Query, Zustand, React Hook Form, Zod |
| Data and auth | Supabase Postgres, Auth, Storage, Realtime |
| AI | Bring-your-own-key: OpenRouter, Gemini, OpenAI, Anthropic, xAI |
| Testing | Vitest |
| Hosting | Ubuntu VM behind Caddy (HTTPS), Supabase |

## Roadmap

| Area | Item | Status |
|---|---|---|
| AI | Smarter market news: curated sources and exchange announcements, with every answer citing source and time | ![In progress](https://img.shields.io/badge/In_progress-orange) |
| AI | More providers and the latest models, with a capability badge per model | ![Soon](https://img.shields.io/badge/Soon-blue) |
| AI | Custom instructions and reusable analysis skills (weekly review, portfolio health check) | ![Planned](https://img.shields.io/badge/Planned-lightgrey) |
| AI | Strategy what-if: replay your own trades under rules like "stop after 2 losses a day" | ![Planned](https://img.shields.io/badge/Planned-lightgrey) |
| AI | Opt-in weekly report by email and alerts on unusual drawdown or overtrading | ![Pending](https://img.shields.io/badge/Pending-yellow) |
| Exchanges | More centralized exchanges and brokers | ![Planned](https://img.shields.io/badge/Planned-lightgrey) |
| Data | Export trade history and PNL to CSV / Excel | ![Soon](https://img.shields.io/badge/Soon-blue) |

Have a request? [Get in touch](#contact).

## Documentation

- [Architecture](ARCHITECTURE.md): system overview, request flow, sync pipeline, PNL engine and data model.
- [Contributing](CONTRIBUTING.md): local setup, checks, code guidelines and pull requests.

## Contact

Found a bug, have a question, or need the database schema to run PnLens locally? Reach out:

<p>
  <a href="mailto:thaikhang1410@gmail.com"><img src="https://img.shields.io/badge/Email-EA4335?style=for-the-badge&logo=gmail&logoColor=white" alt="Email" /></a>
  <a href="https://t.me/Dui1410"><img src="https://img.shields.io/badge/Telegram-26A5E4?style=for-the-badge&logo=telegram&logoColor=white" alt="Telegram" /></a>
  <a href="https://x.com/duionchain"><img src="https://img.shields.io/badge/X-000000?style=for-the-badge&logo=x&logoColor=white" alt="X" /></a>
</p>


Please report security issues privately through one of these channels instead of opening a public issue.

## License

[MIT](LICENSE)
