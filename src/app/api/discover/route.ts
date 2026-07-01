import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getCachedData, setCachedData } from '@/lib/dbHelper';
import { discoverCompaniesFromAI } from '@/lib/geminiService';
import { validateTickers } from '@/lib/tickerValidator';
import { DiscoveredCompany } from '@/lib/types';

const CACHE_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface DiscoveryCachePayload {
  companies: DiscoveredCompany[];
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { trend, trends, filters } = body as {
      trend?: string;
      trends?: string[];
      filters?: { exchange: string[]; marketCap: string[] };
    };

    // Support single or multiple trends list
    const trendsList = Array.isArray(trends)
      ? trends.filter((t) => t.trim() !== '')
      : trend && trend.trim() !== ''
      ? [trend.trim()]
      : [];

    if (trendsList.length === 0) {
      return NextResponse.json({ error: 'At least one trend thesis is required' }, { status: 400 });
    }

    const exchange = filters?.exchange || [];
    const marketCap = filters?.marketCap || [];

    const uniqueTickers = new Set<string>();
    const allDiscovered: {
      [ticker: string]: {
        ticker: string;
        companyName: string;
        trendsMatched: string[];
        rationales: { [trend: string]: string };
        relevanceScores: number[];
      };
    } = {};

    // 1. Fetch AI discovery results for each trend
    for (const t of trendsList) {
      const normalizedPayload = JSON.stringify({ trend: t.trim().toLowerCase(), exchange, marketCap });
      const hash = crypto.createHash('sha256').update(normalizedPayload).digest('hex');
      const cacheKey = `discovery:${hash}`;

      let companies: DiscoveredCompany[] = [];
      const cachedResult = (await getCachedData(cacheKey)) as DiscoveryCachePayload | null;

      if (cachedResult && Array.isArray(cachedResult.companies)) {
        companies = cachedResult.companies;
      } else {
        try {
          companies = await discoverCompaniesFromAI(t, { exchange, marketCap });
          await setCachedData(cacheKey, 'discovery', { companies }, CACHE_DURATION_MS);
        } catch (aiErr) {
          console.error(`AI Discovery failed for trend "${t}":`, aiErr);
          // If we fail on one trend but have others, we can continue.
          // Otherwise, if it's the only trend, throw.
          if (trendsList.length === 1) {
            throw aiErr;
          }
        }
      }

      for (const c of companies) {
        const upperTicker = c.ticker.trim().toUpperCase();
        if (!allDiscovered[upperTicker]) {
          allDiscovered[upperTicker] = {
            ticker: upperTicker,
            companyName: c.companyName,
            trendsMatched: [],
            rationales: {},
            relevanceScores: [],
          };
        }
        allDiscovered[upperTicker].trendsMatched.push(t);
        allDiscovered[upperTicker].rationales[t] = c.rationale;
        allDiscovered[upperTicker].relevanceScores.push(c.relevanceScore || 5);
        uniqueTickers.add(upperTicker);
      }
    }

    // 2. Validate all unique tickers across our NYSE/NASDAQ directory
    // This is the HALLUCINATION GATE: Drops invalid/fake tickers before enrichment
    const validation = await validateTickers(Array.from(uniqueTickers));
    const validTickersSet = new Set(validation.valid);

    if (validation.invalid.length > 0) {
      console.log(
        `[Validation Gate] Dropped ${validation.invalid.length} hallucinated tickers: ${validation.invalid.join(', ')}`
      );
    }
    if (validation.bypassed) {
      console.warn('[Validation Gate] Ticker validation was bypassed (FMP API unavailable or not configured)');
    }

    // 3. Construct convergence records
    const activeTrendsCount = trendsList.length;
    const finalCompanies = Object.values(allDiscovered)
      .filter((c) => validTickersSet.has(c.ticker))
      .map((c) => {
        // Average the relevance score if the company matches multiple trends
        const avgRelevance = Math.round(
          c.relevanceScores.reduce((sum, s) => sum + s, 0) / c.relevanceScores.length
        );
        const convergenceScore = activeTrendsCount > 0 ? c.trendsMatched.length / activeTrendsCount : 0;

        return {
          ticker: c.ticker,
          companyName: c.companyName,
          relevanceScore: avgRelevance,
          trendsMatched: c.trendsMatched,
          convergenceScore,
          rationales: c.rationales,
          stockPrice: 0,
          marketCap: 0,
          exchange: 'NASDAQ' as const,
          dataQuality: {
            priceSource: 'unavailable' as const,
          },
          compositeScore: 0,
        };
      });

    // Sort primarily by convergence score, then by relevance score
    finalCompanies.sort((a, b) => {
      if (b.convergenceScore !== a.convergenceScore) {
        return b.convergenceScore - a.convergenceScore;
      }
      return b.relevanceScore - a.relevanceScore;
    });

    return NextResponse.json({
      companies: finalCompanies,
      invalidTickers: validation.invalid,
      validationMetrics: {
        totalDiscovered: uniqueTickers.size,
        validCount: validation.valid.length,
        invalidCount: validation.invalid.length,
        validationBypassed: validation.bypassed,
      },
    });
  } catch (error: unknown) {
    console.error("Error in discover route:", error);
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
