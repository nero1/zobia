/**
 * app/api/admin/config/route.ts
 *
 * Admin-only x_manifest configuration endpoints.
 *
 * GET  /api/admin/config
 *   Returns all x_manifest entries as { key, value, description }[].
 *   is_admin verified from DATABASE (not just JWT).
 *
 * PUT  /api/admin/config/[key]  →  see /app/api/admin/config/[key]/route.ts
 *   Update a single manifest key/value.
 *   - Validates key exists in the manifest.
 *   - Sanitizes value based on expected type (boolean strings → 'true'/'false',
 *     numeric strings validated as integers, text strings trimmed).
 *   - Logs change to the admin_audit_log table.
 *   - Invalidates the Redis manifest cache.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { invalidateManifestCache } from "@/lib/manifest";
import { withAdminAuth, type AdminContext } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ManifestRow {
  key: string;
  value: string;
  description: string | null;
  updated_at: string | null;
}

interface ManifestEntry {
  key: string;
  value: string;
  description: string | null;
  updatedAt: string | null;
}

// ---------------------------------------------------------------------------
// GET /api/admin/config
// ---------------------------------------------------------------------------

/**
 * Returns all x_manifest entries for the admin configuration panel.
 * Admin-only — is_admin verified from DATABASE by withAdminAuth middleware.
 */
export const GET = withAdminAuth(async (req: NextRequest, _ctx: { params: Record<string, string>; auth: AdminContext }) => {
  try {
    const result = await db.query<ManifestRow>(
      `SELECT key, value, description, updated_at
       FROM x_manifest
       ORDER BY key ASC`
    );

    const entries: ManifestEntry[] = result.rows.map((row) => ({
      key: row.key,
      value: row.value,
      description: row.description,
      updatedAt: row.updated_at,
    }));

    return NextResponse.json({
      success: true,
      data: entries,
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
