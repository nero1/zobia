export const dynamic = "force-dynamic";

/**
 * app/api/admin/help-center/docs/route.ts
 *
 * GET  — all docs (any status) for the admin CRUD UI.
 * POST — create a doc.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAdminAuth, validateBody, type AdminContext } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { createDoc, listAllDocsForAdmin } from "@/lib/help/service";

const createSchema = z.object({
  categoryId: z.string().uuid(),
  slug: z.string().trim().min(1).max(150).regex(/^[a-z0-9-]+$/, "Lowercase letters, numbers, and hyphens only").optional(),
  title: z.string().trim().min(1).max(200),
  bodyMarkdown: z.string().trim().min(1).max(50_000),
  difficulty: z.enum(["first_time", "beginner", "intermediate", "advanced"]),
  sortOrder: z.number().int().optional(),
  seoTitle: z.string().trim().max(200).optional().nullable(),
  seoDescription: z.string().trim().max(300).optional().nullable(),
  published: z.boolean().optional(),
});

export const GET = withAdminAuth(async () => {
  try {
    const docs = await listAllDocsForAdmin();
    return NextResponse.json({ success: true, data: docs, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAdminAuth(async (req: NextRequest, { auth }: { auth: AdminContext; params: Record<string, string> }) => {
  try {
    const body = await validateBody(req, createSchema);
    const doc = await createDoc({ ...body, authorId: auth.user.sub });
    return NextResponse.json({ success: true, data: doc, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
