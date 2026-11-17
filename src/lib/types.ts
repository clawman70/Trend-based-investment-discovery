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
  // --- Phase C (honest scoring). All optional: snapshots saved before Phase C lack them,
  // and a missing value is treated as "no data" (neutral in the score, marked missing). ---
  /** Price / sales (Finnhub psTTM). The valuation input: exists for loss-makers too. */
  priceToSales?: number | null;
  /** true = Finnhub reports zero revenue. Ranked last on valuation (P/S is effectively infinite). */
  preRevenue?: boolean | null;
  /** true = negative trailing EPS; explains why P/E is N/A. */
  lossMaking?: boolean | null;
  /** Revenue growth, trailing 12 months vs the year before, percent (Finnhub). */
  revenueGrowthYoY?: number | null;
  /** 6-month price change in percent. Display only (rally flag); never scored. */
  change6M?: number | null;
  /** change6M > 30%. null = couldn't check. Display only; never scored (decision D4). */
  rallied6M?: boolean | null;
}

/** The five score factors. Keys double as the weight keys. */
export type ScoreFactorKey = 'relevance' | 'convergence' | 'valuation' | 'health' | 'growth';

export type ScoringWeights = Record<ScoreFactorKey, number>;

/**
 * How one factor fed one company's score.
 * - real: came from market data (Finnhub/Yahoo)
 * - ai: came from the AI discovery step (relevance; convergence = how many AI calls found it)
 * - missing: no data, so the factor sat at neutral (0.5)
 * - excluded: left out of the math entirely (convergence with a single thesis, decision D2)
 */
export interface FactorContribution {
  status: 'real' | 'ai' | 'missing' | 'excluded';
  /** 0..1 factor score actually used (0.5 when missing, null when excluded). */
  value: number | null;
  /** Share of the total weight this factor carried for this run, 0..100. */
  weightPct: number;
  /** Points this factor added to the 0-100 composite (value x weightPct). */
  points: number;
}

export interface ScoreBreakdown {
  factors: Record<ScoreFactorKey, FactorContribution>;
  /** How many of the three market-data factors (valuation, health, growth) had real data. */
  coverage: { real: number; total: number };
}

/** Saved with every history snapshot so a restored search re-scores the same way (and for Phase D). */
export interface ScoringConfig {
  weights: ScoringWeights;
  /** Theses that actually returned results. <= 1 means convergence is excluded. */
  thesesRun: number;
  /** Identifies the scoring formula, so a later change can tell old snapshots apart. */
  method: 'percentile-v1';
}

export interface ScoredCompanyData extends CompanyData {
  trendsMatched: string[]; // trends this company matches
  convergenceScore: number; // 0.0 to 1.0 based on matches
  rationales: Record<string, string>; // trend -> rationale mapping
  compositeScore: number; // weighted composite score 0-100 (one decimal)
  /** Per-factor contributions. Missing on snapshots saved before Phase C until re-scored. */
  scoreBreakdown?: ScoreBreakdown;
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
