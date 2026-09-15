import { NextRequest, NextResponse } from 'next/server';
import { createScan, findCachedScan } from '@/lib/stores/researchStore';
import { generateTrendResearchReport } from '@/lib/geminiService';
import { getDemoResearchReport, isDemoMode } from '@/lib/demoData';

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { domains = [], mode = 'guided', customPrompt = null, forceRefresh = false } = body;

    const formattedDomains = (domains as string[]).map((d) => d.trim()).filter(Boolean);
    const sortedDomains = [...formattedDomains].sort();
    const cleanPrompt = customPrompt ? (customPrompt as string).trim() : null;

    if (!forceRefresh) {
      const cachedScan = await findCachedScan({ mode, sortedDomains, customPrompt: cleanPrompt });
      if (cachedScan) {
        return NextResponse.json({ scanId: cachedScan.id, ...cachedScan.report });
      }
    }

    // Generate report (placeholder content only when DEMO_MODE=true)
    const report = isDemoMode()
      ? getDemoResearchReport(sortedDomains, mode, cleanPrompt)
      : await generateTrendResearchReport(sortedDomains, mode, cleanPrompt);

    const scan = await createScan({
      domains: sortedDomains,
      customPrompt: mode === 'open' ? cleanPrompt : null,
      report,
      ttlMs: CACHE_TTL_MS,
    });

    return NextResponse.json({ scanId: scan.id, ...report });
  } catch (error: unknown) {
    console.error('Error in /api/research POST handler:', error);
    const errorMsg = error instanceof Error ? error.message : 'Internal Server Error';
    // 503 = missing configuration, 502 = upstream AI failure
    const status = errorMsg.includes('not configured') ? 503 : 502;
    return NextResponse.json({ error: errorMsg }, { status });
  }
}
