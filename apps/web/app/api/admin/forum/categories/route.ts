export const dynamic = "force-dynamic";

/**
 * app/api/admin/forum/categories/route.ts
 *
 * GET  — list all Answers categories with their question counts.
 * POST — create a new category.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { getDb, schema } from "@/lib/db/drizzle";
import { slugify } from "@zobia/shared/utils";

const createSchema = z.object({
  name: z.string().min(2).max(60),
  description: z.string().max(300).optional(),
  iconEmoji: z.string().min(1).max(8).default("💬"),
  sortOrder: z.number().int().default(0),
});

export const GET = withAdminAuth(async () => {
  try {
    const orm = await getDb();
    const { rows } = await orm.execute(sql`
      SELECT c.id, c.slug, c.name, c.description, c.icon_emoji, c.sort_order,
             COUNT(q.id) FILTER (WHERE q.status = 'visible' AND q.deleted_at IS NULL) AS question_count
      FROM forum_categories c
      LEFT JOIN forum_questions q ON q.category_id = c.id
      GROUP BY c.id
      ORDER BY c.sort_order ASC, c.name ASC
    `);
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

    const orm = await getDb();

    const baseSlug = slugify(parsed.data.name) || `category-${Date.now()}`;
    let slug = baseSlug;
    for (let i = 2; i <= 100; i++) {
      const existing = await orm
        .select({ id: schema.forumCategories.id })
        .from(schema.forumCategories)
        .where(eq(schema.forumCategories.slug, slug))
        .limit(1);
      if (existing.length === 0) break;
      slug = `${baseSlug}${i}`;
    }

    const [row] = await orm
      .insert(schema.forumCategories)
      .values({
        slug,
        name: parsed.data.name.trim(),
        description: parsed.data.description?.trim() ?? null,
        iconEmoji: parsed.data.iconEmoji,
        sortOrder: parsed.data.sortOrder,
      })
      .returning();
    return NextResponse.json({ success: true, data: { category: row }, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
