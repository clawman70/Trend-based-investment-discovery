import { NextRequest, NextResponse } from 'next/server';
import { getCachedData, setCachedData } from '@/lib/dbHelper';
import { getValueChainPositionFromAI } from '@/lib/geminiService';
import { fetchMetrics, fetchProfile, fetchQuote, isFinnhubConfigured, normalizeMetrics } from '@/lib/finnhubService';
import { fetchCompanyProfile } from '@/lib/yahooService';
import { getDemoCompanyDetails, isDemoMode } from '@/lib/demoData';

const CACHE_DURATION_MS = 6 * 60 * 60 * 1000; // 6 hours

/** Every field is real data or null. Nothing is invented. */
export interface CompanyDetails {
  isDemo: boolean;
  ticker: string;
  companyName: string;
  description: string | null;
  sector: string | null;
  industry: string | null;
  ceo: string | null;
  website: string | null;
  logo: string | null;
  stockPrice: number; // 0 = unavailable
  marketCap: number; // 0 = unavailable
  peRatio: number | null;
  yoyRevenueGrowth: number | null; // percent, TTM
  debtToEquity: number | null;
  freeCashFlow: number | null; // derived: market cap / (price-to-FCF)
  valueChainPosition: string | null; // AI-generated, only when a trend is supplied
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const ticker = searchParams.get('ticker');
    const trend = searchParams.get('trend');

    if (!ticker) {
      return NextResponse.json({ error: 'Ticker symbol is required' }, { status: 400 });
    }

    const upperTicker = ticker.trim().toUpperCase();
    const cleanTrend = trend ? trend.trim() : '';

    if (isDemoMode()) {
      return NextResponse.json(getDemoCompanyDetails(upperTicker, cleanTrend));
    }

    if (!isFinnhubConfigured()) {
      return NextResponse.json(
        { error: 'FINNHUB_API_KEY is not configured in .env.local — company details are unavailable.' },
        { status: 503 }
      );
    }

    const cacheKey = cleanTrend
      ? `details:${upperTicker}:${cleanTrend.toLowerCase().replace(/\s+/g, '_')}`
      : `details:${upperTicker}`;

    const cached = (await getCachedData(cacheKey)) as CompanyDetails | null;
    if (cached) {
      return NextResponse.json(cached);
    }

    let profile, metrics, quote, yahooProfile;
    try {
      [profile, metrics, quote, yahooProfile] = await Promise.all([
        fetchProfile(upperTicker),
        fetchMetrics(upperTicker).catch(() => null),
        fetchQuote(upperTicker).catch(() => null),
        fetchCompanyProfile(upperTicker),
      ]);
    } catch (err) {
      console.error(`Finnhub profile fetch failed for ${upperTicker}:`, err);
      return NextResponse.json({ error: `Company data is unavailable for ${upperTicker} right now.` }, { status: 502 });
    }

    if (!profile && !quote) {
      return NextResponse.json({ error: `No company data found for ${upperTicker}.` }, { status: 404 });
    }

    const fundamentals = normalizeMetrics(metrics);
    const companyName = profile?.name ?? upperTicker;
    const sector = yahooProfile?.sector ?? profile?.finnhubIndustry ?? null;
    const industry = yahooProfile?.industry ?? null;

    const valueChainPosition = cleanTrend
      ? await getValueChainPositionFromAI(upperTicker, companyName, sector ?? 'N/A', industry ?? 'N/A', cleanTrend)
      : null;

    const profileMarketCap = profile?.marketCapitalization ? profile.marketCapitalization * 1_000_000 : 0;

    const details: CompanyDetails = {
      isDemo: false,
      ticker: upperTicker,
      companyName,
      description: yahooProfile?.description ?? null,
      sector,
      industry,
      ceo: yahooProfile?.ceo ?? null,
      website: yahooProfile?.website ?? profile?.weburl ?? null,
      logo: profile?.logo || null,
      stockPrice: quote?.c ?? 0,
      marketCap: fundamentals.marketCap ?? profileMarketCap,
      peRatio: fundamentals.peRatio,
      yoyRevenueGrowth: fundamentals.revenueGrowthYoY,
      debtToEquity: fundamentals.debtToEquity,
      freeCashFlow: fundamentals.freeCashFlowDerived,
      valueChainPosition,
    };

    await setCachedData(cacheKey, 'financial', details, CACHE_DURATION_MS);
    return NextResponse.json(details);
  } catch (error: unknown) {
    console.error('Error in company-details GET:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
