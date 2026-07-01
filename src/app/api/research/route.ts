import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { memoryResearchScans } from '@/lib/memoryStore';
import { generateTrendResearchReport } from '@/lib/geminiService';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { domains = [], mode = 'guided', customPrompt = null, forceRefresh = false } = body;

    const formattedDomains = (domains as string[]).map(d => d.trim()).filter(Boolean);
    const sortedDomains = [...formattedDomains].sort();
    const cleanPrompt = customPrompt ? (customPrompt as string).trim() : null;
    const now = new Date();

    // Skip cache if forceRefresh is true
    if (!forceRefresh) {
      // Check memory cache
      const cachedScan = memoryResearchScans.find(scan => {
        if (scan.cachedUntil <= now) return false;
        if (mode === 'open') {
          return scan.customPrompt === cleanPrompt;
        } else {
          if (scan.domains.length !== sortedDomains.length) return false;
          return sortedDomains.every(d => scan.domains.includes(d));
        }
      });

      if (cachedScan) {
        return NextResponse.json({
          scanId: cachedScan.id,
          ...cachedScan.report,
        });
      }
    }

    // Generate report
    const report = await generateTrendResearchReport(sortedDomains, mode, cleanPrompt);

    // Save to memory cache
    const scanId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7-day TTL

    memoryResearchScans.push({
      id: scanId,
      createdAt: new Date(),
      domains: sortedDomains,
      customPrompt: mode === 'open' ? cleanPrompt : null,
      report,
      cachedUntil: expiresAt,
    });

    return NextResponse.json({
      scanId,
      ...report,
    });
  } catch (error: unknown) {
    console.error('Error in /api/research POST handler:', error);
    const errorMsg = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
