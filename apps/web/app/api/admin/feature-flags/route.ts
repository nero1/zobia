export const dynamic = 'force-dynamic';

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
  available_from: z.string().datetime({ offset: true }).nullable().optional(),
  early_access_plans: z.array(z.string()).nullable().optional(),
  /** Whether moderators may still see/access this feature while `enabled` is false. */
  mods_visible: z.boolean().optional(),
});

const MOD_VISIBLE_KEY = "feature_flags_mod_visible";

async function readModVisibleSet(): Promise<Set<string>> {
  const { rows } = await db.query<{ value: string }>(
    `SELECT value FROM x_manifest WHERE key = $1 LIMIT 1`,
    [MOD_VISIBLE_KEY]
  );
  try {
    const parsed = JSON.parse(rows[0]?.value ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

async function writeModVisibleSet(set: Set<string>): Promise<void> {
  await db.query(
    `INSERT INTO x_manifest (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [MOD_VISIBLE_KEY, JSON.stringify(Array.from(set))]
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FeatureFlagRow {
  key: string;
  value: string;
  description: string | null;
  updated_at: string;
  available_from: string | null;
  early_access_plans: string[] | null;
}

interface FeatureFlag {
  key: string;
  enabled: boolean;
  description: string | null;
  audience: string;
  updatedAt: string;
  availableFrom: string | null;
  earlyAccessPlans: string[] | null;
  /** Whether moderators may still see/access this feature while disabled. */
  modsVisible: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseAudience(key: string): string {
  if (key.includes("_admin")) return "admin";
  if (key.includes("_beta")) return "beta";
  return "all";
}

function rowToFlag(row: FeatureFlagRow, modVisibleSet: Set<string>): FeatureFlag {
  return {
    key: row.key,
    enabled: row.value === "true" || row.value === "1",
    description: row.description,
    audience: parseAudience(row.key),
    updatedAt: row.updated_at,
    availableFrom: row.available_from ?? null,
    earlyAccessPlans: row.early_access_plans ?? null,
    modsVisible: modVisibleSet.has(row.key),
  };
}

// ---------------------------------------------------------------------------
// GET /api/admin/feature-flags
// ---------------------------------------------------------------------------

export const GET = withAdminAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const { rows } = await db.query<FeatureFlagRow>(
      `SELECT
         m.key,
         m.value,
         m.description,
         m.updated_at,
         NULL::timestamptz AS available_from,
         NULL::text[]      AS early_access_plans
       FROM x_manifest m
       WHERE m.key LIKE 'feature_%' AND m.key != '${MOD_VISIBLE_KEY}'
       ORDER BY m.key ASC`,
      []
    ).catch(async () => {
      // Fallback if query fails for any reason
      const fallback = await db.query<FeatureFlagRow>(
        `SELECT key, value, description, updated_at,
                NULL::timestamptz AS available_from, NULL::text[] AS early_access_plans
         FROM x_manifest WHERE key LIKE 'feature_%' AND key != '${MOD_VISIBLE_KEY}' ORDER BY key ASC`
      );
      return fallback;
    }).then(async (base) => {
      // Enrich with feature_flags table data if it exists
      try {
        const { rows: ffRows } = await db.query<{ key: string; available_from: string | null; early_access_plans: string[] | null }>(
          `SELECT key, available_from, early_access_plans FROM feature_flags`
        );
        const ffMap = new Map(ffRows.map((r) => [r.key, r]));
        return {
          rows: base.rows.map((r) => ({
            ...r,
            available_from: ffMap.get(r.key)?.available_from ?? null,
            early_access_plans: ffMap.get(r.key)?.early_access_plans ?? null,
          })),
        };
      } catch {
        return base;
      }
    });

    const modVisibleSet = await readModVisibleSet().catch(() => new Set<string>());

    return NextResponse.json({
      success: true,
      items: rows.map((r) => rowToFlag(r, modVisibleSet)),
      total: rows.length,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// PUT /api/admin/feature-flags
// ---------------------------------------------------------------------------

export const PUT = withAdminAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const body = await validateBody(req, toggleSchema);
    const newValue = body.enabled ? "true" : "false";

    // Capture the before value for the audit log
    const { rows: beforeRows } = await db.query<{ value: string }>(
      `SELECT value FROM x_manifest WHERE key = $1 LIMIT 1`,
      [body.key]
    );
    const beforeVal = beforeRows[0]?.value ?? null;

    // Upsert the feature flag toggle in x_manifest
    await db.query(
      `INSERT INTO x_manifest (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE
         SET value = $2, updated_at = NOW()`,
      [body.key, newValue]
    );

    // Upsert early access settings into feature_flags when provided
    if (body.available_from !== undefined || body.early_access_plans !== undefined) {
      await db.query(
        `INSERT INTO feature_flags (key, available_from, early_access_plans)
         VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE
           SET available_from    = EXCLUDED.available_from,
               early_access_plans = EXCLUDED.early_access_plans`,
        [
          body.key,
          body.available_from ?? null,
          body.early_access_plans ?? null,
        ]
      ).catch(() => {}); // Non-fatal if feature_flags table doesn't yet have these columns
    }

    // Update the mods-visible allow-list when provided
    if (body.mods_visible !== undefined) {
      const modVisibleSet = await readModVisibleSet();
      if (body.mods_visible) {
        modVisibleSet.add(body.key);
      } else {
        modVisibleSet.delete(body.key);
      }
      await writeModVisibleSet(modVisibleSet);
    }

    // Audit log — use canonical column names from admin_audit_log schema
    await db.query(
      `INSERT INTO admin_audit_log
         (admin_id, action, resource, resource_id, before_val, after_val, created_at)
       VALUES ($1, 'feature_flag_toggle', 'x_manifest', $2, $3::jsonb, $4::jsonb, NOW())`,
      [
        auth.user.sub,
        body.key,
        JSON.stringify(beforeVal),
        JSON.stringify(newValue),
      ]
    ).catch(() => {}); // Non-fatal if audit log table doesn't exist

    return NextResponse.json({
      success: true,
      data: {
        key: body.key,
        enabled: body.enabled,
        availableFrom: body.available_from ?? null,
        earlyAccessPlans: body.early_access_plans ?? null,
        modsVisible: body.mods_visible ?? null,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
});
