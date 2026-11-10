# Bybit Read-Only API Integration Guide (Unified V5 REST API)

This document provides a technical specification for binding, verifying, and querying Read-Only API Keys on Bybit using the Unified V5 REST API.


## Cryptographic Authentication Architecture

Bybit supports two API key signing mechanisms. For community-facing applications and SaaS platforms, Self-Generated RSA Keys offer superior key safety.

| Feature / Criteria | System-Generated (HMAC) | Self-Generated (RSA) | Recommendation |
| :--- | :--- | :--- | :--- |
| **Key Pair Generation** | Bybit generates Public & Secret Key | Server generates RSA 2048-bit Pair | **RSA** |
| **Secret Exposure Risk** | Secret Key shown once; user copies it | Private Key never leaves backend server; only Public Key sent to Bybit | **RSA** |
| **API Compatibility** | V3 & V5 | V3 & V5 | Equal |

By employing Self-Generated RSA Keys, end users never handle raw secret keys. Your backend provisions a unique RSA key pair per tenant, sends only the Public Key to Bybit, and keeps the Private Key securely encrypted at rest.


## 1. Authentication & Cryptographic Signing Rules

All private endpoints on Bybit V5 require custom HTTP headers containing authentication credentials, timestamps, reception windows, and signatures.

### Base Endpoint URLs

Bybit routes traffic through dedicated base URLs:

* Mainnet Primary: `https://api.bybit.com` or `https://api.bytick.com`
* Testnet: `https://api-testnet.bybit.com`
* Regional Specific Endpoints: Turkey (`api.bybit.tr`), Kazakhstan (`api.bybit.kz`), Georgia (`api.bybitgeorgia.ge`), UAE (`api.bybit.ae`), EEA (`api.bybit.eu`), Hong Kong (`api.spark-fintech.com`), Japan (`api.manepa.jp`).

> Note: Requests originating from IP addresses located in the United States or Mainland China will be rejected with HTTP status code `403 Forbidden`.

### HTTP Request Headers

Authenticated HTTP requests must include:

| Header Name | Type | Mandatory | Description |
| :--- | :--- | :--- | :--- |
| `X-BAPI-API-KEY` | String | Yes | API key issued by Bybit |
| `X-BAPI-TIMESTAMP` | String | Yes | UTC timestamp in milliseconds |
| `X-BAPI-SIGN` | String | Yes | Signature string generated via RSA-SHA256 (Base64) or HMAC-SHA256 (Hex) |
| `X-BAPI-RECV-WINDOW` | String | No | Valid time window in milliseconds (default: 5000, max: 60000) |

### Signature Rules

The pre-hash string concatenation rule:
* GET Requests: `timestamp + api_key + recv_window + queryString`
* POST Requests: `timestamp + api_key + recv_window + jsonBodyString`

Timestamp validation rule:
`server_time - recv_window <= timestamp < server_time + 1000`

Client servers must keep system clocks synchronized via NTP.


## 2. Step-by-Step RSA Read-Only Integration Workflow

1. **Generate Key Pair on Backend**: Generate an RSA 2048-bit key pair on your application backend.
2. **Register API Key on Bybit Console**:
   * Navigate to Bybit API Management.
   * Choose Auto-generated API Keys (RSA Encryption).
   * Paste the RSA Public Key.
   * Set Permission Type to Read-Only (`Enable Reading`).
   * Bind server static outbound IP address.
   * Ensure order placement, trading, withdrawal, and transfer rights remain unchecked.
   * Save and obtain the generated API Key.


## 3. Programmatic Verification of Read-Only Permissions

Your backend must programmatically inspect API key permissions before storing the key or running balance syncs. If an API key possesses trade or withdrawal permissions, the system must reject it immediately.

### Endpoint: Query API Key Information

* HTTP Method: `GET`
* Endpoint Path: `/v5/user/query-api`
* Security Type: Signed

#### Request Example

```http
GET /v5/user/query-api HTTP/1.1
Host: api.bybit.com
X-BAPI-API-KEY: xxxxxxxxxxxxxxxxxx
X-BAPI-TIMESTAMP: 1710000000000
X-BAPI-RECV-WINDOW: 5000
X-BAPI-SIGN: <Base64_Signature>
```

#### Verification Rules

| Field Path | Required Value | Action |
| :--- | :--- | :--- |
| `result.readOnly` | `1` | Reject key if `0` |
| `result.permissions` | No write permissions | Reject key if write rights exist |
| `result.ips` | Contains server egress IP | Alert user if IP binding missing |


## 4. Complete Read-Only Endpoint Directory for PnL & Balance Reconciliation

To accurately track account balances, trade history, fees, funding payments, and realized/unrealized Profit and Loss (PnL), query the following official Bybit V5 REST endpoints:

### Endpoint Summary Table

| Category | HTTP Method | Endpoint Path | Key Query Parameters | Description |
| :--- | :--- | :--- | :--- | :--- |
| **System** | `GET` | `/v5/market/time` | *None* | Get Bybit server timestamp |
| **Permission** | `GET` | `/v5/user/query-api` | *None* | Verify API key permissions and IP restrictions |
| **Account** | `GET` | `/v5/account/wallet-balance` | `accountType=UNIFIED`, `coin=BTC,USDT` | Query total equity, wallet balance, and margin equity |
| **Positions** | `GET` | `/v5/position/list` | `category=linear` / `inverse` / `option`, `settleCoin=USDT` | Get active position risk, mark price, leverage, and unrealized PnL |
| **Trades** | `GET` | `/v5/execution/list` | `category=spot` / `linear` / `inverse`, `startTime`, `endTime`, `limit=100` | Fetch trade fills including fee rates, fill prices, and quantities |
| **Orders** | `GET` | `/v5/order/history` | `category=spot` / `linear`, `startTime`, `endTime`, `limit=50` | Retrieve completed and canceled historical orders |
| **Closed PnL** | `GET` | `/v5/position/closed-pnl` | `category=linear` / `inverse`, `startTime`, `endTime`, `limit=100` | Retrieve realized PnL per closed position record |
| **Ledger / Logs**| `GET` | `/v5/account/transaction-log` | `accountType=UNIFIED`, `type=REALIZED_PNL` / `FUNDING_FEE` / `TRADE` | Complete ledger of cash flows, funding fees, and realized PnL |
| **Fee Rates** | `GET` | `/v5/account/fee-rate` | `category=spot` / `linear`, `symbol=BTCUSDT` | Get account maker and taker fee tier rates |


## 5. Accounting & PnL Calculation Methodology

Calculating accurate financial performance metrics from exchange records requires isolating genuine trading events from capital movements.

### Key Calculation Principles

1. **Transaction History as Ground Truth**: Base all PnL calculations on execution logs (`/v5/execution/list` and `/v5/account/transaction-log`). Do not calculate PnL merely from balance delta changes.
2. **Capital Isolation**: Deposits, withdrawals, internal account transfers, and bonus distributions are capital flows, **not trading PnL**.
3. **PnL Segregation**:
   * **Realized PnL**: Actualized profit/loss upon position close or order fill, net of fees.
   * **Unrealized PnL**: Paper profit/loss on open positions based on current Mark Price.
4. **Day boundary**: Bybit request timestamps stay Unix milliseconds. PnLens daily, weekly, monthly, and yearly aggregates use Vietnam time, fixed UTC+7, from `APP_UTC_OFFSET_MINUTES = 420` (`spec/features/pnl-day-boundary.md`). They do not use UTC midnight and they do not use the server's local zone.

### Module-Specific PnL Rules

#### Spot Market Accounting
* **Execution Formula**: Realized PnL = Total Proceeds - Total Cost Basis - Trading Fees.
* **Cost Basis Method**: Implement First-In, First-Out (FIFO) or Weighted Average Cost (WAC) based on chronological fills from `GET /v5/execution/list?category=spot`.

#### Derivatives & Perpetual Futures Accounting
* **Realized PnL Components**:
Net Realized PnL = Closed Position PnL - Trading Fees - Funding Fees - Liquidation Penalties
* **Query Sources**:
  * Closed Position PnL: `GET /v5/position/closed-pnl?category=linear`
  * Funding Fees & Cash Adjustments: `GET /v5/account/transaction-log?accountType=UNIFIED&type=FUNDING_FEE`
  * Executed Trades & Commissions: `GET /v5/execution/list?category=linear`

#### Margin & Borrowing
* Interest payments on borrowed assets are queried via `GET /v5/account/transaction-log?type=INTEREST` and subtracted from net profit.

---

## 6. Security & Operational Best Practices

When managing Read-Only API keys across a community or multi-tenant system, adhere to the following enterprise security guidelines:

### Private Key Isolation & Encryption at Rest

* **Encrypted Storage**: Encrypt RSA Private Keys at rest using AES-256-GCM or cloud Key Management Systems (KMS / Vault).
* **Database Separation**: Store private keys in an isolated, restricted database schema separate from regular user metadata.
* **Zero Logging Policy**: Ensure application loggers scrub private keys, authorization headers, and raw signature strings.
* **Backend Processing Only**: Never return or transmit the RSA Private Key to the frontend or mobile client.

### Rate Limiting & Network Resilience

Bybit V5 REST API enforces rate limits per User ID and Endpoint Category:

* **Header Metrics**: Inspect response headers `X-Bapi-Limit`, `X-Bapi-Limit-Status`, and `X-Bapi-Limit-Reset-Timestamp`.
* **Handling HTTP 429**: Upon receiving HTTP `429 Too Many Requests`, pause calls until the reset timestamp specified in `X-Bapi-Limit-Reset-Timestamp`.
* **Data Expiration Backups**: Historical REST API queries are bounded by time windows. Provide CSV file import capabilities using Bybit's **Download Center** for historical data prior to the API lookback limit.

### User Data Privacy Warning

> **Privacy Alert**: A Read-Only API Key permits viewing complete asset balances, active positions, open orders, and full historical transaction logs. Treat all synced exchange data as **highly sensitive personal financial information**.

---

## Summary Checklist for Integration

* [x] **Generate RSA-2048 Key Pair** on secure backend.
* [x] **Bind API Key with Read-Only Rights** and server static IP.
* [x] **Query `/v5/user/query-api`** and reject keys with `readOnly != 1` or write rights.
* [x] **Synchronize Server Time** using `/v5/market/time` and NTP.
* [x] **Reconcile PnL** using `/v5/execution/list`, `/v5/position/closed-pnl`, and `/v5/account/transaction-log`.
* [x] **Encrypt Keys at Rest** using AES-256-GCM.


