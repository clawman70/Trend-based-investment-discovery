# Trend-Based Investment Discovery Engine

A Bloomberg-style research terminal. You describe a market trend in plain English. The app then:

1. **Researches** emerging cross-domain trends (Claude with live web search).
2. **Analyzes** a thesis (maturity, TAM, catalysts, risks).
3. **Discovers** publicly traded companies that fit it (Claude).
4. **Validates** every AI-suggested ticker against real US exchange listings and drops anything unlisted.
5. **Enriches** the survivors with live price, market cap, P/E, debt-to-equity and 1Y/5Y price growth.
6. **Scores** and ranks them, and lets you save them to a watchlist and portfolios.

> **Data integrity rule:** every number on screen is real or shown as **N/A**. The app never fills gaps with made-up values. Placeholder data exists only when you explicitly turn on `DEMO_MODE`, and it is labeled **DEMO** everywhere it appears.

---

## Data Sources

| What | Source | Notes |
|------|--------|-------|
| AI analysis, discovery, research, sentiment | Claude (`claude-sonnet-5` by default) | Model is configurable with `CLAUDE_MODEL`. Research scans use the `web_search` tool; every citation is cross-checked against a real search result before it's shown — see `src/lib/claudeService.ts`. |
| Ticker validation (hallucination gate) | Finnhub `/stock/symbol` (free) | Accepts NASDAQ, NYSE, NYSE American, NYSE Arca, Cboe BZX. Rejects OTC, ETFs, warrants, units. Cached 24h. |
| Live price | Finnhub `/quote` (free) | Cached 5 min |
| Market cap, P/E, revenue growth, debt/equity, free cash flow (est.) | Finnhub `/stock/metric` (free) | Cached 24h. FCF is derived as market cap ÷ price-to-FCF. |
| Company name, exchange, industry, website | Finnhub `/stock/profile2` + symbol directory | |
| Description, sector, industry, CEO | Yahoo Finance via `yahoo-finance2` | Unofficial source. If it fails, fields show N/A. |
| 1Y / 5Y price growth | Yahoo Finance weekly price history | Falls back to Finnhub 52-week return for 1Y |
| News | Finnhub `/company-news` (last 14 days) | |
| Peers | Finnhub `/stock/peers` | Up to 8 peers |

**Finnhub free-tier budget:** 60 calls/minute. All Finnhub calls share one rate limiter (capped at 55/min), so a big discovery run (25+ companies) may pause briefly instead of failing.

---

## Setup

### 1. Install dependencies
Requires **Node.js 22+** (needed by `yahoo-finance2` v4).
```bash
npm install
```

### 2. Add API keys
Copy `.env.example` to `.env.local` and fill in:

| Variable | Required | What it's for |
|----------|----------|---------------|
| `ANTHROPIC_API_KEY` | Yes | All AI features. Get it at [platform.claude.com](https://platform.claude.com). |
| `FINNHUB_API_KEY` | Yes | Ticker validation, prices, fundamentals, news, peers. Get it at [finnhub.io/register](https://finnhub.io/register). |
| `CLAUDE_MODEL` | No | Override the AI model (default `claude-sonnet-5`) |
| `DEMO_MODE` | No | `true` = serve clearly-labeled placeholder data when you have no keys |

**What happens when a key is missing (and `DEMO_MODE` is off):**
- **No Finnhub key:** a red banner says tickers weren't verified. Prices and fundamentals return a clear error, and the details window shows an error instead of fake data.
- **No Claude key:** discovery and research return an error, and news sentiment shows "unavailable".

### 3. Set up persistence (optional but recommended)
Without a database the app still runs — the watchlist, portfolios, history and research scans just live in memory and reset every time the server restarts. To make them stick:

```bash
npm run db:up       # starts Postgres via Docker Compose (Docker Desktop must be running)
npm run db:migrate   # creates the tables
```

`.env.example` already has the matching `POSTGRES_PRISMA_URL` / `POSTGRES_URL_NON_POOLING` for this local database — copy them into `.env.local` if you haven't already. For a production deploy, point those two variables at a real Postgres instance (Vercel Postgres or [Neon](https://neon.tech) both work) and run `npm run db:deploy` once instead.

**How the fallback works:** every request checks whether Postgres is reachable. If it is, data is read from and written to Postgres. If it isn't (no `POSTGRES_PRISMA_URL`, or the database is down), the app falls back to in-memory storage automatically — no errors, no restart needed, it just won't remember anything past the current server process. You'll see `[DB] Postgres unavailable, falling back to in-memory store` in the server log when this happens.

### 4. (Optional) Password-protect the app
Off by default. Set `APP_PASSWORD` in `.env.local` (and optionally `APP_USERNAME`, default `admin`) before deploying anywhere public — your browser will show a native login prompt for the whole app, API included.

### 5. Run
```bash
npm run dev
```
Open http://localhost:3000.

---

## Tests & Checks

```bash
npx vitest run
```
```bash
npx tsc --noEmit
```
```bash
npm run lint
```

The tests mock every external API and the database, so they run offline and cost nothing.

---

## Project Structure

```text
├── Documents/                         # Requirements, specs, improvement plan (source of truth)
├── docker-compose.yml                 # Local Postgres for dev (npm run db:up)
├── prisma/schema.prisma               # Database schema
├── prisma.config.ts                   # Prisma CLI connection config (migrate/generate)
├── src/
│   ├── middleware.ts                  # Optional APP_PASSWORD gate (whole app, incl. API)
│   ├── app/
│   │   ├── api/
│   │   │   ├── analyze-trend/         # Claude trend diagnostics
│   │   │   ├── discover/              # Claude discovery + hallucination gate
│   │   │   ├── enrich/                # Live price, fundamentals, growth, exchange
│   │   │   ├── company-details/       # Details window: profile + fundamentals + AI value chain
│   │   │   ├── news/                  # Finnhub headlines + Claude sentiment
│   │   │   ├── peers/                 # Finnhub peer comparison
│   │   │   ├── research/              # Claude research scans (web_search tool)
│   │   │   ├── validate-ticker/       # Ticker validation endpoint
│   │   │   └── watchlist/ portfolios/ history/ score/   # Saved items + composite scoring
│   │   └── page.tsx                   # Main dashboard
│   ├── components/                    # UI (ResultsTable, DetailsModal, ValidationAlerts, ...)
│   └── lib/
│       ├── finnhubService.ts          # Rate-limited Finnhub client + metric normalization
│       ├── yahooService.ts            # Yahoo price history + company profile
│       ├── tickerValidator.ts         # Hallucination gate (Finnhub symbol directory)
│       ├── claudeService.ts           # Claude prompts, structured outputs, web search grounding
│       ├── demoData.ts                # DEMO_MODE placeholder fixtures (labeled)
│       ├── scoring.ts                 # Composite score
│       ├── prisma.ts                  # Prisma client (Postgres, driver adapter)
│       ├── dbHelper.ts                # isDbAvailable() + TTL cache (Postgres, falls back to memory)
│       ├── memoryStore.ts             # In-memory fallback storage
│       ├── stores/                    # One module per resource: Postgres if available, else memory
│       │   ├── historyStore.ts / watchlistStore.ts / portfolioStore.ts / researchStore.ts
│       └── types.ts
└── v1_backup/                         # Original v1 code
```

---

## Known Limitations

See `Documents/Improvement-Plan-2026-09.md` for the full roadmap.

- **The composite score still weights "data availability"** in its health factor. Reweighting is Phase 3.
- **The market-cap filter is passed to the AI but not enforced** against real market cap yet (Phase 3).
- **Research citations are written by the model**, not taken from grounding metadata, so verify links (Phase 3).
- **The app password gate is a deterrent, not compliance-grade auth.** No rate limiting, no audit log, no per-user accounts — fine for a personal tool, not for anything handling other people's data.
- **Portfolio→watchlist links have a real foreign key on the portfolio side only.** Deleting a watchlist item that's linked to a portfolio never fails, it just quietly drops from that portfolio's view — same behavior with or without Postgres.
