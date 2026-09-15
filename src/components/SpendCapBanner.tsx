'use client';

import React, { useEffect, useState } from 'react';

const WarningIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
  </svg>
);

interface UsageToday {
  spentUsd: number;
  capUsd: number;
  exceeded: boolean;
}

/** Warns once today's estimated AI spend crosses DAILY_SPEND_CAP_USD. Informational only — never blocks AI calls. */
export const SpendCapBanner: React.FC = () => {
  const [usage, setUsage] = useState<UsageToday | null>(null);

  useEffect(() => {
    fetch('/api/usage/today')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: UsageToday | null) => setUsage(data))
      .catch(() => undefined); // Never let a usage-check failure disrupt the page
  }, []);

  if (!usage || !usage.exceeded) {
    return null;
  }

  return (
    <div className="mb-6 bg-brand-yellow/5 border border-brand-yellow/30 p-4 rounded-xl flex items-start space-x-3.5 shadow-lg animate-fade-in">
      <div className="bg-brand-yellow/10 p-2 rounded-lg text-brand-yellow shrink-0">
        <WarningIcon />
      </div>
      <div>
        <h4 className="text-sm font-bold text-brand-yellow tracking-wide uppercase">
          Daily AI Spend Cap Reached
        </h4>
        <p className="text-xs text-brand-light mt-1.5 leading-relaxed">
          {`Today's estimated AI usage (~$${usage.spentUsd.toFixed(2)}) has crossed your $${usage.capUsd.toFixed(2)} daily cap. This is an estimate for a heads-up, not a real billing figure — AI calls still work as normal.`}
          {' '}Adjust <code className="font-mono">DAILY_SPEND_CAP_USD</code> in <code className="font-mono">.env.local</code> if this cap no longer fits.
        </p>
      </div>
    </div>
  );
};
