# Trend-Based Investment Discovery Engine — v2.0 Requirements

## Project Overview

**What it is:** A tool that lets an investor describe emerging market trends in natural language, discovers publicly traded companies aligned with those trends, enriches them with real financial data, and scores/ranks them for investment potential.

**What v1 got right:** The core loop — trend input → AI discovery → financial enrichment → sortable table with CSV export. That pipeline is the product.

**What v1 got wrong:** Fake analyst data presented as real, no ticker validation, hardcoded API keys, silent mock data fallback, no persistence, single-trend-only analysis, and no way to assess trend quality before seeing companies.

**v2 goal:** Make every data point trustworthy, add multi-trend convergence as the killer differentiator, introduce scoring and persistence, and build it on a real stack that can grow.

---

## v1 Audit — Issues to Resolve

| Issue | Severity | Resolution |
|-------|----------|------------|
| Analyst consensus & target price are randomly generated | **Critical** | Remove or source from real API (FMP upgrade, or Alpha Vantage / Polygon.io) |
| FMP API key hardcoded in source | **Critical** | Move to server-side env var; never expose in client bundle |
| Mock data fallback is silent — user can't tell real from fake | **High** | Add `dataSource: 'live' \| 'unavailable'` flag per company row; style accordingly |
| No ticker validation — Gemini can hallucinate tickers | **High** | Validate every ticker against exchange listing API before enrichment |
| No persistence — searches are fire-and-forget | **Medium** | Add search history with saved results |
| Single trend only — no convergence analysis | **Medium** | Core v2 feature (see below) |
| No trend quality assessment | **Medium** | Add trend analysis phase before company discovery |

---

## Architecture Decisions

### Stack

- **Framework:** Next.js 15 (App Router)
- **Styling:** Tailwind CSS
- **Database:** Vercel Postgres (Neon-backed) + Prisma
- **Deployment:** Vercel (production and preview), local dev via `next dev`
- **AI Model:** Gemini 2.5 Flash (via `@google/genai`) — keep what works
- **Financial Data:** FMP free tier as baseline; supplement with free-tier sources (Yahoo Finance unofficial API, Alpha Vantage free tier at 25 req/day). Evaluate paid upgrades only if free sources prove insufficient for core metrics. This is a hobby tool — optimize for free first.
- **Auth:** None. Single-user tool, no plans to distribute. Skip entirely.

### Key Architectural Shift

v1 is a pure client-side app — API keys ship in the browser bundle. v2 moves all API calls server-side via Next.js Route Handlers. The client becomes a thin UI layer that talks to your own API routes, which proxy to Gemini and financial data providers. This fixes the credential exposure problem and opens the door for server-side caching, rate limiting, and database persistence.

No Docker — local dev runs via `next dev` against a Vercel Postgres dev branch or a local `.env` pointing to the Neon connection string. Production deploys to Vercel.

### Caching Strategy

Usage pattern is monthly — Jeff runs this when surplus cash shows up in his accounts and he wants to take a position. That means the FMP free tier (250 req/day) is more than sufficient as long as we're not re-fetching data we already have.

Cache rules:
- **Financial data (price, market cap, growth):** Cache for 7 days per ticker. A company's fundamentals don't change meaningfully week to week.
- **Ticker validation:** Cache indefinitely (or until manually cleared). A valid NYSE listing doesn't become invalid overnight.
- **Trend analysis (Gemini):** Cache for 30 days per trend string. The AI's assessment of a trend's maturity and catalysts doesn't shift daily.
- **Discovery results (Gemini):** Cache for 7 days per trend + filter combination. New companies don't emerge in a sector overnight.

Cache is stored in Vercel Postgres alongside the search history — same database, separate table. On each run, check cache first; only call external APIs for stale or missing data. This means a second run on the same trend within a week costs zero API calls.

Cache can be manually busted from the UI ("Refresh Data" button) if Jeff wants fresh numbers on a specific search.

---

## Feature Specifications

### Phase 1: Foundation (Fix What's Broken)

#### 1.1 — Server-Side API Layer

Move all external API calls behind Next.js Route Handlers:

- `POST /api/discover` — accepts trend + filters, calls Gemini, returns validated company list
- `POST /api/enrich` — accepts ticker list, calls FMP, returns financial data
- `GET /api/validate-ticker?symbol=XXX` — checks ticker against exchange listing

All API keys stored in `.env.local`, never exposed to the client.

#### 1.2 — Ticker Validation Pipeline

After Gemini returns its company list, before enrichment:

1. Batch-validate all tickers against FMP's `/api/v3/stock/list` or similar endpoint
2. Drop any ticker that doesn't resolve to an active listing
3. Return validation status to client: `{ valid: [...], invalid: [...] }`
4. Show the user which (if any) AI-suggested tickers were dropped and why

#### 1.3 — Data Integrity Flags

Every `CompanyData` record gets a `dataQuality` field:

```typescript
interface DataQuality {
  priceSource: 'live' | 'unavailable';
  growthSource: 'calculated' | 'insufficient_history' | 'unavailable';
  analystSource: 'live' | 'unavailable';  // only 'live' if using a real source
}
```

The UI renders rows differently based on quality — faded or flagged rows for incomplete data. No more silent random numbers.

#### 1.4 — Remove Fake Data

Analyst consensus and target price columns are **removed** unless a real data source is integrated. Better to show 6 real columns than 8 columns where 2 are lies.

If FMP's paid tier or another provider offers real analyst estimates, add them back with the `analystSource: 'live'` flag. Until then, they don't exist.

---

### Phase 2: Intelligence Layer (Make It Smart)

#### 2.1 — Trend Analysis Phase

Before discovering companies, run a trend assessment. The user enters a trend, hits "Analyze," and gets:

- **Maturity Stage:** Nascent → Emerging → Growth → Established → Declining
- **Estimated TAM:** Order-of-magnitude market size
- **Key Catalysts:** What would accelerate this trend (regulatory, technological, market)
- **Key Risks:** What could kill or stall it
- **Time Horizon:** When this trend likely hits mainstream adoption
- **Adjacent Trends:** Related themes the user might also want to explore

This gives the user conviction context before they commit to a company search. It also becomes the foundation for multi-trend convergence scoring.

Endpoint: `POST /api/analyze-trend`

UI: A "Trend Report Card" panel that appears after analysis, before company discovery. The user can proceed to discovery or refine their thesis.

#### 2.2 — Multi-Trend Convergence (The Killer Feature)

Allow the user to enter 2-3 trends simultaneously. The system:

1. Runs discovery for each trend independently
2. Identifies companies that appear across multiple trends
3. Assigns a **Convergence Score** — companies found in 3/3 trends score highest
4. Ranks results with convergence as the primary sort

This is where the real value is. A company that sits at the intersection of "edge AI inference" AND "autonomous vehicles" AND "custom silicon" is a fundamentally different signal than one that just appears in a single trend search.

Data model:

```typescript
interface ConvergenceResult {
  company: CompanyData;
  trendsMatched: string[];          // which trends flagged this company
  convergenceScore: number;          // 1.0 = appeared in all trends
  rationales: Record<string, string>; // rationale per trend
}
```

UI: A convergence view that shows a Venn-style overlap visualization (or simpler: a table with trend-match columns) and highlights the companies in the intersection.

#### 2.3 — Composite Scoring Engine

Each company gets a composite score built from weighted factors:

| Factor | Source | Default Weight |
|--------|--------|---------------|
| Trend Relevance | Gemini rationale strength (AI-scored 1-10) | 25% |
| Convergence | Multi-trend overlap count | 25% |
| Growth Trajectory | 1Y and 5Y price growth | 20% |
| Valuation | Price vs. target (if available), P/E, market cap tier | 15% |
| Financial Health | Debt-to-equity, revenue growth, margins | 15% |

The user can adjust weights via sliders to match their investment style (growth-heavy, value-heavy, convergence-heavy).

Endpoint: `POST /api/score` — accepts enriched company data + weight config, returns scored/ranked list.

---

### Phase 3: Persistence & Tracking

#### 3.1 — Search History

Store every search with:

- Timestamp
- Trend(s) entered
- Filters applied
- Results returned (snapshot)
- Any user-added notes

Database table: `searches`

UI: A sidebar or dedicated "History" page showing past searches, sortable by date. Click to reload results.

#### 3.2 — Watchlist

Users can star/bookmark individual companies from any search result. Watchlisted companies:

- Appear in a dedicated "Watchlist" view
- Show current price alongside the price when they were added (fetched on-demand when the watchlist is opened, not on a schedule)
- Display performance since added (gain/loss %)
- Can be grouped by trend or manually tagged

Database tables: `watchlist_items`, `watchlist_tags`

#### 3.3 — Trend Portfolios

Group saved companies into named "trend portfolios" — a collection of companies tied to a thesis. Track aggregate performance of the portfolio over time.

---

### Phase 4: Enhanced Data (Stretch)

#### 4.1 — Deeper Financial Metrics

Add to the enrichment pipeline (as API tier allows):

- P/E Ratio (trailing and forward)
- Revenue growth (YoY)
- Debt-to-equity ratio
- Free cash flow
- Insider buying/selling activity (last 90 days)
- Institutional ownership % and recent changes

#### 4.2 — News & Sentiment Layer

For watchlisted or high-scoring companies, pull recent news headlines and run basic sentiment analysis. Surface companies with significant positive or negative news momentum.

#### 4.3 — Sector & Competitor Context

When a company is discovered, also show:

- Its sector/industry classification
- 2-3 direct competitors with comparative metrics
- Where it sits in the value chain for the given trend

---

## Data Model (Core Tables)

```
searches
  id            UUID
  created_at    DateTime
  trends        String[]        // 1-3 trend descriptions
  filters       JSON            // market cap, exchange, price filters
  trend_analysis JSON           // cached trend report card data
  
search_results
  id            UUID
  search_id     UUID → searches
  ticker        String
  company_name  String
  rationale     String
  trend_matched String          // which trend this result came from
  financial_data JSON           // enriched snapshot at time of search
  data_quality   JSON           // DataQuality flags
  composite_score Float
  convergence_score Float

watchlist_items
  id            UUID
  ticker        String
  company_name  String
  added_at      DateTime
  price_at_add  Float
  source_search UUID → searches
  notes         String?
  tags          String[]

trend_portfolios
  id            UUID
  name          String
  description   String?
  created_at    DateTime
  
portfolio_items
  id            UUID
  portfolio_id  UUID → trend_portfolios
  watchlist_id  UUID → watchlist_items

api_cache
  id            UUID
  cache_key     String (unique)   // e.g. "ticker:AAPL", "trend:edge AI inference", "discovery:hash(trend+filters)"
  cache_type    String            // 'financial' | 'validation' | 'trend_analysis' | 'discovery'
  data          JSON
  fetched_at    DateTime
  expires_at    DateTime          // 7 days for financial/discovery, 30 days for trend analysis, never for validation
```

---

## UI/UX Direction

### Design Philosophy

The current v1 has a dark theme with green accents — functional but generic. v2 should feel like a **professional research terminal** — think Bloomberg meets a modern analytics dashboard. Dense but not cluttered. Data-forward with clear visual hierarchy.

### Key UI Components

- **Trend Input Panel** — Multi-field (up to 3 trends), with a "quick examples" dropdown for inspiration
- **Trend Report Card** — Compact analysis card showing maturity, TAM, catalysts, risks before discovery
- **Discovery Results Table** — Sortable, filterable, with data quality indicators and convergence highlighting
- **Convergence View** — Visual representation of trend overlap; companies in the intersection are highlighted
- **Scoring Sliders** — Adjustable weight panel for the composite score
- **Watchlist Sidebar** — Persistent panel showing bookmarked companies with live price updates
- **Search History** — Accessible from nav; click to reload any past search

### Responsive Behavior

Desktop-first (this is a research tool), but table should scroll horizontally on tablet. Mobile is deprioritized but shouldn't break.

---

## Build Plan

### Phase 1 — Foundation (Week 1-2)
1. Scaffold Next.js project with Tailwind, Prisma, Vercel Postgres
2. Build Route Handlers for `/api/discover`, `/api/enrich`, `/api/validate-ticker`
3. Migrate Gemini integration to server-side
4. Implement ticker validation pipeline
5. Add data quality flags to enrichment
6. Remove fake analyst data columns
7. Build basic UI (trend input → results table)
8. Write tests for API routes and validation logic
9. Deploy to Vercel

### Phase 2 — Intelligence (Week 3-4)
1. Build trend analysis endpoint and Report Card UI
2. Implement multi-trend discovery with convergence detection
3. Build composite scoring engine with weight sliders
4. Build convergence visualization
5. Tests for scoring and convergence logic

### Phase 3 — Persistence (Week 5-6)
1. Database schema for searches, results, watchlist
2. Search history page with reload capability
3. Watchlist with add/remove, price tracking, performance display
4. Trend portfolios (create, add companies, view aggregate performance)
5. Tests for persistence layer

### Phase 4 — Enhanced Data (Week 7+)
1. Integrate deeper financial metrics (P/E, D/E, FCF, etc.)
2. News/sentiment layer for watchlisted companies
3. Sector/competitor context panel
4. Polish and performance optimization

---

## Environment Variables Required

```
# .env.local
GOOGLE_GENAI_API_KEY=          # Gemini API key
FMP_API_KEY=                    # Financial Modeling Prep API key (free tier)
POSTGRES_PRISMA_URL=            # Vercel Postgres connection string (pooled)
POSTGRES_URL_NON_POOLING=       # Vercel Postgres direct connection (for migrations)
```

---

## Resolved Decisions

1. **Data providers:** FMP free tier as baseline (250 req/day). Easily sufficient given monthly usage pattern. Supplement with other free-tier sources as needed. Paid upgrade only if free sources can't cover core metrics after testing.
2. **Caching:** 7-day cache for financial data and discovery results, 30-day for trend analysis, indefinite for ticker validation. Stored in Vercel Postgres. Manual "Refresh Data" button available per search. This keeps API usage well within free tier limits even with multi-trend convergence.
3. **Auth:** None. Single-user hobby tool. No Clerk, no login.
4. **Deployment:** Vercel for everything. No Docker. Local dev via `next dev`.
5. **Historical tracking:** On-demand only. Prices refresh when the watchlist view is opened — no cron jobs, no scheduled snapshots.
6. **Usage pattern:** Monthly-ish. Jeff runs this when surplus cash accumulates and he wants to take a flyer on a trend. Not a daily-driver tool.
7. **Scope:** Personal tool, not intended for public release. Build for utility, not polish.