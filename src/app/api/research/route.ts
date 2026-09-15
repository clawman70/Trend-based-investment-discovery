import { NextRequest, NextResponse } from 'next/server';
import { createScan, findCachedScan } from '@/lib/stores/researchStore';
import { generateTrendResearchReport } from '@/lib/geminiService';
import { getDemoResearchReport, isDemoMode } from '@/lib/demoData';
import { fetchQuote, isFinnhubConfigured } from '@/lib/finnhubService';
import { fetchSixMonthRally } from '@/lib/yahooService';
import { MentionedCompany, TrendResearchReport } from '@/lib/types';

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Replaces the model's job of guessing recentRally with a real check: live price from
 * Finnhub, 6-month history from Yahoo. Stays null (not false) when the ticker isn't a
 * real, currently-quotable security (e.g. a private company) or data is unavailable —
 * never guess.
 */
async function attachRealRecentRally(companies: MentionedCompany[]): Promise<MentionedCompany[]> {
  if (!isFinnhubConfigured() || companies.length === 0) {
    return companies;
  }

  return Promise.all(
    companies.map(async (company) => {
      try {
        const quote = await fetchQuote(company.ticker);
        if (!quote || !(quote.c > 0)) {
          return company;
        }
        const rally = await fetchSixMonthRally(company.ticker, quote.c);
        return { ...company, recentRally: rally.rallied };
      } catch (err) {
        console.warn(`[Research] Could not compute real recentRally for ${company.ticker}:`, err instanceof Error ? err.message : err);
        return company;
      }
    })
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { domains = [], mode = 'guided', customPrompt = null, forceRefresh = false } = body;

    const formattedDomains = (domains as string[]).map((d) => d.trim()).filter(Boolean);
    const sortedDomains = [...formattedDomains].sort();
    const cleanPrompt = customPrompt ? (customPrompt as string).trim() : null;

    if (!forceRefresh) {
      const cachedScan = await findCachedScan({ mode, sortedDomains, customPrompt: cleanPrompt });
      if (cachedScan) {
        return NextResponse.json({ scanId: cachedScan.id, ...cachedScan.report });
      }
    }

    // Generate report (placeholder content only when DEMO_MODE=true)
    let report: TrendResearchReport = isDemoMode()
      ? getDemoResearchReport(sortedDomains, mode, cleanPrompt)
      : await generateTrendResearchReport(sortedDomains, mode, cleanPrompt);

    if (!report.isDemo) {
      report = { ...report, companiesMentioned: await attachRealRecentRally(report.companiesMentioned) };
    }

    const scan = await createScan({
      domains: sortedDomains,
      customPrompt: mode === 'open' ? cleanPrompt : null,
      report,
      ttlMs: CACHE_TTL_MS,
    });

    return NextResponse.json({ scanId: scan.id, ...report });
  } catch (error: unknown) {
    console.error('Error in /api/research POST handler:', error);
    const errorMsg = error instanceof Error ? error.message : 'Internal Server Error';
    // 503 = missing configuration, 502 = upstream AI failure
    const status = errorMsg.includes('not configured') ? 503 : 502;
    return NextResponse.json({ error: errorMsg }, { status });
  }
}
