# Trend Discovery — Evaluation & Improvement Plan

**Date:** 2026-09-15
**Scope:** Code review of the current app + AI engine comparison (Gemini vs Claude vs OpenAI) + phased improvement plan.

---

## 1. Bottom Line

1. **The AI model isn't the biggest problem. The data behind it is.** Several data sources have quietly broken or been removed. The app now shows made-up numbers as if they were real, and the hallucination filter is switched off. A smarter model won't fix that.
2. **Cost is not the constraint at your volume.** At personal use (~50 discovery runs + 20 research scans a month), every reasonable model costs **$3–$21/month**. Pick for output quality, then tune cost.
3. **AI engine recommendation:**
   - **Now:** switch `gemini-3.5-flash` → `gemini-3.8-flash`. It's newer and costs about half as much through Dec 31, 2026. It's a one-line change.
   - **Quality upgrade candidate:** Claude Sonnet 5 for the two calls that matter (research scan + company discovery). Expect roughly 2× Gemini's cost, which is about $0.10–0.25 per run. *Disclosure: this review was written by Claude. Treat this as a hypothesis for the bake-off in Phase 2, not a verdict.*
   - **Cheap tier:** use Gemini 3.5 Flash-Lite or GPT-5.4-nano for small tasks like sentiment and value-chain one-liners.
   - **Skip:** Claude Opus 5, GPT-5.5, and Gemini Pro. They cost 2–5× more, and this pipeline's accuracy is limited by its data, not by reasoning.

---

## 2. What's Broken or Misleading (ranked by severity)

| # | Issue | Where | Impact |
|---|-------|-------|--------|
| 1 | **The hallucination gate is off.** `FMP_API_KEY` was removed from `.env.local`, so `validateTickers()` lets every ticker through (`bypassed: true`). | `src/lib/tickerValidator.ts` | Made-up or delisted tickers reach the results table. This was the headline v2 feature. |
| 2 | **Fake company details and news are shown as real.** Without an FMP key, the Details modal shows a made-up profile (CEO "Sarah Jenkins", $154.20 price, $45B market cap) and invented "Bullish" news for every ticker. The fake data is also cached for 7 days. | `src/app/api/company-details/route.ts`, `src/app/api/news/route.ts` | This is the most dangerous issue in an investing tool. Nothing in the UI marks the data as fake. |
| 3 | **1Y/5Y growth is always 0.** Yahoo's `v7/finance/download` endpoint now returns **401 Unauthorized** (verified today). A `.reverse()` on already-sorted data would also break the date matching. | `src/lib/yfinanceService.ts` | Growth columns are empty or zero for every company. |
| 4 | **Market cap is always 0 and P/E is always null.** Finnhub's quote endpoint returns neither value, and nothing else fills them in. | `src/lib/finnhubService.ts`, `enrich/route.ts` | The market-cap filter can't be checked. The valuation score is always a neutral 0.5, and the health score only reflects whether a price loaded. **The composite score is really just two numbers the AI made up (relevance + convergence).** |
| 5 | **Research scans silently fall back to a mock report.** Any Gemini error returns a canned report with `example.com` sources. Separately, the real report's source URLs are typed by the model into JSON instead of coming from Google's grounding metadata, so they can be invented. | `src/lib/geminiService.ts` (`generateTrendResearchReport`) | Citations can't be trusted, and you can't tell a real scan from a fallback. |
| 6 | **Watchlist, portfolios, and history are stored in memory.** Prisma was removed, so everything is lost on restart. On Vercel, each serverless instance has its own copy, so saved items randomly "disappear". | `src/lib/memoryStore.ts`, `src/lib/dbHelper.ts` | The persistence features don't really work in production. |
| 7 | **Discovery relies only on the model's training data.** There's no search grounding, so recent IPOs, SPAC mergers, and small caps are missed. `recentRally` is a guess from the model, not a price check. | `discoverCompaniesFromAI` | This works against the "find it before consensus" goal. |
| 8 | **The API routes have no protection.** If the app is deployed publicly, anyone can call `/api/research` and use up your AI quota. | all `src/app/api/*` | Cost and abuse risk. |
| 9 | **Tests and docs have drifted.** 2 of 24 tests fail (`enrich` growth, `peers` mock), `tsc` reports 4 type errors in the test files, and the README still describes FMP + Prisma. The two requirements docs are byte-identical duplicates. | `src/__tests__/`, `README.md`, `Documents/` | Verification can't be trusted. |
| 10 | **Minor efficiency issues:** trend analysis runs one trend at a time, discovery and analysis are separate calls for the same trend, and simple tasks run with `thinkingLevel: medium`. | `page.tsx`, `geminiService.ts` | Slower and uses more tokens than needed. |

---

## 3. AI Engine Comparison

### 3.1 Current list prices (per 1M tokens, standard tier, Sept 2026)

| Provider | Model | Input | Cached input | Output | Search grounding |
|----------|-------|-------|--------------|--------|------------------|
| Google | `gemini-3.5-flash` *(current)* | $1.50 | $0.15 | $9.00 | 5,000 free requests/mo, then $14 per 1K |
| Google | `gemini-3.8-flash` | $0.75 → $1.50 after Dec 31 | $0.075 | $3.75 → $7.50 | same |
| Google | `gemini-3.5-flash-lite` | $0.30 | $0.03 | $2.50 | — |
| Anthropic | `claude-haiku-4-5` | $1.00 | $0.10 | $5.00 | $10 per 1K searches + result tokens billed as input |
| Anthropic | `claude-sonnet-5` | $2.00 | $0.20 | $10.00 | same |
| Anthropic | `claude-opus-5` | $5.00 | $0.50 | $25.00 | same |
| OpenAI | `gpt-5.4-nano` | $0.20 | $0.02 | $1.25 | $10 per 1K calls + content tokens billed |
| OpenAI | `gpt-5.4-mini` | $0.75 | $0.075 | $4.50 | same |
| OpenAI | `gpt-5.4` | $2.50 | $0.25 | $15.00 | same |
| OpenAI | `gpt-5.5` | $5.00 | $0.50 | $30.00 | same |

All three providers offer a **50% batch discount**. On Gemini, thinking tokens are billed as output. Claude 4.7+ models use a tokenizer that produces about 30% more tokens for the same text, and the estimates below account for this. Third-party sites list a "GPT-5.6" line, but OpenAI's official pricing page does not show it yet, so it's excluded here.

### 3.2 Estimated cost per action in *this* app

Assumptions:
- **Discovery run** = 2 theses → 2 trend-analysis calls + 2 discovery calls. About 2K input and 11K output tokens, mostly thinking.
- **Research scan** = about 6K output tokens. Claude and OpenAI run about 5 searches that pull about 40K tokens of results into input. Gemini grounding does not bill the retrieved content as input.

| Model | Discovery run | Research scan | Month (50 runs + 20 scans) |
|-------|---------------|---------------|-----------------------------|
| Gemini 3.8 Flash | **$0.04** ($0.09 in 2027) | **$0.03** | **~$2.50** (~$5.50 in 2027) |
| Gemini 3.5 Flash *(today)* | $0.10 | $0.06 | ~$6 |
| GPT-5.4-mini | $0.05 | $0.11 | ~$5 |
| Claude Haiku 4.5 | $0.02 | $0.12 | ~$3.50 |
| Claude Sonnet 5 | $0.15 | $0.24 | ~$12 |
| GPT-5.4 | $0.17 | $0.24 | ~$13 |
| Claude Opus 5 | $0.21 | $0.52 | ~$21 |

These are estimates. Phase 2 replaces them with measured numbers.

### 3.3 Quality trade-offs (what matters for this app)

| Criterion | Gemini Flash | Claude Sonnet 5 | OpenAI GPT-5.4 / mini |
|-----------|--------------|-----------------|------------------------|
| Fresh web research (research scan) | Google's index and a free grounding quota. Citations come from `groundingMetadata`, which the app currently ignores. | Web search filters results before they reach the model and returns citations tied to real retrieved pages. Retrieved results are billed as input, which costs more. | Solid web search tool. Results are billed as input tokens. |
| Accurate ticker lists (discovery) | Good. Hallucinations are the known weak spot, which is why the gate exists. | Strong instruction-following and schema adherence. Still needs the ticker gate. | mini is cheap but weaker at niche small caps. Full 5.4 is competitive. |
| Structured JSON output | Native `responseSchema` | Native structured outputs | Native structured outputs |
| Cheapest option for tiny tasks | Flash-Lite ($0.30 / $2.50) | Haiku 4.5 ($1 / $5) | nano ($0.20 / $1.25) |

**No model fixes issues #1–#6.** Fix the data first, then run the bake-off to compare models fairly.

---

## 4. Improvement Plan

### Phase 0 — Stop showing fake data (≈1–2 build sessions) 🔴
**Goal:** Every number on screen is real or clearly marked as unavailable.

- Delete the mock and "dummy" fallbacks in `company-details`, `news`, and `generateTrendResearchReport`. Return `unavailable` states and show them in the UI. Only allow mock data behind an explicit `DEMO_MODE=true` flag.
- Restore the hallucination gate using Finnhub's free symbol list (`/stock/symbol?exchange=US`) instead of FMP, which saves one paid key. Cache it for 24h.
- Fill in market cap and P/E from Finnhub's free `/stock/profile2` and `/stock/metric` endpoints.
- Replace the dead Yahoo CSV endpoint with the maintained `yahoo-finance2` npm package (chart API) for 1Y/5Y prices, and remove the `.reverse()` bug.
- Replace FMP news with Finnhub `/company-news` (free).
- Switch the model string to `gemini-3.8-flash`.
- Fix the 2 failing tests and the 4 `tsc` errors. Update the README and delete the duplicate requirements doc.

**Success criteria** — all verified live 2026-09-15 against real Finnhub/Yahoo data
- [x] A fake ticker (e.g., `ZZZQ`) is dropped and shows up in Validation Alerts.
- [x] AAPL shows a real market cap, P/E, and non-zero 1Y growth.
- [x] With the data keys removed, the UI shows "unavailable" instead of invented values.
- [x] `npx vitest run` passes 100%, and `tsc --noEmit` and `eslint` are clean.

### Phase 1 — Real persistence (≈1 session) 🔴 — done 2026-09-15
**Goal:** The watchlist and history survive restarts and Vercel deploys.

- [x] Postgres + Prisma 7 (driver adapters) for `searches`, `watchlist`, `portfolios`, `research_scans`, `research_loaded_theses`, and the API cache. Local dev runs Postgres via Docker Compose (`npm run db:up`); a store module per resource (`src/lib/stores/`) uses Postgres when reachable and falls back to the in-memory store automatically otherwise — not just for tests, as a resilience feature.
- [x] Access gate: `APP_PASSWORD` env var turns on HTTP Basic Auth for the whole app (middleware), off by default so local dev has no added friction.

**Success criteria**
- [x] Calling `/api/research` without auth returns a 401 — verified live against a running dev server (401 no creds, 401 wrong creds, 200 correct creds, page itself also gated).
- [ ] A starred ticker is still on the watchlist after `npm run dev` restarts. **Code-complete and covered by mocked-Prisma tests, but not verified against a live Postgres** — Docker Desktop would not finish starting in this environment (its logs stopped updating mid-launch, most likely stuck on a Windows permission prompt). To finish verifying: get Docker Desktop running, then `npm run db:up && npm run db:migrate`, star a ticker, restart `npm run dev`, confirm it's still there.

### Phase 2 — AI provider layer + bake-off (≈2 sessions) 🟠
**Goal:** Choose the engine with data instead of opinion.

- Create a single `src/lib/ai/` interface with `analyzeTrend`, `discoverCompanies`, `researchScan`, and `summarizeSentiment`, plus adapters for Gemini, Claude, and OpenAI using each official SDK. Select the model per task via env vars (for example, `AI_MODEL_RESEARCH=claude-sonnet-5`).
- Log token usage and cost for every call (input, output, cached, searches).
- Build a **golden set of 20 theses** (mix of mature and emerging, plus 3 deliberately obscure ones).
- Run every candidate: Gemini 3.8 Flash, Claude Sonnet 5, GPT-5.4-mini, GPT-5.4, and Claude Haiku 4.5 for discovery only.

**Metrics per model**
| Metric | How |
|--------|-----|
| Ticker validity rate | % of returned tickers that pass the Finnhub symbol gate |
| Relevance precision | You score 5 theses by hand (keep / drop per company); an LLM judge scores the rest |
| Source validity (research) | % of cited URLs that resolve and actually mention the claim |
| Recency | % of theses backed by a source dated within 30 days |
| Cost per run | From the usage logs |
| Latency | p50 / p90 seconds |

**Decision rule:** pick the cheapest model within 5 points of the best on validity and precision. If none is close, pick the best.

**Success criteria**
- [ ] Changing one env var switches providers with no code changes.
- [ ] A bake-off report in `Documents/` shows a measured cost and quality table.

### Phase 3 — Output quality upgrades (≈2–3 sessions) 🟡
- **Ground discovery:** give the discovery call web search so it picks up recent listings. Then check each company against the user's market-cap filter using real data from Phase 0 and drop the ones that don't fit.
- **Use real citations:** build `sources` from the provider's grounding or citation metadata, never from URLs the model types out.
- **Replace AI guesses with facts:** compute `recentRally` (>30% in 6 months) from price history.
- **Make the composite score meaningful:** now that P/E, debt-to-equity, and growth are real, reweight the score and remove "data quality" from the health factor.
- **Merge calls:** combine trend analysis and discovery into one structured call per thesis, and run theses in parallel.
- **Right-size thinking:** use high effort for research scans, medium for discovery, and none/low on the cheap model for sentiment and value chain.

**Success criteria**
- [ ] A thesis about a company that IPO'd in the last 60 days finds that company.
- [ ] 100% of displayed citations come from grounding metadata.
- [ ] A 2-thesis discovery run finishes in under 50% of today's time.

### Phase 4 — Cost controls (≈1 session) 🟢
- Enable prompt caching on the static system prompts and schemas (Claude/OpenAI cached input is about 90% cheaper).
- Run a nightly **batch** job (50% off) to refresh watchlist sentiment and value-chain text, instead of calling the AI when the modal opens.
- Set a daily spend cap that shows a warning banner once reached.

**Success criteria**
- [ ] The cost dashboard (from the usage logs) shows a ≥30% drop in cost per run compared with the Phase 2 baseline, with no quality loss on the golden set.

---

## 5. Future Improvements (not scheduled)
- Pull in SEC filings (8-K and S-1 via EDGAR full-text search) as a research source, which gives a strong early signal for "pre-consensus" theses.
- Add alerts when a watchlist company's news sentiment flips.
- Upgrade Next.js 15.5 → 16 once the rest is stable.
