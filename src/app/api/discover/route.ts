import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getCachedData, setCachedData } from '@/lib/dbHelper';
import { discoverCompaniesFromAI } from '@/lib/claudeService';
import { normalizeTicker, validateTickers } from '@/lib/tickerValidator';
import { DiscoveredCompany } from '@/lib/types';
import { checkThesisLimits } from '@/lib/inputLimits';

const CACHE_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface DiscoveryCachePayload {
  companies: DiscoveredCompany[];
  /** When the AI run behind this entry finished (ISO). Missing on entries saved before Phase E. */
  cachedAt?: string;
}

/** Per-thesis cache report sent to the UI for the "cached N days ago" label (Phase E). */
export interface DiscoveryCacheInfo {
  trend: string;
  fromCache: boolean;
  /** ISO time the cached result was produced; null if served from cache but the age is unknown. */
  cachedAt: string | null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { trend, trends, filters, forceRefresh = false } = body as {
      trend?: string;
      trends?: string[];
      filters?: { exchange: string[]; marketCap: string[] };
      /** true = ignore any cached result and run the AI search again (the Refresh button) */
      forceRefresh?: boolean;
    };

    // Input limits (Phase E): at most 3 theses, 500 characters each
    const submitted: unknown[] = Array.isArray(trends) ? trends : trend !== undefined ? [trend] : [];
    const limitError = checkThesisLimits(submitted);
    if (limitError) {
      return NextResponse.json({ error: limitError }, { status: 400 });
    }

    // Support single or multiple trends list
    const trendsList = (submitted as string[]).map((t) => t.trim()).filter((t) => t !== '');

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

    // 1. Fetch AI discovery results for each trend in parallel — was sequential, which
    // made a multi-thesis discovery run take N times as long as it needed to.
    const perTrendResults = await Promise.all(
      trendsList.map(async (t): Promise<{ trend: string; companies: DiscoveredCompany[]; failed: boolean; cache: DiscoveryCacheInfo }> => {
        const normalizedPayload = JSON.stringify({ trend: t.trim().toLowerCase(), exchange, marketCap });
        const hash = crypto.createHash('sha256').update(normalizedPayload).digest('hex');
        const cacheKey = `discovery:${hash}`;

        // Refresh skips the read but still overwrites the entry with the new result below
        const cachedResult = forceRefresh ? null : ((await getCachedData(cacheKey)) as DiscoveryCachePayload | null);
        if (cachedResult && Array.isArray(cachedResult.companies)) {
          return {
            trend: t,
            companies: cachedResult.companies,
            failed: false,
            cache: { trend: t, fromCache: true, cachedAt: cachedResult.cachedAt ?? null },
          };
        }

        try {
          const companies = await discoverCompaniesFromAI(t, { exchange, marketCap });
          const cachedAt = new Date().toISOString();
          const payload: DiscoveryCachePayload = { companies, cachedAt };
          await setCachedData(cacheKey, 'discovery', payload, CACHE_DURATION_MS);
          return { trend: t, companies, failed: false, cache: { trend: t, fromCache: false, cachedAt } };
        } catch (aiErr) {
          console.error(`AI Discovery failed for trend "${t}":`, aiErr);
          // If it's the only thesis, fail the whole request. Otherwise carry on with the
          // others, but mark this one as FAILED (bug B4: it used to be silently treated as
          // "found nothing", which skewed convergence and told the user nothing).
          if (trendsList.length === 1) {
            throw aiErr;
          }
          return { trend: t, companies: [], failed: true, cache: { trend: t, fromCache: false, cachedAt: null } };
        }
      })
    );

    // Theses whose AI call failed (not "found zero companies" — the call itself errored).
    // Reported to the UI so it can warn, and excluded from the convergence denominator.
    const failedTrends = perTrendResults.filter((r) => r.failed).map((r) => r.trend);
    const succeededCount = perTrendResults.length - failedTrends.length;
    if (succeededCount === 0) {
      return NextResponse.json(
        { error: `Discovery failed for every thesis (${failedTrends.map((t) => `"${t}"`).join(', ')}). Please try again.`, failedTrends },
        { status: 502 }
      );
    }

    for (const { trend: t, companies } of perTrendResults) {
      for (const c of companies) {
        // Same normalization as the validator (e.g. BRK-B -> BRK.B) so gate lookups match
        const upperTicker = normalizeTicker(c.ticker);
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

    // 2. Validate all unique tickers against the Finnhub US exchange listing directory
    // This is the HALLUCINATION GATE: Drops invalid/fake tickers before enrichment
    const validation = await validateTickers(Array.from(uniqueTickers));
    const validTickersSet = new Set(validation.valid);

    if (validation.invalid.length > 0) {
      console.log(
        `[Validation Gate] Dropped ${validation.invalid.length} hallucinated tickers: ${validation.invalid.join(', ')}`
      );
    }
    if (validation.bypassed) {
      console.warn('[Validation Gate] Ticker validation was bypassed (Finnhub symbol directory unavailable or not configured)');
    }

    // 3. Construct convergence records. Convergence = theses matched / theses that actually
    // ran. A failed thesis can't have matched anything, so counting it would turn a real
    // "2 of 2" into a misleading "2 of 3" (bug B4).
    const activeTrendsCount = succeededCount;
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
          exchange: null, // filled in by /api/enrich from the listing directory
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
      failedTrends,
      // Which theses were served from the 7-day cache, and how old each one is
      cache: perTrendResults.filter((r) => !r.failed).map((r) => r.cache),
      // Theses that actually ran. The browser's scoring drops convergence when this is 1
      // (decision D2): with one thesis every company's convergence would be the same 1.0.
      thesesRun: succeededCount,
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
