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
import { and, eq, like, ne } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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
  const orm = await getDb();
  const [row] = await orm
    .select({ value: schema.xManifest.value })
    .from(schema.xManifest)
    .where(eq(schema.xManifest.key, MOD_VISIBLE_KEY))
    .limit(1);
  try {
    const parsed = JSON.parse(row?.value ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

async function writeModVisibleSet(set: Set<string>): Promise<void> {
  const orm = await getDb();
  await orm
    .insert(schema.xManifest)
    .values({ key: MOD_VISIBLE_KEY, value: JSON.stringify(Array.from(set)) })
    .onConflictDoUpdate({
      target: schema.xManifest.key,
      set: { value: JSON.stringify(Array.from(set)), updatedAt: new Date() },
    });
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

    const orm = await getDb();

    const rawBaseRows = await orm
      .select({
        key: schema.xManifest.key,
        value: schema.xManifest.value,
        description: schema.xManifest.description,
        updated_at: schema.xManifest.updatedAt,
      })
      .from(schema.xManifest)
      .where(and(like(schema.xManifest.key, "feature_%"), ne(schema.xManifest.key, MOD_VISIBLE_KEY)))
      .orderBy(schema.xManifest.key);

    const baseRows = rawBaseRows.map((r) => ({
      ...r,
      updated_at: r.updated_at ? r.updated_at.toISOString() : new Date().toISOString(),
    }));

    // Enrich with feature_flags table data if it exists
    let rows: FeatureFlagRow[] = baseRows.map((r) => ({
      ...r,
      available_from: null,
      early_access_plans: null,
    }));
    try {
      const ffRows = await orm
        .select({
          key: schema.featureFlags.key,
          available_from: schema.featureFlags.availableFrom,
          early_access_plans: schema.featureFlags.earlyAccessPlans,
        })
        .from(schema.featureFlags);
      const ffMap = new Map(ffRows.map((r) => [r.key, r]));
      rows = baseRows.map((r) => ({
        ...r,
        available_from: ffMap.get(r.key)?.available_from?.toISOString() ?? null,
        early_access_plans: ffMap.get(r.key)?.early_access_plans ?? null,
      }));
    } catch {
      // feature_flags table/columns not present — keep base rows as-is
    }

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

    const orm = await getDb();

    // Capture the before value for the audit log
    const [beforeRow] = await orm
      .select({ value: schema.xManifest.value })
      .from(schema.xManifest)
      .where(eq(schema.xManifest.key, body.key))
      .limit(1);
    const beforeVal = beforeRow?.value ?? null;

    // Upsert the feature flag toggle in x_manifest
    await orm
      .insert(schema.xManifest)
      .values({ key: body.key, value: newValue })
      .onConflictDoUpdate({
        target: schema.xManifest.key,
        set: { value: newValue, updatedAt: new Date() },
      });

    // Upsert early access settings into feature_flags when provided
    if (body.available_from !== undefined || body.early_access_plans !== undefined) {
      await orm
        .insert(schema.featureFlags)
        .values({
          key: body.key,
          availableFrom: body.available_from ? new Date(body.available_from) : null,
          earlyAccessPlans: body.early_access_plans ?? null,
        })
        .onConflictDoUpdate({
          target: schema.featureFlags.key,
          set: {
            availableFrom: body.available_from ? new Date(body.available_from) : null,
            earlyAccessPlans: body.early_access_plans ?? null,
          },
        })
        .catch(() => {}); // Non-fatal if feature_flags table doesn't yet have these columns
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
    await orm
      .insert(schema.adminAuditLog)
      .values({
        adminId: auth.user.sub,
        action: "feature_flag_toggle",
        resource: "x_manifest",
        resourceId: body.key,
        beforeVal,
        afterVal: newValue,
      })
      .catch(() => {}); // Non-fatal if audit log table doesn't exist

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
