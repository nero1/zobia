export const dynamic = "force-dynamic";

/**
 * app/api/help/categories/[slug]/route.ts
 *
 * GET — a category + its published docs, keyed by SEO-friendly slug (not id).
 */

import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api/errors";
import { listDocsByCategory, resolveCategorySlug } from "@/lib/help/service";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    try {
      const result = await listDocsByCategory(slug);
      return NextResponse.json({ success: true, data: result, error: null });
    } catch (err) {
      const redirect = await resolveCategorySlug(slug);
      if (redirect) {
        return NextResponse.json({ success: false, redirect: `/help/${redirect}`, error: null }, { status: 301 });
      }
      throw err;
    }
  } catch (err) {
    return handleApiError(err);
  }
}
