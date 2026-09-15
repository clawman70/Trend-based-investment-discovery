import { NextRequest, NextResponse } from 'next/server';
import { getCachedData, setCachedData } from '@/lib/dbHelper';
import { analyzeTrendFromAI } from '@/lib/claudeService';
import { TrendAnalysis } from '@/lib/types';

const CACHE_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { trend } = body as { trend: string };

    if (!trend || !trend.trim()) {
      return NextResponse.json({ error: 'Trend thesis is required' }, { status: 400 });
    }

    const normalizedTrend = trend.trim().toLowerCase();
    const cacheKey = `analysis:${normalizedTrend}`;

    // Check cache
    const cachedResult = (await getCachedData(cacheKey)) as TrendAnalysis | null;
    if (cachedResult) {
      return NextResponse.json({
        analysis: cachedResult,
        cached: true,
      });
    }

    // Call Gemini to analyze the trend
    const analysis = await analyzeTrendFromAI(trend.trim());

    // Cache the result
    await setCachedData(cacheKey, 'trend_analysis', analysis, CACHE_DURATION_MS);

    return NextResponse.json({
      analysis,
      cached: false,
    });
  } catch (error: unknown) {
    console.error("Error in analyze-trend route:", error);
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
