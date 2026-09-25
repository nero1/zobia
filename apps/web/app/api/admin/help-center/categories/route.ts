export const dynamic = "force-dynamic";

/**
 * app/api/admin/help-center/categories/route.ts
 *
 * GET  — all categories (including unpublished) for the admin CRUD UI.
 * POST — create a category.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { asc } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { createCategory } from "@/lib/help/service";

const createSchema = z.object({
  slug: z.string().trim().min(1).max(100).regex(/^[a-z0-9-]+$/, "Lowercase letters, numbers, and hyphens only").optional(),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional().nullable(),
  sortOrder: z.number().int().optional(),
  published: z.boolean().optional(),
});

export const GET = withAdminAuth(async () => {
  try {
    const orm = await getDb();
    const rows = await orm
      .select()
      .from(schema.helpCategories)
      .orderBy(asc(schema.helpCategories.sortOrder), asc(schema.helpCategories.name));
    const data = rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      description: r.description,
      sort_order: r.sortOrder,
      published: r.published,
    }));
    return NextResponse.json({ success: true, data, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAdminAuth(async (req: NextRequest) => {
  try {
    const body = await validateBody(req, createSchema);
    const category = await createCategory(body);
    return NextResponse.json({ success: true, data: category, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
