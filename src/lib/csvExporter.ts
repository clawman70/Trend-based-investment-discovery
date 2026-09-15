import { ScoredCompanyData } from './types';

const escapeCSVValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '';
  }
  let str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    str = str.replace(/"/g, '""');
    return `"${str}"`;
  }
  return str;
};

export const exportToCSV = (data: ScoredCompanyData[], filename: string): void => {
  if (data.length === 0) {
    return;
  }
  
  const headers = [
    'Ticker', 'Company Name', 'Exchange', 'Composite Score', 'Convergence Score', 
    'Matched Trends Count', 'Matched Trends List', 'P/E Ratio', 'Stock Price ($)',
    'Market Cap ($)', '1Y Price Growth (%)', '5Y Price Growth (%)', 'Debt/Equity'
  ];

  const formatOptional = (value: number | null | undefined, decimals: number) =>
    value !== null && value !== undefined ? value.toFixed(decimals) : 'N/A';
  
  const rows = data.map(company => [
    escapeCSVValue(company.ticker),
    escapeCSVValue(company.companyName),
    escapeCSVValue(company.exchange),
    escapeCSVValue(company.compositeScore !== undefined ? company.compositeScore : ''),
    escapeCSVValue(company.convergenceScore !== undefined ? company.convergenceScore.toFixed(2) : ''),
    escapeCSVValue(company.trendsMatched?.length || 0),
    escapeCSVValue(company.trendsMatched?.join('; ') || ''),
    escapeCSVValue(company.peRatio !== null && company.peRatio !== undefined ? company.peRatio.toFixed(1) : 'N/A'),
    escapeCSVValue(company.stockPrice > 0 ? company.stockPrice.toFixed(2) : 'N/A'),
    escapeCSVValue(company.marketCap > 0 ? company.marketCap : 'N/A'),
    escapeCSVValue(formatOptional(company.growth1Y, 1)),
    escapeCSVValue(formatOptional(company.growth5Y, 1)),
    escapeCSVValue(formatOptional(company.debtToEquity, 2)),
  ].join(','));

  const csvContent = [headers.join(','), ...rows].join('\n');
  
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  
  const link = document.createElement('a');
  if (link.download !== undefined) {
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
};
