export const dynamic = "force-dynamic";
export const revalidate = 300;

/**
 * app/api/help/categories/route.ts
 *
 * GET — public Help Center category list. No auth wall (Feature 2 §1).
 */

import { NextResponse } from "next/server";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { listCategories } from "@/lib/help/service";
import { loadManifest } from "@/lib/manifest";

export async function GET() {
  try {
    const manifest = await loadManifest();
    if (!manifest.features.helpCenter) {
      throw badRequest("Help Center is currently unavailable", "FEATURE_DISABLED");
    }
    const categories = await listCategories();
    return NextResponse.json({ success: true, data: categories, error: null });
  } catch (err) {
    return handleApiError(err);
  }
}
