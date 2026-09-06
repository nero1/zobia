export const dynamic = "force-dynamic";

/**
 * app/api/help/search/route.ts
 *
 * GET /api/help/search?q=... — Postgres full-text search over doc title/body.
 * Public (no auth wall). Backs /help/search?q=... (SEO-friendly search page).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateSearchParams } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { searchDocs } from "@/lib/help/service";

const querySchema = z.object({
  q: z.string().trim().min(1).max(200),
});

export async function GET(req: NextRequest) {
  try {
    const query = validateSearchParams(req.nextUrl.searchParams, querySchema);
    const results = await searchDocs(query.q);
    return NextResponse.json({ success: true, data: results, error: null });
  } catch (err) {
    return handleApiError(err);
  }
}
