export const dynamic = "force-dynamic";

/**
 * app/api/admin/forum/categories/route.ts
 *
 * GET  — list all Answers categories with their question counts.
 * POST — create a new category.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { slugify } from "@zobia/shared/utils";

const createSchema = z.object({
  name: z.string().min(2).max(60),
  description: z.string().max(300).optional(),
  iconEmoji: z.string().min(1).max(8).default("💬"),
  sortOrder: z.number().int().default(0),
});

export const GET = withAdminAuth(async () => {
  try {
    const { rows } = await db.query(
      `SELECT c.id, c.slug, c.name, c.description, c.icon_emoji, c.sort_order,
              COUNT(q.id) FILTER (WHERE q.status = 'visible' AND q.deleted_at IS NULL) AS question_count
       FROM forum_categories c
       LEFT JOIN forum_questions q ON q.category_id = c.id
       GROUP BY c.id
       ORDER BY c.sort_order ASC, c.name ASC`
    );
    return NextResponse.json({ success: true, data: { categories: rows }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAdminAuth(async (req: NextRequest) => {
  try {
    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) throw badRequest("Invalid request body", parsed.error.flatten());

    const baseSlug = slugify(parsed.data.name) || `category-${Date.now()}`;
    let slug = baseSlug;
    for (let i = 2; i <= 100; i++) {
      const { rows } = await db.query(`SELECT id FROM forum_categories WHERE slug = $1 LIMIT 1`, [slug]);
      if (rows.length === 0) break;
      slug = `${baseSlug}${i}`;
    }

    const { rows } = await db.query(
      `INSERT INTO forum_categories (slug, name, description, icon_emoji, sort_order)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [slug, parsed.data.name.trim(), parsed.data.description?.trim() ?? null, parsed.data.iconEmoji, parsed.data.sortOrder]
    );
    return NextResponse.json({ success: true, data: { category: rows[0] }, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
