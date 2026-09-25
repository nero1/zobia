export const dynamic = 'force-dynamic';

/**
 * app/api/admin/alerts/contacts/[userId]/route.ts
 *
 * PUT /api/admin/alerts/contacts/[userId]
 *
 * Upserts an admin/moderator's SMS contact info for Level 1/2 alert paging.
 * Body: { phoneNumber: string | null, smsEnabled: boolean }
 *
 * Deliberately separate from the `users` table — the platform has an
 * explicit no-phone-number/no-SMS policy everywhere else (PRD §16, §22).
 * Admin-only.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq, isNull, and, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAdminAuth, validateBody, type AdminContext } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";

const updateContactSchema = z.object({
  phoneNumber: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{6,14}$/, "Phone number must be in E.164 format, e.g. +2348012345678")
    .nullable(),
  smsEnabled: z.boolean(),
});

export const PUT = withAdminAuth(
  async (req: NextRequest, { params }: { params: { userId: string }; auth: AdminContext }) => {
    try {
      const { userId } = (await params) as { userId: string };
      const body = await validateBody(req, updateContactSchema);

      const orm = await getDb();
      const [userRow] = await orm
        .select({ id: schema.users.id, isAdmin: schema.users.isAdmin, isModerator: schema.users.isModerator })
        .from(schema.users)
        .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
        .limit(1);
      if (!userRow || (!userRow.isAdmin && !userRow.isModerator)) {
        throw badRequest("User is not an admin or moderator.", "NOT_STAFF");
      }

      // NOTE: `staff_alert_contacts` is not present in lib/db/schema.ts
      // (schema/DB mismatch — reported upstream), so this uses Drizzle's
      // `sql` tag directly rather than the query builder.
      await orm.execute(sql`
        INSERT INTO staff_alert_contacts (user_id, phone_number, sms_enabled, updated_at)
        VALUES (${userId}, ${body.phoneNumber}, ${body.smsEnabled}, NOW())
        ON CONFLICT (user_id) DO UPDATE SET phone_number = ${body.phoneNumber}, sms_enabled = ${body.smsEnabled}, updated_at = NOW()
      `);

      return NextResponse.json({ success: true, data: { userId }, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
