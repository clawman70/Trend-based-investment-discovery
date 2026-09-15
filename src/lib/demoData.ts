/**
 * DEMO MODE fixtures.
 *
 * Fake data is ONLY returned when DEMO_MODE=true is set explicitly. Every payload carries
 * `isDemo: true` and obviously-fake labels so it can never be mistaken for real market data.
 * Without DEMO_MODE, missing keys or failed API calls surface as "unavailable" / errors.
 */

import { TrendResearchReport } from './types';

export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === 'true';
}

export function getDemoCompanyDetails(ticker: string, trend: string) {
  return {
    isDemo: true,
    ticker,
    companyName: `${ticker} (DEMO DATA)`,
    description: 'Demo mode is on. This profile is placeholder data, not a real company description.',
    sector: 'Demo Sector',
    industry: null,
    ceo: null,
    website: null,
    logo: null,
    stockPrice: 100,
    marketCap: 10_000_000_000,
    peRatio: 20,
    yoyRevenueGrowth: 10,
    debtToEquity: 0.5,
    freeCashFlow: 500_000_000,
    valueChainPosition: trend ? `Demo value-chain position for the "${trend}" trend.` : null,
  };
}

export function getDemoNews(ticker: string) {
  return {
    isDemo: true,
    news: [
      {
        title: `[DEMO] Placeholder headline for ${ticker}`,
        url: '#',
        publishedDate: new Date().toISOString(),
        text: 'Demo mode is on. This is not a real news article.',
        site: 'Demo',
      },
    ],
    sentiment: {
      sentiment: 'Neutral' as const,
      sentimentScore: 0,
      summary: 'Demo mode is on. No real sentiment analysis was performed.',
    },
  };
}

export function getDemoResearchReport(
  domains: string[],
  mode: 'guided' | 'open',
  customPrompt: string | null
): TrendResearchReport {
  const list = domains.length > 0 ? domains : ['Demo Domain A', 'Demo Domain B'];
  return {
    isDemo: true,
    executiveSummary: `[DEMO] Offline scan in ${mode} mode${customPrompt ? ` for "${customPrompt}"` : ''} across: ${list.join(', ')}. This report is placeholder content — no research was performed.`,
    scanDate: new Date().toISOString().split('T')[0],
    domainsScanned: list,
    candidateTheses: [
      {
        thesisStatement: `[DEMO] ${list[0]} converging with ${list[1] || list[0]}`,
        convergenceType: 'technology_enablement',
        domainsInvolved: list.slice(0, 2),
        recencySignal: 'Demo data — no recency signal.',
        maturity: 'Nascent',
        confidence: 'Speculative',
        rationale: 'Demo data — placeholder rationale.',
        sources: [],
      },
    ],
    companiesMentioned: [],
    adjacentSignals: ['[DEMO] Placeholder adjacent signal.'],
  };
}
