'use client';

/**
 * Header status bar (Phase E). Replaces the old hardcoded "TERMINAL STATUS: ONLINE"
 * light with real checks from GET /api/status, polled every 10 seconds while the tab
 * is visible.
 *
 * Light colour:
 * - green: Postgres is saving data and every API key is set
 * - amber: running on in-memory storage (saved items will not survive a restart),
 *          or an API key is missing
 * - red:   the status check itself failed (server unreachable)
 */
import React, { useCallback, useEffect, useState } from 'react';

const POLL_MS = 10_000;

export interface AppStatus {
  storage: { mode: 'postgres'; reason: null } | { mode: 'memory'; reason: 'not_configured' | 'unreachable' };
  keys: { anthropic: boolean; gemini: boolean; finnhub: boolean };
  tickerDirectory: { loaded: boolean; symbolCount: number | null };
  spend: { spentUsd: number | null; capUsd: number };
  checkedAt: string;
}

const KEY_LABELS: { id: keyof AppStatus['keys']; label: string }[] = [
  { id: 'anthropic', label: 'CLAUDE' },
  { id: 'gemini', label: 'GEMINI' },
  { id: 'finnhub', label: 'FINNHUB' },
];

export const StatusBar: React.FC = () => {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [failed, setFailed] = useState(false);

  const poll = useCallback(async () => {
    try {
      const res = await fetch('/api/status', { cache: 'no-store' });
      if (!res.ok) throw new Error(`status ${res.status}`);
      setStatus((await res.json()) as AppStatus);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') poll();
    }, POLL_MS);
    const onVisible = () => document.visibilityState === 'visible' && poll();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [poll]);

  const memoryMode = status?.storage.mode === 'memory';
  const missingKeys = status ? KEY_LABELS.filter((k) => !status.keys[k.id]) : [];
  const tone: 'green' | 'amber' | 'red' | 'unknown' = failed
    ? 'red'
    : !status
    ? 'unknown'
    : memoryMode || missingKeys.length > 0
    ? 'amber'
    : 'green';

  const dotClass = {
    green: 'bg-brand-green',
    amber: 'bg-brand-yellow',
    red: 'bg-brand-red',
    unknown: 'bg-zinc-600',
  }[tone];

  const headline = failed
    ? 'STATUS: SERVER UNREACHABLE'
    : !status
    ? 'STATUS: CHECKING...'
    : memoryMode
    ? 'STORAGE: MEMORY — saved items will not survive a restart'
    : 'STORAGE: POSTGRES';

  return (
    <div
      data-testid="status-bar"
      data-tone={tone}
      className={`bg-brand-secondary/40 border px-5 py-3 rounded-lg mb-6 flex flex-wrap justify-between items-center text-xs font-mono text-brand-light gap-2 ${
        tone === 'amber' ? 'border-brand-yellow/40' : tone === 'red' ? 'border-brand-red/40' : 'border-brand-border/40'
      }`}
    >
      <div className="flex items-center space-x-2">
        <span className={`w-2.5 h-2.5 rounded-full inline-block ${dotClass}`} />
        <span className={tone === 'amber' ? 'text-brand-yellow' : tone === 'red' ? 'text-brand-red' : ''}>
          {headline}
          {memoryMode && status?.storage.reason === 'not_configured' && ' (no database configured)'}
          {memoryMode && status?.storage.reason === 'unreachable' && ' (database unreachable)'}
        </span>
      </div>
      {status && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>
            KEYS:{' '}
            {KEY_LABELS.map((k) => (
              <span key={k.id} className={`ml-1 ${status.keys[k.id] ? 'text-brand-green' : 'text-brand-yellow'}`}>
                {k.label} {status.keys[k.id] ? '✓' : 'MISSING'}
              </span>
            ))}
          </span>
          <span>
            TICKER DIRECTORY:{' '}
            {status.tickerDirectory.loaded && status.tickerDirectory.symbolCount !== null
              ? `${status.tickerDirectory.symbolCount.toLocaleString()} SYMBOLS`
              : 'NOT LOADED YET (loads on first run)'}
          </span>
          <span title="Estimate from reported token counts, not a billing figure">
            AI SPEND TODAY: {status.spend.spentUsd === null ? 'N/A' : `~$${status.spend.spentUsd.toFixed(2)}`} / ${status.spend.capUsd.toFixed(2)} cap
          </span>
        </div>
      )}
    </div>
  );
};
