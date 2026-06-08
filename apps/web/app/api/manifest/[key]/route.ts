export const dynamic = 'force-dynamic';

/**
 * app/api/manifest/[key]/route.ts
 *
 * Admin-only manifest value update endpoint.
 *
 * PUT /api/manifest/[key]
 *   - Requires is_admin = true from the DATABASE (not just JWT)
 *   - Updates a top-level manifest key in the app_settings table
 *   - Invalidates the Redis manifest cache
 *   - Returns the updated manifest section
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { loadManifest, invalidateManifestCache } from "@/lib/manifest";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ManifestKeyParams {
  key: string;
}

// ---------------------------------------------------------------------------
// Allowed manifest keys that can be updated via the admin API
// ---------------------------------------------------------------------------

const UPDATABLE_KEYS = new Set([
  "features",
  "payment",
  "moderation",
  "minimum_age",
]);

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const updateManifestSchema = z.object({
  /** The new value for the manifest key. Must be a JSON-serialisable object. */
  value: z.unknown(),
});

// ---------------------------------------------------------------------------
// PUT /api/manifest/[key]
// ---------------------------------------------------------------------------

/**
 * Update a manifest key value.
 *
 * Admin-only: is_admin is verified against the database, not just the JWT.
 * The Redis cache is invalidated so the change takes effect on the next request.
 *
 * @returns JSON { key, value, updatedAt }
 */
export const PUT = withAdminAuth<ManifestKeyParams>(async (req, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const { key } = params;

    if (!UPDATABLE_KEYS.has(key)) {
      throw badRequest(
        `Invalid manifest key '${key}'. Allowed keys: ${[...UPDATABLE_KEYS].join(", ")}`,
        "INVALID_MANIFEST_KEY"
      );
    }

    const { value } = await validateBody(req, updateManifestSchema);

    // Load current manifest to merge
    const currentManifest = await loadManifest();
    const updatedManifest = {
      ...currentManifest,
      [key]: value,
      updatedAt: Math.floor(Date.now() / 1000),
    };

    // Persist to app_settings table
    await db.query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ('manifest', $1, NOW())
       ON CONFLICT (key) DO UPDATE
         SET value = $1, updated_at = NOW()`,
      [JSON.stringify(updatedManifest)]
    );

    // Invalidate Redis cache so next request reads fresh value
    await invalidateManifestCache();

    return NextResponse.json(
      {
        key,
        value,
        updatedAt: updatedManifest.updatedAt,
      },
      { status: 200 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
