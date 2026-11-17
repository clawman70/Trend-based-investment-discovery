# Trend Discovery — Review & Implementation Plan (November 2026)

**Date:** 2026-11-09
**Reviewed at:** commit `f89b263` (last commit 2026-09-15)
**Audience:** the engineering session that builds this (Opus, high effort). Jeff is the PM and does not read code.
**Supersedes:** nothing. `Improvement-Plan-2026-09.md` stays as the record of Phases 0–4. This plan picks up from there.

---

## 1. Bottom line

The September work fixed the data. Every number on screen is now real or marked N/A, and the checks are clean. What the app still cannot do is tell Jeff whether its picks are any good. That is the biggest gap, and the data to close it is already being saved.

Three things matter most, in this order:

1. **Add a track record.** Every saved search already stores each pick's price on the day it was found. Comparing that to today's price and to the S&P 500 over the same period is a small build and answers "does this tool work?"
2. **Make the score honest.** With a single thesis, 30% of the composite score is the same constant for every company. The two real-data factors (P/E and debt) are neutral for most small, unprofitable companies, which are the companies this tool exists to find. So the ranking is mostly the AI's own 1–10 relevance guess.
3. **Fix a handful of real bugs** found in this review (section 3). None are dangerous. Several quietly break features that look finished.

Everything else here is hygiene.

---

## 2. Current state (verified 2026-11-09)

| Check | Result |
|---|---|
| `npx vitest run` | 113 of 113 tests pass (12 files) |
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean |
| `npm audit` | 26 findings: 1 critical, 12 high, 13 moderate |
| Git | working tree clean, pushed to `origin` |
| Live run against real APIs | **not done in this review** — findings below come from reading the code and running the offline checks |

The critical audit finding is in `next` (installed 15.5.25, fixed in 15.5.29, a patch-level bump). The September plan patched an earlier critical the same way; new advisories have landed since.

---

## 3. Findings

### 3.1 Bugs (confirmed by reading the code)

| # | What happens | Where | Why it matters |
|---|---|---|---|
| B1 | The watchlist note and the saved-history rationale are always empty. The discover route returns `rationales` (a per-thesis map) and never sets the single `rationale` field that the watchlist and history code read. The type says the field is required, so TypeScript does not catch it. | `src/app/api/discover/route.ts:122`, `src/app/page.tsx:95`, `src/lib/stores/historyStore.ts:93`, `src/lib/types.ts:34` | Starring a company loses the reason it was picked. |
| B2 | The exchange filter is never enforced. It goes to Claude as a sentence in the prompt and nothing checks the answer, even though the real exchange is known for every ticker after enrichment. Market cap got this fix in Phase 3; exchange did not. | `src/app/page.tsx:273`, `src/lib/claudeService.ts:85` | Selecting "NASDAQ only" can return NYSE companies. |
| B3 | With one thesis, every company gets a convergence score of 1.0. At the default weights that adds the same 30 points to every row. | `src/app/api/discover/route.ts:120`, `src/lib/scoring.ts:64` | Scores look higher and closer together than the data supports. |
| B4 | When one thesis in a multi-thesis run fails, the run continues with an empty list for it and tells nobody. Convergence is still divided by the full thesis count. | `src/app/api/discover/route.ts:65-73`, `:112` | A "2 of 3" company may really be "2 of 2". The user sees no warning. |
| B5 | Companies named in a Research report skip the ticker check. The ticker Gemini typed is used as-is to fetch a quote and compute the 6-month rally. | `src/app/api/research/route.ts:17-37` | A wrong ticker that happens to belong to another real company shows that company's rally under the wrong name. |
| B6 | The daily spend total loses updates. It reads the total, adds, and writes back with no locking, and discovery fires several AI calls at once. | `src/lib/usageTracker.ts:34-43` | The spend banner under-reports, which is the wrong direction for a safety net. |
| B7 | The spend estimate leaves out Gemini thinking tokens (billed as output) and Claude's per-search web search fee. Prices are hardcoded for one model each and ignore `CLAUDE_MODEL` / `GEMINI_MODEL`. The Gemini rate in the table is the promotional one that the September plan says ends 2026-12-31. | `src/lib/usageTracker.ts:11-14`, `src/lib/geminiService.ts:201`, `src/lib/claudeService.ts:125` | Same direction as B6: under-reports. |
| B8 | A company starred when its price failed to load is saved with a cost basis of 0, which permanently blanks its gain/loss. | `src/app/page.tsx:94`, `src/app/api/watchlist/route.ts:64` | Silent hole in the watchlist's one tracking feature. |
| B9 | Watchlist items are never linked to the search that found them, and loaded research theses are never linked to the search they led to. Both columns exist and are always null. | `src/app/page.tsx:91`, `src/components/ResearchReport.tsx:85`, `prisma/schema.prisma` (`sourceSearchId`, `searchId`) | Blocks the track record: there is no chain from thesis to pick to outcome. |
| B10 | The structured Research report from Gemini is parsed with `JSON.parse` and trusted. Fields the UI treats as fixed lists (maturity, confidence, convergence type, market cap tier) are plain strings in the Gemini schema. | `src/lib/geminiService.ts:254` | An off-list value renders as a broken badge or throws in the UI. |

### 3.2 Scoring weaknesses (design, not bugs)

- **Relevance is the AI grading its own homework.** It is 30% of the score by default and is a rounded 1–10 from the same call that chose the company.
- **Valuation and health go neutral exactly where the tool is aimed.** Negative P/E is dropped to "missing" and scored 0.5 (`finnhubService.ts:230`). Most micro and small caps in emerging themes lose money, so this factor does not separate them.
- **Min-max scaling is fragile.** One company with a P/E of 400 pushes every other company to nearly the same valuation score (`scoring.ts:22-24`).
- **Real data is fetched and not used.** Revenue growth is already pulled from Finnhub and shown only in the details window. The 6-month rally check, which is the app's own "has the market already noticed" test, runs only on the Research tab and not on Discovery results.
- **The requirements doc called for a growth factor at 20%.** It was never built. `/api/score` still carries a `growth` weight that the scoring function ignores, and nothing in the UI calls that route.

### 3.3 Operations and hygiene

- **Silent fallback to memory.** If Postgres is unreachable, writes go to memory and vanish on restart. The only signal is a server log line. The header's "TERMINAL STATUS: ONLINE" light is hardcoded and reflects nothing (`page.tsx:369-372`).
- **The password gate is off unless configured.** Deploying without `APP_PASSWORD` exposes every AI route to the internet.
- **No request limits.** `/api/enrich` accepts any number of tickers; thesis text has no length cap.
- **No function timeout set.** Research makes up to four Gemini calls with backoff; discovery runs web searches. Neither route sets `maxDuration`, so a Vercel deploy would use the platform default.
- **No discovery refresh.** Discovery results are cached 7 days with no way to bust the cache, while the prompt asks for recent IPOs. The requirements doc promised a "Refresh Data" button. Research has `forceRefresh`; check that the UI exposes it.
- **Stale docs.** `Trend-Discovery-2.0-Requirements.md` still specifies FMP, Gemini 2.5 Flash, no auth, and no Docker. All four have changed.
- **Dead weight.** `v1_backup/` (18 files), `metadata.json`, `/api/score`, `/api/validate-ticker` (no caller in the UI), package name `temp-app`.
- **No CI.** Tests, types, and lint only run when someone remembers.
- **Dependencies.** Two AI SDKs are a major version behind (`@anthropic-ai/sdk` 0.126 → 1.x, `@google/genai` 2.x → 3.x). Next 16 is still pending from September.
- **Project lives in OneDrive.** `node_modules` and `.next` sit inside a synced folder. This causes slow installs and occasional file-lock errors. Moving it is Jeff's call and outside this plan.

---

## 4. Decisions (resolved 2026-11-09)

**Jeff approved every recommendation below on 2026-11-09. Treat the Recommendation column as the decision; do not re-ask.**

D5 had no recommendation to approve, so it is settled this way: **build for local use now and defer Phase F.** Nothing in Phases A–E depends on it, and Phase F can be picked up unchanged if Jeff later decides to deploy to Vercel. Jeff can overrule this at any time.

| # | Decision | Recommendation | Why |
|---|---|---|---|
| D1 | What does a pick get compared against in the track record? | SPY (S&P 500 ETF) only, for now. | One benchmark is easy to read. Sector benchmarks can come later. |
| D2 | What happens to the convergence weight when there is only one thesis? | Drop it from the math for that run and spread its weight across the other factors. Grey out the slider. | A factor that is identical for every row is not information. |
| D3 | Add a growth factor to the score? If so, which growth? | Yes, **revenue** growth (already fetched, free). Do not score price growth as a positive. | The tool's premise is finding names before the market does. Rewarding stocks that already ran works against that. |
| D4 | Show a "6M rally >30%" flag on Discovery results? | Yes, as a flag in the table. Do not put it in the score yet. | It is the app's own definition of "already priced in" and currently only appears on the Research tab. |
| D5 | Is this going on Vercel, or staying local? | Local for now; Phase F deferred. | Fail-closed auth, timeouts, and hosted Postgres only matter if it deploys. |
| D6 | Delete `v1_backup/` and the unused routes? | Yes. Git history keeps them. | Less for future sessions to read and misread. |
| D7 | Upgrade the two AI SDKs and Next 16 in this round? | No. Separate session, after the features land. | Major-version upgrades change behavior. Mixing them with feature work makes failures hard to attribute. |

---

## 5. Implementation plan

Build in this order. Each phase is one session and ends with all three checks green (`npx vitest run`, `npx tsc --noEmit`, `npm run lint`), a README update where behavior changed, and a commit.

Standing rules for every phase:
- The app's data rule holds: a value is real or it is N/A. Never fill a gap with a guess.
- Add tests with each change. Existing tests mock every external API; keep that pattern.
- Before using any SDK feature not already in the code, fetch the current docs for the pinned version. Do not rely on memory for Anthropic, Gemini, Prisma 7, or Finnhub response shapes.
- Do one live run per phase where the success criteria say "live". If keys or Docker are not available, say so in the summary and do not mark the criterion met.

### Phase A — Security patch and cleanup (small)

1. Run `npm audit fix` (no `--force`). Expect `next` 15.5.29, `zod`, `prisma`, and transitive fixes. Re-run the three checks.
2. Do **not** apply the `yahoo-finance2` fix that npm suggests: it is a downgrade to 3.x. Read the advisory, state in the summary whether the vulnerable code path is reachable from this app, and leave the version alone.
3. If D6 is yes: delete `v1_backup/`, `metadata.json`, `src/app/api/score/`, and `src/app/api/validate-ticker/` along with their tests. Rename the package from `temp-app` to `trend-discovery`.
4. Add a header to `Trend-Discovery-2.0-Requirements.md` marking it as the original v2 spec, listing what has since changed (FMP → Finnhub, Gemini-only → Claude plus Gemini, auth added, Docker for local Postgres), and pointing to the README for current behavior.
5. Add a GitHub Actions workflow that runs install, vitest, tsc, and lint on push and pull request. No secrets needed; the tests run offline.

**Success criteria**
- `npm audit` reports 0 critical. Remaining highs are listed in the summary with the reason each stays.
- All three checks pass locally and in the first CI run.
- `npm run build` succeeds.

### Phase B — Bug fixes (B1, B2, B4, B5, B8, B10)

1. **B1 rationale.** Remove the single `rationale` field from `ScoredCompanyData` so the type matches what the discover route returns. Where a single string is needed (watchlist note, history row), build it from `rationales` (join per thesis). Fix both call sites.
2. **B2 exchange filter.** Add an exchange check next to `passesMarketCapFilter` and apply it in `page.tsx` after enrichment. A company with an unknown exchange is kept, matching the market-cap rule. Consider moving both filters into one module.
3. **B4 partial failure.** Have the discover route return the list of theses that failed. Compute convergence against the theses that succeeded. Show a warning in the existing `ValidationAlerts` area naming the failed thesis.
4. **B5 research tickers.** Run each mentioned company through `getListing()`. If the ticker is not a listed US security, show it as unverified and skip the rally check. If it is listed, compare the directory's company name to the name Gemini gave; on a clear mismatch, mark it unverified. Replace Gemini's guessed market-cap tier with one computed from the real Finnhub market cap when available; otherwise label the tier as an AI estimate.
5. **B8 cost basis.** In the watchlist POST, when `priceAtAdd` is missing or 0, fetch the quote server-side. If that also fails, store null and show "N/A" for gain/loss. This needs `priceAtAdd` to become nullable: one Prisma migration plus the matching change in `memoryStore.ts`.
6. **B10 Gemini validation.** Validate the parsed Gemini JSON with a Zod schema (Zod is already a dependency). Coerce unknown enum values to a safe "unknown" display, or fail the scan with a clear error. Pick one and say which in the summary.

**Success criteria**
- New unit tests for each fix, all passing.
- Live: star a company from Discovery and confirm the watchlist note contains the rationale.
- Live: run a thesis with "NASDAQ" selected and confirm every row shows NASDAQ.
- Unit: a research company with a fake ticker shows as unverified and has no rally value.

### Phase C — Honest scoring (B3 plus section 3.2)

Depends on D2, D3, D4.

1. **Single-thesis convergence (D2).** When only one thesis ran, exclude convergence from the composite and renormalize the remaining weights. Disable the convergence slider with a one-line explanation.
2. **Revenue growth factor (D3).** Carry `revenueGrowthYoY` through `/api/enrich` into the results. Add a growth factor to `scoring.ts` and a fifth slider. Missing growth scores neutral, same as the other factors.
3. **Robust scaling.** Replace min-max with rank-based (percentile) scaling within the result set for valuation, health, and growth, so one outlier cannot flatten the rest.
4. **Loss-making companies.** Stop treating negative earnings as "missing." Either score them at the bottom of the valuation factor or switch the valuation input to price-to-sales, which exists for unprofitable companies. Check which fields the free Finnhub metric endpoint actually returns before choosing, and state the choice.
5. **Rally flag (D4).** Compute the 6-month change for each Discovery result (the 5-year weekly history is already fetched for growth, so derive it from that data instead of a second Yahoo call). Show a flag column.
6. **Show the work.** In the expanded row, show each factor's contribution to the score and mark which factors had no data. Add a small "data coverage" indicator per row (for example "3 of 4 factors from real data").
7. Save the weights used with each history snapshot so a restored search re-scores the same way.

**Success criteria**
- Unit: a one-thesis run produces scores that do not include a constant convergence term; two-thesis behavior is unchanged.
- Unit: adding one extreme P/E outlier does not change the rank order of the other companies.
- Live: a small-cap thesis returns rows where unprofitable companies have distinct valuation scores instead of all 0.5.
- README scoring section rewritten to match.

### Phase D — Track record (the main feature)

Depends on D1 and on B9.

1. **Link the chain (B9).** Have `/api/history` POST return the new search ID and keep it in page state. Pass it as `sourceSearchId` when starring a company. When a research thesis is loaded and later discovered, write that search ID back to the loaded-thesis record.
2. **Scorecard endpoint.** New `GET /api/scorecard`. For each saved search: for each pick with a stored price, fetch the current quote and compute the return since the search date. Fetch SPY's close on the search date (Yahoo history, cached permanently since the past does not change) and its current price, and compute the pick's return minus SPY's. Respect the Finnhub rate limiter; cache quotes with the existing 5-minute rule.
3. **Scorecard view.** New tab, or a section in History. Per search: average pick return, SPY return, the difference, and the hit rate (share of picks beating SPY). Overall: the same numbers across all searches, plus top-scored half versus bottom-scored half, which shows whether the composite score predicts anything.
4. **Honesty guards.** Show the number of picks and days elapsed next to every figure. Under 30 days or under 10 picks, label the result "too early to read." Picks with no stored price are excluded and counted as excluded. State on the page that this is price return only, without dividends, and is not investment advice.
5. Add SPY-relative return to the Watchlist and Portfolio views using the same helper.

**Success criteria**
- Unit: return and SPY-relative math tested with fixed fixtures, including a missing-price pick and a delisted ticker.
- Live: at least one saved search shows a scorecard row with real numbers. If the database has no searches older than a few days, say so; the feature is then verified on math and wiring only.
- No more than one Finnhub quote call per unique ticker per scorecard load.

### Phase E — Spend tracking and visibility (B6, B7, section 3.3)

1. **Atomic spend total (B6).** Move the daily total out of the generic cache into its own small table with an atomic increment (Prisma `upsert` with `increment`). Keep a memory fallback.
2. **Complete the estimate (B7).** Include Gemini thinking tokens and Claude web-search request counts. Confirm the exact usage field names against current SDK docs before coding. Key the price table by model name with a clearly marked default, and add the post-2026-12-31 Gemini rate with a date switch. Re-check all rates against the providers' pricing pages on the day of the build.
3. **Real status bar.** New `GET /api/status` returning: storage mode (Postgres or memory), which keys are configured, and whether the ticker directory is loaded. Replace the hardcoded "ONLINE" light with it. Memory mode shows amber with "saved items will not survive a restart."
4. **Discovery refresh.** Add `forceRefresh` to `/api/discover` and a "Refresh" control on the results. Show "cached N days ago" when a cached result is served. Confirm the Research tab exposes its existing `forceRefresh`.
5. **Input limits.** Cap tickers per enrich call (50), theses per run (3, matching the UI), and thesis length (500 characters). Return 400 with a clear message.

**Success criteria**
- Unit: 20 concurrent `recordUsage` calls produce the exact sum.
- Live: stop the Postgres container and confirm the status bar turns amber within 30 seconds, and returns to green after restart.
- Live: run the same thesis twice and see the cached label; press Refresh and see a new run.

### Phase F — Deploy readiness (deferred; build only if Jeff decides to deploy to Vercel)

1. **Fail closed.** In production (`NODE_ENV=production`) with no `APP_PASSWORD`, the middleware returns 503 with a setup message instead of letting requests through. Add an explicit opt-out variable for anyone who wants it open. Compare credentials in constant time.
2. Set `maxDuration` on the research and discover routes, sized from measured run times.
3. Document in the README that the Finnhub rate limiter is per server instance and what that means on serverless.
4. Hosted Postgres setup steps (already outlined in the README): verify them end to end on a preview deploy.

**Success criteria**
- Preview deploy with no `APP_PASSWORD` returns 503 on `/api/research`.
- Preview deploy with a password completes one research scan and one discovery run without a timeout.

### Later (separate sessions, not this round)

- Upgrade `@anthropic-ai/sdk` to 1.x and `@google/genai` to 3.x, each on its own, reading the migration guide first.
- Upgrade Next 15 → 16.
- Review the default Claude and Gemini model choices against what is current. The defaults were chosen in September.
- SEC EDGAR filings as a research source and watchlist sentiment alerts (both carried over from the September plan).

---

## 6. What this review did not cover

- No live calls were made to Claude, Gemini, Finnhub, or Yahoo. Third-party response shapes are as the code and its September comments describe them.
- The UI components were checked for data flow, not for layout, accessibility, or mobile behavior.
- The test suite was run but not audited for whether each test asserts something meaningful.
