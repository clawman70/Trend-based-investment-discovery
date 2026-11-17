/**
 * GET /api/status — what the header status bar shows (Phase E).
 *
 * Every field is checked for real on each call; nothing is assumed:
 * - storage: "postgres" when the database answers right now, otherwise "memory"
 *   (saved items then live only until the server restarts). Checked fresh, not from
 *   the 30-second memo, so an outage shows on the next poll.
 * - keys: whether each API key is set in .env.local (never the key itself).
 * - tickerDirectory: whether the US listing directory used by the hallucination gate is
 *   already cached, and how many symbols it holds. It loads on the first discovery or
 *   research run, so "not loaded" on a fresh server is normal.
 * - spend: today's estimated AI spend (same figure as the spend-cap banner).
 */
import { NextResponse } from 'next/server';
import { getStorageStatus } from '@/lib/dbHelper';
import { isClaudeConfigured } from '@/lib/claudeService';
import { isGeminiConfigured } from '@/lib/geminiService';
import { isFinnhubConfigured } from '@/lib/finnhubService';
import { peekListingDirectorySize } from '@/lib/tickerValidator';
import { getDailySpendCapUsd, getTodaysSpend } from '@/lib/usageTracker';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const storage = await getStorageStatus();
    const [symbolCount, spentUsd] = await Promise.all([
      peekListingDirectorySize().catch(() => null),
      getTodaysSpend().catch(() => null),
    ]);

    return NextResponse.json({
      storage,
      keys: {
        anthropic: isClaudeConfigured(),
        gemini: isGeminiConfigured(),
        finnhub: isFinnhubConfigured(),
      },
      tickerDirectory: { loaded: symbolCount !== null, symbolCount },
      spend: { spentUsd, capUsd: getDailySpendCapUsd() },
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error in /api/status:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Status check failed' }, { status: 500 });
  }
}
