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
 * Calculate normalized growth score (0-1)
 * Higher growth is better. Uses 1Y growth primarily, 5Y as secondary.
 */
function calculateGrowthScore(growth1Y: number, growth5Y: number): number {
  const avgGrowth = growth1Y > 0 ? growth1Y : growth5Y > 0 ? growth5Y : 0;

  if (avgGrowth === 0) return 0.5;

  return Math.min(1, Math.max(0, avgGrowth / 100)); // Normalize growth % to 0-1
}

/**
 * Calculate normalized financial health score (0-1)
 * Combines debt-to-equity and data quality
 */
function calculateHealthScore(
  debtToEquity: number | null,
  priceSource: 'live' | 'unavailable',
  allDebtToEquity: (number | null)[]
): number {
  // Data quality is primary
  const dataQualityScore = priceSource === 'live' ? 0.8 : 0.2;

  // Debt-to-equity is secondary (lower is better, but some debt is normal)
  let debtScore = 0.5;
  if (debtToEquity !== null && debtToEquity >= 0) {
    const validDTE = allDebtToEquity.filter((dte) => dte !== null && dte >= 0) as number[];
    if (validDTE.length > 0) {
      const minDTE = Math.min(...validDTE);
      const maxDTE = Math.max(...validDTE);
      debtScore = 1 - normalizeMinMax(debtToEquity, minDTE, maxDTE); // Invert: lower is better
    }
  }

  // Weighted average: 70% data quality, 30% financial health
  return dataQualityScore * 0.7 + debtScore * 0.3;
}

export function calculateCompanyScores(
  companies: ScoredCompanyData[],
  weights: { relevance: number; convergence: number; valuation: number; health: number }
): ScoredCompanyData[] {
  const { relevance, convergence, valuation, health } = weights;
  const totalWeight = relevance + convergence + valuation + health || 100;

  // Pre-calculate min/max for normalization across all companies
  const allPERatios = companies.map((c) => c.peRatio);
  const allGrowths = companies.map((c) => c.growth1Y || c.growth5Y || 0).filter((g) => g > 0);
  const allDebtToEquity = companies.map((c) => c.debtToEquity);

  return companies.map((c) => {
    // 1. Relevance Score (1-10, normalized to 0-1)
    const relevanceNorm = normalizeMinMax(c.relevanceScore || 5, 1, 10);

    // 2. Convergence Score (0-1, already normalized)
    const convergenceNorm = c.convergenceScore || 0;

    // 3. Valuation Score (P/E ratio normalization)
    const valuationNorm = calculateValuationScore(c.peRatio, allPERatios);

    // 4. Health Score (data quality + debt-to-equity)
    const healthNorm = calculateHealthScore(
      c.debtToEquity,
      c.dataQuality?.priceSource || 'unavailable',
      allDebtToEquity
    );

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
