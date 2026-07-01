export interface Filters {
  marketCap: string[];
  exchange: string[];
  currentPrice: string | null;
}

export interface DiscoveredCompany {
  ticker: string;
  companyName: string;
  rationale: string;
}

export interface CompanyData extends DiscoveredCompany {
  stockPrice: number;
  marketCap: number;
  growth1Y: number;
  growth5Y: number;
  analystConsensus: 'Buy' | 'Hold' | 'Sell';
  analystTargetPrice: number;
  exchange: 'NASDAQ' | 'NYSE';
}

export type SortableKeys = keyof CompanyData;

export interface SortConfig {
  key: SortableKeys;
  direction: 'ascending' | 'descending';
}