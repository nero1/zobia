export const dynamic = 'force-dynamic';

/**
 * app/api/market/section/route.ts
 *
 * GET /api/market/section?section=sponsored|featured|trending|platform
 *       &category=digital|physical|cosmetics_themes|boosts_passes|credits
 *       &sort=price|popularity|rating&limit=&offset=
 *
 * "View more" / paginated single-section listing for the Market page, with
 * list/grid-agnostic data (the view mode is a client-side rendering choice)
 * and the category/sort facets. Sort is only meaningful for creator items
 * (digital/physical) — see lib/market/query.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { getMarketSection } from "@/lib/market/query";
import type { MarketCategory, MarketSection, MarketSort } from "@/lib/market/types";

const querySchema = z.object({
  section: z.enum(["sponsored", "featured", "trending", "platform"]),
  category: z.enum(["digital", "physical", "cosmetics_themes", "boosts_passes", "credits"]).optional(),
  sort: z.enum(["price", "popularity", "rating"]).optional(),
  limit: z.coerce.number().int().min(1).max(60).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
    if (!parsed.success) {
      throw badRequest("Invalid query parameters", { issues: parsed.error.issues });
    }
    const { section, category, sort, limit, offset } = parsed.data;

    const items = await getMarketSection(section as MarketSection, {
      category: category as MarketCategory | undefined,
      sort: sort as MarketSort | undefined,
      limit,
      offset,
    });

    return NextResponse.json({ success: true, data: { items }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
}
