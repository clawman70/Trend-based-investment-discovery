import { NextRequest, NextResponse } from 'next/server';
import { getCachedData, setCachedData } from '@/lib/dbHelper';
import { getValueChainPositionFromAI } from '@/lib/geminiService';

const CACHE_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface CompanyDetails {
  ticker: string;
  companyName: string;
  description: string;
  sector: string;
  industry: string;
  ceo: string;
  website: string;
  stockPrice: number;
  marketCap: number;
  peRatio: number | null;
  yoyRevenueGrowth: number | null;
  debtToEquity: number | null;
  freeCashFlow: number | null;
  valueChainPosition?: string;
  recentFinancials: {
    revenue: number;
    netIncome: number;
    operatingCashFlow: number;
    capitalExpenditure: number;
    totalDebt: number;
    totalEquity: number;
    date: string;
  } | null;
}

interface FMPProfile {
  companyName?: string;
  description?: string;
  sector?: string;
  industry?: string;
  ceo?: string;
  website?: string;
  price?: number;
  mcap?: number;
  pe?: number | null;
}

interface FMPIncome {
  revenue?: number;
  netIncome?: number;
  date?: string;
}

interface FMPBalance {
  totalDebt?: number;
  totalStockholdersEquity?: number;
}

interface FMPCashFlow {
  operatingCashFlow?: number;
  capitalExpenditure?: number;
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
    const cacheKey = cleanTrend 
      ? `details:${upperTicker}:${cleanTrend.replace(/\s+/g, '_')}`
      : `details:${upperTicker}`;

    // 1. Check cache first
    const cached = (await getCachedData(cacheKey)) as CompanyDetails | null;
    if (cached) {
      return NextResponse.json(cached);
    }

    const apiKey = process.env.FMP_API_KEY;

    // 2. Fallback to mock details if API Key is placeholder/absent
    if (!apiKey || apiKey === 'PLACEHOLDER_API_KEY') {
      const dummyDetails: CompanyDetails = {
        ticker: upperTicker,
        companyName: `${upperTicker} Corp`,
        description: `${upperTicker} is a high-growth technology enterprise specializing in scalable software applications, edge computing interfaces, and advanced computational platforms for next-generation industries.`,
        sector: 'Technology',
        industry: 'Software—Application',
        ceo: 'Sarah Jenkins',
        website: 'https://example.com',
        stockPrice: 154.20,
        marketCap: 45000000000,
        peRatio: 32.4,
        yoyRevenueGrowth: 24.5,
        debtToEquity: 0.45,
        freeCashFlow: 820000000,
        valueChainPosition: cleanTrend 
          ? `Midstream supplier of specialized applications for the ${cleanTrend} trend.`
          : 'Midstream component designer.',
        recentFinancials: {
          revenue: 4200000000,
          netIncome: 850000000,
          operatingCashFlow: 1100000000,
          capitalExpenditure: 280000000,
          totalDebt: 1200000000,
          totalEquity: 2660000000,
          date: new Date().toISOString().split('T')[0],
        },
      };
      // Cache the mock result
      await setCachedData(cacheKey, 'financial', dummyDetails, CACHE_DURATION_MS);
      return NextResponse.json(dummyDetails);
    }

    // 3. Fetch from FMP
    try {
      const profileUrl = `https://financialmodelingprep.com/api/v3/profile/${upperTicker}?apikey=${apiKey}`;
      const profileRes = await fetch(profileUrl);
      if (!profileRes.ok) {
        throw new Error(`Profile fetch failed: ${profileRes.status}`);
      }
      const profileData = (await profileRes.json()) as FMPProfile[];
      if (!profileData || profileData.length === 0) {
        throw new Error(`Ticker ${upperTicker} profile not found`);
      }

      const prof = profileData[0];

      // Income Statement
      let yoyRevenueGrowth: number | null = null;
      let recentIncome: FMPIncome | null = null;
      const incomeUrl = `https://financialmodelingprep.com/api/v3/income-statement/${upperTicker}?limit=2&apikey=${apiKey}`;
      const incomeRes = await fetch(incomeUrl);
      if (incomeRes.ok) {
        const incomeData = (await incomeRes.json()) as FMPIncome[];
        if (incomeData && incomeData.length > 0) {
          recentIncome = incomeData[0];
          if (incomeData.length > 1) {
            const revCurr = incomeData[0].revenue || 0;
            const revPrev = incomeData[1].revenue || 0;
            if (revPrev > 0) {
              yoyRevenueGrowth = ((revCurr - revPrev) / revPrev) * 100;
            }
          }
        }
      }

      // Balance Sheet
      let debtToEquity: number | null = null;
      let recentBalance: FMPBalance | null = null;
      const balanceUrl = `https://financialmodelingprep.com/api/v3/balance-sheet-statement/${upperTicker}?limit=1&apikey=${apiKey}`;
      const balanceRes = await fetch(balanceUrl);
      if (balanceRes.ok) {
        const balanceData = (await balanceRes.json()) as FMPBalance[];
        if (balanceData && balanceData.length > 0) {
          recentBalance = balanceData[0];
          const debt = balanceData[0].totalDebt || 0;
          const equity = balanceData[0].totalStockholdersEquity || 0;
          if (equity > 0) {
            debtToEquity = debt / equity;
          }
        }
      }

      // Cash Flow Statement
      let freeCashFlow: number | null = null;
      let recentCashFlow: FMPCashFlow | null = null;
      const cashFlowUrl = `https://financialmodelingprep.com/api/v3/cash-flow-statement/${upperTicker}?limit=1&apikey=${apiKey}`;
      const cashFlowRes = await fetch(cashFlowUrl);
      if (cashFlowRes.ok) {
        const cashFlowData = (await cashFlowRes.json()) as FMPCashFlow[];
        if (cashFlowData && cashFlowData.length > 0) {
          recentCashFlow = cashFlowData[0];
          const ocf = cashFlowData[0].operatingCashFlow || 0;
          const capex = cashFlowData[0].capitalExpenditure || 0;
          freeCashFlow = ocf - capex;
        }
      }

      // Fetch Value Chain Position via Gemini if trend context is available
      let valueChainPosition = undefined;
      if (cleanTrend) {
        valueChainPosition = await getValueChainPositionFromAI(
          upperTicker,
          prof.companyName || upperTicker,
          prof.sector || 'N/A',
          prof.industry || 'N/A',
          cleanTrend
        );
      }

      // Assemble object
      const details: CompanyDetails = {
        ticker: upperTicker,
        companyName: prof.companyName || upperTicker,
        description: prof.description || 'No description available.',
        sector: prof.sector || 'N/A',
        industry: prof.industry || 'N/A',
        ceo: prof.ceo || 'N/A',
        website: prof.website || 'N/A',
        stockPrice: prof.price || 0,
        marketCap: prof.mcap || 0,
        peRatio: prof.pe !== undefined && prof.pe !== null ? Number(prof.pe) : null,
        yoyRevenueGrowth,
        debtToEquity,
        freeCashFlow,
        valueChainPosition,
        recentFinancials: recentIncome
          ? {
              revenue: recentIncome.revenue || 0,
              netIncome: recentIncome.netIncome || 0,
              operatingCashFlow: recentCashFlow?.operatingCashFlow || 0,
              capitalExpenditure: recentCashFlow?.capitalExpenditure || 0,
              totalDebt: recentBalance?.totalDebt || 0,
              totalEquity: recentBalance?.totalStockholdersEquity || 0,
              date: recentIncome.date || 'N/A',
            }
          : null,
      };

      // Cache and return
      await setCachedData(cacheKey, 'financial', details, CACHE_DURATION_MS);
      return NextResponse.json(details);
    } catch (err) {
      console.error(`FMP live fetch failed for details ${upperTicker}:`, err);
      // Fallback to dummy data
      const dummyDetails: CompanyDetails = {
        ticker: upperTicker,
        companyName: `${upperTicker} Corp`,
        description: `${upperTicker} is a high-growth technology enterprise.`,
        sector: 'Technology',
        industry: 'Software—Application',
        ceo: 'Sarah Jenkins',
        website: 'https://example.com',
        stockPrice: 154.20,
        marketCap: 45000000000,
        peRatio: 32.4,
        yoyRevenueGrowth: 24.5,
        debtToEquity: 0.45,
        freeCashFlow: 820000000,
        valueChainPosition: cleanTrend 
          ? `Midstream supplier of specialized applications for the ${cleanTrend} trend.`
          : 'Midstream component designer.',
        recentFinancials: {
          revenue: 4200000000,
          netIncome: 850000000,
          operatingCashFlow: 1100000000,
          capitalExpenditure: 280000000,
          totalDebt: 1200000000,
          totalEquity: 2660000000,
          date: new Date().toISOString().split('T')[0],
        },
      };
      await setCachedData(cacheKey, 'financial', dummyDetails, CACHE_DURATION_MS);
      return NextResponse.json(dummyDetails);
    }
  } catch (error: unknown) {
    console.error("Error in company-details GET:", error);
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
