export const dynamic = "force-dynamic";

/**
 * app/api/admin/audit-logs/route.ts
 *
 * GET /api/admin/audit-logs — Read-only viewer over the platform's two audit
 * trails. Admin only (these can include sensitive KYC/financial actions and
 * IP addresses).
 *
 *   source     - "admin" (admin_audit_log: config/KYC/payout/etc. writes made
 *                through the admin panel) or "security" (audit_log: login,
 *                2FA, PIN, ban/suspend events). Default: "admin".
 *   action     - Filter by exact action value.
 *   actorId    - Filter by acting admin/user UUID.
 *   targetType - Filter by target_type (admin source only).
 *   startDate  - ISO-8601 start date (inclusive)
 *   endDate    - ISO-8601 end date (inclusive)
 *   cursor     - Keyset pagination cursor, "<created_at>|<id>" of the last row seen
 *   limit      - Page size (default 50, max 200)
 *
 * Both tables are keyset-paginated (created_at, id) — see migration
 * 0001_consolidated_schema.sql for the supporting indexes — so listing stays
 * fast regardless of how many rows have accumulated. Retention is handled
 * separately by the daily-platform cron (lib/audit/pruneAuditLogs.ts).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAdminAuth, validateSearchParams } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { writeAuditLog } from "@/lib/audit/auditLog";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const listQuerySchema = z.object({
  source: z.enum(["admin", "security"]).optional().default("admin"),
  action: z.string().max(100).optional(),
  actorId: z.string().uuid().optional(),
  targetType: z.string().max(100).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  cursor: z.string().optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? Math.min(Math.max(parseInt(v, 10), 1), 200) : 50)),
});

function parseCursor(cursor: string | undefined): { createdAt: string; id: string } | null {
  if (!cursor) return null;
  const sep = cursor.lastIndexOf("|");
  if (sep <= 0) return null;
  return { createdAt: cursor.slice(0, sep), id: cursor.slice(sep + 1) };
}

// ---------------------------------------------------------------------------
// GET /api/admin/audit-logs
// ---------------------------------------------------------------------------

export const GET = withAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const query = validateSearchParams(req.nextUrl.searchParams, listQuerySchema);
    const cursor = parseCursor(query.cursor);
    const fetchLimit = query.limit + 1;

    const orm = await getDb();

    // BUG-45-style read-path auditing: viewing the audit trail is itself a
    // sensitive read (IP addresses, KYC/financial before/after diffs).
    writeAuditLog({
      actorId: auth.user.sub,
      action: "financial_read",
      metadata: { view: "audit_logs", source: query.source, filters: { action: query.action ?? null, targetType: query.targetType ?? null } },
    });

    if (query.source === "security") {
      const log = schema.auditLog;
      const conditions = [];
      if (query.action) conditions.push(eq(log.action, query.action));
      if (query.targetType) conditions.push(eq(log.targetType, query.targetType));
      if (query.startDate) conditions.push(gte(log.createdAt, new Date(query.startDate)));
      if (query.endDate) conditions.push(lte(log.createdAt, new Date(query.endDate)));
      if (cursor) {
        conditions.push(sql`(${log.createdAt}, ${log.id}) < (${cursor.createdAt}, ${cursor.id})`);
      }
      if (query.actorId) conditions.push(eq(log.actorId, query.actorId));

      const rows = await orm
        .select({
          id: log.id,
          actor_id: log.actorId,
          actor_username: schema.users.username,
          action: log.action,
          target_type: log.targetType,
          target_id: log.targetId,
          metadata: log.metadata,
          ip_address: log.ipAddress,
          user_agent: log.userAgent,
          created_at: log.createdAt,
        })
        .from(log)
        .leftJoin(schema.users, eq(schema.users.id, log.actorId))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(log.createdAt), desc(log.id))
        .limit(fetchLimit);

      const hasMore = rows.length > query.limit;
      const items = hasMore ? rows.slice(0, query.limit) : rows;
      const last = items[items.length - 1];

      return NextResponse.json({
        success: true,
        data: {
          source: "security",
          items: items.map((r) => ({
            id: r.id,
            actorId: r.actor_id,
            actorUsername: r.actor_username,
            action: r.action,
            targetType: r.target_type,
            targetId: r.target_id,
            metadata: r.metadata,
            ipAddress: r.ip_address,
            userAgent: r.user_agent,
            createdAt: r.created_at,
          })),
          hasMore,
          nextCursor: hasMore && last ? `${last.created_at as unknown as string}|${last.id}` : null,
        },
        error: null,
      });
    }

    const log = schema.adminAuditLog;
    const conditions = [];
    if (query.action) conditions.push(eq(log.action, query.action));
    if (query.targetType) conditions.push(eq(log.targetType, query.targetType));
    if (query.startDate) conditions.push(gte(log.createdAt, new Date(query.startDate)));
    if (query.endDate) conditions.push(lte(log.createdAt, new Date(query.endDate)));
    if (cursor) {
      conditions.push(sql`(${log.createdAt}, ${log.id}) < (${cursor.createdAt}, ${cursor.id})`);
    }
    if (query.actorId) conditions.push(eq(log.adminId, query.actorId));

    const rows = await orm
      .select({
        id: log.id,
        admin_id: log.adminId,
        admin_username: schema.users.username,
        action: log.action,
        resource: log.resource,
        resource_id: log.resourceId,
        target_type: log.targetType,
        target_id: log.targetId,
        before_val: log.beforeVal,
        after_val: log.afterVal,
        metadata: log.metadata,
        ip_address: log.ipAddress,
        created_at: log.createdAt,
      })
      .from(log)
      .leftJoin(schema.users, eq(schema.users.id, log.adminId))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(log.createdAt), desc(log.id))
      .limit(fetchLimit);

    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    const last = items[items.length - 1];

    return NextResponse.json({
      success: true,
      data: {
        source: "admin",
        items: items.map((r) => ({
          id: r.id,
          adminId: r.admin_id,
          adminUsername: r.admin_username,
          action: r.action,
          resource: r.resource,
          resourceId: r.resource_id,
          targetType: r.target_type,
          targetId: r.target_id,
          beforeVal: r.before_val,
          afterVal: r.after_val,
          metadata: r.metadata,
          ipAddress: r.ip_address,
          createdAt: r.created_at,
        })),
        hasMore,
        nextCursor: hasMore && last ? `${last.created_at as unknown as string}|${last.id}` : null,
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
