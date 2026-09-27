import { NextRequest, NextResponse } from 'next/server';
import { ingestSafes } from '../../../services/safeIngestion';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
let active = 0;
export async function POST(request: NextRequest) {
  const host = request.headers.get('host') ?? '';
  const hostname = host.replace(/^\[/, '').split(/\]:|:/)[0];
  const origin = request.headers.get('origin');
  if (!['localhost', '127.0.0.1', '::1'].includes(hostname) || (origin && origin !== `http://${host}`))
    return NextResponse.json({ error: 'Only same-origin local requests are accepted.' }, { status: 403 });
  if (active >= 2) return NextResponse.json({ error: 'An import is already running. Please wait and retry.' }, { status: 429 });
  active++;
  try {
    const raw = await request.text();
    if (raw.length > 4096) throw new Error('Import request is too large.');
    const { network, addresses } = JSON.parse(raw);
    return NextResponse.json(await ingestSafes(network, addresses), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to import Safes.' }, { status: 400 });
  } finally { active--; }
}
