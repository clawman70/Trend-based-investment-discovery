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

export interface CompanyData extends DiscoveredCompany {
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

export interface Source {
  title: string;
  url: string;
  date: string;
  sourceType: 'research_paper' | 'news' | 'social' | 'video' | 'patent' | 'government';
}

export interface CandidateThesis {
  thesisStatement: string;
  convergenceType: 'demand_supply' | 'parallel_growth' | 'regulatory_catalyst' | 'technology_enablement';
  domainsInvolved: string[];
  recencySignal: string;
  maturity: 'Nascent' | 'Pre-emergence' | 'Early emergence';
  confidence: 'High' | 'Medium' | 'Speculative';
  rationale: string;
  sources: Source[];
}

export interface MentionedCompany {
  name: string;
  ticker: string;
  marketCapTier: 'micro' | 'small' | 'mid' | 'large';
  context: string;
  recentRally: boolean;
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
