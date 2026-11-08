# System Architecture

## Overview

PnLens follows a layered architecture that separates presentation, business logic, domain processing, and infrastructure integrations. This design improves maintainability, scalability, and testability.

### Architecture

```mermaid
flowchart LR
  U[User Client]
  M[Next.js Middleware]
  A[API Routes]
  S[Domain Services]
  E[Domain Engines]
  DB[(Supabase Postgres)]
  ST[(Supabase Storage)]
  EX[Exchange APIs]
  LLM[LLM APIs]

  U --> M --> A
  A --> S
  S --> E
  S --> DB
  S --> ST
  S --> EX
  S --> LLM
```

## Core Layers

### Presentation Layer

Responsible for user interaction and data visualization.

**Main directories**

```text
src/app
src/components
```

**Responsibilities**

* Dashboard and analytics UI
* Demo trading interface
* AI chat interface
* User profile management
* Authentication flows

---

### Application Layer

Acts as the entry point for requests and coordinates business operations.

**Main directory**

```text
src/app/api
```

**Responsibilities**

* Request validation
* Authentication and authorization
* Session handling
* Service orchestration

---

### Domain Layer

Contains the core business logic of the platform.

**Main directories**

```text
src/lib/services
src/lib/engines
```

**Responsibilities**

* PNL calculation
* Portfolio aggregation
* Demo trading execution
* Exchange synchronization
* AI workflow orchestration

---

### Infrastructure Layer

Handles communication with external systems and data sources.

**Main directories**

```text
src/lib/db
src/lib/adapters
```

**Responsibilities**

* Database access
* Exchange integrations
* AI provider integrations
* File storage management

---

## Core Modules

### Authentication & Security

Manages user authentication, authorization, and protected routes.

### Portfolio & PNL Analytics

Aggregates trading data from multiple exchanges and calculates performance metrics.

### Exchange Integration

Synchronizes balances, positions, and trade history from supported exchanges.

### Demo Trading Engine

Provides a risk-free trading environment with realistic order execution and PNL simulation.

### AI Assistant

Implements an agentic AI workflow with:

* Retrieval-Augmented Generation (RAG)
* Tool Calling
* Market Data Retrieval
* Crypto News Retrieval
* Conversation Memory
* Real-time Streaming (SSE)

```mermaid
sequenceDiagram
  autonumber
  participant user as User
  participant ui as Web Interface
  participant system as System
  participant orchestrator as AI Orchestrator

  user->>ui: Submit a question
  ui->>system: POST /api/ai/chat
  system->>system: Authenticate request and validate payload
  system->>orchestrator: Initialize or resume conversation

  loop Response Streaming
    orchestrator-->>system: Content chunks and tool events
    system-->>ui: SSE event
    ui-->>user: Update response in real time
  end

  orchestrator-->>system: Response completed
  system-->>ui: SSE completed
  ui-->>user: Display final response
```

### User Profile Management

Handles account settings, avatars, exchange connections, and synchronization preferences.

---

## Data Flow

```mermaid
sequenceDiagram
  autonumber
  participant user as User
  participant ui as Web Interface
  participant system as System
  participant engine as PNL Engine

  user->>ui: Access dashboard and connect exchange accounts
  ui->>system: Request overview, summary, charts, calendar, and assets
  system->>engine: Aggregate PNL data based on selected filters
  engine-->>system: Return metrics, time-series data, and asset allocation
  system-->>ui: Dashboard JSON response
  ui-->>user: Render cards, charts, and PNL calendar
```

Typical workflow:

1. User interacts with the web application.
2. Requests pass through the application layer.
3. Business logic is processed by domain services and engines.
4. Data is retrieved from databases or external providers.
5. Results are aggregated and returned to the user interface.

