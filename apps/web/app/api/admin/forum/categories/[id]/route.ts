export const dynamic = "force-dynamic";

/**
 * app/api/admin/forum/categories/[id]/route.ts
 *
 * PATCH  — edit a category's name/description/icon/sort order.
 * DELETE — remove a category. Blocked while it still has questions
 *          (reassign or delete those first) rather than silently
 *          orphaning them or cascading a bulk delete.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest, notFound } from "@/lib/api/errors";
import { db } from "@/lib/db";

interface Ctx {
  params: Promise<{ id: string }>;
}

const patchSchema = z.object({
  name: z.string().min(2).max(60).optional(),
  description: z.string().max(300).nullable().optional(),
  iconEmoji: z.string().min(1).max(8).optional(),
  sortOrder: z.number().int().optional(),
});

export const PATCH = withAdminAuth(async (req: NextRequest, { params }: Ctx) => {
  try {
    const { id } = await params;
    const body = await req.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) throw badRequest("Invalid request body", parsed.error.flatten());
    if (Object.keys(parsed.data).length === 0) throw badRequest("No fields to update");

    const { rows } = await db.query(
      `UPDATE forum_categories
       SET name = COALESCE($2, name),
           description = CASE WHEN $3::text IS NOT NULL THEN NULLIF($3, '') ELSE description END,
           icon_emoji = COALESCE($4, icon_emoji),
           sort_order = COALESCE($5, sort_order),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, parsed.data.name ?? null, parsed.data.description ?? null, parsed.data.iconEmoji ?? null, parsed.data.sortOrder ?? null]
    );
    if (!rows[0]) throw notFound("Category not found");
    return NextResponse.json({ success: true, data: { category: rows[0] }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const DELETE = withAdminAuth(async (_req: NextRequest, { params }: Ctx) => {
  try {
    const { id } = await params;
    const { rows: countRows } = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM forum_questions WHERE category_id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (Number(countRows[0]?.count ?? 0) > 0) {
      throw badRequest("Move or delete this category's questions before deleting it.", "CATEGORY_HAS_QUESTIONS");
    }

    const { rowCount } = await db.query(`DELETE FROM forum_categories WHERE id = $1`, [id]);
    if (!rowCount) throw notFound("Category not found");
    return NextResponse.json({ success: true, data: { id }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
