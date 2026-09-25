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
import { sql } from "drizzle-orm";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getDb, schema } from "@/lib/db/drizzle";
import { logger } from "@/lib/logger";

const topUpSchema = z.object({
  amountKobo: z.number().int().positive().max(10_000_000_000), // ₦100M ceiling — sanity guard against a fat-fingered extra zero
  note: z.string().max(500).optional(),
});

export const POST = withAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const body = await validateBody(req, topUpSchema);

    const orm = await getDb();
    const rows = await orm.transaction(async (tx) => {
      const beforeRows = await tx
        .select({ value: schema.xManifest.value })
        .from(schema.xManifest)
        .where(sql`${schema.xManifest.key} = 'creator_fund_balance_kobo'`)
        .limit(1)
        .for("update");
      const balanceBeforeKobo = parseInt(beforeRows[0]?.value ?? "0", 10);

      const afterRows = await tx
        .insert(schema.xManifest)
        .values({ key: "creator_fund_balance_kobo", value: String(body.amountKobo) })
        .onConflictDoUpdate({
          target: schema.xManifest.key,
          set: {
            value: sql`(COALESCE(${schema.xManifest.value}::NUMERIC, 0) + ${body.amountKobo})::TEXT`,
            updatedAt: sql`NOW()`,
          },
        })
        .returning({ value: schema.xManifest.value });

      await tx.insert(schema.adminAuditLog).values({
        adminId: auth.user.sub,
        action: "creator_fund_topup",
        resource: "creator_fund",
        resourceId: "creator_fund_balance_kobo",
        beforeVal: { balanceKobo: balanceBeforeKobo },
        afterVal: {
          balanceKobo: parseInt(afterRows[0]?.value ?? "0", 10),
          addedKobo: body.amountKobo,
          note: body.note ?? null,
        },
      });

      return afterRows;
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
