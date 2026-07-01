import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isDbAvailable } from '@/lib/dbHelper';
import { memoryResearchScans } from '@/lib/memoryStore';
import { generateTrendResearchReport } from '@/lib/geminiService';
import { TrendResearchReport } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { domains = [], mode = 'guided', customPrompt = null, forceRefresh = false } = body;

    const formattedDomains = (domains as string[]).map(d => d.trim()).filter(Boolean);
    const sortedDomains = [...formattedDomains].sort();

    // Cache lookup key
    const cleanPrompt = customPrompt ? (customPrompt as string).trim() : null;
    const now = new Date();

    // Skip cache if forceRefresh is true
    if (!forceRefresh) {
      // 1. Database cache lookup
      if (await isDbAvailable()) {
        try {
          const cachedScan = await prisma.researchScan.findFirst({
            where: {
              customPrompt: mode === 'open' ? cleanPrompt : null,
              domains: mode === 'guided' ? { hasEvery: sortedDomains } : undefined,
              cachedUntil: { gt: now },
            },
            orderBy: { createdAt: 'desc' },
          });

          if (cachedScan) {
            // Confirm length parity for guided mode
            if (mode === 'open' || cachedScan.domains.length === sortedDomains.length) {
              const reportData = cachedScan.report as unknown as TrendResearchReport;
              return NextResponse.json({
                scanId: cachedScan.id,
                ...reportData,
              });
            }
          }
        } catch (dbErr) {
          console.warn('Failed to query research_scans from database, falling back to memory:', dbErr);
        }
      }

      // 2. Memory cache fallback
      const cachedScanMem = memoryResearchScans.find(scan => {
        if (scan.cachedUntil <= now) return false;
        if (mode === 'open') {
          return scan.customPrompt === cleanPrompt;
        } else {
          if (scan.domains.length !== sortedDomains.length) return false;
          return sortedDomains.every(d => scan.domains.includes(d));
        }
      });

      if (cachedScanMem) {
        return NextResponse.json({
          scanId: cachedScanMem.id,
          ...cachedScanMem.report,
        });
      }
    }

    // 3. Call AI service to generate report
    const report = await generateTrendResearchReport(sortedDomains, mode, cleanPrompt);

    // 4. Save to cache
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7-day TTL
    let scanId = crypto.randomUUID();

    if (await isDbAvailable()) {
      try {
        const savedScan = await prisma.researchScan.create({
          data: {
            domains: sortedDomains,
            customPrompt: mode === 'open' ? cleanPrompt : null,
            report: report as unknown as import('@prisma/client').Prisma.InputJsonValue,
            cachedUntil: expiresAt,
          },
        });
        scanId = savedScan.id;
      } catch (dbErr) {
        console.warn('Failed to save research scan to database:', dbErr);
      }
    } else {
      memoryResearchScans.push({
        id: scanId,
        createdAt: new Date(),
        domains: sortedDomains,
        customPrompt: mode === 'open' ? cleanPrompt : null,
        report,
        cachedUntil: expiresAt,
      });
    }

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
