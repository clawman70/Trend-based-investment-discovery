/**
 * Composite score (0-100), computed in the browser. Phase C ("honest scoring") rules:
 *
 * Five factors, each turned into a 0..1 factor score, then weighted by the sliders:
 *   relevance   - the AI's 1-10 fit rating from discovery (AI, fixed 1..10 scale)
 *   convergence - share of the theses that found this company (AI-derived).
 *                 EXCLUDED when only one thesis ran (decision D2): it would be the same
 *                 number for every row, so its weight is spread over the other factors.
 *   valuation   - price-to-sales (Finnhub psTTM), lower is better. P/S exists for
 *                 loss-making companies, unlike P/E. Pre-revenue companies (Finnhub reports
 *                 zero revenue) rank last: their P/S is effectively infinite.
 *   health      - debt-to-equity, lower is better. Negative D/E (negative equity, i.e.
 *                 liabilities exceed assets) ranks last instead of being dropped.
 *   growth      - revenue growth YoY (Finnhub), higher is better (decision D3). Price
 *                 growth is never scored as a positive.
 *
 * Valuation, health and growth use RANK (percentile) scaling within the result set: the
 * best company gets 1, the worst 0, the rest are evenly spaced by rank. One extreme
 * outlier can therefore never squash everyone else together (min-max could).
 *
 * A factor with no data sits at neutral (0.5) and is marked "missing" in the breakdown —
 * never filled with a guess. The 6-month rally flag is display-only (decision D4).
 */
import {
  FactorContribution,
  ScoreBreakdown,
  ScoredCompanyData,
  ScoreFactorKey,
  ScoringConfig,
  ScoringWeights,
} from './types';

/** Defaults from the v2 requirements doc (section 2.3). */
export const DEFAULT_WEIGHTS: ScoringWeights = {
  relevance: 25,
  convergence: 25,
  growth: 20,
  valuation: 15,
  health: 15,
};

export const FACTOR_KEYS: ScoreFactorKey[] = ['relevance', 'convergence', 'valuation', 'health', 'growth'];

/** The factors that come from market data, counted by the coverage indicator. */
export const MARKET_DATA_FACTORS: ScoreFactorKey[] = ['valuation', 'health', 'growth'];

const NEUTRAL = 0.5;

export interface ScoringOptions {
  /** Theses that actually returned results this run. <= 1 excludes convergence (D2). */
  thesesRun: number;
}

/** Convergence only carries information when more than one thesis ran. */
export const isConvergenceActive = (thesesRun: number): boolean => thesesRun > 1;

/**
 * Rank-based scaling. `values[i]` is null when company i has no data (it gets null back).
 * Among the rest, the best value scores 1 and the worst 0; ties share their average rank.
 * +Infinity is allowed and means "worst possible" (pre-revenue P/S, negative-equity D/E).
 * With fewer than two real values there's nothing to compare against, so they get 0.5.
 */
export function percentileScores(values: (number | null)[], higherIsBetter: boolean): (number | null)[] {
  const present = values.filter((v): v is number => v !== null && !Number.isNaN(v));
  const n = present.length;
  return values.map((v) => {
    if (v === null || Number.isNaN(v)) return null;
    if (n < 2) return NEUTRAL;
    let worse = 0;
    let ties = 0;
    for (const other of present) {
      if (other === v) ties++;
      else if (higherIsBetter ? other < v : other > v) worse++;
    }
    // Average rank among ties (ties includes v itself), mapped to 0..1
    return (worse + (ties - 1) / 2) / (n - 1);
  });
}

/** Valuation input: P/S, with pre-revenue ranked as the worst possible value. */
function valuationInput(c: ScoredCompanyData): number | null {
  if (typeof c.priceToSales === 'number' && c.priceToSales > 0) return c.priceToSales;
  if (c.preRevenue === true) return Number.POSITIVE_INFINITY;
  return null;
}

/** Health input: D/E, with negative equity ranked as the worst possible value. */
function healthInput(c: ScoredCompanyData): number | null {
  const dte = c.debtToEquity;
  if (typeof dte !== 'number' || !Number.isFinite(dte)) return null;
  return dte < 0 ? Number.POSITIVE_INFINITY : dte;
}

function growthInput(c: ScoredCompanyData): number | null {
  const g = c.revenueGrowthYoY;
  return typeof g === 'number' && Number.isFinite(g) ? g : null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Share of total weight per factor for this run (convergence zeroed when excluded). */
export function effectiveWeightShares(weights: ScoringWeights, thesesRun: number): Record<ScoreFactorKey, number> {
  const active = FACTOR_KEYS.filter((k) => k !== 'convergence' || isConvergenceActive(thesesRun));
  const total = active.reduce((sum, k) => sum + Math.max(0, weights[k] || 0), 0);
  const shares = {} as Record<ScoreFactorKey, number>;
  for (const k of FACTOR_KEYS) {
    shares[k] = total > 0 && active.includes(k) ? Math.max(0, weights[k] || 0) / total : 0;
  }
  return shares;
}

export function calculateCompanyScores(
  companies: ScoredCompanyData[],
  weights: ScoringWeights,
  options: ScoringOptions
): ScoredCompanyData[] {
  const convergenceActive = isConvergenceActive(options.thesesRun);
  const shares = effectiveWeightShares(weights, options.thesesRun);

  const valuation = percentileScores(companies.map(valuationInput), false); // lower P/S = better
  const health = percentileScores(companies.map(healthInput), false); // lower D/E = better
  const growth = percentileScores(companies.map(growthInput), true); // higher growth = better

  return companies.map((c, i) => {
    const factor = (status: FactorContribution['status'], value: number | null, key: ScoreFactorKey): FactorContribution => {
      const used = status === 'excluded' ? null : value ?? NEUTRAL;
      const weightPct = shares[key] * 100;
      return { status, value: used, weightPct, points: used === null ? 0 : used * weightPct };
    };
    const marketFactor = (value: number | null, key: ScoreFactorKey) =>
      factor(value === null ? 'missing' : 'real', value, key);

    // Relevance: AI 1-10 on a fixed scale (not relative to the others). 5 if absent.
    const relevance = Math.max(1, Math.min(10, c.relevanceScore || 5));

    const factors: Record<ScoreFactorKey, FactorContribution> = {
      relevance: factor('ai', (relevance - 1) / 9, 'relevance'),
      convergence: convergenceActive
        ? factor('ai', Math.max(0, Math.min(1, c.convergenceScore || 0)), 'convergence')
        : factor('excluded', null, 'convergence'),
      valuation: marketFactor(valuation[i], 'valuation'),
      health: marketFactor(health[i], 'health'),
      growth: marketFactor(growth[i], 'growth'),
    };

    const scoreBreakdown: ScoreBreakdown = {
      factors,
      coverage: {
        real: MARKET_DATA_FACTORS.filter((k) => factors[k].status === 'real').length,
        total: MARKET_DATA_FACTORS.length,
      },
    };

    const compositeScore = round1(FACTOR_KEYS.reduce((sum, k) => sum + factors[k].points, 0));
    return { ...c, compositeScore, scoreBreakdown };
  });
}

/** Scores and sorts best-first. */
export function scoreAndRank(
  companies: ScoredCompanyData[],
  weights: ScoringWeights,
  options: ScoringOptions
): ScoredCompanyData[] {
  return calculateCompanyScores(companies, weights, options).sort((a, b) => b.compositeScore - a.compositeScore);
}

export function buildScoringConfig(weights: ScoringWeights, thesesRun: number): ScoringConfig {
  return { weights: { ...weights }, thesesRun, method: 'percentile-v1' };
}

/** Reads a saved ScoringConfig defensively (history JSON may be from an older version). */
export function parseScoringConfig(raw: unknown): ScoringConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { weights?: Record<string, unknown>; thesesRun?: unknown; method?: unknown };
  if (!r.weights || typeof r.thesesRun !== 'number') return null;
  const weights = { ...DEFAULT_WEIGHTS };
  for (const k of FACTOR_KEYS) {
    const v = r.weights[k];
    if (typeof v === 'number' && Number.isFinite(v)) weights[k] = v;
  }
  return { weights, thesesRun: r.thesesRun, method: 'percentile-v1' };
}
