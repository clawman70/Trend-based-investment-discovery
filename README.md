# Trend-Based Investment Discovery Engine

A Bloomberg-style research terminal. You describe a market trend in plain English. The app then:

1. **Researches** emerging cross-domain trends (Gemini with Google Search grounding).
2. **Analyzes** a thesis (maturity, TAM, catalysts, risks).
3. **Discovers** publicly traded companies that fit it (Gemini).
4. **Validates** every AI-suggested ticker against real US exchange listings and drops anything unlisted.
5. **Enriches** the survivors with live price, market cap, P/E, debt-to-equity and 1Y/5Y price growth.
6. **Scores** and ranks them, and lets you save them to a watchlist and portfolios.

> **Data integrity rule:** every number on screen is real or shown as **N/A**. The app never fills gaps with made-up values. Placeholder data exists only when you explicitly turn on `DEMO_MODE`, and it is labeled **DEMO** everywhere it appears.

---

## Data Sources

| What | Source | Notes |
|------|--------|-------|
| AI analysis, discovery, research, sentiment | Google Gemini (`gemini-3.8-flash` by default) | Model is configurable with `GEMINI_MODEL` |
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
| `GOOGLE_GENAI_API_KEY` | Yes | All AI features. Get it at [aistudio.google.com/apikey](https://aistudio.google.com/apikey). |
| `FINNHUB_API_KEY` | Yes | Ticker validation, prices, fundamentals, news, peers. Get it at [finnhub.io/register](https://finnhub.io/register). |
| `GEMINI_MODEL` | No | Override the AI model (default `gemini-3.8-flash`) |
| `DEMO_MODE` | No | `true` = serve clearly-labeled placeholder data when you have no keys |

**What happens when a key is missing (and `DEMO_MODE` is off):**
- **No Finnhub key:** a red banner says tickers weren't verified. Prices and fundamentals return a clear error, and the details window shows an error instead of fake data.
- **No Gemini key:** discovery and research return an error, and news sentiment shows "unavailable".

### 3. Run
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

The tests mock every external API, so they run offline and cost nothing.

---

## Project Structure

```text
├── Documents/                         # Requirements, specs, improvement plan (source of truth)
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── analyze-trend/         # Gemini trend diagnostics
│   │   │   ├── discover/              # Gemini discovery + hallucination gate
│   │   │   ├── enrich/                # Live price, fundamentals, growth, exchange
│   │   │   ├── company-details/       # Details window: profile + fundamentals + AI value chain
│   │   │   ├── news/                  # Finnhub headlines + Gemini sentiment
│   │   │   ├── peers/                 # Finnhub peer comparison
│   │   │   ├── research/              # Gemini grounded research scans
│   │   │   ├── validate-ticker/       # Ticker validation endpoint
│   │   │   ├── watchlist/ portfolios/ history/   # Saved items (in-memory for now)
│   │   │   └── score/                 # Composite scoring
│   │   └── page.tsx                   # Main dashboard
│   ├── components/                    # UI (ResultsTable, DetailsModal, ValidationAlerts, ...)
│   └── lib/
│       ├── finnhubService.ts          # Rate-limited Finnhub client + metric normalization
│       ├── yahooService.ts            # Yahoo price history + company profile
│       ├── tickerValidator.ts         # Hallucination gate (Finnhub symbol directory)
│       ├── geminiService.ts           # Gemini prompts & schemas
│       ├── demoData.ts                # DEMO_MODE placeholder fixtures (labeled)
│       ├── scoring.ts                 # Composite score
│       ├── dbHelper.ts / memoryStore.ts  # In-memory cache & storage
│       └── types.ts
└── v1_backup/                         # Original v1 code
```

---

## Known Limitations

See `Documents/Improvement-Plan-2026-09.md` for the full roadmap.

- **Saved data is in memory only.** The watchlist, portfolios and history reset on restart and don't work reliably on Vercel. This is Phase 1 of the plan.
- **API routes have no authentication.** Don't deploy publicly yet (Phase 1).
- **The composite score still weights "data availability"** in its health factor. Reweighting is Phase 3.
- **The market-cap filter is passed to the AI but not enforced** against real market cap yet (Phase 3).
- **Research citations are written by the model**, not taken from grounding metadata, so verify links (Phase 3).
