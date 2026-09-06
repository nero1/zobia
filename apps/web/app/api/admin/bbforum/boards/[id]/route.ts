export const dynamic = "force-dynamic";

/**
 * app/api/admin/bbforum/boards/[id]/route.ts
 *
 * PATCH  — update a board (rename, re-icon, reorder, activate/deactivate, re-parent).
 * DELETE — remove a board (cascades to its threads/posts via FK ON DELETE CASCADE).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { updateBoard, deleteBoard } from "@/lib/bbforum/repo";

const patchSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  description: z.string().max(300).nullable().optional(),
  iconEmoji: z.string().min(1).max(8).optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
  parentId: z.string().uuid().nullable().optional(),
});

export const PATCH = withAdminAuth(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await params;
    const body = await req.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) throw badRequest("Invalid request body", parsed.error.flatten());
    const board = await updateBoard(id, parsed.data);
    return NextResponse.json({ success: true, data: { board }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const DELETE = withAdminAuth(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await params;
    await deleteBoard(id);
    return NextResponse.json({ success: true, data: { deleted: true }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
