export const dynamic = 'force-dynamic';

/**
 * app/api/admin/creator-fund/topup/route.ts
 *
 * POST /api/admin/creator-fund/topup — Manually add funds to the Creator
 * Fund pool (admin only). Credits x_manifest.creator_fund_balance_kobo
 * directly, the same balance every per-activity contribution
 * (lib/creator/fundContribution.ts) and the day-5 monthly distribution
 * (lib/creator/fund.ts) read/write — a top-up just adds to that pool ahead
 * of the next distribution.
 *
 * Every top-up is written to admin_audit_log (before/after balance, admin
 * id, optional note) since this is a direct monetary action, not a config
 * value edit.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

const topUpSchema = z.object({
  amountKobo: z.number().int().positive().max(10_000_000_000), // ₦100M ceiling — sanity guard against a fat-fingered extra zero
  note: z.string().max(500).optional(),
});

export const POST = withAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const body = await validateBody(req, topUpSchema);

    const { rows } = await db.transaction(async (tx) => {
      const { rows: beforeRows } = await tx.query<{ value: string }>(
        `SELECT value FROM x_manifest WHERE key = 'creator_fund_balance_kobo' LIMIT 1 FOR UPDATE`
      );
      const balanceBeforeKobo = parseInt(beforeRows[0]?.value ?? "0", 10);

      const { rows: afterRows } = await tx.query<{ value: string }>(
        `INSERT INTO x_manifest (key, value, updated_at)
         VALUES ('creator_fund_balance_kobo', $1::TEXT, NOW())
         ON CONFLICT (key) DO UPDATE
           SET value = (COALESCE(x_manifest.value::NUMERIC, 0) + $1)::TEXT,
               updated_at = NOW()
         RETURNING value`,
        [body.amountKobo]
      );

      await tx.query(
        `INSERT INTO admin_audit_log (admin_id, action, resource, resource_id, before_val, after_val, created_at)
         VALUES ($1, 'creator_fund_topup', 'creator_fund', 'creator_fund_balance_kobo', $2::jsonb, $3::jsonb, NOW())`,
        [
          auth.user.sub,
          JSON.stringify({ balanceKobo: balanceBeforeKobo }),
          JSON.stringify({ balanceKobo: parseInt(afterRows[0]?.value ?? "0", 10), addedKobo: body.amountKobo, note: body.note ?? null }),
        ]
      );

      return { rows: afterRows };
    });

    const balanceKobo = parseInt(rows[0]?.value ?? "0", 10);
    logger.info({ adminId: auth.user.sub, addedKobo: body.amountKobo, balanceKobo }, "[creator-fund] manual top-up applied");

    return NextResponse.json({
      success: true,
      data: { balanceKobo, addedKobo: body.amountKobo },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
