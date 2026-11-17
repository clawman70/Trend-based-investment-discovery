/**
 * Track record math (Phase D): how each saved search's picks did since the search date,
 * compared with SPY (the S&P 500 ETF) over the same window (decision D1: SPY only).
 *
 * Everything in this file is pure (no network, no database) so it can be unit-tested with
 * fixed fixtures. The I/O lives in src/lib/benchmark.ts and src/app/api/scorecard/route.ts.
 *
 * Ground rules, matching the app's data rule (real data or N/A, never a guess):
 * - A pick's start price is the price saved with the search (financialData.stockPrice).
 *   No saved price -> the pick is EXCLUDED and counted, never back-filled.
 * - A pick with no current quote (delisted, renamed, or Finnhub has nothing) is EXCLUDED
 *   and counted. We can't know whether it went to zero or was bought out at a premium,
 *   so any number would be a guess. (This means the figures carry some survivorship bias;
 *   the UI says so.)
 * - Returns are PRICE-ONLY: dividends are not included, for the picks or for SPY.
 * - Stock splits after the search date are adjusted for (a 10-for-1 split would otherwise
 *   look like a -90% loss; a 1-for-10 reverse split, common in micro caps, like +900%).
 * - Averages are equal-weighted: every pick counts the same.
 */

export const BENCHMARK_TICKER = 'SPY';

/** A figure covering fewer days than this is labeled "too early to read". */
export const MIN_DAYS_TO_READ = 30;
/** A figure covering fewer picks than this is labeled "too early to read". */
export const MIN_PICKS_TO_READ = 10;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MARKET_OPEN_MINUTES = 9 * 60 + 30; // 9:30 ET
/** A daily bar counts as a final close only after 16:30 ET (market closes 16:00; 30-minute margin). */
const CLOSE_FINAL_MINUTES = 16 * 60 + 30;
/**
 * Weekend + a holiday never puts more than 4 calendar days between a date and the prior
 * trading close. 7 tolerates a short data gap but rejects stale data.
 */
export const MAX_CLOSE_GAP_DAYS = 7;
/**
 * A pick must beat SPY by more than this many percentage points to count as a hit. Smaller
 * gaps are ties: rounding noise between data sources, not outperformance (found live: a
 * same-day search showed a "100% hit rate" from a 0.0000003-point difference).
 */
export const HIT_MARGIN_PTS = 0.01;

export interface DailyClose {
  date: Date;
  close: number;
}

export interface SplitEvent {
  /** Ex-date (Yahoo stamps it at the market open of that day). */
  date: Date;
  /** "10:1" forward split = numerator 10, denominator 1. A 1-for-10 reverse split = 1 and 10. */
  numerator: number;
  denominator: number;
}

/** A specific trading day's close: `date` is that trading day (YYYY-MM-DD, US Eastern). */
export interface ResolvedClose {
  date: string;
  close: number;
}

// ---------------------------------------------------------------------------
// Dates (US market time)
// ---------------------------------------------------------------------------

const easternFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Calendar date (YYYY-MM-DD) and minutes past midnight of a moment, in US Eastern time. */
export function easternParts(moment: Date): { date: string; minutes: number } {
  const parts = Object.fromEntries(easternFormatter.formatToParts(moment).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/** Adds (or subtracts) whole days to a YYYY-MM-DD date. */
export function addDays(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

function calendarDaysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY);
}

/** Whole days between two moments (never negative). */
export function daysElapsed(from: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - from.getTime()) / MS_PER_DAY));
}

/**
 * The trading-day close that matches a price captured at `capturedAt`.
 *
 * A pick's saved price is a Finnhub quote taken when the search ran. Before the 9:30 ET
 * open that quote is still the previous session's close, so the matching date is the day
 * before. From the open onward it's that day (an intraday price during market hours, the
 * close after 16:00: the closest daily match available either way).
 *
 * Weekends and holidays are NOT handled here: findCloseOnOrBefore() steps back to the
 * nearest prior trading close.
 */
export function priceAsOfDate(capturedAt: Date): string {
  const { date, minutes } = easternParts(capturedAt);
  return minutes < MARKET_OPEN_MINUTES ? addDays(date, -1) : date;
}

/** True once a trading day's close is final (the day is over in US Eastern time). */
export function isFinalClose(tradingDate: string, now: Date): boolean {
  const today = easternParts(now);
  return tradingDate < today.date || (tradingDate === today.date && today.minutes >= CLOSE_FINAL_MINUTES);
}

/**
 * The close on `asOfDate`, or, when that day wasn't a trading day (weekend or market
 * holiday), the NEAREST PRIOR TRADING CLOSE. That's the price that stood on a non-trading
 * day: a search saved on Saturday saw Friday's close, so it's measured from Friday's close.
 *
 * Returns null when:
 * - there is no close within MAX_CLOSE_GAP_DAYS before the date (data gap or bad input), or
 * - the matching close isn't final yet (today, before 16:30 ET). Never used, so it can never
 *   be cached as if it were history.
 */
export function findCloseOnOrBefore(asOfDate: string, closes: DailyClose[], now: Date): ResolvedClose | null {
  let best: ResolvedClose | null = null;
  for (const bar of closes) {
    if (!(typeof bar.close === 'number' && Number.isFinite(bar.close) && bar.close > 0)) continue;
    const barDate = easternParts(bar.date).date;
    if (barDate > asOfDate) continue;
    if (!best || barDate > best.date) best = { date: barDate, close: bar.close };
  }
  if (!best) return null;
  if (calendarDaysBetween(best.date, asOfDate) > MAX_CLOSE_GAP_DAYS) return null;
  if (!isFinalClose(best.date, now)) return null;
  return best;
}

/**
 * How many of today's shares one share on `asOfDate` became, from the splits after that date.
 * 1 = no split. Divide the saved start price by this to compare it with today's price.
 */
export function splitFactorAfter(asOfDate: string, splits: SplitEvent[]): number {
  let factor = 1;
  for (const split of splits) {
    if (!(split.numerator > 0 && split.denominator > 0)) continue; // malformed event: ignore
    // A split on the as-of date itself is already in a price captured after that day's open
    if (easternParts(split.date).date > asOfDate) factor *= split.numerator / split.denominator;
  }
  return factor;
}

// ---------------------------------------------------------------------------
// Returns (shared with the Watchlist and Portfolio views)
// ---------------------------------------------------------------------------

const isPositive = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0;

/** Percent change from start to end. Null unless both are real positive prices. */
export function pctChange(start: number | null | undefined, end: number | null | undefined): number | null {
  if (!isPositive(start) || !isPositive(end)) return null;
  return ((end - start) / start) * 100;
}

/** Return minus SPY's return over the same window, in percentage points. Null if either is missing. */
export function excessReturn(pickReturn: number | null, benchmarkReturn: number | null): number | null {
  return pickReturn !== null && benchmarkReturn !== null ? pickReturn - benchmarkReturn : null;
}

// ---------------------------------------------------------------------------
// Per-pick outcome
// ---------------------------------------------------------------------------

export interface PickInput {
  ticker: string;
  companyName: string;
  /** Composite score at save time (relative within its own search only). */
  compositeScore: number | null;
  /** Price saved with the search; null = none was available then. */
  priceAtSearch: number | null;
}

export type PickStatus = 'included' | 'no_stored_price' | 'no_current_price';

export interface PickOutcome extends PickInput {
  status: PickStatus;
  currentPrice: number | null;
  /** Split adjustment applied (1 = none). Null = the split check itself failed (factor 1 used). */
  splitFactor: number | null;
  /** priceAtSearch adjusted for splits since: the price actually compared with today's. */
  startPrice: number | null;
  pickReturn: number | null;
  benchmarkReturn: number | null;
  excessReturn: number | null;
  /** True = beat SPY, false = didn't (a tie isn't a hit), null = can't tell. */
  beatBenchmark: boolean | null;
}

export function evaluatePick(
  pick: PickInput,
  currentPrice: number | null,
  splitFactor: number | null,
  benchmarkReturn: number | null
): PickOutcome {
  const empty = {
    ...pick,
    currentPrice: isPositive(currentPrice) ? currentPrice : null,
    splitFactor: null,
    startPrice: null,
    pickReturn: null,
    benchmarkReturn,
    excessReturn: null,
    beatBenchmark: null,
  };
  if (!isPositive(pick.priceAtSearch)) return { ...empty, status: 'no_stored_price' };
  if (!isPositive(currentPrice)) return { ...empty, status: 'no_current_price' };

  const factor = splitFactor !== null && splitFactor > 0 ? splitFactor : 1;
  const startPrice = pick.priceAtSearch / factor;
  const pickReturn = pctChange(startPrice, currentPrice);
  const excess = excessReturn(pickReturn, benchmarkReturn);
  return {
    ...pick,
    status: 'included',
    currentPrice,
    splitFactor: splitFactor !== null && splitFactor > 0 ? splitFactor : null,
    startPrice,
    pickReturn,
    benchmarkReturn,
    excessReturn: excess,
    beatBenchmark: excess === null ? null : excess > HIT_MARGIN_PTS,
  };
}

// ---------------------------------------------------------------------------
// Aggregates ("figures") with the honesty guards built in
// ---------------------------------------------------------------------------

export interface FigureRow {
  pickReturn: number;
  benchmarkReturn: number | null;
  days: number;
}

export interface Figure {
  /** Picks behind the average pick return. */
  picks: number;
  /** Picks behind SPY / difference / hit rate (those with a SPY return for their window). */
  picksVsBenchmark: number;
  minDays: number | null;
  maxDays: number | null;
  avgPickReturn: number | null;
  /** Average of SPY's return over each pick's own window (same window as the pick). */
  avgBenchmarkReturn: number | null;
  /** Average of (pick return - SPY return): "the difference", in percentage points. */
  avgExcessReturn: number | null;
  /** Share of picks (0..1) that beat SPY over their window. */
  hitRate: number | null;
  /** Under MIN_DAYS_TO_READ days or MIN_PICKS_TO_READ picks: noise, not a verdict. */
  tooEarly: boolean;
  tooEarlyReason: string | null;
}

const mean = (values: number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length;

export function summarize(rows: FigureRow[]): Figure {
  const withBenchmark = rows.filter((r): r is FigureRow & { benchmarkReturn: number } => r.benchmarkReturn !== null);
  const excess = withBenchmark.map((r) => r.pickReturn - r.benchmarkReturn);
  const days = rows.map((r) => r.days);
  const minDays = days.length ? Math.min(...days) : null;
  const maxDays = days.length ? Math.max(...days) : null;

  const reasons: string[] = [];
  if (rows.length === 0) reasons.push('no picks with prices');
  else {
    if (minDays !== null && minDays < MIN_DAYS_TO_READ) reasons.push(`only ${minDays} day${minDays === 1 ? '' : 's'} (needs ${MIN_DAYS_TO_READ})`);
    if (rows.length < MIN_PICKS_TO_READ) reasons.push(`only ${rows.length} pick${rows.length === 1 ? '' : 's'} (needs ${MIN_PICKS_TO_READ})`);
  }

  return {
    picks: rows.length,
    picksVsBenchmark: withBenchmark.length,
    minDays,
    maxDays,
    avgPickReturn: mean(rows.map((r) => r.pickReturn)),
    avgBenchmarkReturn: mean(withBenchmark.map((r) => r.benchmarkReturn)),
    avgExcessReturn: mean(excess),
    hitRate: excess.length ? excess.filter((e) => e > HIT_MARGIN_PTS).length / excess.length : null,
    tooEarly: reasons.length > 0,
    tooEarlyReason: reasons.length ? reasons.join('; ') : null,
  };
}

/**
 * Splits picks into the top-scored and bottom-scored halves of ONE search. Scores are
 * ranks within their own search, so this is the only valid comparison; scores are never
 * compared across searches. With an odd count the middle pick is left out so the halves
 * are equal. Ties are broken by ticker so the split is repeatable. Picks without a saved
 * score are left out and counted.
 */
export function splitByScore<T extends { ticker: string; compositeScore: number | null }>(
  picks: T[]
): { top: T[]; bottom: T[]; middleLeftOut: number; unscored: number } {
  const scored = picks.filter((p) => typeof p.compositeScore === 'number' && Number.isFinite(p.compositeScore));
  const sorted = [...scored].sort(
    (a, b) => (b.compositeScore as number) - (a.compositeScore as number) || a.ticker.localeCompare(b.ticker)
  );
  const half = Math.floor(sorted.length / 2);
  return {
    top: sorted.slice(0, half),
    bottom: sorted.slice(sorted.length - half),
    middleLeftOut: sorted.length % 2,
    unscored: picks.length - scored.length,
  };
}

// ---------------------------------------------------------------------------
// Per-search scorecard and the overall roll-up
// ---------------------------------------------------------------------------

export interface SearchInput {
  id: string;
  createdAt: Date;
  trends: string[];
  picks: PickInput[];
}

export interface SearchScorecard {
  searchId: string;
  createdAt: string;
  trends: string[];
  daysElapsed: number;
  picksTotal: number;
  excluded: { noStoredPrice: number; noCurrentPrice: number };
  splitAdjusted: number;
  splitCheckUnavailable: number;
  benchmark: {
    ticker: string;
    /** Trading day the search's prices correspond to (before weekend/holiday step-back). */
    asOfDate: string;
    /** Trading day whose close was actually used; null = unavailable. */
    startDate: string | null;
    startClose: number | null;
    /** True when the search ran on a weekend, holiday or before the open, so the prior close was used. */
    usedPriorClose: boolean;
    currentPrice: number | null;
    return: number | null;
  };
  figure: Figure;
  topHalf: Figure | null;
  bottomHalf: Figure | null;
  middleLeftOut: number;
  unscored: number;
  /** Old enough (MIN_DAYS_TO_READ+) to count in the overall figures. */
  countsInOverall: boolean;
  picks: PickOutcome[];
}

export interface ScorecardContext {
  now: Date;
  /** Current price per uppercase ticker (one quote per unique ticker). */
  prices: Map<string, number>;
  /** SPY close keyed by as-of date (null = unavailable). */
  benchmarkStarts: Map<string, ResolvedClose | null>;
  benchmarkCurrent: number | null;
  /** Split factor keyed by splitKey(ticker, asOfDate); missing or null = check unavailable. */
  splitFactors: Map<string, number | null>;
}

export const splitKey = (ticker: string, asOfDate: string) => `${ticker.toUpperCase()}|${asOfDate}`;

const toRows = (outcomes: PickOutcome[], days: number): FigureRow[] =>
  outcomes
    .filter((o): o is PickOutcome & { pickReturn: number } => o.status === 'included' && o.pickReturn !== null)
    .map((o) => ({ pickReturn: o.pickReturn, benchmarkReturn: o.benchmarkReturn, days }));

export function buildSearchScorecard(search: SearchInput, ctx: ScorecardContext): SearchScorecard {
  const asOfDate = priceAsOfDate(search.createdAt);
  const start = ctx.benchmarkStarts.get(asOfDate) ?? null;
  const benchmarkReturn = pctChange(start?.close, ctx.benchmarkCurrent);
  const days = daysElapsed(search.createdAt, ctx.now);

  const outcomes = search.picks.map((pick) => {
    const ticker = pick.ticker.toUpperCase();
    const factor = ctx.splitFactors.get(splitKey(ticker, asOfDate));
    return evaluatePick(pick, ctx.prices.get(ticker) ?? null, factor ?? null, benchmarkReturn);
  });

  const included = outcomes.filter((o) => o.status === 'included');
  const halves = splitByScore(included);

  return {
    searchId: search.id,
    createdAt: search.createdAt.toISOString(),
    trends: search.trends,
    daysElapsed: days,
    picksTotal: outcomes.length,
    excluded: {
      noStoredPrice: outcomes.filter((o) => o.status === 'no_stored_price').length,
      noCurrentPrice: outcomes.filter((o) => o.status === 'no_current_price').length,
    },
    splitAdjusted: included.filter((o) => o.splitFactor !== null && o.splitFactor !== 1).length,
    splitCheckUnavailable: included.filter((o) => o.splitFactor === null).length,
    benchmark: {
      ticker: BENCHMARK_TICKER,
      asOfDate,
      startDate: start?.date ?? null,
      startClose: start?.close ?? null,
      usedPriorClose: start !== null && start.date !== easternParts(search.createdAt).date,
      currentPrice: ctx.benchmarkCurrent,
      return: benchmarkReturn,
    },
    figure: summarize(toRows(outcomes, days)),
    topHalf: halves.top.length ? summarize(toRows(halves.top, days)) : null,
    bottomHalf: halves.bottom.length ? summarize(toRows(halves.bottom, days)) : null,
    middleLeftOut: halves.middleLeftOut,
    unscored: halves.unscored,
    countsInOverall: days >= MIN_DAYS_TO_READ,
    picks: outcomes,
  };
}

export interface OverallScorecard {
  searchesTotal: number;
  /** Searches at least MIN_DAYS_TO_READ days old: the only ones in the overall figures. */
  searchesCounted: number;
  /** Younger searches: shown individually, left out of the overall figures. */
  searchesTooYoung: number;
  excluded: { noStoredPrice: number; noCurrentPrice: number; noBenchmark: number };
  figure: Figure;
  topHalf: Figure;
  bottomHalf: Figure;
}

/**
 * Roll-up across searches. Only searches at least MIN_DAYS_TO_READ days old count: a
 * days-old search is mostly noise and would drag every average toward zero. Only picks
 * with a SPY return count, so "average pick return minus SPY" equals "the difference".
 * Top vs bottom half is split WITHIN each search first, then pooled.
 */
export function buildOverall(cards: SearchScorecard[]): OverallScorecard {
  const counted = cards.filter((c) => c.countsInOverall);
  const rowsFor = (picks: PickOutcome[], days: number) => toRows(picks, days).filter((r) => r.benchmarkReturn !== null);

  const all: FigureRow[] = [];
  const top: FigureRow[] = [];
  const bottom: FigureRow[] = [];
  let noBenchmark = 0;

  for (const card of counted) {
    const included = card.picks.filter((p) => p.status === 'included');
    noBenchmark += toRows(included, card.daysElapsed).length - rowsFor(included, card.daysElapsed).length;
    all.push(...rowsFor(included, card.daysElapsed));
    const halves = splitByScore(included);
    top.push(...rowsFor(halves.top, card.daysElapsed));
    bottom.push(...rowsFor(halves.bottom, card.daysElapsed));
  }

  return {
    searchesTotal: cards.length,
    searchesCounted: counted.length,
    searchesTooYoung: cards.length - counted.length,
    excluded: {
      noStoredPrice: counted.reduce((n, c) => n + c.excluded.noStoredPrice, 0),
      noCurrentPrice: counted.reduce((n, c) => n + c.excluded.noCurrentPrice, 0),
      noBenchmark,
    },
    figure: summarize(all),
    topHalf: summarize(top),
    bottomHalf: summarize(bottom),
  };
}
