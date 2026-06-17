export const dynamic = 'force-dynamic';

/**
 * app/api/admin/session-settings/route.ts
 *
 * Admin endpoints for managing per-role session TTL configuration.
 *
 * GET  /api/admin/session-settings
 *   Returns current TTL values for all session_ttl_* keys from app_settings,
 *   alongside the defaults for comparison.
 *
 * PUT  /api/admin/session-settings
 *   Body: { key: string, value: string }
 *   Validates and upserts a single TTL setting into app_settings, then
 *   invalidates the Redis cache so the new value takes effect immediately.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api/middleware";
import { db } from "@/lib/db";
import { handleApiError, badRequest } from "@/lib/api/errors";
import {
  SESSION_TTL_SETTINGS,
  DEFAULT_SESSION_TTLS,
  invalidateSessionSettingsCache,
} from "@/lib/auth/session-settings";

// ---------------------------------------------------------------------------
// GET /api/admin/session-settings
// ---------------------------------------------------------------------------

export const GET = withAdminAuth(async (_req: NextRequest) => {
  try {
    const keys = SESSION_TTL_SETTINGS.map((s) => s.key);
    const { rows } = await db.query<{ key: string; value: string }>(
      `SELECT key, value FROM app_settings WHERE key = ANY($1)`,
      [keys]
    );
    const dbValues = new Map(rows.map((r) => [r.key, r.value]));

    const data = SESSION_TTL_SETTINGS.map((setting) => {
      const defaults = DEFAULT_SESSION_TTLS[setting.role] ?? DEFAULT_SESSION_TTLS["default"];
      const defaultValue = setting.type === "access" ? defaults.accessTtl : defaults.refreshTtl;
      return {
        key: setting.key,
        role: setting.role,
        type: setting.type,
        value: dbValues.get(setting.key) ?? null,
        defaultValue,
      };
    });

    return NextResponse.json({ data });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// PUT /api/admin/session-settings
// ---------------------------------------------------------------------------

export const PUT = withAdminAuth(async (req: NextRequest) => {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw badRequest("Request body must be valid JSON");
    }

    const { key, value } = body as { key?: unknown; value?: unknown };

    if (typeof key !== "string" || typeof value !== "string") {
      throw badRequest("Both 'key' and 'value' must be strings");
    }

    // Validate that the key is a known session TTL setting
    const validKeys = new Set(SESSION_TTL_SETTINGS.map((s) => s.key));
    if (!validKeys.has(key)) {
      throw badRequest(`Unknown session TTL key: ${key}`, "UNKNOWN_KEY");
    }

    // Validate that the value is a positive integer >= 60 seconds
    const numericValue = parseInt(value, 10);
    if (isNaN(numericValue) || numericValue < 60 || String(numericValue) !== value.trim()) {
      throw badRequest("Value must be a positive integer >= 60 (seconds)", "INVALID_VALUE");
    }

    // Upsert into app_settings
    await db.query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, value]
    );

    // Invalidate the Redis cache so the new TTL takes effect promptly
    await invalidateSessionSettingsCache();

    return NextResponse.json({ success: true });
  } catch (err) {
    return handleApiError(err);
  }
});
