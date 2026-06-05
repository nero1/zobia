/**
 * app/api/admin/config/[key]/route.ts
 *
 * PUT /api/admin/config/[key]
 *
 * Update a single x_manifest configuration value.
 * Admin-only — is_admin verified from DATABASE.
 *
 * Body: { value: string }
 *
 * Behaviour:
 *  1. Verifies the key exists in x_manifest (rejects unknown keys).
 *  2. Sanitizes the value based on the key's expected type:
 *     - Keys ending with _enabled or is_ prefix → must be 'true' or 'false'
 *     - Keys containing _kobo, _count, _max, _min, _limit → must be a valid integer string
 *     - All others → trimmed string (max 500 chars)
 *  3. Updates the x_manifest row.
 *  4. Appends a record to admin_audit_log.
 *  5. Invalidates the Redis manifest cache.
 *
 * Response: { key: string, value: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { invalidateManifestCache } from "@/lib/manifest";
import {
  withAdminAuth,
  validateBody,
  type AdminContext,
} from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const updateConfigSchema = z.object({
  value: z.string().max(500),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ManifestKeyRow {
  key: string;
  value: string;
  description: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sanitizes and validates the incoming value based on the manifest key name.
 * Throws ApiError on invalid input.
 *
 * @param key   - The x_manifest key being updated.
 * @param value - Raw value string from the request.
 * @returns Sanitized string value ready for database storage.
 */
function sanitizeManifestValue(key: string, value: string): string {
  const lower = key.toLowerCase();

  // Boolean keys
  if (
    lower.includes("_enabled") ||
    lower.startsWith("is_") ||
    lower.includes("require_") ||
    lower.includes("allow_")
  ) {
    if (value !== "true" && value !== "false") {
      throw badRequest(
        `Value for '${key}' must be 'true' or 'false'.`,
        "INVALID_BOOLEAN_VALUE"
      );
    }
    return value;
  }

  // Numeric keys (stored as integer strings)
  if (
    lower.includes("_kobo") ||
    lower.includes("_count") ||
    lower.includes("_max") ||
    lower.includes("_min") ||
    lower.includes("_limit") ||
    lower.includes("_threshold") ||
    lower.includes("_cap")
  ) {
    const num = parseInt(value, 10);
    if (isNaN(num) || String(num) !== value.trim()) {
      throw badRequest(
        `Value for '${key}' must be a valid integer.`,
        "INVALID_INTEGER_VALUE"
      );
    }
    return String(num);
  }

  // Default: trimmed string
  return value.trim();
}

// ---------------------------------------------------------------------------
// PUT /api/admin/config/[key]
// ---------------------------------------------------------------------------

/**
 * Update a single x_manifest entry.
 * Admin-only — is_admin verified from DATABASE by withAdminAuth middleware.
 */
export const PUT = withAdminAuth(
  async (
    req: NextRequest,
    { params, auth }: { params: { key: string }; auth: { user: { sub: string }; isAdmin: true } }
  ) => {
    try {
      const { key } = await params as { key: string };
      const body = await validateBody(req, updateConfigSchema);

      // Verify key exists in x_manifest
      const existing = await db.query<ManifestKeyRow>(
        `SELECT key, value, description FROM x_manifest WHERE key = $1 LIMIT 1`,
        [key]
      );
      if (existing.rows.length === 0) {
        throw badRequest(`Unknown manifest key: '${key}'.`, "UNKNOWN_MANIFEST_KEY");
      }

      const previousValue = existing.rows[0].value;
      const sanitizedValue = sanitizeManifestValue(key, body.value);

      await db.transaction(async (client) => {
        // Update the manifest value
        await client.query(
          `UPDATE x_manifest SET value = $1, updated_at = NOW() WHERE key = $2`,
          [sanitizedValue, key]
        );

        // Log the change to audit table (best-effort; table may not exist in all environments)
        await client.query(
          `INSERT INTO admin_audit_log
             (admin_user_id, action, entity_type, entity_id, before_value, after_value, created_at)
           VALUES ($1, 'update_manifest', 'x_manifest', $2, $3, $4, NOW())
           ON CONFLICT DO NOTHING`,
          [auth.user.sub, key, previousValue, sanitizedValue]
        ).catch(() => {
          // Silently ignore if admin_audit_log table doesn't exist yet
        });
      });

      // Invalidate Redis manifest cache so new value takes effect immediately
      await invalidateManifestCache();

      return NextResponse.json({
        success: true,
        data: { key, value: sanitizedValue },
        error: null,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
