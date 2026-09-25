export const dynamic = 'force-dynamic';

/**
 * app/api/admin/business/route.ts
 *
 * Admin endpoints for managing business accounts.
 *
 * GET /api/admin/business
 *   List all business accounts (supports ?status=pending for verification queue).
 *
 * PATCH /api/admin/business/[id]
 *   Update a business account: approve/reject verification, suspend/restore.
 *   Body: { action: "verify" | "reject" | "suspend" | "restore", reason?: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, count, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// GET /api/admin/business
// ---------------------------------------------------------------------------

export const GET = withAdminAuth(async (req: NextRequest) => {
  try {
    const url = new URL(req.url);
    const verificationStatus = url.searchParams.get("verification_status"); // "pending" | "all"
    const tier = url.searchParams.get("tier");
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
    const limit = 50;
    const offset = (page - 1) * limit;

    const filters = [];
    if (verificationStatus && verificationStatus !== "all") {
      filters.push(eq(schema.businessAccounts.verificationStatus, verificationStatus));
    }
    if (tier && tier !== "all") {
      filters.push(eq(schema.businessAccounts.tier, tier));
    }
    const whereClause = filters.length > 0 ? and(...filters) : undefined;

    const orm = await getDb();

    const rows = await orm
      .select({
        id: schema.businessAccounts.id,
        user_id: schema.businessAccounts.userId,
        business_name: schema.businessAccounts.businessName,
        business_type: schema.businessAccounts.businessType,
        tier: schema.businessAccounts.tier,
        status: schema.businessAccounts.status,
        verification_status: schema.businessAccounts.verificationStatus,
        verification_requested_at: schema.businessAccounts.verificationRequestedAt,
        verified: schema.businessAccounts.verified,
        created_at: schema.businessAccounts.createdAt,
        username: schema.users.username,
        email: schema.users.email,
      })
      .from(schema.businessAccounts)
      .innerJoin(schema.users, eq(schema.users.id, schema.businessAccounts.userId))
      .where(whereClause)
      .orderBy(sql`${schema.businessAccounts.verificationRequestedAt} DESC NULLS LAST`, sql`${schema.businessAccounts.createdAt} DESC`)
      .limit(limit)
      .offset(offset);

    const [countRow] = await orm
      .select({ total: count() })
      .from(schema.businessAccounts)
      .where(whereClause);

    return NextResponse.json({
      success: true,
      data: {
        businesses: rows,
        total: countRow?.total ?? 0,
        page,
        limit,
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// Schema + PATCH /api/admin/business/[id]
// ---------------------------------------------------------------------------

const adminActionSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(["verify", "reject", "suspend", "restore"]),
  reason: z.string().max(500).optional(),
});

export const PATCH = withAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const body = await validateBody(req, adminActionSchema);
    const { id, action, reason } = body;

    const orm = await getDb();

    const [biz] = await orm
      .select({
        id: schema.businessAccounts.id,
        user_id: schema.businessAccounts.userId,
        verification_status: schema.businessAccounts.verificationStatus,
        status: schema.businessAccounts.status,
      })
      .from(schema.businessAccounts)
      .where(eq(schema.businessAccounts.id, id))
      .limit(1);
    if (!biz) throw notFound("Business account not found");

    let notifTitle = "";
    let notifBody = "";
    let notifType = "";

    if (action === "verify") {
      if (biz.verification_status !== "pending") {
        throw badRequest("Account is not in pending verification status");
      }
      await orm
        .update(schema.businessAccounts)
        .set({
          verificationStatus: "verified",
          verified: true,
          verificationReviewedAt: new Date(),
          verificationRejectReason: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.businessAccounts.id, id));
      notifType = "business_verified";
      notifTitle = "Business Account Verified";
      notifBody = "Your business account has been verified. Your verified badge is now active.";

    } else if (action === "reject") {
      if (biz.verification_status !== "pending") {
        throw badRequest("Account is not in pending verification status");
      }
      await orm
        .update(schema.businessAccounts)
        .set({
          verificationStatus: "rejected",
          verified: false,
          verificationReviewedAt: new Date(),
          verificationRejectReason: reason ?? null,
          updatedAt: new Date(),
        })
        .where(eq(schema.businessAccounts.id, id));
      notifType = "business_verification_rejected";
      notifTitle = "Business Verification Unsuccessful";
      notifBody = reason
        ? `Your verification request was not approved: ${reason}`
        : "Your verification request was not approved. You may reapply after addressing any issues.";

    } else if (action === "suspend") {
      await orm
        .update(schema.businessAccounts)
        .set({ status: "suspended", updatedAt: new Date() })
        .where(eq(schema.businessAccounts.id, id));
      notifType = "business_suspended";
      notifTitle = "Business Account Suspended";
      notifBody = reason
        ? `Your business account has been suspended: ${reason}`
        : "Your business account has been suspended. Contact support for more information.";

    } else if (action === "restore") {
      await orm
        .update(schema.businessAccounts)
        .set({ status: "active", updatedAt: new Date() })
        .where(eq(schema.businessAccounts.id, id));
      notifType = "business_restored";
      notifTitle = "Business Account Restored";
      notifBody = "Your business account has been restored and is now active.";
    }

    // Notify user
    if (notifType) {
      await orm
        .insert(schema.notifications)
        .values({
          userId: biz.user_id,
          type: notifType,
          title: notifTitle,
          body: notifBody,
          metadata: { businessAccountId: id, action },
          isRead: false,
        })
        .catch(() => {});
    }

    // Audit log
    await orm
      .insert(schema.adminAuditLog)
      .values({
        adminId: auth.user.sub,
        action: `business_${action}`,
        resource: "business_account",
        resourceId: id,
        afterVal: { action, reason: reason ?? null },
      })
      .catch(() => {});

    return NextResponse.json({
      success: true,
      data: { id, action },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
