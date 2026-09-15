import { NextRequest, NextResponse } from 'next/server';
import { logLoadedThesis } from '@/lib/stores/researchStore';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { scanId, thesis } = body as { scanId?: string; thesis?: string };

    if (!scanId || !thesis) {
      return NextResponse.json({ error: 'scanId and thesis are required' }, { status: 400 });
    }

    const { id } = await logLoadedThesis({ scanId, thesis });
    return NextResponse.json({ success: true, id });
  } catch (error: unknown) {
    console.error('Error in /api/research/load POST handler:', error);
    const errorMsg = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
