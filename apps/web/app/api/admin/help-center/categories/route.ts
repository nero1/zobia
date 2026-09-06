export const dynamic = "force-dynamic";

/**
 * app/api/admin/help-center/categories/route.ts
 *
 * GET  — all categories (including unpublished) for the admin CRUD UI.
 * POST — create a category.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { createCategory, type HelpCategory } from "@/lib/help/service";

const createSchema = z.object({
  slug: z.string().trim().min(1).max(100).regex(/^[a-z0-9-]+$/, "Lowercase letters, numbers, and hyphens only").optional(),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional().nullable(),
  sortOrder: z.number().int().optional(),
  published: z.boolean().optional(),
});

export const GET = withAdminAuth(async () => {
  try {
    const { rows } = await db.query<HelpCategory>(`SELECT * FROM help_categories ORDER BY sort_order ASC, name ASC`);
    return NextResponse.json({ success: true, data: rows, error: null });
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
