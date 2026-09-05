export const dynamic = "force-dynamic";

/**
 * app/api/forum/boards/route.ts
 *
 * GET /api/forum/boards — the board tree for the /forum home page.
 * Public (no auth) — forum content is publicly readable; only posting
 * requires a signed-in account (see requireFeatureEnabled below for the
 * write-side gate).
 */

import { NextResponse } from "next/server";
import { requireFeatureEnabled } from "@/lib/manifest";
import { handleApiError } from "@/lib/api/errors";
import { listBoardTree } from "@/lib/bbforum/repo";

export const GET = async () => {
  try {
    await requireFeatureEnabled("bbforum");
    const boards = await listBoardTree();
    return NextResponse.json({ success: true, data: { boards }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
};
