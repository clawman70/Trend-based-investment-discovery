
import { CompanyData } from '../types';

const escapeCSVValue = (value: any): string => {
  if (value === null || value === undefined) {
    return '';
  }
  let str = String(value);
  // If the value contains a comma, double quote, or newline, wrap it in double quotes.
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    // Escape existing double quotes by doubling them up.
    str = str.replace(/"/g, '""');
    return `"${str}"`;
  }
  return str;
};

export const exportToCSV = (data: CompanyData[], filename: string): void => {
  if (data.length === 0) {
    return;
  }
  
  const headers = [
    'Ticker', 'Company Name', 'Exchange', 'Rationale', 'Stock Price', 'Market Cap', 
    '1Y Growth (%)', '5Y Growth (%)', 'Analyst Consensus', 'Analyst Target Price'
  ];
  
  const rows = data.map(company => [
    escapeCSVValue(company.ticker),
    escapeCSVValue(company.companyName),
    escapeCSVValue(company.exchange),
    escapeCSVValue(company.rationale),
    escapeCSVValue(company.stockPrice.toFixed(2)),
    escapeCSVValue(company.marketCap),
    escapeCSVValue(company.growth1Y.toFixed(2)),
    escapeCSVValue(company.growth5Y.toFixed(2)),
    escapeCSVValue(company.analystConsensus),
    escapeCSVValue(company.analystTargetPrice.toFixed(2)),
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
