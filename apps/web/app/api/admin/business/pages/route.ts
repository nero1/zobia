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
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

export const GET = withAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
    const limit = 50;
    const offset = (page - 1) * limit;

    const filters = [isNull(schema.businessPages.deletedAt)];
    if (status && ["active", "deactivated", "suspended", "banned"].includes(status)) {
      filters.push(eq(schema.businessPages.status, status));
    }
    const whereClause = and(...filters);

    const orm = await getDb();

    const [totalRow] = await orm
      .select({ count: count() })
      .from(schema.businessPages)
      .where(whereClause);

    const rows = await orm
      .select({
        id: schema.businessPages.id,
        business_account_id: schema.businessPages.businessAccountId,
        slug: schema.businessPages.slug,
        name: schema.businessPages.name,
        status: schema.businessPages.status,
        status_reason: schema.businessPages.statusReason,
        view_count: schema.businessPages.viewCount,
        post_count: schema.businessPages.postCount,
        created_at: schema.businessPages.createdAt,
        business_name: schema.businessAccounts.businessName,
        owner_username: schema.users.username,
      })
      .from(schema.businessPages)
      .innerJoin(schema.businessAccounts, eq(schema.businessAccounts.id, schema.businessPages.businessAccountId))
      .innerJoin(schema.users, eq(schema.users.id, schema.businessAccounts.userId))
      .where(whereClause)
      .orderBy(desc(schema.businessPages.createdAt))
      .limit(limit)
      .offset(offset);

    return NextResponse.json({
      success: true,
      data: { pages: rows, total: totalRow?.count ?? 0 },
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

    const orm = await getDb();

    const [page] = await orm
      .select({
        id: schema.businessPages.id,
        owner_user_id: schema.businessAccounts.userId,
        name: schema.businessPages.name,
        status: schema.businessPages.status,
      })
      .from(schema.businessPages)
      .innerJoin(schema.businessAccounts, eq(schema.businessAccounts.id, schema.businessPages.businessAccountId))
      .where(and(eq(schema.businessPages.id, body.id), isNull(schema.businessPages.deletedAt)))
      .limit(1);
    if (!page) throw notFound("Business page not found");

    if (body.action === "delete") {
      await orm
        .update(schema.businessPages)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.businessPages.id, body.id));
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
      await orm
        .update(schema.businessPages)
        .set({ status: nextStatus[body.action], statusReason: body.reason ?? null, updatedAt: new Date() })
        .where(eq(schema.businessPages.id, body.id));
    }

    await orm
      .insert(schema.notifications)
      .values({
        userId: page.owner_user_id,
        type: "business_page_moderated",
        title: `Business Page ${body.action === "delete" ? "removed" : body.action + "d"}`,
        body: `Your Business Page "${page.name}" was ${body.action === "delete" ? "removed" : body.action + "d"} by an admin.${body.reason ? ` Reason: ${body.reason}` : ""}`,
        metadata: { businessPageId: body.id, action: body.action },
        isRead: false,
      })
      .catch(() => {});

    await orm
      .insert(schema.adminAuditLog)
      .values({
        adminId: auth.user.sub,
        action: `business_page_${body.action}`,
        resource: "business_page",
        resourceId: body.id,
        afterVal: { reason: body.reason ?? null },
      })
      .catch(() => {});

    return NextResponse.json({ success: true, data: { id: body.id, action: body.action }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
