import { NextResponse } from 'next/server';
import { getDailySpendCapUsd, getTodaysSpend } from '@/lib/usageTracker';

export async function GET() {
  const spentUsd = await getTodaysSpend();
  const capUsd = getDailySpendCapUsd();

  return NextResponse.json({
    spentUsd,
    capUsd,
    exceeded: spentUsd >= capUsd,
  });
}
