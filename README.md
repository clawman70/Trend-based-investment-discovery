# Trend-Based Investment Discovery Engine

A Bloomberg-style research terminal. You describe a market trend in plain English. The app then:

1. **Researches** emerging cross-domain trends (Gemini with Google Search grounding).
2. **Analyzes** a thesis (maturity, TAM, catalysts, risks).
3. **Discovers** publicly traded companies that fit it (Claude).
4. **Validates** every AI-suggested ticker against real US exchange listings and drops anything unlisted.
5. **Enriches** the survivors with live price, market cap, P/E, price-to-sales, revenue growth, debt-to-equity, 1Y/5Y price growth and the 6-month price change.
6. **Scores** and ranks them (see [How the score works](#how-the-score-works)), and lets you save them to a watchlist and portfolios.

> **Data integrity rule:** every number on screen is real or shown as **N/A**. The app never fills gaps with made-up values. Placeholder data exists only when you explicitly turn on `DEMO_MODE`, and it is labeled **DEMO** everywhere it appears.

---

## Data Sources

| What | Source | Notes |
|------|--------|-------|
| Discovery, trend analysis, news sentiment, value-chain | Claude (`claude-sonnet-5` by default) | Model configurable with `CLAUDE_MODEL`. Discovery searches the web (`web_search_20260209`) before answering, so it can catch recent IPOs/SPAC mergers/spin-offs the model's training data would miss — every ticker it returns still goes through the hallucination gate below regardless of whether it searched. See `src/lib/claudeService.ts`. |
| Research tab (grounded trend scan) | Gemini (`gemini-3.8-flash` by default), with Google Search grounding | Model configurable with `GEMINI_MODEL`. Runs on Google's own search index — chosen specifically for this task because it's recency- and breadth-critical (last-30-days signals across patents, government filings, niche technical sources), which is more a search-index property than a reasoning one. Two Gemini calls per scan, not one: a freeform search call, then a structuring call that's only allowed to cite URLs the first call actually found. (Live testing showed a single call combining search + structured output would often skip the real search and write convincing-looking fake citations instead — the two-call split fixes that, at roughly double the token cost per scan.) Every citation is cross-checked again against the real grounding results before it's shown, and the scan fails outright rather than return an ungrounded report if Google Search never actually returns anything — see `src/lib/geminiService.ts`. |
| Ticker validation (hallucination gate) | Finnhub `/stock/symbol` (free) | Accepts NASDAQ, NYSE, NYSE American, NYSE Arca, Cboe BZX. Rejects OTC, ETFs, warrants, units. Cached 24h. |
| Live price | Finnhub `/quote` (free) | Cached 5 min |
| Market cap, P/E, price-to-sales, EPS, revenue growth, debt/equity, free cash flow (est.) | Finnhub `/stock/metric` (free) | Cached 24h. FCF is derived as market cap ÷ price-to-FCF. For a loss-making company Finnhub sends no P/E at all (checked live 2026-11-17), so the table shows **Loss** instead of N/A when trailing EPS is negative. |
| Company name, exchange, industry, website | Finnhub `/stock/profile2` + symbol directory | |
| Description, sector, industry, CEO | Yahoo Finance via `yahoo-finance2` | Unofficial source. If it fails, fields show N/A. |
| 1Y / 5Y price growth | Yahoo Finance weekly price history | Falls back to Finnhub 52-week return for 1Y. Shown for context; **never scored**. |
| "6M" column and **▲ RALLY** flag on Discovery results | The same Yahoo weekly history (no extra call) | Falls back to Finnhub's 26-week price return. The flag appears when a stock is up more than 30% in 6 months, the app's "the market may already have noticed" test. Context only: **not part of the score**. N/A when neither source has the data. |
| News | Finnhub `/company-news` (last 14 days) | |
| Peers | Finnhub `/stock/peers` | Up to 8 peers |
| Market-cap and exchange filter enforcement | Real Finnhub market cap and real listing exchange, checked after enrichment | The AI only sees your market-cap and exchange filters as text hints. After enrichment, a company whose *real* market cap doesn't match your selected tier, or whose *real* listing exchange isn't one you selected, is dropped. Exchange matching is exact: "NYSE" means NYSE only, not NYSE American or NYSE Arca. A company whose market cap or exchange is unknown is kept (can't verify, so it isn't filtered out). See `src/lib/resultFilters.ts`. |
| Research-tab ticker check | Finnhub symbol directory (same one the Discovery gate uses) | Every company Gemini names is checked before its ticker is used. If the ticker isn't a listed US security, or it belongs to a company with a clearly different name, the row is marked **UNVERIFIED** with the reason, and it gets no rally value. See `src/lib/researchVerification.ts`. |
| Research-tab market-cap tier | Real Finnhub market cap for verified tickers | Recomputed from real data (same micro/small/mid/large cutoffs as Discovery). When Finnhub has no market cap, or the ticker is unverified, the tier is Gemini's guess and is labeled **AI estimate** under the badge. |
| "6M Rally >30%" on Research-tab companies | Computed from real Finnhub price + Yahoo 6-month history | Never an AI guess. Only computed for **verified** tickers; **N/A** for unverified tickers or when price history is unavailable. See `fetchSixMonthRally` in `src/lib/yahooService.ts`. |

**Research report validation:** Gemini's structured report is checked with a schema (`src/lib/researchSchema.ts`) instead of being trusted. A label outside the allowed list (maturity, confidence, convergence type, source type, market-cap tier) is shown as "unknown" rather than breaking the page. If the report itself is broken (not valid JSON, no summary, no list of theses, a thesis with no statement), the scan fails with a clear "Research scan failed" message instead of showing a partial report.

**Multi-thesis runs:** if discovery fails for one thesis while others succeed, a red warning above the results names the failed thesis. The results come from the theses that ran, and "matches N of M" counts only those. If every thesis fails, the run stops with an error.

**Watchlist:**
- Starring a company saves why it was picked as the note. With several theses, each reason is labeled with its thesis.
- The cost basis is the price on the day you starred it. If the price didn't load in the browser, the server fetches a live quote. If that also fails, the cost basis is saved as **N/A**, not $0, and gain/loss shows N/A. Portfolio totals leave those items out.

**Finnhub free-tier budget:** 60 calls/minute. All Finnhub calls share one rate limiter (capped at 55/min), so a big discovery run (25+ companies) may pause briefly instead of failing.

---

## How the score works

Every Discovery result gets a score from 0 to 100. Click a row to see exactly how it was built: each factor's input, its 0-to-1 factor score, how much weight it carried, how many points it added, and where the input came from.

**The five factors**

| Factor | Input | Better is | Source | Default weight |
|---|---|---|---|---|
| Trend relevance | The AI's 1-10 fit rating from discovery | Higher | **AI estimate** | 25 |
| Multi-thesis overlap | Share of your theses that found the company | Higher | AI (how many discovery runs found it) | 25 |
| Revenue growth | Revenue, last 12 months vs the year before | Higher | Finnhub (real data) | 20 |
| Valuation | Price-to-sales (P/S) | Lower | Finnhub (real data) | 15 |
| Financial health | Debt-to-equity | Lower | Finnhub (real data) | 15 |

The defaults come from the original v2 requirements. Drag the sliders to change them; the percentages always add to 100.

**Rules that keep the score honest**

- **One thesis = no overlap factor.** With a single thesis, every company "matches 1 of 1", so overlap would add the same points to every row and tell you nothing. It's switched off for that run, its slider is greyed out, and its weight is spread across the other four. With two or three theses it works as before. If one thesis in a multi-thesis run fails, only the theses that ran count.
- **Ranked, not stretched.** Revenue growth, valuation and health are ranked against the other companies in the same result set: best = 1, worst = 0, the rest evenly spaced. One company with a crazy number (a P/S of 4,000, say) just ranks last; it can't squash everyone else into the same score.
- **Valuation uses price-to-sales, not P/E.** Most small companies in emerging themes lose money, and Finnhub gives no P/E for them, so a P/E-based score left them all stuck at the middle. P/S exists for any company with revenue, profitable or not. A company Finnhub reports as having **zero revenue** ranks last on valuation (its P/S is effectively infinite). P/E is still shown in the table for reference.
- **Negative equity ranks last on health.** A negative debt-to-equity means the company owes more than it owns. That used to be dropped as "missing"; now it's the worst health score.
- **Price momentum is never rewarded.** 1Y/5Y price growth and the 6-month rally flag are shown but not scored. The tool is meant to find companies *before* the market does.
- **Missing data is neutral and labeled.** If a factor has no real data for a company, it sits at the middle (0.5) and is marked **MISSING** in the breakdown. Nothing is filled with a guess.

**Data coverage badge.** Each row shows **DATA n/3**: how many of the three market-data factors (revenue growth, valuation, health) had real data. 3/3 = fully data-backed; a lower number means more of that score is neutral filler or the AI's opinion.

**Saved searches re-score the same way.** Each history snapshot stores the weights and the number of theses that ran. Restoring it puts the sliders back where they were and reproduces the same scores. Searches saved before this change (November 2026) have no saved weights: they're re-scored with your current sliders, and the data they never stored (P/S, revenue growth) shows as missing.

The code is in `src/lib/scoring.ts`; the breakdown panel is `src/components/ScoreBreakdownPanel.tsx`.

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
| `ANTHROPIC_API_KEY` | Yes | Discovery, trend analysis, news sentiment, value-chain. Get it at [platform.claude.com](https://platform.claude.com). |
| `GOOGLE_GENAI_API_KEY` | Yes | Research tab only. Get it at [aistudio.google.com/apikey](https://aistudio.google.com/apikey). |
| `FINNHUB_API_KEY` | Yes | Ticker validation, prices, fundamentals, news, peers. Get it at [finnhub.io/register](https://finnhub.io/register). |
| `CLAUDE_MODEL` | No | Override the Claude model (default `claude-sonnet-5`) |
| `GEMINI_MODEL` | No | Override the Gemini model (default `gemini-3.8-flash`) |
| `DEMO_MODE` | No | `true` = serve clearly-labeled placeholder data when you have no keys |

**What happens when a key is missing (and `DEMO_MODE` is off):**
- **No Finnhub key:** a red banner says tickers weren't verified. Prices and fundamentals return a clear error, and the details window shows an error instead of fake data.
- **No Claude key:** discovery, trend analysis and value-chain summaries return an error, and news sentiment shows "unavailable".
- **No Gemini key:** the Research tab returns an error. Everything else still works.

### 3. Set up persistence (optional but recommended)
Without a database the app still runs — the watchlist, portfolios, history and research scans just live in memory and reset every time the server restarts. To make them stick:

```bash
npm run db:up       # starts Postgres via Docker Compose (Docker Desktop must be running)
npm run db:migrate   # creates the tables
```

Run `npm run db:migrate` again after pulling changes that add a migration. The November 2026 work added two: one makes the watchlist cost basis optional and turns any stored $0 cost basis into N/A; the other adds a column that saves the scoring weights with each history snapshot.

`.env.example` already has the matching `POSTGRES_PRISMA_URL` / `POSTGRES_URL_NON_POOLING` for this local database — copy them into `.env.local` if you haven't already. **Docker Compose is local-dev only — it doesn't exist on Vercel.** For a production deploy, point those two variables at a real hosted Postgres instance (Vercel Postgres or [Neon](https://neon.tech) both work) and run `npm run db:deploy` once instead.

**How the fallback works:** every request checks whether Postgres is reachable. If it is, data is read from and written to Postgres. If it isn't (no `POSTGRES_PRISMA_URL`, or the database is down), the app falls back to in-memory storage automatically — no errors, no restart needed, it just won't remember anything past the current server process. You'll see `[DB] Postgres unavailable, falling back to in-memory store` in the server log when this happens.

### 4. (Optional) Password-protect the app
Off by default. Set `APP_PASSWORD` in `.env.local` (and optionally `APP_USERNAME`, default `admin`) before deploying anywhere public — your browser will show a native login prompt for the whole app, API included.

### 5. (Optional) Set a daily AI spend cap
Off by default (a $5/day cap otherwise). Every Claude and Gemini call is logged to a running daily total; once it crosses `DAILY_SPEND_CAP_USD`, a warning banner appears at the top of the app. It's a heads-up against a bug or runaway usage, not real billing data or a hard limit — AI calls keep working as normal past the cap.

### 6. Run
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

```bash
npm run build
```

The tests mock every external API and the database, so they run offline and cost nothing.

**CI:** `.github/workflows/ci.yml` runs the tests, type check and lint on GitHub for every push and pull request (Node 22, no secrets needed). It does not run the production build.

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
│   │   │   ├── research/              # Gemini research scans (Google Search grounding)
│   │   │   ├── usage/today/           # Today's estimated AI spend + daily cap status
│   │   │   └── watchlist/ portfolios/ history/   # Saved items (Postgres, falls back to memory)
│   │   └── page.tsx                   # Main dashboard
│   ├── components/                    # UI (ResultsTable, ScoreBreakdownPanel, ScoringSliders, DetailsModal, ...)
│   └── lib/
│       ├── finnhubService.ts          # Rate-limited Finnhub client + metric normalization
│       ├── yahooService.ts            # Yahoo price history + company profile
│       ├── tickerValidator.ts         # Hallucination gate (Finnhub symbol directory)
│       ├── resultFilters.ts           # Real market-cap + exchange enforcement (post-enrichment)
│       ├── rationale.ts               # Builds the watchlist/history note from per-thesis rationales
│       ├── researchSchema.ts          # Validates Gemini's Research report JSON (unknown labels -> "unknown")
│       ├── researchVerification.ts    # Research-tab ticker check, real market-cap tier, rally check
│       ├── claudeService.ts           # Claude: discovery, trend analysis, sentiment, value-chain
│       ├── geminiService.ts           # Gemini: Research tab only, Google Search grounding
│       ├── usageTracker.ts            # Daily AI spend estimate + cap check (DAILY_SPEND_CAP_USD)
│       ├── demoData.ts                # DEMO_MODE placeholder fixtures (labeled)
│       ├── scoring.ts                 # Composite score: 5 factors, rank scaling, breakdown (runs in the browser)
│       ├── prisma.ts                  # Prisma client (Postgres, driver adapter)
│       ├── dbHelper.ts                # isDbAvailable() + TTL cache (Postgres, falls back to memory)
│       ├── memoryStore.ts             # In-memory fallback storage
│       ├── stores/                    # One module per resource: Postgres if available, else memory
│       │   ├── historyStore.ts / watchlistStore.ts / portfolioStore.ts / researchStore.ts
│       └── types.ts
└── .github/workflows/ci.yml           # CI: runs tests, type check and lint on every push / PR
```

---

## Known Limitations

See `Documents/Improvement-Plan-2026-11.md` for the current roadmap (`Improvement-Plan-2026-09.md` is the record of the earlier phases).

- **The app password gate is a deterrent, not compliance-grade auth.** No rate limiting, no audit log, no per-user accounts — fine for a personal tool, not for anything handling other people's data.
- **The score ranks within one result set.** A 70 in one search and a 70 in another aren't directly comparable: valuation, health and growth are ranked against the other companies in that same search. Phase D (track record) is what will test whether high scores actually predict better returns.
- **Portfolio→watchlist links have a real foreign key on the portfolio side only.** Deleting a watchlist item that's linked to a portfolio never fails, it just quietly drops from that portfolio's view — same behavior with or without Postgres.
