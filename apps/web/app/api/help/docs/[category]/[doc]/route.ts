export const dynamic = "force-dynamic";

/**
 * app/api/help/docs/[category]/[doc]/route.ts
 *
 * GET — a single Help Center doc at its SEO-friendly URL
 * (/help/<category-slug>/<doc-slug>). No auth wall.
 */

import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api/errors";
import { getDoc, resolveDocRedirect } from "@/lib/help/service";

export async function GET(_req: Request, { params }: { params: Promise<{ category: string; doc: string }> }) {
  try {
    const { category, doc } = await params;
    try {
      const result = await getDoc(category, doc);
      return NextResponse.json({ success: true, data: result, error: null });
    } catch (err) {
      const redirect = await resolveDocRedirect(category, doc);
      if (redirect) {
        return NextResponse.json(
          { success: false, redirect: `/help/${redirect.categorySlug}/${redirect.docSlug}`, error: null },
          { status: 301 }
        );
      }
      throw err;
    }
  } catch (err) {
    return handleApiError(err);
  }
}
