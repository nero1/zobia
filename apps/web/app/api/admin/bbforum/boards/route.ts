export const dynamic = "force-dynamic";

/**
 * app/api/admin/bbforum/boards/route.ts
 *
 * GET  — list all boards (including inactive) for the admin boards manager.
 * POST — create a new board or sub-board.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { listAllBoardsAdmin, createBoard } from "@/lib/bbforum/repo";

const createSchema = z.object({
  parentId: z.string().uuid().nullable().optional(),
  name: z.string().min(2).max(80),
  description: z.string().max(300).optional(),
  iconEmoji: z.string().min(1).max(8).default("💬"),
  sortOrder: z.number().int().default(0),
});

export const GET = withAdminAuth(async () => {
  try {
    const boards = await listAllBoardsAdmin();
    return NextResponse.json({ success: true, data: { boards }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAdminAuth(async (req: NextRequest) => {
  try {
    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) throw badRequest("Invalid request body", parsed.error.flatten());

    const board = await createBoard({
      parentId: parsed.data.parentId ?? null,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      iconEmoji: parsed.data.iconEmoji,
      sortOrder: parsed.data.sortOrder,
    });
    return NextResponse.json({ success: true, data: { board }, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
