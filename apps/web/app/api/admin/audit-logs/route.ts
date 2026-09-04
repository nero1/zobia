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
 * 0013_audit_log_viewer.sql for the supporting indexes — so listing stays
 * fast regardless of how many rows have accumulated. Retention is handled
 * separately by the daily-platform cron (lib/audit/pruneAuditLogs.ts).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db, type SqlParam } from "@/lib/db";
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

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

interface AdminAuditRow {
  id: string;
  admin_id: string;
  admin_username: string | null;
  action: string;
  resource: string | null;
  resource_id: string | null;
  target_type: string | null;
  target_id: string | null;
  before_val: unknown;
  after_val: unknown;
  metadata: unknown;
  ip_address: string | null;
  created_at: string;
}

interface SecurityAuditRow {
  id: string;
  actor_id: string | null;
  actor_username: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: unknown;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

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

    const conditions: string[] = [];
    const params: SqlParam[] = [];
    let idx = 1;

    if (query.action) {
      conditions.push(`log.action = $${idx++}`);
      params.push(query.action);
    }
    if (query.targetType) {
      conditions.push(`log.target_type = $${idx++}`);
      params.push(query.targetType);
    }
    if (query.startDate) {
      conditions.push(`log.created_at >= $${idx++}`);
      params.push(query.startDate);
    }
    if (query.endDate) {
      conditions.push(`log.created_at <= $${idx++}`);
      params.push(query.endDate);
    }
    if (cursor) {
      conditions.push(`(log.created_at, log.id) < ($${idx}, $${idx + 1})`);
      params.push(cursor.createdAt, cursor.id);
      idx += 2;
    }

    // BUG-45-style read-path auditing: viewing the audit trail is itself a
    // sensitive read (IP addresses, KYC/financial before/after diffs).
    writeAuditLog({
      actorId: auth.user.sub,
      action: "financial_read",
      metadata: { view: "audit_logs", source: query.source, filters: { action: query.action ?? null, targetType: query.targetType ?? null } },
    });

    if (query.source === "security") {
      if (query.actorId) {
        conditions.push(`log.actor_id = $${idx++}`);
        params.push(query.actorId);
      }
      params.push(fetchLimit);

      const { rows } = await db.query<SecurityAuditRow>(
        `SELECT
           log.id, log.actor_id, actor.username AS actor_username,
           log.action, log.target_type, log.target_id, log.metadata,
           log.ip_address, log.user_agent, log.created_at
         FROM audit_log log
         LEFT JOIN users actor ON actor.id = log.actor_id
         ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
         ORDER BY log.created_at DESC, log.id DESC
         LIMIT $${idx}`,
        params
      );

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
          nextCursor: hasMore && last ? `${last.created_at}|${last.id}` : null,
        },
        error: null,
      });
    }

    if (query.actorId) {
      conditions.push(`log.admin_id = $${idx++}`);
      params.push(query.actorId);
    }
    params.push(fetchLimit);

    const { rows } = await db.query<AdminAuditRow>(
      `SELECT
         log.id, log.admin_id, admin.username AS admin_username,
         log.action, log.resource, log.resource_id, log.target_type, log.target_id,
         log.before_val, log.after_val, log.metadata, log.ip_address, log.created_at
       FROM admin_audit_log log
       LEFT JOIN users admin ON admin.id = log.admin_id
       ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
       ORDER BY log.created_at DESC, log.id DESC
       LIMIT $${idx}`,
      params
    );

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
        nextCursor: hasMore && last ? `${last.created_at}|${last.id}` : null,
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
