import { NextRequest, NextResponse } from 'next/server';
import { linkLoadedThesisToSearch, logLoadedThesis } from '@/lib/stores/researchStore';

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

/**
 * PATCH { id, searchId }: called by the page once a loaded thesis has actually been run
 * through Discovery and the search saved, so the audit record points at the search it
 * led to (bug B9).
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, searchId } = body as { id?: unknown; searchId?: unknown };

    if (typeof id !== 'string' || !id || typeof searchId !== 'string' || !searchId) {
      return NextResponse.json({ error: 'id and searchId are required' }, { status: 400 });
    }

    const linked = await linkLoadedThesisToSearch(id, searchId);
    if (!linked) {
      return NextResponse.json({ error: 'Loaded thesis record not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Error in /api/research/load PATCH handler:', error);
    const errorMsg = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
