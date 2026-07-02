export const dynamic = 'force-dynamic';

/**
 * app/api/admin/business/pages/route.ts
 *
 * Admin moderation panel for Business Pages (PRD §17 — "business
 * pages/business accounts moderation panel"). Mirrors
 * app/api/admin/business/route.ts's list+action shape exactly.
 *
 * GET   /api/admin/business/pages — paginated list, filterable by status.
 * PATCH /api/admin/business/pages — { id, action: "suspend"|"ban"|"deactivate"|"restore"|"delete", reason? }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import type { SqlParam } from "@/lib/db";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

interface AdminBusinessPageRow {
  id: string;
  business_account_id: string;
  slug: string;
  name: string;
  status: string;
  status_reason: string | null;
  view_count: number;
  post_count: number;
  created_at: string;
  business_name: string;
  owner_username: string;
}

export const GET = withAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
    const limit = 50;
    const offset = (page - 1) * limit;

    const conditions: string[] = ["bp.deleted_at IS NULL"];
    const params: SqlParam[] = [];
    if (status && ["active", "deactivated", "suspended", "banned"].includes(status)) {
      params.push(status);
      conditions.push(`bp.status = $${params.length}`);
    }

    const { rows: total } = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM business_pages bp WHERE ${conditions.join(" AND ")}`,
      params
    );

    params.push(limit, offset);
    const { rows } = await db.query<AdminBusinessPageRow>(
      `SELECT bp.id, bp.business_account_id, bp.slug, bp.name, bp.status, bp.status_reason,
              bp.view_count, bp.post_count, bp.created_at,
              ba.business_name, u.username AS owner_username
       FROM business_pages bp
       JOIN business_accounts ba ON ba.id = bp.business_account_id
       JOIN users u ON u.id = ba.user_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY bp.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return NextResponse.json({
      success: true,
      data: { pages: rows, total: parseInt(total[0]?.count ?? "0", 10) },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

const actionSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(["suspend", "ban", "deactivate", "restore", "delete"]),
  reason: z.string().max(500).optional(),
});

export const PATCH = withAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const body = await validateBody(req, actionSchema);

    const { rows } = await db.query<{ id: string; owner_user_id: string; name: string; status: string }>(
      `SELECT bp.id, ba.user_id AS owner_user_id, bp.name, bp.status
       FROM business_pages bp JOIN business_accounts ba ON ba.id = bp.business_account_id
       WHERE bp.id = $1 AND bp.deleted_at IS NULL LIMIT 1`,
      [body.id]
    );
    const page = rows[0];
    if (!page) throw notFound("Business page not found");

    if (body.action === "delete") {
      await db.query(`UPDATE business_pages SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`, [body.id]);
    } else {
      const nextStatus: Record<typeof body.action, string> = {
        suspend: "suspended",
        ban: "banned",
        deactivate: "deactivated",
        restore: "active",
      };
      if (body.action === "restore" && page.status !== "deactivated" && page.status !== "suspended" && page.status !== "banned") {
        throw badRequest("Page is not in a state that can be restored.");
      }
      await db.query(
        `UPDATE business_pages SET status = $1, status_reason = $2, updated_at = NOW() WHERE id = $3`,
        [nextStatus[body.action], body.reason ?? null, body.id]
      );
    }

    await db
      .query(
        `INSERT INTO notifications (user_id, type, title, body, metadata, is_read, created_at)
         VALUES ($1, 'business_page_moderated', $2, $3, $4::jsonb, false, NOW())`,
        [
          page.owner_user_id,
          `Business Page ${body.action === "delete" ? "removed" : body.action + "d"}`,
          `Your Business Page "${page.name}" was ${body.action === "delete" ? "removed" : body.action + "d"} by an admin.${body.reason ? ` Reason: ${body.reason}` : ""}`,
          JSON.stringify({ businessPageId: body.id, action: body.action }),
        ]
      )
      .catch(() => {});

    await db
      .query(
        `INSERT INTO admin_audit_log (admin_id, action, resource, resource_id, after_val, created_at)
         VALUES ($1, $2, 'business_page', $3, $4::jsonb, NOW())`,
        [auth.user.sub, `business_page_${body.action}`, body.id, JSON.stringify({ reason: body.reason ?? null })]
      )
      .catch(() => {});

    return NextResponse.json({ success: true, data: { id: body.id, action: body.action }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
