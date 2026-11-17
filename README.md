# PnLens Documentation

The platform enabling crypto traders to track PNL across multiple centralized exchanges, simulate risk-free trading, and receive strategic advice via an integrated AI assistant.

<img width="869" height="467" alt="image" src="https://github.com/user-attachments/assets/b4a728ec-e0d8-44e9-9674-f1d79cb619b7" />

---

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Tech Stack](#tech-stack)
- [Supported Exchanges](#supported-exchanges)
- [Documentation](#documentation)

---

## Overview

PnLens addresses the challenge of fragmented trading data by aggregating PNL from multiple Centralized Exchanges (CEXs) into a single interface. The platform also provides a risk-free demo trading environment and an AI assistant powered by advanced LLMs.

**Target Audience:** Multi-exchange crypto traders (Binance, OKX, Bybit, Bitget, Gate.io) seeking automated PNL tracking, strategy simulation, and AI-driven market insights.

---

## Key Features

### Dashboard
- **Exchange Connectivity:** Connect accounts via read-only API keys.
- **Data Normalization:** Fetch and standardize closed trade history across supported exchanges.
- **PNL Calculation:** Calculate realized PNL per trade and aggregate by timeframes (Day / Week / Month / Year / All-time).
- **Performance Metrics:** Display win rate, total trade count, and portfolio balance per exchange.
- **PNL Calendar:** Heatmap calendar visualizing daily/monthly profits with historical navigation.
- **Visual Analytics:** PNL trend charts and data visualization via Recharts.
- **Unified Portfolio:** Total aggregated balance converted to USD equivalent.

<img width="1000" height="400" alt="image" src="https://github.com/user-attachments/assets/6c53a64d-c0fe-4e30-ae66-b457b7c01330" />
<img width="300" height="350" alt="image" src="https://github.com/user-attachments/assets/765973e8-45a1-40c0-9cd7-6631d76ff4c3" />
<img width="500" height="350" alt="image" src="https://github.com/user-attachments/assets/23b9adff-598d-4fbe-a9cb-6fea56eb1fea" />

### Demo Trading
- **Integrated Charts:** Embedded TradingView widget with live candlestick data.
- **Order Simulation:** Support for Market and Limit orders in a sandbox environment.
- **Position Management:** Real-time Open Positions dashboard with one-click closing.
- **Historical Logs:** Detailed Order History and Trade History with realized PNL.
- **Virtual Capital:** Default initial balance of 10,000 USD per user.
- **Fee Simulation:** Realistic PNL calculation including a 0.1% simulated trading fee.

<img width="980" height="542" alt="image" src="https://github.com/user-attachments/assets/6452b6ab-db7a-40db-b167-81cce8b58bd4" />

### Ask AI
- **Conversational Interface:** Specialized chat for trading queries, strategy analysis, portfolio review, and PNL interpretation.
- **RAG-Powered Insights:** Retrieves user-specific trade history, positions, and PNL data from Supabase to provide personalized responses.
- **Tool Calling:** Automatically selects and invokes the appropriate data sources when external information is required.
- **Market Intelligence:** Accesses live market quotes and crypto news to enrich analysis and recommendations.
- **Response Synthesis:** Combines retrieved data with LLM reasoning to generate contextual, actionable answers.
- **Real-time Streaming:** Low-latency responses delivered via Server-Sent Events (SSE).
- **LLM Integration:** Compatible with OpenAI, Groq, Anthropic and more models.

<img width="1029" height="667" alt="image" src="https://github.com/user-attachments/assets/51d647d2-b649-43d9-bc0b-9bb34d078ef7" />

### User Profile
- **Account Settings:** Update display name, email, and avatar (hosted on Supabase Storage).
- **Security:** Password management for email-based accounts.
- **API Management:** CRUD operations for connected exchange API keys.
- **Sync Control:** Toggle automated data synchronization for individual exchanges.

### Authentication
- **OAuth Integration:** Google OAuth via Supabase Auth.
- **Standard Auth:** Email/Password authentication via Supabase Auth.
- **Session Handling:** Secure session management via Supabase JWT tokens.
- **Route Protection:** Server-side route enforcement via Next.js middleware.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript 5 (Strict Mode) |
| Styling | TailwindCSS 3 |
| Charts | Recharts 2 + TradingView Widget |
| Forms | React Hook Form 7 + Zod 3 |
| Database | Supabase PostgreSQL |
| Auth | Supabase Auth |
| Storage | Supabase Storage |
| Hosting | Render |
| Package Manager | pnpm |

---

## Supported Exchanges
> [!IMPORTANT]
> All exchange API keys must be set to **read-only**. For security reasons, withdrawal permissions must not be enabled.

<img width="860" height="444" alt="image" src="https://github.com/user-attachments/assets/7b44ab34-e2b0-4561-bf75-6cb1ea4d7ccd" />

| Exchange | Trade History | Balance |
|---|---|---|
| Binance | REST API | REST API |
| OKX | REST API | REST API |
| Bybit | REST API | REST API |
| Bitget | REST API | REST API |
| Gate.io | REST API | REST API |

---

## Documentation

- Architecture: [View](docs/ARCHITECTURE.md)
- Exchange Integration Research: [View](docs/deep-research-report.md) (Technical guide on utilizing REST APIs from various crypto exchanges)
- Local test account: email `pnlens-test@example.com`. Password is `PNLENS_TEST_PASSWORD` in gitignored `src/.env.test-account`. Sign in at `http://localhost:3000/login`. How the account was created, which tables were seeded, and which exchange accounts are connected: `spec/index.md`. Do not commit that password file or `src/.env.local`.
