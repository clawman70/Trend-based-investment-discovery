import { NextRequest, NextResponse } from 'next/server';
import { createSearch, deleteSearch, getSearchWithResults, listSearches } from '@/lib/stores/historyStore';
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
      const record = await getSearchWithResults(id);
      if (!record) {
        return NextResponse.json({ error: 'Search record not found' }, { status: 404 });
      }
      return NextResponse.json(record);
    }

    return NextResponse.json(await listSearches());
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

    const newSearch = await createSearch({
      trends,
      filters: filters || {},
      trendAnalysis: trendAnalysis || {},
      results: results || [],
    });

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

    const deleted = await deleteSearch(id);
    if (!deleted) {
      return NextResponse.json({ error: 'Search not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Error in history route DELETE:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
