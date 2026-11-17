/**
 * Phase C "honest scoring" tests for src/lib/scoring.ts. Pure functions, no external APIs.
 */
import { describe, it, expect } from 'vitest';
import {
  buildScoringConfig,
  calculateCompanyScores,
  DEFAULT_WEIGHTS,
  effectiveWeightShares,
  parseScoringConfig,
  percentileScores,
  scoreAndRank,
} from '../lib/scoring';
import { ScoredCompanyData, ScoringWeights } from '../lib/types';

/** A fully-populated company; override per test. */
const company = (ticker: string, overrides: Partial<ScoredCompanyData> = {}): ScoredCompanyData => ({
  ticker,
  companyName: `${ticker} Inc.`,
  relevanceScore: 7,
  trendsMatched: ['T1'],
  convergenceScore: 1,
  rationales: { T1: 'fits' },
  stockPrice: 10,
  marketCap: 500_000_000,
  exchange: 'NASDAQ',
  dataQuality: { priceSource: 'live' },
  peRatio: null,
  debtToEquity: 0.5,
  priceToSales: 5,
  preRevenue: false,
  lossMaking: true,
  revenueGrowthYoY: 20,
  growth1Y: 10,
  compositeScore: 0,
  ...overrides,
});

const only = (key: keyof ScoringWeights): ScoringWeights => ({
  relevance: 0,
  convergence: 0,
  valuation: 0,
  health: 0,
  growth: 0,
  [key]: 100,
});

const byTicker = (rows: ScoredCompanyData[]) => Object.fromEntries(rows.map((r) => [r.ticker, r]));

describe('percentileScores (rank-based scaling)', () => {
  it('spreads values evenly by rank, best = 1 and worst = 0', () => {
    expect(percentileScores([10, 30, 20], true)).toEqual([0, 1, 0.5]);
    expect(percentileScores([10, 30, 20], false)).toEqual([1, 0, 0.5]);
  });

  it('gives ties the same (average) rank', () => {
    expect(percentileScores([5, 5, 1], true)).toEqual([0.75, 0.75, 0]);
  });

  it('returns null for missing values and ranks only the rest', () => {
    expect(percentileScores([null, 2, 8], true)).toEqual([null, 0, 1]);
  });

  it('is neutral (0.5) when there is nothing to compare against', () => {
    expect(percentileScores([42], true)).toEqual([0.5]);
    expect(percentileScores([null, 7], false)).toEqual([null, 0.5]);
  });

  it('treats +Infinity as the worst possible value for lower-is-better', () => {
    expect(percentileScores([Infinity, 3, 1], false)).toEqual([0, 0.5, 1]);
  });
});

describe('Single-thesis convergence (decision D2)', () => {
  const rows = [
    company('AAA', { relevanceScore: 9, priceToSales: 2, debtToEquity: 0.1, revenueGrowthYoY: 80 }),
    company('BBB', { relevanceScore: 5, priceToSales: 9, debtToEquity: 1.5, revenueGrowthYoY: 5 }),
    company('CCC', { relevanceScore: 7, priceToSales: 4, debtToEquity: 0.8, revenueGrowthYoY: 30 }),
  ];

  it('a one-thesis run has no constant convergence term in any score', () => {
    const scored = calculateCompanyScores(rows, DEFAULT_WEIGHTS, { thesesRun: 1 });
    for (const r of scored) {
      expect(r.convergenceScore).toBe(1); // every row "matched 1 of 1"...
      expect(r.scoreBreakdown!.factors.convergence).toEqual({ status: 'excluded', value: null, weightPct: 0, points: 0 });
    }
    // ...and the convergence slider position makes no difference at all
    const heavy = calculateCompanyScores(rows, { ...DEFAULT_WEIGHTS, convergence: 100 }, { thesesRun: 1 });
    const none = calculateCompanyScores(rows, { ...DEFAULT_WEIGHTS, convergence: 0 }, { thesesRun: 1 });
    expect(heavy.map((r) => r.compositeScore)).toEqual(none.map((r) => r.compositeScore));
    expect(heavy.map((r) => r.compositeScore)).toEqual(scored.map((r) => r.compositeScore));
  });

  it("spreads convergence's weight over the other four factors", () => {
    const shares = effectiveWeightShares(DEFAULT_WEIGHTS, 1);
    expect(shares.convergence).toBe(0);
    // Defaults 25/25/20/15/15 without convergence: 25/75, 20/75, 15/75, 15/75
    expect(shares.relevance).toBeCloseTo(25 / 75);
    expect(shares.growth).toBeCloseTo(20 / 75);
    expect(shares.relevance + shares.growth + shares.valuation + shares.health).toBeCloseTo(1);
  });

  it('the old bug is gone: one thesis no longer adds the same points to every row', () => {
    // Convergence-only weights used to give every single-thesis row 100 points.
    const scored = calculateCompanyScores(rows, only('convergence'), { thesesRun: 1 });
    expect(scored.every((r) => r.compositeScore === 0)).toBe(true);
  });

  it('two-thesis behavior is unchanged: convergence = share of theses matched', () => {
    const two = [
      company('BOTH', { trendsMatched: ['T1', 'T2'], convergenceScore: 1 }),
      company('ONE', { trendsMatched: ['T1'], convergenceScore: 0.5 }),
    ];
    const scored = byTicker(calculateCompanyScores(two, only('convergence'), { thesesRun: 2 }));
    expect(scored.BOTH.compositeScore).toBe(100);
    expect(scored.ONE.compositeScore).toBe(50);
    expect(scored.BOTH.scoreBreakdown!.factors.convergence.status).toBe('ai');
  });

  it('a 3-thesis run where 2 failed (thesesRun = 1) is treated as single-thesis', () => {
    const scored = calculateCompanyScores(rows, DEFAULT_WEIGHTS, { thesesRun: 1 });
    expect(scored[0].scoreBreakdown!.factors.convergence.status).toBe('excluded');
  });
});

describe('Robust scaling: outliers', () => {
  const base = [
    company('A', { priceToSales: 2, relevanceScore: 6 }),
    company('B', { priceToSales: 5, relevanceScore: 6 }),
    company('C', { priceToSales: 8, relevanceScore: 6 }),
    company('D', { priceToSales: 12, relevanceScore: 6 }),
  ];
  const order = (rows: ScoredCompanyData[]) =>
    scoreAndRank(rows, DEFAULT_WEIGHTS, { thesesRun: 1 })
      .map((r) => r.ticker)
      .filter((t) => t !== 'OUTLIER');

  it('an extreme P/E outlier does not change the rank order of the other companies', () => {
    const withPE = base.map((c, i) => ({ ...c, peRatio: [8, 15, 22, 30][i] }));
    const outlier = company('OUTLIER', { peRatio: 4000, priceToSales: 6 });
    expect(order([...withPE, outlier])).toEqual(order(withPE));
  });

  it('an extreme P/S outlier (the valuation input) does not change the others’ rank order or flatten them', () => {
    const outlier = company('OUTLIER', { priceToSales: 4000 });
    expect(order([...base, outlier])).toEqual(order(base));

    const vals = byTicker(calculateCompanyScores([...base, outlier], only('valuation'), { thesesRun: 1 }));
    // Min-max would put A..D all within 0.3% of each other next to a 4000x P/S. Ranks keep them spread.
    expect(vals.A.compositeScore).toBe(100);
    expect(vals.B.compositeScore).toBe(75);
    expect(vals.C.compositeScore).toBe(50);
    expect(vals.D.compositeScore).toBe(25);
    expect(vals.OUTLIER.compositeScore).toBe(0);
  });
});

describe('Loss-making and pre-revenue companies', () => {
  it('unprofitable companies (no P/E) get distinct valuation scores from P/S, not all 0.5', () => {
    const rows = [
      company('L1', { peRatio: null, lossMaking: true, priceToSales: 3 }),
      company('L2', { peRatio: null, lossMaking: true, priceToSales: 15 }),
      company('L3', { peRatio: null, lossMaking: true, priceToSales: 45 }),
    ];
    const scored = calculateCompanyScores(rows, only('valuation'), { thesesRun: 1 });
    const values = scored.map((r) => r.scoreBreakdown!.factors.valuation.value);
    expect(values).toEqual([1, 0.5, 0]);
    expect(scored.every((r) => r.scoreBreakdown!.factors.valuation.status === 'real')).toBe(true);
  });

  it('pre-revenue companies rank last on valuation (real "no revenue"), not neutral', () => {
    const rows = [
      company('REV', { priceToSales: 40 }),
      company('PRE', { priceToSales: null, preRevenue: true }),
    ];
    const scored = byTicker(calculateCompanyScores(rows, only('valuation'), { thesesRun: 1 }));
    expect(scored.PRE.scoreBreakdown!.factors.valuation).toMatchObject({ status: 'real', value: 0 });
    expect(scored.REV.scoreBreakdown!.factors.valuation.value).toBe(1);
  });

  it('negative debt-to-equity (negative equity) ranks last on health instead of being dropped', () => {
    const rows = [company('POS', { debtToEquity: 3 }), company('NEG', { debtToEquity: -2 })];
    const scored = byTicker(calculateCompanyScores(rows, only('health'), { thesesRun: 1 }));
    expect(scored.NEG.scoreBreakdown!.factors.health).toMatchObject({ status: 'real', value: 0 });
    expect(scored.POS.scoreBreakdown!.factors.health.value).toBe(1);
  });
});

describe('Revenue growth factor (decision D3)', () => {
  it('higher revenue growth ranks higher', () => {
    const rows = [company('SLOW', { revenueGrowthYoY: -5 }), company('FAST', { revenueGrowthYoY: 120 })];
    const scored = byTicker(calculateCompanyScores(rows, only('growth'), { thesesRun: 1 }));
    expect(scored.FAST.compositeScore).toBe(100);
    expect(scored.SLOW.compositeScore).toBe(0);
  });

  it('price growth and the 6M rally flag never move the score', () => {
    const rows = [company('X'), company('Y', { revenueGrowthYoY: 50 })];
    const before = calculateCompanyScores(rows, DEFAULT_WEIGHTS, { thesesRun: 1 }).map((r) => r.compositeScore);
    const ran = rows.map((r) => ({ ...r, growth1Y: 900, growth5Y: 5000, change6M: 300, rallied6M: true }));
    const after = calculateCompanyScores(ran, DEFAULT_WEIGHTS, { thesesRun: 1 }).map((r) => r.compositeScore);
    expect(after).toEqual(before);
  });
});

describe('Missing data and the breakdown', () => {
  it('a missing factor sits at neutral 0.5, is marked missing, and lowers coverage', () => {
    const rows = [
      company('FULL'),
      company('GAPS', { priceToSales: null, preRevenue: null, revenueGrowthYoY: null }),
      company('OTHER', { priceToSales: 9, revenueGrowthYoY: 1 }),
    ];
    const scored = byTicker(calculateCompanyScores(rows, DEFAULT_WEIGHTS, { thesesRun: 1 }));
    const gaps = scored.GAPS.scoreBreakdown!;
    expect(gaps.factors.valuation).toMatchObject({ status: 'missing', value: 0.5 });
    expect(gaps.factors.growth).toMatchObject({ status: 'missing', value: 0.5 });
    expect(gaps.factors.health.status).toBe('real');
    expect(gaps.coverage).toEqual({ real: 1, total: 3 });
    expect(scored.FULL.scoreBreakdown!.coverage).toEqual({ real: 3, total: 3 });
  });

  it('rows saved before Phase C (no P/S or revenue growth fields) score as missing, not invented', () => {
    const legacy = company('OLD');
    delete legacy.priceToSales;
    delete legacy.preRevenue;
    delete legacy.revenueGrowthYoY;
    const [scored] = calculateCompanyScores([legacy, company('NEW')], DEFAULT_WEIGHTS, { thesesRun: 1 });
    expect(scored.scoreBreakdown!.factors.valuation.status).toBe('missing');
    expect(scored.scoreBreakdown!.factors.growth.status).toBe('missing');
  });

  it("each factor's points add up to the composite score, and relevance is labeled AI", () => {
    const rows = [company('A', { relevanceScore: 10 }), company('B', { relevanceScore: 1, trendsMatched: ['T1', 'T2'] })];
    const scored = calculateCompanyScores(rows, DEFAULT_WEIGHTS, { thesesRun: 2 });
    for (const r of scored) {
      const f = r.scoreBreakdown!.factors;
      const sum = f.relevance.points + f.convergence.points + f.valuation.points + f.health.points + f.growth.points;
      expect(r.compositeScore).toBeCloseTo(sum, 1);
      expect(f.relevance.status).toBe('ai');
      const totalWeight = Object.values(f).reduce((s, x) => s + x.weightPct, 0);
      expect(totalWeight).toBeCloseTo(100);
    }
    expect(scored[0].scoreBreakdown!.factors.relevance.value).toBe(1); // 10/10
    expect(scored[1].scoreBreakdown!.factors.relevance.value).toBe(0); // 1/10
  });

  it('all-zero weights give a score of 0 rather than dividing by zero', () => {
    const zero: ScoringWeights = { relevance: 0, convergence: 0, valuation: 0, health: 0, growth: 0 };
    const [r] = calculateCompanyScores([company('Z')], zero, { thesesRun: 1 });
    expect(r.compositeScore).toBe(0);
  });
});

describe('Saved scoring config (step 7)', () => {
  it('round-trips weights and theses-run count', () => {
    const cfg = buildScoringConfig({ ...DEFAULT_WEIGHTS, growth: 60 }, 3);
    expect(parseScoringConfig(JSON.parse(JSON.stringify(cfg)))).toEqual(cfg);
  });

  it('rejects junk and fills a missing weight with the default', () => {
    expect(parseScoringConfig(null)).toBeNull();
    expect(parseScoringConfig({ weights: {} })).toBeNull(); // no thesesRun
    const partial = parseScoringConfig({ weights: { relevance: 50, growth: 'x' }, thesesRun: 1 });
    expect(partial!.weights.relevance).toBe(50);
    expect(partial!.weights.growth).toBe(DEFAULT_WEIGHTS.growth);
  });
});
