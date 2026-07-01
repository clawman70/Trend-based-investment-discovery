import { ScoredCompanyData } from './types';

export function calculateCompanyScores(
  companies: ScoredCompanyData[],
  weights: { relevance: number; convergence: number; valuation: number; health: number }
): ScoredCompanyData[] {
  const { relevance, convergence, valuation, health } = weights;
  const totalWeight = relevance + convergence + valuation + health || 100;

  return companies.map((c) => {
    // 1. Relevance Score (1 to 10)
    const relevanceScore = c.relevanceScore || 5;

    // 2. Convergence Score (0.0 to 1.0 mapped to 0-10)
    const convergenceScore = (c.convergenceScore || 0) * 10;

    // 3. Valuation Score (P/E Ratio, 0 to 10)
    let valuationScore = 5;
    if (c.peRatio !== null && c.peRatio !== undefined) {
      const pe = c.peRatio;
      if (pe < 0) valuationScore = 2;
      else if (pe > 0 && pe <= 15) valuationScore = 10;
      else if (pe > 15 && pe <= 30) valuationScore = 8;
      else if (pe > 30 && pe <= 50) valuationScore = 6;
      else valuationScore = 4;
    }

    // 4. Data Health Score (0 to 10)
    let healthScore = 5;
    if (c.dataQuality) {
      healthScore = c.dataQuality.priceSource === 'live' ? 10 : 3;
    }

    // Weighted sum
    const rawScore =
      (relevanceScore * relevance) / totalWeight +
      (convergenceScore * convergence) / totalWeight +
      (valuationScore * valuation) / totalWeight +
      (healthScore * health) / totalWeight;

    // Convert raw score (0-10) to composite score (0-100)
    const compositeScore = Math.round(rawScore * 10 * 10) / 10;

    return {
      ...c,
      compositeScore,
    };
  });
}
