import React from 'react';

interface ValidationAlertsProps {
  invalidTickers: string[];
}

export const ValidationAlerts: React.FC<ValidationAlertsProps> = ({ invalidTickers }) => {
  if (!invalidTickers || invalidTickers.length === 0) {
    return null;
  }

  return (
    <div className="mt-6 bg-brand-yellow/5 border border-brand-yellow/30 p-4 rounded-xl flex items-start space-x-3.5 shadow-lg animate-fade-in">
      <div className="bg-brand-yellow/10 p-2 rounded-lg text-brand-yellow shrink-0">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      </div>
      <div>
        <h4 className="text-sm font-bold text-brand-yellow tracking-wide uppercase">
          Validation Warning: Hallucinated Tickers Dropped
        </h4>
        <p className="text-xs text-brand-light mt-1.5 leading-relaxed">
          The following tickers suggested by Gemini were dropped because they do not resolve to active, listed companies on the exchange stock directories. This ensures all financial data displayed below is 100% verified.
        </p>
        <div className="flex flex-wrap gap-1.5 mt-3">
          {invalidTickers.map((ticker) => (
            <span 
              key={ticker} 
              className="text-xs font-mono font-bold bg-brand-yellow/10 border border-brand-yellow/30 text-brand-yellow px-2 py-0.5 rounded"
            >
              {ticker}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};
