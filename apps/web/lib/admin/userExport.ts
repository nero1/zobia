/**
 * lib/admin/userExport.ts
 *
 * Shared field allowlist + filter schema/builder for the Data Management
 * user exports (granular CSV/TSV/XLSX and the full-account NDJSON export).
 *
 * SECURITY: ALLOWED_EXPORT_FIELDS is the only set of columns the granular
 * export can ever emit — it deliberately excludes passwordHash, pinHash,
 * totpSecret, adminMagicWordHash, and any other secret column. The full
 * account export (export-accounts/route.ts) is a SEPARATE code path with
 * its own explicit, commented allowlist for `includeCredentials`.
 */

import { z } from "zod";
import type { SqlParam } from "@/lib/db";

// ---------------------------------------------------------------------------
// Field allowlist (granular export)
// ---------------------------------------------------------------------------

export const ALLOWED_EXPORT_FIELDS = [
  "id",
  "username",
  "email",
  "displayName",
  "plan",
  "trustScore",
  "xpTotal",
  "isVerified",
  "isBanned",
  "isSuspended",
  "isModerator",
  "city",
  "country",
  "locale",
  "createdAt",
  "lastActiveAt",
  "coinBalance",
  "starBalance",
  "guildId",
  "referralCode",
  "kycTier",
] as const;

export type ExportField = (typeof ALLOWED_EXPORT_FIELDS)[number];

/** camelCase export field name -> `users` table column expression. */
export const FIELD_TO_COLUMN: Record<ExportField, string> = {
  id: "u.id",
  username: "u.username",
  email: "u.email",
  displayName: "u.display_name",
  plan: "u.plan",
  trustScore: "u.trust_score",
  xpTotal: "u.xp_total",
  isVerified: "u.is_verified",
  isBanned: "u.is_banned",
  isSuspended: "u.is_suspended",
  isModerator: "u.is_moderator",
  city: "u.city",
  country: "u.country",
  locale: "u.locale",
  createdAt: "u.created_at",
  lastActiveAt: "u.last_active_at",
  coinBalance: "u.coin_balance",
  starBalance: "u.star_balance",
  guildId: "u.guild_id",
  referralCode: "u.referral_code",
  kycTier: "u.kyc_tier",
};

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export const exportFiltersSchema = z.object({
  plan: z.enum(["free", "plus", "pro", "max"]).optional(),
  minTrustScore: z.number().int().min(0).max(100).optional(),
  maxTrustScore: z.number().int().min(0).max(100).optional(),
  minXp: z.number().int().min(0).optional(),
  maxXp: z.number().int().min(0).optional(),
  isBanned: z.boolean().optional(),
  isSuspended: z.boolean().optional(),
  isVerified: z.boolean().optional(),
  country: z.string().max(10).optional(),
  createdAfter: z.string().datetime().optional(),
  createdBefore: z.string().datetime().optional(),
  /** 1 means "the #1 user by xp_total" — the only supported rank for now (no leaderboard snapshot table exists to page through arbitrary ranks). */
  leaderboardRank: z.literal(1).optional(),
  /** Restrict the export to a specific set of user IDs (the "export selected" checkbox path). Capped — selection doesn't scale to millions of rows, so this is a secondary option alongside the primary filter-based export. */
  userIds: z.array(z.string().uuid()).max(1000).optional(),
});

export type ExportFilters = z.infer<typeof exportFiltersSchema>;

/**
 * Build additional WHERE clauses + params for the given filters. Always
 * ANDed onto a base `u.deleted_at IS NULL` condition supplied by the caller.
 * `paramIdx` is the next free $N placeholder index.
 */
export function buildFilterConditions(
  filters: ExportFilters,
  paramIdx: number
): { clauses: string[]; params: SqlParam[]; nextParamIdx: number } {
  const clauses: string[] = [];
  const params: SqlParam[] = [];
  let idx = paramIdx;

  if (filters.plan) {
    clauses.push(`u.plan = $${idx++}`);
    params.push(filters.plan);
  }
  if (filters.minTrustScore !== undefined) {
    clauses.push(`u.trust_score >= $${idx++}`);
    params.push(filters.minTrustScore);
  }
  if (filters.maxTrustScore !== undefined) {
    clauses.push(`u.trust_score <= $${idx++}`);
    params.push(filters.maxTrustScore);
  }
  if (filters.minXp !== undefined) {
    clauses.push(`u.xp_total >= $${idx++}`);
    params.push(filters.minXp);
  }
  if (filters.maxXp !== undefined) {
    clauses.push(`u.xp_total <= $${idx++}`);
    params.push(filters.maxXp);
  }
  if (filters.isBanned !== undefined) {
    clauses.push(`u.is_banned = $${idx++}`);
    params.push(filters.isBanned);
  }
  if (filters.isSuspended !== undefined) {
    clauses.push(`u.is_suspended = $${idx++}`);
    params.push(filters.isSuspended);
  }
  if (filters.isVerified !== undefined) {
    clauses.push(`u.is_verified = $${idx++}`);
    params.push(filters.isVerified);
  }
  if (filters.country) {
    clauses.push(`u.country = $${idx++}`);
    params.push(filters.country);
  }
  if (filters.createdAfter) {
    clauses.push(`u.created_at >= $${idx++}`);
    params.push(filters.createdAfter);
  }
  if (filters.createdBefore) {
    clauses.push(`u.created_at <= $${idx++}`);
    params.push(filters.createdBefore);
  }
  if (filters.userIds && filters.userIds.length > 0) {
    clauses.push(`u.id = ANY($${idx++})`);
    params.push(filters.userIds);
  }

  return { clauses, params, nextParamIdx: idx };
}
