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
import { db } from "@/lib/db";
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

    const conditions: string[] = [];
    const params: (string | number)[] = [];
    let idx = 1;

    if (verificationStatus && verificationStatus !== "all") {
      conditions.push(`ba.verification_status = $${idx++}`);
      params.push(verificationStatus);
    }
    if (tier && tier !== "all") {
      conditions.push(`ba.tier = $${idx++}`);
      params.push(tier);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    params.push(limit, offset);

    const { rows } = await db.query<{
      id: string;
      user_id: string;
      business_name: string;
      business_type: string | null;
      tier: string;
      status: string;
      verification_status: string;
      verification_requested_at: string | null;
      verified: boolean;
      created_at: string;
      username: string;
      email: string | null;
    }>(
      `SELECT ba.id, ba.user_id, ba.business_name, ba.business_type, ba.tier,
              ba.status, ba.verification_status, ba.verification_requested_at,
              ba.verified, ba.created_at,
              u.username, u.email
       FROM business_accounts ba
       JOIN users u ON u.id = ba.user_id
       ${where}
       ORDER BY ba.verification_requested_at DESC NULLS LAST, ba.created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      params
    );

    const { rows: countRows } = await db.query<{ total: string }>(
      `SELECT COUNT(*) AS total FROM business_accounts ba ${where}`,
      params.slice(0, -2)
    );

    return NextResponse.json({
      success: true,
      data: {
        businesses: rows,
        total: parseInt(countRows[0]?.total ?? "0", 10),
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
    await enforceRateLimit(auth.user.sub, "admin", RATE_LIMITS.apiWrite);

    const body = await validateBody(req, adminActionSchema);
    const { id, action, reason } = body;

    const { rows } = await db.query<{ id: string; user_id: string; verification_status: string; status: string }>(
      `SELECT id, user_id, verification_status, status FROM business_accounts WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (!rows[0]) throw notFound("Business account not found");

    const biz = rows[0];
    let notifTitle = "";
    let notifBody = "";
    let notifType = "";

    if (action === "verify") {
      if (biz.verification_status !== "pending") {
        throw badRequest("Account is not in pending verification status");
      }
      await db.query(
        `UPDATE business_accounts
         SET verification_status = 'verified',
             verified = TRUE,
             verification_reviewed_at = NOW(),
             verification_reject_reason = NULL,
             updated_at = NOW()
         WHERE id = $1`,
        [id]
      );
      notifType = "business_verified";
      notifTitle = "Business Account Verified";
      notifBody = "Your business account has been verified. Your verified badge is now active.";

    } else if (action === "reject") {
      if (biz.verification_status !== "pending") {
        throw badRequest("Account is not in pending verification status");
      }
      await db.query(
        `UPDATE business_accounts
         SET verification_status = 'rejected',
             verified = FALSE,
             verification_reviewed_at = NOW(),
             verification_reject_reason = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [reason ?? null, id]
      );
      notifType = "business_verification_rejected";
      notifTitle = "Business Verification Unsuccessful";
      notifBody = reason
        ? `Your verification request was not approved: ${reason}`
        : "Your verification request was not approved. You may reapply after addressing any issues.";

    } else if (action === "suspend") {
      await db.query(
        `UPDATE business_accounts
         SET status = 'suspended', updated_at = NOW()
         WHERE id = $1`,
        [id]
      );
      notifType = "business_suspended";
      notifTitle = "Business Account Suspended";
      notifBody = reason
        ? `Your business account has been suspended: ${reason}`
        : "Your business account has been suspended. Contact support for more information.";

    } else if (action === "restore") {
      await db.query(
        `UPDATE business_accounts
         SET status = 'active', updated_at = NOW()
         WHERE id = $1`,
        [id]
      );
      notifType = "business_restored";
      notifTitle = "Business Account Restored";
      notifBody = "Your business account has been restored and is now active.";
    }

    // Notify user
    if (notifType) {
      await db.query(
        `INSERT INTO notifications
           (user_id, type, title, body, metadata, is_read, created_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, false, NOW())`,
        [
          biz.user_id,
          notifType,
          notifTitle,
          notifBody,
          JSON.stringify({ businessAccountId: id, action }),
        ]
      ).catch(() => {});
    }

    // Audit log
    await db.query(
      `INSERT INTO admin_audit_log
         (admin_id, action, resource, resource_id, after_val, created_at)
       VALUES ($1, $2, 'business_account', $3, $4::jsonb, NOW())`,
      [
        auth.user.sub,
        `business_${action}`,
        id,
        JSON.stringify({ action, reason: reason ?? null }),
      ]
    ).catch(() => {});

    return NextResponse.json({
      success: true,
      data: { id, action },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
