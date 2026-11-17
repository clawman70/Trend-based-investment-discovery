import React, { useEffect, useState } from 'react';
import type { Figure, OverallScorecard, PickOutcome, SearchScorecard } from '@/lib/trackRecord';
import { ReturnBadge } from './ReturnBadge';

/**
 * Scorecard tab (Phase D, the track record): did the picks beat SPY since each search?
 * All numbers come from GET /api/scorecard; this component only displays them. Every
 * figure shows the picks and days behind it, and is labeled TOO EARLY TO READ under 30
 * days or 10 picks (the rule lives in src/lib/trackRecord.ts).
 */

interface ScorecardResponse {
  generatedAt: string;
  benchmarkTicker: string;
  benchmarkCurrentPrice: number | null;
  finnhubConfigured: boolean;
  rules: { minDays: number; minPicks: number };
  overall: OverallScorecard;
  searches: SearchScorecard[];
}

interface ScorecardViewProps {
  isActive: boolean;
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** A trading date (YYYY-MM-DD) shown as "Fri, Sep 11" without timezone drift. */
const fmtTradingDate = (ymd: string) =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

const daysLabel = (f: Figure) =>
  f.minDays === null ? '0 days' : f.minDays === f.maxDays ? `${f.minDays} days` : `${f.minDays}–${f.maxDays} days`;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const TooEarly: React.FC<{ figure: Figure }> = ({ figure }) =>
  figure.tooEarly ? (
    <span
      className="text-[9px] font-mono font-bold uppercase text-amber-400 bg-amber-950/30 border border-amber-900/40 px-1.5 py-0.5 rounded"
      title={figure.tooEarlyReason ?? undefined}
    >
      Too early to read{figure.tooEarlyReason ? `: ${figure.tooEarlyReason}` : ''}
    </span>
  ) : null;

/** One number with its basis ("13 picks · 63 days") right under it. */
const Stat: React.FC<{ label: string; basis: string; children: React.ReactNode }> = ({ label, basis, children }) => (
  <div className="bg-zinc-950/50 border border-zinc-900 rounded-lg p-3 min-w-0">
    <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">{label}</div>
    <div className="mt-1.5 text-base">{children}</div>
    <div className="text-[10px] font-mono text-zinc-600 mt-1">{basis}</div>
  </div>
);

/** The four numbers for one figure: average pick return, SPY, difference, hit rate. */
const FigureStats: React.FC<{ figure: Figure; benchmark: string }> = ({ figure, benchmark }) => {
  const basis = `${plural(figure.picks, 'pick')} · ${daysLabel(figure)}`;
  const vsBasis = `${plural(figure.picksVsBenchmark, 'pick')} · ${daysLabel(figure)}`;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Stat label="Avg pick return" basis={basis}>
        <ReturnBadge value={figure.avgPickReturn} />
      </Stat>
      <Stat label={`${benchmark} same window`} basis={vsBasis}>
        <ReturnBadge value={figure.avgBenchmarkReturn} />
      </Stat>
      <Stat label={`Difference vs ${benchmark}`} basis={vsBasis}>
        <ReturnBadge value={figure.avgExcessReturn} unit="pts" />
      </Stat>
      <Stat label={`Hit rate (beat ${benchmark})`} basis={vsBasis}>
        {figure.hitRate === null ? (
          <span className="text-zinc-600 italic text-[11px]">N/A</span>
        ) : (
          <span className="font-mono font-bold text-zinc-200 text-sm">{Math.round(figure.hitRate * 100)}%</span>
        )}
      </Stat>
    </div>
  );
};

/** Top-scored half vs bottom-scored half: does a higher score predict a better result? */
const HalvesStats: React.FC<{ top: Figure | null; bottom: Figure | null; benchmark: string }> = ({ top, bottom, benchmark }) => {
  const half = (label: string, f: Figure | null) => (
    <div className="bg-zinc-950/50 border border-zinc-900 rounded-lg p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">{label}</span>
        {f && <TooEarly figure={f} />}
      </div>
      {f ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-mono text-zinc-400">
          <span>
            vs {benchmark}: <ReturnBadge value={f.avgExcessReturn} unit="pts" />
          </span>
          <span>
            return: <ReturnBadge value={f.avgPickReturn} />
          </span>
          <span>hit rate: {f.hitRate === null ? 'N/A' : `${Math.round(f.hitRate * 100)}%`}</span>
          <span className="text-zinc-600">
            {plural(f.picks, 'pick')} · {daysLabel(f)}
          </span>
        </div>
      ) : (
        <div className="mt-2 text-xs font-mono text-zinc-600 italic">N/A: needs at least 2 scored picks</div>
      )}
    </div>
  );
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {half('Top-scored half', top)}
      {half('Bottom-scored half', bottom)}
    </div>
  );
};

const exclusionText = (p: PickOutcome) =>
  p.status === 'no_stored_price'
    ? 'Excluded: no price was saved with the search'
    : 'Excluded: no price today (possibly delisted or renamed)';

const exclusionSummary = (e: { noStoredPrice: number; noCurrentPrice: number }) =>
  [
    e.noStoredPrice > 0 ? `${e.noStoredPrice} no saved price` : null,
    e.noCurrentPrice > 0 ? `${e.noCurrentPrice} no price today` : null,
  ]
    .filter(Boolean)
    .join(', ');

const PicksTable: React.FC<{ card: SearchScorecard }> = ({ card }) => {
  // Best first; excluded picks at the bottom
  const rows = [...card.picks].sort((a, b) => (b.pickReturn ?? -Infinity) - (a.pickReturn ?? -Infinity));
  return (
    <div className="overflow-x-auto rounded-lg border border-brand-border/40 mt-3">
      <table className="min-w-full divide-y divide-brand-border/40">
        <thead className="bg-brand-primary/60">
          <tr>
            {['Pick', 'Score', 'Price at search', 'Price now', 'Return', `vs ${card.benchmark.ticker}`].map((h) => (
              <th key={h} scope="col" className="px-3 py-2 text-left text-[10px] font-bold text-brand-light uppercase tracking-wider whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-brand-border/30 bg-brand-secondary/30 text-xs">
          {rows.map((p) => (
            <tr key={p.ticker} className={p.status === 'included' ? '' : 'opacity-60'}>
              <td className="px-3 py-2 whitespace-nowrap">
                <span className="font-mono font-bold text-brand-green">{p.ticker}</span>
                <span className="text-zinc-500 ml-2">{p.companyName}</span>
              </td>
              <td className="px-3 py-2 font-mono text-zinc-400">{p.compositeScore ?? 'N/A'}</td>
              <td className="px-3 py-2 font-mono text-zinc-300 whitespace-nowrap">
                {p.priceAtSearch !== null ? `$${p.priceAtSearch.toFixed(2)}` : <span className="text-zinc-600 italic">N/A</span>}
                {p.splitFactor !== null && p.splitFactor !== 1 && p.startPrice !== null && (
                  <span className="block text-[10px] text-sky-400" title="Adjusted for a stock split after the search date">
                    split-adjusted: ${p.startPrice.toFixed(2)}
                  </span>
                )}
                {p.status === 'included' && p.splitFactor === null && (
                  <span className="block text-[10px] text-amber-500" title="Yahoo split data unavailable; price not adjusted">
                    split check unavailable
                  </span>
                )}
              </td>
              <td className="px-3 py-2 font-mono text-zinc-200">
                {p.currentPrice !== null ? `$${p.currentPrice.toFixed(2)}` : <span className="text-zinc-600 italic">N/A</span>}
              </td>
              {p.status === 'included' ? (
                <>
                  <td className="px-3 py-2"><ReturnBadge value={p.pickReturn} /></td>
                  <td className="px-3 py-2"><ReturnBadge value={p.excessReturn} unit="pts" /></td>
                </>
              ) : (
                <td colSpan={2} className="px-3 py-2 text-[11px] text-zinc-500 italic">{exclusionText(p)}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const SearchCard: React.FC<{ card: SearchScorecard; minDays: number }> = ({ card, minDays }) => {
  const [open, setOpen] = useState(false);
  const { benchmark, figure } = card;
  const excludedTotal = card.excluded.noStoredPrice + card.excluded.noCurrentPrice;

  return (
    <div className="border border-zinc-900 bg-zinc-950/40 rounded-lg p-4 space-y-3">
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-2">
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-mono text-zinc-500 bg-zinc-950 px-1.5 py-0.5 border border-zinc-900 rounded">
              {fmtDate(card.createdAt)}
            </span>
            <span className="text-[10px] font-mono text-zinc-400">{plural(card.daysElapsed, 'day')} ago</span>
            <TooEarly figure={figure} />
            {!card.countsInOverall && (
              <span className="text-[9px] font-mono text-zinc-500 border border-zinc-800 px-1.5 py-0.5 rounded">
                Not in overall (under {minDays} days)
              </span>
            )}
          </div>
          {card.trends.map((t, i) => (
            <div key={i} className="text-sm font-mono text-zinc-200 break-words">{t}</div>
          ))}
        </div>
        <button
          onClick={() => setOpen((o) => !o)}
          className="text-[11px] font-mono text-zinc-500 hover:text-brand-green shrink-0 cursor-pointer self-start"
        >
          [{open ? 'HIDE PICKS' : 'SHOW PICKS'}]
        </button>
      </div>

      <FigureStats figure={figure} benchmark={benchmark.ticker} />

      <div className="text-[11px] font-mono text-zinc-500 leading-relaxed space-y-0.5">
        <div>
          {plural(figure.picks, 'pick')} of {card.picksTotal} counted
          {excludedTotal > 0 && (
            <>
              {' '}· <span className="text-amber-500/90">{excludedTotal} excluded</span> ({exclusionSummary(card.excluded)})
            </>
          )}
          {card.splitAdjusted > 0 && ` · ${card.splitAdjusted} split-adjusted`}
          {card.splitCheckUnavailable > 0 && ` · split check unavailable for ${card.splitCheckUnavailable}`}
        </div>
        <div>
          {benchmark.startDate && benchmark.startClose !== null ? (
            <>
              {benchmark.ticker} from the {fmtTradingDate(benchmark.startDate)} close (${benchmark.startClose.toFixed(2)})
              {benchmark.usedPriorClose && ' — the search ran on a weekend, holiday or before the open, so the prior trading close is used'}
              {benchmark.currentPrice !== null && ` to $${benchmark.currentPrice.toFixed(2)} now`}
            </>
          ) : (
            <>{benchmark.ticker} close for this date unavailable, so the comparison is N/A</>
          )}
        </div>
      </div>

      {open && (
        <>
          <HalvesStats top={card.topHalf} bottom={card.bottomHalf} benchmark={benchmark.ticker} />
          {(card.leftOutAtBoundary > 0 || card.unscored > 0) && (
            <p className="text-[10px] font-mono text-zinc-600">
              {card.leftOutAtBoundary > 0 &&
                `${plural(card.leftOutAtBoundary, 'pick')} at the middle score (the odd middle pick, or picks tied across the dividing line) ${card.leftOutAtBoundary === 1 ? 'is' : 'are'} left out of both halves. `}
              {card.unscored > 0 && `${plural(card.unscored, 'pick')} had no saved score and ${card.unscored === 1 ? 'is' : 'are'} left out of the halves.`}
            </p>
          )}
          <PicksTable card={card} />
        </>
      )}
    </div>
  );
};

export const ScorecardView: React.FC<ScorecardViewProps> = ({ isActive }) => {
  const [data, setData] = useState<ScorecardResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchScorecard = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/scorecard');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load the scorecard');
      setData(json as ScorecardResponse);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load the scorecard');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isActive) fetchScorecard();
  }, [isActive]);

  if (!isActive) return null;
  const bench = data?.benchmarkTicker ?? 'SPY';
  const overall = data?.overall;

  return (
    <div className="bg-brand-secondary/80 backdrop-blur-md border border-brand-border/60 p-6 rounded-xl shadow-2xl space-y-6">
      <div className="border-b border-zinc-900 pb-3 flex justify-between items-center gap-4">
        <div>
          <h2 className="text-lg font-bold tracking-wide uppercase text-brand-text flex items-center gap-2">
            <span className="w-1.5 h-4 bg-brand-green rounded-full inline-block animate-pulse" />
            Track Record Scorecard
          </h2>
          <p className="text-xs text-brand-light mt-1">
            How each saved search&apos;s picks have done since the search date, compared with {bench} (the S&amp;P 500 ETF) over the same window.
          </p>
        </div>
        <button
          onClick={fetchScorecard}
          className="px-3 py-1 bg-zinc-900 border border-zinc-800 text-[11px] font-mono text-zinc-400 hover:text-brand-green hover:border-brand-green transition-colors cursor-pointer shrink-0"
        >
          [REFRESH]
        </button>
      </div>

      {/* Always-visible caveats */}
      <div className="bg-zinc-950/60 border border-zinc-900 rounded-lg p-4 text-[11px] text-zinc-400 leading-relaxed space-y-1">
        <p>
          <strong className="text-zinc-200">Price return only.</strong> Dividends are not included, for the picks or for {bench}.
          Each pick counts equally. Stock splits after the search are adjusted for.
        </p>
        <p>
          <strong className="text-zinc-200">Excluded picks are counted, not guessed.</strong> A pick with no price saved at search time, or no
          price today (often a delisting), is left out. A delisted stock may have gone to zero, so these figures can look better than reality.
        </p>
        <p>
          <strong className="text-zinc-200">Too early to read</strong> = under {data?.rules.minDays ?? 30} days or under{' '}
          {data?.rules.minPicks ?? 10} picks: noise, not a verdict. Scores rank picks <em>within</em> one search, so the top vs bottom half
          split is made inside each search, never across searches. &quot;pts&quot; = percentage points (pick return minus {bench}&apos;s).
        </p>
        <p className="text-amber-500/90">This is a record of past prices, not investment advice.</p>
      </div>

      {loading && (
        <div className="py-12 text-center text-xs font-mono text-zinc-500">
          <span className="inline-block animate-spin mr-2">⚙</span> Pricing every saved pick against {bench}...
        </div>
      )}

      {error && (
        <div className="bg-rose-950/20 border border-rose-900/40 p-4 rounded-lg text-rose-400 text-xs font-mono">Error: {error}</div>
      )}

      {!loading && data && !data.finnhubConfigured && (
        <div className="bg-amber-950/20 border border-amber-900/40 p-4 rounded-lg text-amber-400 text-xs font-mono">
          FINNHUB_API_KEY is not set, so there are no current prices: every pick shows as excluded.
        </div>
      )}

      {!loading && !error && data && data.searches.length === 0 && (
        <div className="py-16 text-center border border-zinc-900/60 border-dashed rounded-lg">
          <p className="text-sm font-semibold text-zinc-400">No saved searches yet</p>
          <p className="text-xs text-zinc-600 mt-2 max-w-sm mx-auto leading-relaxed">
            Every Discovery run is saved automatically. Come back after a search is at least {data.rules.minDays} days old.
          </p>
        </div>
      )}

      {!loading && data && overall && data.searches.length > 0 && (
        <>
          <section className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-bold font-mono uppercase tracking-widest text-zinc-300">Overall</h3>
              <TooEarly figure={overall.figure} />
            </div>
            <p className="text-[11px] font-mono text-zinc-500">
              {overall.searchesCounted} of {plural(overall.searchesTotal, 'search')} counted
              {overall.searchesTooYoung > 0 &&
                ` · ${overall.searchesTooYoung} under ${data.rules.minDays} days old ${overall.searchesTooYoung === 1 ? 'is' : 'are'} shown below but left out (a few days of price moves is noise)`}
              {overall.excluded.noStoredPrice + overall.excluded.noCurrentPrice > 0 &&
                ` · ${overall.excluded.noStoredPrice + overall.excluded.noCurrentPrice} picks excluded (no saved price or no price today)`}
              {overall.excluded.noBenchmark > 0 && ` · ${overall.excluded.noBenchmark} picks left out: no ${bench} close for their window`}
            </p>
            {overall.searchesCounted === 0 ? (
              <p className="text-xs font-mono text-zinc-500 italic">
                No search is {data.rules.minDays} days old yet, so there is no overall figure.
              </p>
            ) : (
              <>
                <FigureStats figure={overall.figure} benchmark={bench} />
                <div>
                  <h4 className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 mb-2">
                    Does the score predict anything? Top-scored half vs bottom-scored half (split within each search)
                  </h4>
                  <HalvesStats top={overall.topHalf} bottom={overall.bottomHalf} benchmark={bench} />
                  {overall.leftOutAtBoundary > 0 && (
                    <p className="text-[10px] font-mono text-zinc-600 mt-2">
                      {plural(overall.leftOutAtBoundary, 'pick')} at a search&apos;s middle score (odd middle pick or tied across the
                      dividing line) {overall.leftOutAtBoundary === 1 ? 'is' : 'are'} left out of both halves.
                    </p>
                  )}
                </div>
              </>
            )}
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-bold font-mono uppercase tracking-widest text-zinc-300">By search</h3>
            {data.searches.map((card) => (
              <SearchCard key={card.searchId} card={card} minDays={data.rules.minDays} />
            ))}
          </section>

          <p className="text-[10px] font-mono text-zinc-600">
            Prices as of {new Date(data.generatedAt).toLocaleString('en-US')} (quotes cached up to 5 minutes).
          </p>
        </>
      )}
    </div>
  );
};
