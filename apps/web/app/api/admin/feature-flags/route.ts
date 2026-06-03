/**
 * app/api/admin/feature-flags/route.ts
 *
 * Admin feature flags API — manages boolean toggles stored in x_manifest.
 * All writes are admin-only and audited.
 *
 * GET /api/admin/feature-flags
 *   Returns all feature flag entries (keys prefixed "feature_").
 *
 * PUT /api/admin/feature-flags
 *   Toggle a feature flag: { key: string, enabled: boolean }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const toggleSchema = z.object({
  key: z.string().min(1).max(128),
  enabled: z.boolean(),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FeatureFlagRow {
  key: string;
  value: string;
  description: string | null;
  updated_at: string;
}

interface FeatureFlag {
  key: string;
  enabled: boolean;
  description: string | null;
  audience: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseAudience(key: string): string {
  if (key.includes("_admin")) return "admin";
  if (key.includes("_beta")) return "beta";
  return "all";
}

function rowToFlag(row: FeatureFlagRow): FeatureFlag {
  return {
    key: row.key,
    enabled: row.value === "true" || row.value === "1",
    description: row.description,
    audience: parseAudience(row.key),
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// GET /api/admin/feature-flags
// ---------------------------------------------------------------------------

export const GET = withAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const { rows } = await db.query<FeatureFlagRow>(
      `SELECT key, value, description, updated_at
       FROM x_manifest
       WHERE key LIKE 'feature_%'
       ORDER BY key ASC`,
      []
    );

    return NextResponse.json({
      success: true,
      items: rows.map(rowToFlag),
      total: rows.length,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// PUT /api/admin/feature-flags
// ---------------------------------------------------------------------------

export const PUT = withAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const body = await validateBody(req, toggleSchema);
    const newValue = body.enabled ? "true" : "false";

    // Upsert the feature flag in x_manifest
    await db.query(
      `INSERT INTO x_manifest (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE
         SET value = $2, updated_at = NOW()`,
      [body.key, newValue]
    );

    // Audit log
    await db.query(
      `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, metadata, created_at)
       VALUES ($1, 'feature_flag_toggle', 'x_manifest', $2, $3, NOW())`,
      [
        auth.user.sub,
        body.key,
        JSON.stringify({ key: body.key, enabled: body.enabled }),
      ]
    ).catch(() => {}); // Non-fatal if audit log table doesn't exist

    return NextResponse.json({
      success: true,
      data: { key: body.key, enabled: body.enabled },
    });
  } catch (err) {
    return handleApiError(err);
  }
});
