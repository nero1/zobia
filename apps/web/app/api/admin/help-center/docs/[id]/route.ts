export const dynamic = "force-dynamic";

/**
 * app/api/admin/help-center/docs/[id]/route.ts
 *
 * PUT    — update a doc (slug edits recorded to slug_redirects for 301s).
 * DELETE — soft-delete a doc.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { updateDoc, deleteDoc } from "@/lib/help/service";

interface Params {
  id: string;
}

const updateSchema = z.object({
  categoryId: z.string().uuid().optional(),
  slug: z.string().trim().min(1).max(150).regex(/^[a-z0-9-]+$/).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  bodyMarkdown: z.string().trim().min(1).max(50_000).optional(),
  difficulty: z.enum(["first_time", "beginner", "intermediate", "advanced"]).optional(),
  sortOrder: z.number().int().optional(),
  seoTitle: z.string().trim().max(200).optional().nullable(),
  seoDescription: z.string().trim().max(300).optional().nullable(),
  published: z.boolean().optional(),
});

export const PUT = withAdminAuth<Params>(async (req: NextRequest, { params }) => {
  try {
    const body = await validateBody(req, updateSchema);
    const doc = await updateDoc(params.id, body);
    return NextResponse.json({ success: true, data: doc, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const DELETE = withAdminAuth<Params>(async (_req: NextRequest, { params }) => {
  try {
    await deleteDoc(params.id);
    return NextResponse.json({ success: true, data: { ok: true }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
