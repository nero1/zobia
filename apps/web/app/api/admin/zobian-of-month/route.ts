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
import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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

    const orm = await getDb();

    const userRows = await orm
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(and(eq(schema.users.id, body.userId), isNull(schema.users.deletedAt)))
      .limit(1);
    if (!userRows[0]) throw notFound("User not found");

    const rows = await orm
      .insert(schema.zobianOfMonth)
      .values({
        month: body.month,
        userId: body.userId,
        isAdminOverride: true,
        overriddenBy: auth.user.sub,
        note: body.note ?? null,
      })
      .onConflictDoUpdate({
        target: schema.zobianOfMonth.month,
        set: {
          userId: body.userId,
          isAdminOverride: true,
          overriddenBy: auth.user.sub,
          note: body.note ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();

    await invalidateZobianOfMonthCache();

    return NextResponse.json({ success: true, data: { zobianOfMonth: rows[0] }, error: null });
  } catch (err) {
    if (err instanceof Error && "code" in err && (err as { code?: string }).code === "23514") {
      return handleApiError(badRequest("Invalid month value", "INVALID_MONTH"));
    }
    return handleApiError(err);
  }
});
