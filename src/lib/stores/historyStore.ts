/**
 * Saved discovery runs ("History" tab). Postgres-backed with an in-memory fallback —
 * see src/lib/dbHelper.ts for how the fallback decision is made.
 */
import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { isDbAvailable } from '../dbHelper';
import { prisma } from '../prisma';
import { memorySearches, memorySearchResults, MemorySearch, MemorySearchResult } from '../memoryStore';
import { ScoredCompanyData, ScoringConfig, ScoreBreakdown } from '../types';
import { buildRationaleNote } from '../rationale';
import { parseScoringConfig } from '../scoring';
import type { PickInput } from '../trackRecord';

export interface SearchSummary {
  id: string;
  createdAt: Date;
  trends: string[];
  filters: unknown;
  trendAnalysis: unknown;
  /** Weights and theses-run count used for this snapshot; null for snapshots before Phase C. */
  scoringConfig: ScoringConfig | null;
}

interface SearchResultRow {
  ticker: string;
  companyName: string;
  rationale: string;
  trendMatched: string[];
  financialData: unknown;
  dataQuality: unknown;
  compositeScore: number | null;
  convergenceScore: number | null;
}

/** Reassembles a ScoredCompanyData from the flattened row shape used by both storage backends. */
function toScoredCompanyData(row: SearchResultRow): ScoredCompanyData {
  const financialData = (row.financialData ?? {}) as Record<string, unknown>;
  const dataQuality = (row.dataQuality ?? {}) as { priceSource?: string };
  const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
  // Missing on pre-Phase-C rows -> null ("no data"), never a made-up default
  const optNum = (key: string): number | null => num(financialData[key]);
  const optBool = (key: string): boolean | null =>
    typeof financialData[key] === 'boolean' ? (financialData[key] as boolean) : null;

  return {
    ticker: row.ticker,
    companyName: row.companyName,
    trendsMatched: Array.isArray(row.trendMatched) ? row.trendMatched : [],
    convergenceScore: row.convergenceScore ?? 0,
    compositeScore: row.compositeScore ?? 0,
    relevanceScore: typeof financialData.relevanceScore === 'number' ? financialData.relevanceScore : 5,
    dataQuality: { priceSource: dataQuality.priceSource === 'live' ? 'live' : 'unavailable' },
    stockPrice: num(financialData.stockPrice) ?? 0,
    marketCap: num(financialData.marketCap) ?? 0,
    exchange: (financialData.exchange as ScoredCompanyData['exchange']) ?? null,
    peRatio: financialData.peRatio !== undefined ? (financialData.peRatio as number | null) : null,
    growth1Y: financialData.growth1Y !== undefined ? (financialData.growth1Y as number | null) : null,
    growth5Y: financialData.growth5Y !== undefined ? (financialData.growth5Y as number | null) : null,
    debtToEquity: financialData.debtToEquity !== undefined ? (financialData.debtToEquity as number | null) : null,
    rationales: (financialData.rationales as Record<string, string>) ?? {},
    priceToSales: optNum('priceToSales'),
    preRevenue: optBool('preRevenue'),
    lossMaking: optBool('lossMaking'),
    revenueGrowthYoY: optNum('revenueGrowthYoY'),
    change6M: optNum('change6M'),
    rallied6M: optBool('rallied6M'),
    scoreBreakdown: (financialData.scoreBreakdown as ScoreBreakdown | undefined) ?? undefined,
  };
}

function toSummary(row: {
  id: string;
  createdAt: Date;
  trends: string[];
  filters: unknown;
  trendAnalysis: unknown;
  scoringConfig?: unknown;
}): SearchSummary {
  return {
    id: row.id,
    createdAt: row.createdAt,
    trends: row.trends,
    filters: row.filters,
    trendAnalysis: row.trendAnalysis,
    scoringConfig: parseScoringConfig(row.scoringConfig),
  };
}

export async function listSearches(): Promise<SearchSummary[]> {
  if (await isDbAvailable()) {
    const rows = await prisma.search.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map(toSummary);
  }
  return [...memorySearches].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map(toSummary);
}

/** A saved search reduced to what the track record needs (Phase D scorecard). */
export interface SearchWithPicks {
  id: string;
  createdAt: Date;
  trends: string[];
  picks: PickInput[];
}

/** Price saved with a pick; null (never 0) when there wasn't a real one. */
function storedPrice(financialData: unknown): number | null {
  const price = (financialData as { stockPrice?: unknown } | null)?.stockPrice;
  return typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : null;
}

function toPick(row: { ticker: string; companyName: string; compositeScore: number | null; financialData: unknown }): PickInput {
  return {
    ticker: row.ticker.toUpperCase(),
    companyName: row.companyName,
    compositeScore: typeof row.compositeScore === 'number' ? row.compositeScore : null,
    priceAtSearch: storedPrice(row.financialData),
  };
}

/** Every saved search with its picks, oldest first. */
export async function listSearchesWithPicks(): Promise<SearchWithPicks[]> {
  if (await isDbAvailable()) {
    const rows = await prisma.search.findMany({
      orderBy: { createdAt: 'asc' },
      include: { results: { select: { ticker: true, companyName: true, compositeScore: true, financialData: true } } },
    });
    return rows.map((s) => ({ id: s.id, createdAt: s.createdAt, trends: s.trends, picks: s.results.map(toPick) }));
  }

  return [...memorySearches]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      trends: s.trends,
      picks: memorySearchResults.filter((r) => r.searchId === s.id).map(toPick),
    }));
}

export async function getSearchWithResults(
  id: string
): Promise<{ search: SearchSummary; companies: ScoredCompanyData[] } | null> {
  if (await isDbAvailable()) {
    const search = await prisma.search.findUnique({ where: { id }, include: { results: true } });
    if (!search) return null;
    return { search: toSummary(search), companies: search.results.map(toScoredCompanyData) };
  }

  const search = memorySearches.find((s) => s.id === id);
  if (!search) return null;
  const results = memorySearchResults.filter((r) => r.searchId === id);
  return { search: toSummary(search), companies: results.map(toScoredCompanyData) };
}

export async function createSearch(input: {
  trends: string[];
  filters: unknown;
  trendAnalysis: unknown;
  /** Weights + theses-run count used for these scores, so a restore re-scores the same way. */
  scoringConfig?: ScoringConfig | null;
  results: ScoredCompanyData[];
}): Promise<SearchSummary> {
  const resultRows: SearchResultRow[] = input.results.map((r) => ({
    ticker: r.ticker,
    companyName: r.companyName,
    // Joined from the per-thesis map (bug B1: used to read a field that was never set, so always '')
    rationale: buildRationaleNote(r.rationales),
    trendMatched: r.trendsMatched || [],
    financialData: {
      stockPrice: r.stockPrice,
      marketCap: r.marketCap,
      exchange: r.exchange,
      peRatio: r.peRatio,
      growth1Y: r.growth1Y,
      growth5Y: r.growth5Y,
      debtToEquity: r.debtToEquity,
      rationales: r.rationales || {},
      relevanceScore: r.relevanceScore,
      priceToSales: r.priceToSales ?? null,
      preRevenue: r.preRevenue ?? null,
      lossMaking: r.lossMaking ?? null,
      revenueGrowthYoY: r.revenueGrowthYoY ?? null,
      change6M: r.change6M ?? null,
      rallied6M: r.rallied6M ?? null,
      // Per-factor contributions as scored at save time (Phase D reads these)
      scoreBreakdown: r.scoreBreakdown ?? null,
    },
    dataQuality: r.dataQuality,
    compositeScore: r.compositeScore,
    convergenceScore: r.convergenceScore,
  }));

  if (await isDbAvailable()) {
    const created = await prisma.search.create({
      data: {
        trends: input.trends,
        filters: (input.filters ?? {}) as Prisma.InputJsonValue,
        trendAnalysis: (input.trendAnalysis ?? {}) as Prisma.InputJsonValue,
        scoringConfig: input.scoringConfig ? (input.scoringConfig as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        results: {
          create: resultRows.map((r) => ({
            ...r,
            financialData: r.financialData as Prisma.InputJsonValue,
            dataQuality: (r.dataQuality ?? {}) as Prisma.InputJsonValue,
          })),
        },
      },
    });
    return toSummary(created);
  }

  const searchId = crypto.randomUUID();
  const newSearch: MemorySearch = {
    id: searchId,
    createdAt: new Date(),
    trends: input.trends,
    filters: input.filters ?? {},
    trendAnalysis: input.trendAnalysis ?? {},
    scoringConfig: input.scoringConfig ?? null,
  };
  memorySearches.push(newSearch);

  for (const r of resultRows) {
    const entry: MemorySearchResult = { id: crypto.randomUUID(), searchId, ...r };
    memorySearchResults.push(entry);
  }
  return toSummary(newSearch);
}

export async function deleteSearch(id: string): Promise<boolean> {
  if (await isDbAvailable()) {
    try {
      await prisma.search.delete({ where: { id } }); // cascades to results
      return true;
    } catch {
      return false; // not found
    }
  }

  const index = memorySearches.findIndex((s) => s.id === id);
  if (index === -1) return false;
  memorySearches.splice(index, 1);

  const toRemove = memorySearchResults
    .map((r, idx) => (r.searchId === id ? idx : -1))
    .filter((idx) => idx !== -1)
    .reverse();
  for (const idx of toRemove) memorySearchResults.splice(idx, 1);
  return true;
}
