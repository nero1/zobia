export const dynamic = 'force-dynamic';

/**
 * app/api/admin/maintenance/route.ts
 *
 * GET /api/admin/maintenance
 *
 * Lightweight admin-only read of the current maintenance-mode state, used by
 * the "maintenance mode is ON" reminder bar in AdminLayoutShell. Reads
 * loadManifest(), which is already memory+Redis cached — no extra DB/Redis
 * traffic beyond what any other admin page already causes.
 */

import { NextResponse } from "next/server";
import { loadManifest } from "@/lib/manifest";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";

export const GET = withAdminAuth(async () => {
  try {
    const manifest = await loadManifest();
    return NextResponse.json({
      success: true,
      data: { enabled: manifest.maintenance.enabled, message: manifest.maintenance.message },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
