export const dynamic = 'force-dynamic';

/**
 * app/api/admin/zobian-of-month/route.ts
 *
 * POST /api/admin/zobian-of-month — admin-only override of a given month's
 * Zobian of the Month pick. Admin-set rows are flagged is_admin_override and
 * are never overwritten by the auto-compute cron (see
 * lib/feed/zobianOfMonth.ts autoComputeZobianOfMonth).
 *
 * Body: { month: "YYYY-MM-01", userId: uuid, note?: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAdminAuth, validateBody, type AdminContext } from "@/lib/api/middleware";
import { handleApiError, badRequest, notFound } from "@/lib/api/errors";
import { invalidateZobianOfMonthCache } from "@/lib/feed/zobianOfMonth";

const overrideSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}-01$/, "month must be the first day of a month, e.g. 2026-09-01"),
  userId: z.string().uuid(),
  note: z.string().max(500).optional(),
});

export const POST = withAdminAuth(async (req: NextRequest, { auth }: { auth: AdminContext }) => {
  try {
    const body = await validateBody(req, overrideSchema);

    const { rows: userRows } = await db.query<{ id: string }>(
      `SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [body.userId]
    );
    if (!userRows[0]) throw notFound("User not found");

    const { rows } = await db.query(
      `INSERT INTO zobian_of_month (month, user_id, is_admin_override, overridden_by, note)
       VALUES ($1::date, $2, true, $3, $4)
       ON CONFLICT (month) DO UPDATE
         SET user_id = EXCLUDED.user_id, is_admin_override = true,
             overridden_by = EXCLUDED.overridden_by, note = EXCLUDED.note, updated_at = NOW()
       RETURNING *`,
      [body.month, body.userId, auth.user.sub, body.note ?? null]
    );

    await invalidateZobianOfMonthCache();

    return NextResponse.json({ success: true, data: { zobianOfMonth: rows[0] }, error: null });
  } catch (err) {
    if (err instanceof Error && "code" in err && (err as { code?: string }).code === "23514") {
      return handleApiError(badRequest("Invalid month value", "INVALID_MONTH"));
    }
    return handleApiError(err);
  }
});
