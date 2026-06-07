/**
 * GET /api/messages/gif — GIF search proxy.
 *
 * Proxies to Giphy or Tenor based on the x_manifest gif_provider config.
 * Keeps API keys off the client.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/middleware';
import { badRequest } from '@/lib/api/errors';
import { db, SqlParam } from '@/lib/db';

const GIPHY_BASE = 'https://api.giphy.com/v1/gifs';
const TENOR_BASE = 'https://tenor.googleapis.com/v2';

export const GET = withAuth(async (req: NextRequest) => {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q')?.trim();
  const limit = Math.min(Number(searchParams.get('limit') ?? 20), 50);
  const offset = Number(searchParams.get('offset') ?? 0);

  if (!q) throw badRequest('q (search query) is required');

  // Read gif provider from manifest
  const { rows: [row] } = await db.query<{ value: string }>(
    "SELECT value FROM x_manifest WHERE key = 'gif_provider'",
    [],
  );
  const provider: string = row?.value ?? 'giphy';

  try {
    if (provider === 'tenor') {
      const key = process.env.TENOR_API_KEY ?? '';
      const url = `${TENOR_BASE}/search?q=${encodeURIComponent(q)}&key=${key}&limit=${limit}&pos=${offset}&media_filter=gif`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Tenor error');
      const data = (await res.json()) as { results: unknown[] };
      return NextResponse.json({ data: data.results, provider: 'tenor' });
    }

    // Default: Giphy
    const key = process.env.GIPHY_API_KEY ?? '';
    const url = `${GIPHY_BASE}/search?q=${encodeURIComponent(q)}&api_key=${key}&limit=${limit}&offset=${offset}&rating=g`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Giphy error');
    const data = (await res.json()) as { data: unknown[] };
    return NextResponse.json({ data: data.data, provider: 'giphy' });
  } catch {
    return NextResponse.json({ data: [], provider }, { status: 502 });
  }
});
