import { describe, it, expect } from 'vitest';
import {
  buildOverall,
  buildSearchScorecard,
  DailyClose,
  easternParts,
  evaluatePick,
  excessReturn,
  findCloseOnOrBefore,
  isFinalClose,
  pctChange,
  PickInput,
  priceAsOfDate,
  ResolvedClose,
  splitByScore,
  splitFactorAfter,
  splitKey,
  summarize,
} from '../lib/trackRecord';

// Yahoo stamps each daily bar at the 9:30 ET open: 13:30 UTC in summer (EDT), 14:30 UTC in winter (EST)
const bar = (date: string, close: number): DailyClose => ({ date: new Date(`${date}T13:30:00Z`), close });

// SPY fixture around Labor Day 2026 (Monday 2026-09-07, market closed)
const SPY_CLOSES: DailyClose[] = [
  bar('2026-09-03', 745),
  bar('2026-09-04', 750), // Friday
  // 2026-09-05/06 weekend, 2026-09-07 Labor Day: no bars
  bar('2026-09-08', 755), // Tuesday
  bar('2026-09-11', 760), // Friday
  bar('2026-09-14', 758),
  bar('2026-09-15', 757.39),
];
const LONG_AFTER = new Date('2026-11-17T22:00:00Z');

describe('Track record math (Phase D)', () => {
  describe('pctChange / excessReturn', () => {
    it('computes percent change and the difference vs SPY', () => {
      expect(pctChange(100, 125)).toBeCloseTo(25);
      expect(pctChange(80, 60)).toBeCloseTo(-25);
      expect(excessReturn(25, -3.3)).toBeCloseTo(28.3);
    });

    it('is null (N/A), never 0, when either price is missing, zero or negative', () => {
      expect(pctChange(null, 100)).toBeNull();
      expect(pctChange(0, 100)).toBeNull();
      expect(pctChange(100, null)).toBeNull();
      expect(pctChange(100, -1)).toBeNull();
      expect(excessReturn(null, 5)).toBeNull();
      expect(excessReturn(5, null)).toBeNull();
    });
  });

  describe('Which SPY close a search is measured from', () => {
    it('uses US Eastern dates, including across daylight-saving time and late evenings', () => {
      expect(easternParts(new Date('2026-09-15T19:09:50Z'))).toEqual({ date: '2026-09-15', minutes: 15 * 60 + 9 });
      // 22:00 EST on the 17th is already the 18th in UTC
      expect(easternParts(new Date('2026-11-18T03:00:00Z')).date).toBe('2026-11-17');
    });

    it('a search during or after market hours matches that day; before the open, the day before', () => {
      expect(priceAsOfDate(new Date('2026-09-15T19:09:50Z'))).toBe('2026-09-15'); // 15:09 ET
      expect(priceAsOfDate(new Date('2026-11-17T22:36:28Z'))).toBe('2026-11-17'); // 17:36 ET
      // 08:00 ET: the quote was still Monday's close
      expect(priceAsOfDate(new Date('2026-09-15T12:00:00Z'))).toBe('2026-09-14');
    });

    it('a weekend search uses the nearest prior trading close (Friday)', () => {
      // Saturday 2026-09-12: the market was shut, the price that stood was Friday's close
      const asOf = priceAsOfDate(new Date('2026-09-12T15:00:00Z'));
      expect(asOf).toBe('2026-09-12');
      expect(findCloseOnOrBefore(asOf, SPY_CLOSES, LONG_AFTER)).toEqual({ date: '2026-09-11', close: 760 });
    });

    it('a market-holiday search uses the nearest prior trading close (Labor Day -> the Friday before)', () => {
      // Monday 2026-09-07 (Labor Day): no bar that day, nearest prior trading close is Friday 09-04
      const asOf = priceAsOfDate(new Date('2026-09-07T18:00:00Z'));
      expect(findCloseOnOrBefore(asOf, SPY_CLOSES, LONG_AFTER)).toEqual({ date: '2026-09-04', close: 750 });
    });

    it('a trading-day search uses that day’s own close', () => {
      expect(findCloseOnOrBefore('2026-09-15', SPY_CLOSES, LONG_AFTER)).toEqual({ date: '2026-09-15', close: 757.39 });
    });

    it('returns null instead of reaching back more than a week (data gap)', () => {
      expect(findCloseOnOrBefore('2026-09-30', SPY_CLOSES, LONG_AFTER)).toBeNull();
      expect(findCloseOnOrBefore('2026-08-01', SPY_CLOSES, LONG_AFTER)).toBeNull();
    });

    it('never uses today’s close before it is final (16:30 ET)', () => {
      const today = [bar('2026-11-17', 732.44)];
      expect(isFinalClose('2026-11-17', new Date('2026-11-17T21:00:00Z'))).toBe(false); // 16:00 EST
      expect(findCloseOnOrBefore('2026-11-17', today, new Date('2026-11-17T21:00:00Z'))).toBeNull();
      expect(findCloseOnOrBefore('2026-11-17', today, new Date('2026-11-17T21:31:00Z'))).toEqual({
        date: '2026-11-17',
        close: 732.44,
      });
    });
  });

  describe('Stock splits after the search', () => {
    it('a 10-for-1 split divides the old price by 10; a 1-for-10 reverse split multiplies it by 10', () => {
      const forward = [{ date: new Date('2026-10-01T13:30:00Z'), numerator: 10, denominator: 1 }];
      const reverse = [{ date: new Date('2026-10-01T13:30:00Z'), numerator: 1, denominator: 10 }];
      expect(splitFactorAfter('2026-09-15', forward)).toBe(10);
      expect(splitFactorAfter('2026-09-15', reverse)).toBeCloseTo(0.1);
    });

    it('ignores splits on or before the as-of date (already in the saved price) and malformed events', () => {
      const splits = [
        { date: new Date('2026-09-15T13:30:00Z'), numerator: 2, denominator: 1 },
        { date: new Date('2026-08-01T13:30:00Z'), numerator: 3, denominator: 1 },
        { date: new Date('2026-10-01T13:30:00Z'), numerator: 0, denominator: 1 },
      ];
      expect(splitFactorAfter('2026-09-15', splits)).toBe(1);
    });
  });

  describe('One pick', () => {
    const pick = (over: Partial<PickInput> = {}): PickInput => ({
      ticker: 'ACME',
      companyName: 'Acme',
      compositeScore: 70,
      priceAtSearch: 100,
      ...over,
    });

    it('computes return, difference vs SPY and whether it beat SPY', () => {
      const out = evaluatePick(pick(), 120, 1, 5);
      expect(out.status).toBe('included');
      expect(out.pickReturn).toBeCloseTo(20);
      expect(out.excessReturn).toBeCloseTo(15);
      expect(out.beatBenchmark).toBe(true);
    });

    it('a pick with no saved price is excluded, not guessed', () => {
      for (const priceAtSearch of [null, 0]) {
        const out = evaluatePick(pick({ priceAtSearch }), 120, 1, 5);
        expect(out.status).toBe('no_stored_price');
        expect(out.pickReturn).toBeNull();
        expect(out.beatBenchmark).toBeNull();
      }
    });

    it('a delisted ticker (no current quote) is excluded, not counted as 0% or -100%', () => {
      const out = evaluatePick(pick({ ticker: 'GONE' }), null, null, 5);
      expect(out.status).toBe('no_current_price');
      expect(out.pickReturn).toBeNull();
      expect(out.excessReturn).toBeNull();
    });

    it('adjusts the start price for a split (10-for-1: $1000 then is $100 now)', () => {
      const out = evaluatePick(pick({ priceAtSearch: 1000 }), 110, 10, 0);
      expect(out.startPrice).toBe(100);
      expect(out.pickReturn).toBeCloseTo(10);
    });

    it('when the split check failed it still counts the pick, unadjusted, and says so (splitFactor null)', () => {
      const out = evaluatePick(pick(), 110, null, 0);
      expect(out.status).toBe('included');
      expect(out.splitFactor).toBeNull();
      expect(out.pickReturn).toBeCloseTo(10);
    });

    it('with no SPY return the pick return still shows but the difference is N/A', () => {
      const out = evaluatePick(pick(), 120, 1, null);
      expect(out.pickReturn).toBeCloseTo(20);
      expect(out.excessReturn).toBeNull();
      expect(out.beatBenchmark).toBeNull();
    });

    it('matching SPY exactly is not a hit', () => {
      expect(evaluatePick(pick(), 105, 1, 5).beatBenchmark).toBe(false);
    });
  });

  describe('Figures and the "too early to read" label', () => {
    const rows = (returns: number[], spy: number | null, days: number) =>
      returns.map((pickReturn) => ({ pickReturn, benchmarkReturn: spy, days }));

    it('averages pick returns, SPY and the difference, and computes the hit rate', () => {
      const f = summarize(rows([10, -20, 30, 0, 5, 15, -5, 25, 40, -10], 5, 45));
      expect(f.picks).toBe(10);
      expect(f.avgPickReturn).toBeCloseTo(9);
      expect(f.avgBenchmarkReturn).toBeCloseTo(5);
      expect(f.avgExcessReturn).toBeCloseTo(4);
      expect(f.hitRate).toBeCloseTo(0.5); // 10, 30, 15, 25, 40 beat +5
      expect(f.tooEarly).toBe(false);
      expect(f.tooEarlyReason).toBeNull();
    });

    it('is too early under 30 days or under 10 picks, and says why', () => {
      expect(summarize(rows([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0, 29)).tooEarlyReason).toBe('only 29 days (needs 30)');
      expect(summarize(rows([1, 2, 3], 0, 60)).tooEarlyReason).toBe('only 3 picks (needs 10)');
      expect(summarize(rows([1], 0, 1)).tooEarlyReason).toBe('only 1 day (needs 30); only 1 pick (needs 10)');
      expect(summarize([]).tooEarly).toBe(true);
      expect(summarize([]).avgPickReturn).toBeNull();
      expect(summarize([]).hitRate).toBeNull();
    });

    it('without SPY data the pick average shows and SPY, difference and hit rate are N/A', () => {
      const f = summarize(rows([10, 20], null, 40));
      expect(f.avgPickReturn).toBeCloseTo(15);
      expect(f.avgBenchmarkReturn).toBeNull();
      expect(f.avgExcessReturn).toBeNull();
      expect(f.hitRate).toBeNull();
      expect(f.picksVsBenchmark).toBe(0);
    });
  });

  describe('Top-scored half vs bottom-scored half', () => {
    const p = (ticker: string, compositeScore: number | null) => ({ ticker, compositeScore });

    it('splits by score, leaves the middle pick out on odd counts and counts unscored picks', () => {
      const halves = splitByScore([p('A', 90), p('B', 50), p('C', 70), p('D', null), p('E', 60), p('F', 80)]);
      // Scored: A90 F80 C70 E60 B50 -> top A,F; middle C left out; bottom E,B
      expect(halves.top.map((x) => x.ticker)).toEqual(['A', 'F']);
      expect(halves.bottom.map((x) => x.ticker)).toEqual(['E', 'B']);
      expect(halves.middleLeftOut).toBe(1);
      expect(halves.unscored).toBe(1);
    });

    it('breaks score ties by ticker so the split is repeatable', () => {
      const halves = splitByScore([p('Z', 50), p('A', 50)]);
      expect(halves.top[0].ticker).toBe('A');
    });
  });

  describe('A whole search (fixtures, incl. a missing price and a delisted ticker)', () => {
    const NOW = new Date('2026-11-17T22:00:00Z'); // 17:00 EST
    const search = {
      id: 's1',
      createdAt: new Date('2026-09-12T15:00:00Z'), // Saturday -> Friday 09-11 close
      trends: ['quantum computing hardware'],
      picks: [
        { ticker: 'AAA', companyName: 'A', compositeScore: 90, priceAtSearch: 100 }, // -> 130: +30
        { ticker: 'BBB', companyName: 'B', compositeScore: 80, priceAtSearch: 50 }, //  -> 55: +10
        { ticker: 'CCC', companyName: 'C', compositeScore: 60, priceAtSearch: 20 }, //  -> 18: -10
        { ticker: 'DDD', companyName: 'D', compositeScore: 50, priceAtSearch: 1000 }, // 10:1 split -> 90: -10
        { ticker: 'NOPX', companyName: 'No price', compositeScore: 70, priceAtSearch: null },
        { ticker: 'GONE', companyName: 'Delisted', compositeScore: 40, priceAtSearch: 10 },
      ] as PickInput[],
    };
    const asOf = '2026-09-12';
    const ctx = {
      now: NOW,
      prices: new Map([
        ['AAA', 130],
        ['BBB', 55],
        ['CCC', 18],
        ['DDD', 90],
        // GONE: no quote
      ]),
      benchmarkStarts: new Map<string, ResolvedClose | null>([[asOf, { date: '2026-09-11', close: 760 }]]),
      benchmarkCurrent: 722, // SPY -5%
      splitFactors: new Map<string, number | null>([
        [splitKey('AAA', asOf), 1],
        [splitKey('BBB', asOf), 1],
        [splitKey('CCC', asOf), null], // split check failed
        [splitKey('DDD', asOf), 10],
      ]),
    };

    it('computes the four numbers, counts exclusions and flags it too early (4 picks)', () => {
      const card = buildSearchScorecard(search, ctx);
      expect(card.daysElapsed).toBe(66);
      expect(card.picksTotal).toBe(6);
      expect(card.excluded).toEqual({ noStoredPrice: 1, noCurrentPrice: 1 });
      expect(card.splitAdjusted).toBe(1);
      expect(card.splitCheckUnavailable).toBe(1);

      expect(card.benchmark.startDate).toBe('2026-09-11');
      expect(card.benchmark.usedPriorClose).toBe(true); // Saturday search
      expect(card.benchmark.return).toBeCloseTo(-5);

      expect(card.figure.picks).toBe(4);
      expect(card.figure.avgPickReturn).toBeCloseTo(5); // (30 + 10 - 10 - 10) / 4
      expect(card.figure.avgBenchmarkReturn).toBeCloseTo(-5);
      expect(card.figure.avgExcessReturn).toBeCloseTo(10);
      expect(card.figure.hitRate).toBeCloseTo(0.5); // AAA, BBB beat -5%; CCC and DDD at -10% didn't
      expect(card.figure.tooEarly).toBe(true);
      expect(card.figure.tooEarlyReason).toBe('only 4 picks (needs 10)');

      // Halves within the search: AAA, BBB (top) vs CCC, DDD (bottom)
      expect(card.topHalf?.avgPickReturn).toBeCloseTo(20);
      expect(card.bottomHalf?.avgPickReturn).toBeCloseTo(-10);
      expect(card.countsInOverall).toBe(true);
    });

    it('with no SPY close for the window, the difference and hit rate are N/A', () => {
      const card = buildSearchScorecard(search, { ...ctx, benchmarkStarts: new Map([[asOf, null]]) });
      expect(card.benchmark.return).toBeNull();
      expect(card.figure.avgPickReturn).toBeCloseTo(5);
      expect(card.figure.avgExcessReturn).toBeNull();
      expect(card.figure.hitRate).toBeNull();
    });

    it('the overall roll-up leaves out searches under 30 days old and pools halves split within each search', () => {
      const old = buildSearchScorecard(search, ctx);
      const young = buildSearchScorecard(
        { ...search, id: 's2', createdAt: new Date('2026-11-10T18:00:00Z') },
        { ...ctx, benchmarkStarts: new Map([['2026-11-10', { date: '2026-11-10', close: 700 }]]) }
      );
      expect(young.countsInOverall).toBe(false);

      const overall = buildOverall([old, young]);
      expect(overall.searchesTotal).toBe(2);
      expect(overall.searchesCounted).toBe(1);
      expect(overall.searchesTooYoung).toBe(1);
      expect(overall.figure.picks).toBe(4);
      expect(overall.figure.avgExcessReturn).toBeCloseTo(10);
      expect(overall.topHalf.avgExcessReturn).toBeCloseTo(25); // (35 + 15) / 2
      expect(overall.bottomHalf.avgExcessReturn).toBeCloseTo(-5); // (-5 + -5) / 2
      expect(overall.excluded).toEqual({ noStoredPrice: 1, noCurrentPrice: 1, noBenchmark: 0 });
    });
  });
});
