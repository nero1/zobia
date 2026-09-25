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
import { and, eq, isNull, count } from "drizzle-orm";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest, notFound } from "@/lib/api/errors";
import { getDb, schema } from "@/lib/db/drizzle";

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

    // Preserves the original SQL's CASE semantics: description is only
    // touched when a non-null string (including "") was actually sent —
    // an explicit `null` (like an omitted field) leaves the column as-is.
    const updates: Partial<typeof schema.forumCategories.$inferInsert> = { updatedAt: new Date() };
    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (parsed.data.description !== undefined && parsed.data.description !== null) {
      updates.description = parsed.data.description === "" ? null : parsed.data.description;
    }
    if (parsed.data.iconEmoji !== undefined) updates.iconEmoji = parsed.data.iconEmoji;
    if (parsed.data.sortOrder !== undefined) updates.sortOrder = parsed.data.sortOrder;

    const orm = await getDb();
    const [row] = await orm
      .update(schema.forumCategories)
      .set(updates)
      .where(eq(schema.forumCategories.id, id))
      .returning();
    if (!row) throw notFound("Category not found");
    return NextResponse.json({ success: true, data: { category: row }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const DELETE = withAdminAuth(async (_req: NextRequest, { params }: Ctx) => {
  try {
    const { id } = await params;
    const orm = await getDb();
    const [countRow] = await orm
      .select({ count: count() })
      .from(schema.forumQuestions)
      .where(and(eq(schema.forumQuestions.categoryId, id), isNull(schema.forumQuestions.deletedAt)));
    if ((countRow?.count ?? 0) > 0) {
      throw badRequest("Move or delete this category's questions before deleting it.", "CATEGORY_HAS_QUESTIONS");
    }

    const deleted = await orm
      .delete(schema.forumCategories)
      .where(eq(schema.forumCategories.id, id))
      .returning({ id: schema.forumCategories.id });
    if (deleted.length === 0) throw notFound("Category not found");
    return NextResponse.json({ success: true, data: { id }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
