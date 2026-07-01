import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import {
  memorySearches,
  memorySearchResults,
  MemorySearch,
  MemorySearchResult,
} from '@/lib/memoryStore';
import { ScoredCompanyData } from '@/lib/types';

interface QueryFilters {
  marketCap: string[];
  exchange: string[];
  currentPrice: string | null;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (id) {
      const search = memorySearches.find((s) => s.id === id);
      if (!search) {
        return NextResponse.json({ error: 'Search record not found' }, { status: 404 });
      }

      const relatedResults = memorySearchResults.filter((r) => r.searchId === id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const companies: ScoredCompanyData[] = relatedResults.map((res: any) => ({
        ticker: res.ticker,
        companyName: res.companyName,
        rationale: res.rationale,
        trendsMatched: Array.isArray(res.trendMatched) ? res.trendMatched : [],
        convergenceScore: res.convergenceScore || 0,
        compositeScore: res.compositeScore || 0,
        relevanceScore: res.financialData?.relevanceScore !== undefined ? res.financialData.relevanceScore : 5,
        dataQuality: {
          priceSource: res.dataQuality?.priceSource || 'unavailable',
        },
        stockPrice: res.financialData?.stockPrice || 0,
        marketCap: res.financialData?.marketCap || 0,
        exchange: (res.financialData?.exchange || 'NASDAQ') as 'NASDAQ' | 'NYSE',
        peRatio: res.financialData?.peRatio !== undefined ? res.financialData.peRatio : null,
        rationales: res.financialData?.rationales || {},
      }));

      return NextResponse.json({
        search: {
          id: search.id,
          createdAt: search.createdAt,
          trends: search.trends,
          filters: search.filters,
          trendAnalysis: search.trendAnalysis,
        },
        companies,
      });
    }

    const sortedMemory = [...memorySearches].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
    return NextResponse.json(sortedMemory);
  } catch (error: unknown) {
    console.error('Error in history route GET:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { trends, filters, trendAnalysis, results } = body as {
      trends: string[];
      filters: QueryFilters;
      trendAnalysis: Record<string, unknown>;
      results: ScoredCompanyData[];
    };

    if (!trends || !Array.isArray(trends) || trends.length === 0) {
      return NextResponse.json({ error: 'Trends list is required' }, { status: 400 });
    }

    const searchId = crypto.randomUUID();
    const newSearch: MemorySearch = {
      id: searchId,
      createdAt: new Date(),
      trends,
      filters: filters || {},
      trendAnalysis: trendAnalysis || {},
    };

    memorySearches.push(newSearch);

    for (const r of results) {
      const resultEntry: MemorySearchResult = {
        id: crypto.randomUUID(),
        searchId,
        ticker: r.ticker,
        companyName: r.companyName,
        rationale: r.rationale || '',
        trendMatched: r.trendsMatched || [],
        financialData: {
          stockPrice: r.stockPrice,
          marketCap: r.marketCap,
          exchange: r.exchange,
          peRatio: r.peRatio,
          rationales: r.rationales || {},
          relevanceScore: r.relevanceScore,
        },
        dataQuality: r.dataQuality,
        compositeScore: r.compositeScore,
        convergenceScore: r.convergenceScore,
      };
      memorySearchResults.push(resultEntry);
    }

    return NextResponse.json(newSearch);
  } catch (error: unknown) {
    console.error('Error in history route POST:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Search ID is required' }, { status: 400 });
    }

    const index = memorySearches.findIndex((s) => s.id === id);
    if (index === -1) {
      return NextResponse.json({ error: 'Search not found' }, { status: 404 });
    }
    memorySearches.splice(index, 1);

    const indexesToRemove = memorySearchResults
      .map((r, idx) => (r.searchId === id ? idx : -1))
      .filter((idx) => idx !== -1)
      .reverse();

    for (const idx of indexesToRemove) {
      memorySearchResults.splice(idx, 1);
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Error in history route DELETE:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
