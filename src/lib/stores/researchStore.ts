/**
 * Research scans ("Research" tab) and the audit log of theses loaded into Discovery.
 * Postgres-backed with an in-memory fallback — see src/lib/dbHelper.ts.
 *
 * scanId on a loaded thesis is intentionally not a hard foreign key (mirrors the
 * in-memory model) — logging a load should never fail just because the source scan
 * has since expired or the id doesn't resolve.
 */
import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { isDbAvailable } from '../dbHelper';
import { prisma } from '../prisma';
import { memoryResearchLoadedTheses, memoryResearchScans, MemoryResearchScan } from '../memoryStore';
import { TrendResearchReport } from '../types';

export interface StoredResearchScan {
  id: string;
  createdAt: Date;
  domains: string[];
  customPrompt: string | null;
  report: TrendResearchReport;
  cachedUntil: Date;
}

export async function findCachedScan(params: {
  mode: 'guided' | 'open';
  sortedDomains: string[];
  customPrompt: string | null;
}): Promise<StoredResearchScan | null> {
  const now = new Date();

  if (await isDbAvailable()) {
    if (params.mode === 'open') {
      const row = await prisma.researchScan.findFirst({
        where: { customPrompt: params.customPrompt, cachedUntil: { gt: now } },
        orderBy: { createdAt: 'desc' },
      });
      return row ? { ...row, report: row.report as unknown as TrendResearchReport } : null;
    }

    // Guided mode: Postgres array equality doesn't cleanly express "same set regardless
    // of order," so fetch recent non-expired guided scans and match the set in JS.
    const candidates = await prisma.researchScan.findMany({
      where: { customPrompt: null, cachedUntil: { gt: now } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const match = candidates.find(
      (c) => c.domains.length === params.sortedDomains.length && params.sortedDomains.every((d) => c.domains.includes(d))
    );
    return match ? { ...match, report: match.report as unknown as TrendResearchReport } : null;
  }

  const match = memoryResearchScans.find((scan) => {
    if (scan.cachedUntil <= now) return false;
    if (params.mode === 'open') return scan.customPrompt === params.customPrompt;
    if (scan.domains.length !== params.sortedDomains.length) return false;
    return params.sortedDomains.every((d) => scan.domains.includes(d));
  });
  return match ?? null;
}

export async function createScan(input: {
  domains: string[];
  customPrompt: string | null;
  report: TrendResearchReport;
  ttlMs: number;
}): Promise<StoredResearchScan> {
  const cachedUntil = new Date(Date.now() + input.ttlMs);

  if (await isDbAvailable()) {
    const created = await prisma.researchScan.create({
      data: {
        domains: input.domains,
        customPrompt: input.customPrompt,
        report: input.report as unknown as Prisma.InputJsonValue,
        cachedUntil,
      },
    });
    return { ...created, report: created.report as unknown as TrendResearchReport };
  }

  const scan: MemoryResearchScan = {
    id: crypto.randomUUID(),
    createdAt: new Date(),
    domains: input.domains,
    customPrompt: input.customPrompt,
    report: input.report,
    cachedUntil,
  };
  memoryResearchScans.push(scan);
  return scan;
}

export async function logLoadedThesis(input: { scanId: string; thesis: string; searchId?: string | null }): Promise<{ id: string }> {
  if (await isDbAvailable()) {
    const created = await prisma.researchLoadedThesis.create({
      data: { scanId: input.scanId, thesis: input.thesis, searchId: input.searchId ?? null },
    });
    return { id: created.id };
  }

  const id = crypto.randomUUID();
  memoryResearchLoadedTheses.push({ id, scanId: input.scanId, thesis: input.thesis, loadedAt: new Date(), searchId: input.searchId ?? null });
  return { id };
}
