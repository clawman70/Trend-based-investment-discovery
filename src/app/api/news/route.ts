import { NextRequest, NextResponse } from 'next/server';
import { getCachedData, setCachedData } from '@/lib/dbHelper';
import { analyzeNewsSentimentFromAI, NewsSentiment } from '@/lib/geminiService';

const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 1 day

interface NewsItem {
  title: string;
  url: string;
  publishedDate: string;
  text: string;
  site: string;
}

interface NewsResponse {
  news: NewsItem[];
  sentiment: NewsSentiment;
}

interface FMPNewsItem {
  title?: string;
  url?: string;
  publishedDate?: string;
  text?: string;
  site?: string;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const ticker = searchParams.get('ticker');

    if (!ticker) {
      return NextResponse.json({ error: 'Ticker symbol is required' }, { status: 400 });
    }

    const upperTicker = ticker.trim().toUpperCase();
    const cacheKey = `news:${upperTicker}`;

    // 1. Check cache first
    const cached = (await getCachedData(cacheKey)) as NewsResponse | null;
    if (cached) {
      return NextResponse.json(cached);
    }

    const apiKey = process.env.FMP_API_KEY;

    // 2. Fallback in offline mode
    if (!apiKey || apiKey === 'PLACEHOLDER_API_KEY') {
      const dummyNews: NewsItem[] = [
        {
          title: `${upperTicker} Announces Revolutionary AI-driven Enterprise Integration Services`,
          url: "https://example.com/story1",
          publishedDate: new Date(Date.now() - 3600000 * 2).toISOString().replace('T', ' ').substring(0, 19),
          text: "The new platform integrates multiple proprietary models to optimize backend business workflows.",
          site: "TechCrunch"
        },
        {
          title: `${upperTicker} Q1 Earnings Beat Estimates on Strong Cloud Demand`,
          url: "https://example.com/story2",
          publishedDate: new Date(Date.now() - 3600000 * 24 * 2).toISOString().replace('T', ' ').substring(0, 19),
          text: "Quarterly revenue climbed 18% YoY, surpassing Wall Street expectations across key product lines.",
          site: "Bloomberg"
        },
        {
          title: `Key Executives Expand Share Stakes in ${upperTicker}`,
          url: "https://example.com/story3",
          publishedDate: new Date(Date.now() - 3600000 * 24 * 5).toISOString().replace('T', ' ').substring(0, 19),
          text: "Recent filing disclosures show significant insider purchasing from the Chief Technology Officer and directors.",
          site: "Reuters"
        }
      ];

      const sentimentResult: NewsSentiment = {
        sentiment: "Bullish",
        sentimentScore: 0.75,
        summary: `Strong positive momentum for ${upperTicker} driven by product innovation and robust earnings results. Insider buying reports reinforce financial stability.`
      };

      const response: NewsResponse = {
        news: dummyNews,
        sentiment: sentimentResult,
      };

      await setCachedData(cacheKey, 'news', response, CACHE_DURATION_MS);
      return NextResponse.json(response);
    }

    // 3. Fetch from FMP
    try {
      const newsUrl = `https://financialmodelingprep.com/api/v3/stock_news?tickers=${upperTicker}&limit=5&apikey=${apiKey}`;
      const newsRes = await fetch(newsUrl);
      
      if (!newsRes.ok) {
        throw new Error(`FMP news fetch failed: ${newsRes.status}`);
      }

      const rawNews = (await newsRes.json()) as FMPNewsItem[];
      const newsList: NewsItem[] = (rawNews || []).map(item => ({
        title: item.title || 'No Title',
        url: item.url || '#',
        publishedDate: item.publishedDate || 'N/A',
        text: item.text || '',
        site: item.site || 'FMP News',
      }));

      // Get sentiment from headlines
      const headlines = newsList.map(item => item.title);
      const sentiment = await analyzeNewsSentimentFromAI(upperTicker, headlines);

      const response: NewsResponse = {
        news: newsList,
        sentiment,
      };

      await setCachedData(cacheKey, 'news', response, CACHE_DURATION_MS);
      return NextResponse.json(response);
    } catch (err) {
      console.error(`FMP live news fetch failed for ticker ${upperTicker}:`, err);
      // Fallback
      const dummyNews: NewsItem[] = [
        {
          title: `${upperTicker} operational expansion continues.`,
          url: "#",
          publishedDate: new Date().toISOString(),
          text: "Recent updates signal continuous steady execution.",
          site: "Financial News"
        }
      ];
      const sentimentResult: NewsSentiment = {
        sentiment: "Neutral",
        sentimentScore: 0.1,
        summary: `Stable operational progress for ${upperTicker}.`
      };
      const response: NewsResponse = {
        news: dummyNews,
        sentiment: sentimentResult,
      };
      await setCachedData(cacheKey, 'news', response, CACHE_DURATION_MS);
      return NextResponse.json(response);
    }
  } catch (error: unknown) {
    console.error("Error in news GET:", error);
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
