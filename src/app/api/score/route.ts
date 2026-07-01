import { NextRequest, NextResponse } from 'next/server';
import { ScoredCompanyData } from '@/lib/types';
import { calculateCompanyScores } from '@/lib/scoring';

interface ScorePayload {
  companies: ScoredCompanyData[];
  weights: {
    relevance: number;
    convergence: number;
    growth: number;
    valuation: number;
    health: number;
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { companies, weights } = body as ScorePayload;

    if (!companies || !Array.isArray(companies)) {
      return NextResponse.json({ error: 'Companies array is required' }, { status: 400 });
    }

    const defaultWeights = { relevance: 25, convergence: 25, growth: 20, valuation: 15, health: 15 };
    const activeWeights = weights || defaultWeights;

    const scored = calculateCompanyScores(companies, activeWeights);

    // Sort by composite score descending
    scored.sort((a, b) => b.compositeScore - a.compositeScore);

    return NextResponse.json(scored);
  } catch (error: unknown) {
    console.error("Error in score route:", error);
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
