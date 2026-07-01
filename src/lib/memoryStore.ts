export interface MemorySearch {
  id: string;
  createdAt: Date;
  trends: string[];
  filters: unknown;
  trendAnalysis: unknown;
}

export interface MemorySearchResult {
  id: string;
  searchId: string;
  ticker: string;
  companyName: string;
  rationale: string;
  trendMatched: string[];
  financialData: unknown;
  dataQuality: unknown;
  compositeScore: number | null;
  convergenceScore: number | null;
}

export interface MemoryWatchlistItem {
  id: string;
  ticker: string;
  companyName: string;
  addedAt: Date;
  priceAtAdd: number;
  sourceSearchId: string | null;
  notes: string | null;
  tags: string[];
}

export interface MemoryTrendPortfolio {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
}

export interface MemoryPortfolioItem {
  id: string;
  portfolioId: string;
  watchlistId: string;
}

import { TrendResearchReport } from './types';

export interface MemoryResearchScan {
  id: string;
  createdAt: Date;
  domains: string[];
  customPrompt: string | null;
  report: TrendResearchReport;
  cachedUntil: Date;
}

export interface MemoryResearchLoadedThesis {
  id: string;
  scanId: string;
  thesis: string;
  loadedAt: Date;
  searchId: string | null;
}

// Attach stores to a global reference so they persist across hot-reloading in Next.js development mode.
const globalRef = global as unknown as Record<string, unknown[]>;

if (!globalRef.memorySearches) {
  globalRef.memorySearches = [];
}
if (!globalRef.memorySearchResults) {
  globalRef.memorySearchResults = [];
}
if (!globalRef.memoryWatchlistItems) {
  globalRef.memoryWatchlistItems = [];
}
if (!globalRef.memoryTrendPortfolios) {
  globalRef.memoryTrendPortfolios = [];
}
if (!globalRef.memoryPortfolioItems) {
  globalRef.memoryPortfolioItems = [];
}
if (!globalRef.memoryResearchScans) {
  globalRef.memoryResearchScans = [];
}
if (!globalRef.memoryResearchLoadedTheses) {
  globalRef.memoryResearchLoadedTheses = [];
}

export const memorySearches = globalRef.memorySearches as MemorySearch[];
export const memorySearchResults = globalRef.memorySearchResults as MemorySearchResult[];
export const memoryWatchlistItems = globalRef.memoryWatchlistItems as MemoryWatchlistItem[];
export const memoryTrendPortfolios = globalRef.memoryTrendPortfolios as MemoryTrendPortfolio[];
export const memoryPortfolioItems = globalRef.memoryPortfolioItems as MemoryPortfolioItem[];
export const memoryResearchScans = globalRef.memoryResearchScans as MemoryResearchScan[];
export const memoryResearchLoadedTheses = globalRef.memoryResearchLoadedTheses as MemoryResearchLoadedThesis[];
