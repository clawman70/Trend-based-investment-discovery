import React from 'react';

interface ValidationAlertsProps {
  invalidTickers: string[];
  /** True when the symbol directory couldn't be loaded, so no tickers were checked. */
  bypassed?: boolean;
}

const WarningIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
  </svg>
);

export const ValidationAlerts: React.FC<ValidationAlertsProps> = ({ invalidTickers, bypassed = false }) => {
  if (!bypassed && (!invalidTickers || invalidTickers.length === 0)) {
    return null;
  }

  if (bypassed) {
    return (
      <div className="mt-6 bg-brand-red/5 border border-brand-red/40 p-4 rounded-xl flex items-start space-x-3.5 shadow-lg animate-fade-in">
        <div className="bg-brand-red/10 p-2 rounded-lg text-brand-red shrink-0">
          <WarningIcon />
        </div>
        <div>
          <h4 className="text-sm font-bold text-brand-red tracking-wide uppercase">
            Ticker Validation Unavailable
          </h4>
          <p className="text-xs text-brand-light mt-1.5 leading-relaxed">
            The exchange listing directory could not be loaded (check FINNHUB_API_KEY), so AI-suggested tickers
            below were <strong>not verified</strong>. Some may be invalid, delisted, or made up.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6 bg-brand-yellow/5 border border-brand-yellow/30 p-4 rounded-xl flex items-start space-x-3.5 shadow-lg animate-fade-in">
      <div className="bg-brand-yellow/10 p-2 rounded-lg text-brand-yellow shrink-0">
        <WarningIcon />
      </div>
      <div>
        <h4 className="text-sm font-bold text-brand-yellow tracking-wide uppercase">
          Validation Warning: Unlisted Tickers Dropped
        </h4>
        <p className="text-xs text-brand-light mt-1.5 leading-relaxed">
          These AI-suggested tickers were dropped because they are not listed on a major US exchange
          (NASDAQ, NYSE, NYSE American, NYSE Arca, Cboe BZX). This includes made-up symbols, delisted names,
          OTC listings, and ETFs.
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
