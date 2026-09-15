import { NextRequest, NextResponse } from 'next/server';
import { getCachedData, setCachedData } from '@/lib/dbHelper';
import { analyzeNewsSentimentFromAI, NewsSentiment } from '@/lib/claudeService';
import { fetchCompanyNews, isFinnhubConfigured } from '@/lib/finnhubService';
import { getDemoNews, isDemoMode } from '@/lib/demoData';

const CACHE_DURATION_MS = 6 * 60 * 60 * 1000; // 6 hours
const LOOKBACK_DAYS = 14;
const MAX_ARTICLES = 8;
const MAX_SUMMARY_CHARS = 300;

interface NewsItem {
  title: string;
  url: string;
  publishedDate: string; // ISO timestamp
  text: string;
  site: string;
}

interface NewsResponse {
  isDemo: boolean;
  news: NewsItem[];
  sentiment: NewsSentiment | null; // null = sentiment unavailable (no key, no headlines, or AI failure)
}

const toIsoDate = (d: Date) => d.toISOString().split('T')[0];

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const ticker = searchParams.get('ticker');

    if (!ticker) {
      return NextResponse.json({ error: 'Ticker symbol is required' }, { status: 400 });
    }

    const upperTicker = ticker.trim().toUpperCase();

    if (isDemoMode()) {
      return NextResponse.json(getDemoNews(upperTicker));
    }

    if (!isFinnhubConfigured()) {
      return NextResponse.json(
        { error: 'FINNHUB_API_KEY is not configured in .env.local — news is unavailable.' },
        { status: 503 }
      );
    }

    const cacheKey = `news:${upperTicker}`;
    const cached = (await getCachedData(cacheKey)) as NewsResponse | null;
    if (cached) {
      return NextResponse.json(cached);
    }

    const now = new Date();
    const from = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

    let rawNews;
    try {
      rawNews = await fetchCompanyNews(upperTicker, toIsoDate(from), toIsoDate(now));
    } catch (err) {
      console.error(`Finnhub news fetch failed for ${upperTicker}:`, err);
      return NextResponse.json({ error: `News is unavailable for ${upperTicker} right now.` }, { status: 502 });
    }

    const news: NewsItem[] = rawNews
      .filter((item) => item.headline && item.url)
      .sort((a, b) => b.datetime - a.datetime)
      .slice(0, MAX_ARTICLES)
      .map((item) => ({
        title: item.headline,
        url: item.url,
        publishedDate: new Date(item.datetime * 1000).toISOString(),
        text: item.summary.length > MAX_SUMMARY_CHARS ? `${item.summary.slice(0, MAX_SUMMARY_CHARS)}…` : item.summary,
        site: item.source || 'Finnhub',
      }));

    const sentiment = await analyzeNewsSentimentFromAI(
      upperTicker,
      news.map((n) => n.title)
    );

    const response: NewsResponse = { isDemo: false, news, sentiment };

    // Don't cache a missing sentiment when there were headlines — let the next open retry the AI
    if (sentiment !== null || news.length === 0) {
      await setCachedData(cacheKey, 'news', response, CACHE_DURATION_MS);
    }
    return NextResponse.json(response);
  } catch (error: unknown) {
    console.error('Error in news GET:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
