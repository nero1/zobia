export const dynamic = "force-dynamic";

/**
 * app/api/admin/help-center/categories/[id]/route.ts
 *
 * PUT    — update a category (slug edits are recorded to slug_redirects).
 * DELETE — remove a category (cascades to its docs — admin is warned client-side).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { updateCategory, deleteCategory } from "@/lib/help/service";

interface Params {
  id: string;
}

const updateSchema = z.object({
  slug: z.string().trim().min(1).max(100).regex(/^[a-z0-9-]+$/).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(1000).optional().nullable(),
  sortOrder: z.number().int().optional(),
  published: z.boolean().optional(),
});

export const PUT = withAdminAuth<Params>(async (req: NextRequest, { params }) => {
  try {
    const body = await validateBody(req, updateSchema);
    const category = await updateCategory(params.id, body);
    return NextResponse.json({ success: true, data: category, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const DELETE = withAdminAuth<Params>(async (_req: NextRequest, { params }) => {
  try {
    await deleteCategory(params.id);
    return NextResponse.json({ success: true, data: { ok: true }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
