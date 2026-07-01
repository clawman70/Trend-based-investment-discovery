import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { isDbAvailable } from '@/lib/dbHelper';
import { prisma } from '@/lib/prisma';
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

interface DBFinancialData {
  stockPrice: number;
  marketCap: number;
  exchange: 'NASDAQ' | 'NYSE';
  peRatio: number | null;
  rationales: Record<string, string>;
  relevanceScore?: number;
}

interface DBDataQuality {
  priceSource: 'live' | 'unavailable';
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const dbActive = await isDbAvailable();

    if (id) {
      if (dbActive) {
        const search = await prisma.search.findUnique({
          where: { id },
          include: { results: true },
        });

        if (!search) {
          return NextResponse.json({ error: 'Search record not found' }, { status: 404 });
        }

        const companies: ScoredCompanyData[] = search.results.map((res) => {
          const fin = (res.financialData || {}) as unknown as DBFinancialData;
          const dq = (res.dataQuality || {}) as unknown as DBDataQuality;
          return {
            ticker: res.ticker,
            companyName: res.companyName,
            rationale: res.rationale,
            trendsMatched: Array.isArray(res.trendMatched) ? res.trendMatched : [],
            convergenceScore: res.convergenceScore || 0,
            compositeScore: res.compositeScore || 0,
            relevanceScore: fin.relevanceScore !== undefined ? fin.relevanceScore : 5,
            dataQuality: {
              priceSource: dq.priceSource || 'unavailable',
            },
            stockPrice: fin.stockPrice || 0,
            marketCap: fin.marketCap || 0,
            exchange: (fin.exchange || 'NASDAQ') as 'NASDAQ' | 'NYSE',
            peRatio: fin.peRatio !== undefined ? fin.peRatio : null,
            rationales: fin.rationales || {},
          };
        });

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
      } else {
        const search = memorySearches.find((s) => s.id === id);
        if (!search) {
          return NextResponse.json({ error: 'Search record not found (Memory)' }, { status: 404 });
        }

        const relatedResults = memorySearchResults.filter((r) => r.searchId === id);
        const companies: ScoredCompanyData[] = relatedResults.map((res) => {
          const fin = (res.financialData || {}) as unknown as DBFinancialData;
          const dq = (res.dataQuality || {}) as unknown as DBDataQuality;
          return {
            ticker: res.ticker,
            companyName: res.companyName,
            rationale: res.rationale,
            trendsMatched: Array.isArray(res.trendMatched) ? res.trendMatched : [],
            convergenceScore: res.convergenceScore || 0,
            compositeScore: res.compositeScore || 0,
            relevanceScore: fin.relevanceScore !== undefined ? fin.relevanceScore : 5,
            dataQuality: {
              priceSource: dq.priceSource || 'unavailable',
            },
            stockPrice: fin.stockPrice || 0,
            marketCap: fin.marketCap || 0,
            exchange: (fin.exchange || 'NASDAQ') as 'NASDAQ' | 'NYSE',
            peRatio: fin.peRatio !== undefined ? fin.peRatio : null,
            rationales: fin.rationales || {},
          };
        });

        return NextResponse.json({ search, companies });
      }
    }

    if (dbActive) {
      const list = await prisma.search.findMany({
        orderBy: { createdAt: 'desc' },
      });
      return NextResponse.json(list);
    } else {
      const sortedMemory = [...memorySearches].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
      );
      return NextResponse.json(sortedMemory);
    }
  } catch (error: unknown) {
    console.error("Error in history route GET:", error);
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

    const dbActive = await isDbAvailable();

    if (dbActive) {
      const newSearch = await prisma.search.create({
        data: {
          trends,
          filters: (filters || {}) as unknown as Prisma.InputJsonValue,
          trendAnalysis: (trendAnalysis || {}) as unknown as Prisma.InputJsonValue,
          results: {
            create: results.map((r) => ({
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
              } as unknown as Prisma.InputJsonValue,
              dataQuality: r.dataQuality as unknown as Prisma.InputJsonValue,
              compositeScore: r.compositeScore,
              convergenceScore: r.convergenceScore,
            })),
          },
        },
        include: { results: true },
      });

      return NextResponse.json(newSearch);
    } else {
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
    }
  } catch (error: unknown) {
    console.error("Error in history route POST:", error);
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

    const dbActive = await isDbAvailable();

    if (dbActive) {
      await prisma.search.delete({
        where: { id },
      });
      return NextResponse.json({ success: true });
    } else {
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
    }
  } catch (error: unknown) {
    console.error("Error in history route DELETE:", error);
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
