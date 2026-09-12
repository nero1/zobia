export const dynamic = 'force-dynamic';

/**
 * app/api/market/route.ts
 *
 * GET /api/market
 *   Home view: sponsored, admin-featured, trending, and platform sections,
 *   each capped for a grid preview (see lib/market/query.ts). "View more" on
 *   any section calls GET /api/market/section instead.
 *
 * No auth required — Market browsing is public; buying still requires login
 * (existing purchase endpoints already enforce this).
 */

import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api/errors";
import { getMarketHome } from "@/lib/market/query";

export async function GET() {
  try {
    const home = await getMarketHome();
    return NextResponse.json({ success: true, data: home, error: null });
  } catch (err) {
    return handleApiError(err);
  }
}
