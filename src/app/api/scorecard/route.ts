/**
 * GET /api/scorecard: the track record (Phase D).
 *
 * For every saved search: how its picks did since the search date (price return), how
 * SPY did over the same window, the difference, and the hit rate (share of picks that
 * beat SPY). Plus an overall roll-up and top-scored half vs bottom-scored half.
 *
 * Cost per load: one Finnhub quote per UNIQUE ticker across all searches (plus SPY), via
 * the shared rate limiter and the 5-minute quote cache; one Yahoo history call for any
 * SPY closes not cached yet (cached permanently after that); one Yahoo split check per
 * unique ticker with a price (cached 24 hours). No AI calls.
 *
 * Math and honesty rules: src/lib/trackRecord.ts. Data fetching: src/lib/benchmark.ts.
 */
import { NextResponse } from 'next/server';
import { listSearchesWithPicks } from '@/lib/stores/historyStore';
import { getBenchmarkStartCloses, getCurrentPrices, getSplitFactors } from '@/lib/benchmark';
import { isFinnhubConfigured } from '@/lib/finnhubService';
import {
  BENCHMARK_TICKER,
  buildOverall,
  buildSearchScorecard,
  MIN_DAYS_TO_READ,
  MIN_PICKS_TO_READ,
  priceAsOfDate,
} from '@/lib/trackRecord';

export const dynamic = 'force-dynamic'; // live prices: never statically cached by Next

export async function GET() {
  try {
    const now = new Date();
    const searches = await listSearchesWithPicks();
    const finnhubConfigured = isFinnhubConfigured();

    // 1. Current prices: only picks that have a saved start price need one, plus SPY
    const tickers = new Set<string>([BENCHMARK_TICKER]);
    for (const s of searches) for (const p of s.picks) if (p.priceAtSearch !== null) tickers.add(p.ticker);
    const prices = finnhubConfigured && searches.length > 0 ? await getCurrentPrices(Array.from(tickers)) : new Map<string, number>();
    const benchmarkCurrent = prices.get(BENCHMARK_TICKER) ?? null;

    // 2. SPY's close on each search's date (nearest prior trading close on weekends/holidays)
    const asOfDates = searches.map((s) => priceAsOfDate(s.createdAt));
    const benchmarkStarts = searches.length > 0 ? await getBenchmarkStartCloses(asOfDates, now) : new Map();

    // 3. Split checks, only for picks that will actually be scored (saved price + current price)
    const splitRequests = searches.flatMap((s, i) =>
      s.picks
        .filter((p) => p.priceAtSearch !== null && prices.has(p.ticker))
        .map((p) => ({ ticker: p.ticker, asOfDate: asOfDates[i] }))
    );
    const splitFactors = await getSplitFactors(splitRequests);

    // 4. Score each search, then the overall roll-up
    const cards = searches.map((s) =>
      buildSearchScorecard(s, { now, prices, benchmarkStarts, benchmarkCurrent, splitFactors })
    );
    // Newest first for display; the roll-up doesn't depend on order
    cards.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return NextResponse.json({
      generatedAt: now.toISOString(),
      benchmarkTicker: BENCHMARK_TICKER,
      benchmarkCurrentPrice: benchmarkCurrent,
      finnhubConfigured,
      rules: { minDays: MIN_DAYS_TO_READ, minPicks: MIN_PICKS_TO_READ },
      overall: buildOverall(cards),
      searches: cards,
    });
  } catch (error: unknown) {
    console.error('Error in scorecard route GET:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
