import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { memoryResearchLoadedTheses } from '@/lib/memoryStore';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { scanId, thesis } = body;

    if (!scanId || !thesis) {
      return NextResponse.json({ error: 'scanId and thesis are required' }, { status: 400 });
    }

    const loadedId = crypto.randomUUID();

    memoryResearchLoadedTheses.push({
      id: loadedId,
      scanId,
      thesis,
      loadedAt: new Date(),
      searchId: null,
    });

    return NextResponse.json({ success: true, id: loadedId });
  } catch (error: unknown) {
    console.error('Error in /api/research/load POST handler:', error);
    const errorMsg = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
