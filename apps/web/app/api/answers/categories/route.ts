export const dynamic = "force-dynamic";

/**
 * app/api/answers/categories/route.ts
 *
 * GET /api/answers/categories — list Zobia Answers categories, ordered for
 * display. Read-only reference data (no per-user state), used by the
 * "Ask a Question" category picker.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { db } from "@/lib/db";

export interface ForumCategoryOption {
  id: string;
  slug: string;
  name: string;
  iconEmoji: string;
}

export const GET = withAuth(async (_req: NextRequest) => {
  try {
    const { rows } = await db.query<{ id: string; slug: string; name: string; icon_emoji: string }>(
      `SELECT id, slug, name, icon_emoji FROM forum_categories ORDER BY sort_order ASC, name ASC`
    );
    const categories: ForumCategoryOption[] = rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      iconEmoji: r.icon_emoji,
    }));
    return NextResponse.json({ success: true, data: categories, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
