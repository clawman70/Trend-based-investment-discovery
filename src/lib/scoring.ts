import { ScoredCompanyData } from './types';

/**
 * Min-Max Normalization: Scales a value to 0-1 range
 * Handles cases where all values are identical (returns 0.5)
 */
function normalizeMinMax(value: number, min: number, max: number): number {
  if (max === min) return 0.5; // All values identical = neutral score
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

/**
 * Calculate normalized valuation score (0-1)
 * Lower P/E is better, but not linearly. Uses sigmoid-like curve.
 */
function calculateValuationScore(peRatio: number | null, allPERatios: (number | null)[]): number {
  if (peRatio === null || peRatio === undefined || peRatio <= 0) return 0.5; // Neutral if missing

  const validPEs = allPERatios.filter((pe) => pe !== null && pe > 0) as number[];
  if (validPEs.length === 0) return 0.5;

  const minPE = Math.min(...validPEs);
  const maxPE = Math.max(...validPEs);
  const normalized = normalizeMinMax(peRatio, minPE, maxPE);

  // Invert: lower P/E is better (higher score)
  return 1 - normalized;
}

/**
 * Calculate normalized financial health score (0-1) from debt-to-equity.
 * Lower debt-to-equity is healthier. Neutral (0.5) when the ratio is missing —
 * same convention as calculateValuationScore for missing P/E. Data availability
 * used to be 70% of this score; now that debt-to-equity is real data (Phase 0),
 * "did the data load" isn't a proxy for health anymore.
 */
function calculateHealthScore(debtToEquity: number | null, allDebtToEquity: (number | null)[]): number {
  if (debtToEquity === null || debtToEquity === undefined || debtToEquity < 0) return 0.5;

  const validDTE = allDebtToEquity.filter((dte) => dte !== null && dte >= 0) as number[];
  if (validDTE.length === 0) return 0.5;

  const minDTE = Math.min(...validDTE);
  const maxDTE = Math.max(...validDTE);
  return 1 - normalizeMinMax(debtToEquity, minDTE, maxDTE); // Invert: lower debt is better
}

export function calculateCompanyScores(
  companies: ScoredCompanyData[],
  weights: { relevance: number; convergence: number; valuation: number; health: number }
): ScoredCompanyData[] {
  const { relevance, convergence, valuation, health } = weights;
  const totalWeight = relevance + convergence + valuation + health || 100;

  // Pre-calculate min/max for normalization across all companies
  const allPERatios = companies.map((c) => c.peRatio ?? null);
  const allDebtToEquity = companies.map((c) => c.debtToEquity ?? null);

  return companies.map((c) => {
    // 1. Relevance Score (1-10, normalized to 0-1)
    const relevanceNorm = normalizeMinMax(c.relevanceScore || 5, 1, 10);

    // 2. Convergence Score (0-1, already normalized)
    const convergenceNorm = c.convergenceScore || 0;

    // 3. Valuation Score (P/E ratio normalization)
    const valuationNorm = calculateValuationScore(c.peRatio ?? null, allPERatios);

    // 4. Health Score (debt-to-equity)
    const healthNorm = calculateHealthScore(c.debtToEquity ?? null, allDebtToEquity);

    // Weighted composite score (all factors 0-1, normalized)
    const compositeRaw =
      (relevanceNorm * relevance) / totalWeight +
      (convergenceNorm * convergence) / totalWeight +
      (valuationNorm * valuation) / totalWeight +
      (healthNorm * health) / totalWeight;

    // Scale to 0-100
    const compositeScore = Math.round(compositeRaw * 100);

    return {
      ...c,
      compositeScore,
    };
  });
}
