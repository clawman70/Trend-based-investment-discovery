export interface Filters {
  marketCap: string[];
  exchange: string[];
  currentPrice: string | null;
}

export interface DiscoveredCompany {
  ticker: string;
  companyName: string;
  rationale: string;
  relevanceScore: number; // AI-assigned 1-10 relevance
}

/** Google Finance exchange codes (also used for display). */
export type Exchange = 'NASDAQ' | 'NYSE' | 'NYSEAMERICAN' | 'NYSEARCA' | 'BATS';

export interface DataQuality {
  priceSource: 'live' | 'unavailable';
  growthSource?: 'calculated' | 'insufficient_history' | 'unavailable';
  fundamentalsSource?: 'live' | 'unavailable';
}

/**
 * A company after discovery. The single per-thesis `rationale` from Claude is NOT carried
 * here: the discover route merges per-thesis results into `rationales` (on
 * ScoredCompanyData). Where one string is needed (watchlist note, history row), build it
 * with `buildRationaleNote()` in src/lib/rationale.ts. (Bug B1: a required-but-never-set
 * `rationale` field here made those notes silently empty.)
 */
export interface CompanyData extends Omit<DiscoveredCompany, 'rationale'> {
  stockPrice: number; // 0 = unavailable
  marketCap: number; // 0 = unavailable
  exchange: Exchange | null; // null = unknown
  dataQuality: DataQuality;
  peRatio?: number | null;
  growth1Y?: number | null; // percent; null = unavailable
  growth5Y?: number | null; // percent; null = unavailable
  debtToEquity?: number | null;
}

export interface ScoredCompanyData extends CompanyData {
  trendsMatched: string[]; // trends this company matches
  convergenceScore: number; // 0.0 to 1.0 based on matches
  rationales: Record<string, string>; // trend -> rationale mapping
  compositeScore: number; // weighted composite score 0-100
}

export interface TrendAnalysis {
  maturityStage: 'Nascent' | 'Emerging' | 'Growth' | 'Established' | 'Declining';
  estimatedTAM: string;
  catalysts: string[];
  risks: string[];
  timeHorizon: string;
  adjacentTrends: string[];
}

export type SortableKeys = keyof ScoredCompanyData;

export interface SortConfig {
  key: SortableKeys;
  direction: 'ascending' | 'descending';
}

// Research report types. Every fixed-list field also allows 'unknown': Gemini's JSON is
// validated with Zod (src/lib/researchSchema.ts) and an off-list value is coerced to
// 'unknown' instead of rendering a broken badge (bug B10).

export interface Source {
  title: string;
  url: string;
  date: string;
  sourceType: 'research_paper' | 'news' | 'social' | 'video' | 'patent' | 'government' | 'unknown';
}

export interface CandidateThesis {
  thesisStatement: string;
  convergenceType: 'demand_supply' | 'parallel_growth' | 'regulatory_catalyst' | 'technology_enablement' | 'unknown';
  domainsInvolved: string[];
  recencySignal: string;
  maturity: 'Nascent' | 'Pre-emergence' | 'Early emergence' | 'unknown';
  confidence: 'High' | 'Medium' | 'Speculative' | 'unknown';
  rationale: string;
  sources: Source[];
}

export type MentionedMarketCapTier = 'micro' | 'small' | 'mid' | 'large' | 'unknown';

/** Why a Research-tab company's ticker couldn't be trusted (bug B5). */
export type TickerUnverifiedReason =
  | 'not_listed' // not a major-US-exchange listing in the Finnhub directory (private, foreign, OTC, made up)
  | 'name_mismatch' // the ticker IS listed, but to a company whose name doesn't match the one Gemini gave
  | 'directory_unavailable'; // the listing directory couldn't be loaded, so nothing could be checked

export interface MentionedCompany {
  name: string;
  ticker: string;
  /** Computed from the real Finnhub market cap when marketCapTierSource is 'finnhub'; otherwise Gemini's guess. */
  marketCapTier: MentionedMarketCapTier;
  context: string;
  recentRally: boolean | null; // computed from real price history, not an AI guess; null = couldn't verify
  /**
   * 'verified' = the ticker is a listed US security whose official name matches. Only
   * verified companies get a rally check and a real market-cap tier. Optional because
   * scans cached before this check existed don't have it — treat missing as unverified.
   */
  tickerStatus?: 'verified' | 'unverified';
  unverifiedReason?: TickerUnverifiedReason;
  /** The official name from the listing directory, when the ticker was found. */
  listingName?: string | null;
  /** Where marketCapTier came from. Missing (older scans) = treat as an AI estimate. */
  marketCapTierSource?: 'finnhub' | 'ai_estimate';
}

export interface TrendResearchReport {
  isDemo?: boolean; // true only for DEMO_MODE placeholder reports
  executiveSummary: string;
  scanDate: string;
  domainsScanned: string[];
  candidateTheses: CandidateThesis[];
  companiesMentioned: MentionedCompany[];
  adjacentSignals: string[];
}
