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
import { db } from "@/lib/db";
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

      const { rows: userRows } = await db.query<{ id: string; is_admin: boolean; is_moderator: boolean }>(
        `SELECT id, is_admin, is_moderator FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [userId]
      );
      if (userRows.length === 0 || (!userRows[0].is_admin && !userRows[0].is_moderator)) {
        throw badRequest("User is not an admin or moderator.", "NOT_STAFF");
      }

      await db.query(
        `INSERT INTO staff_alert_contacts (user_id, phone_number, sms_enabled, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (user_id) DO UPDATE SET phone_number = $2, sms_enabled = $3, updated_at = NOW()`,
        [userId, body.phoneNumber, body.smsEnabled]
      );

      return NextResponse.json({ success: true, data: { userId }, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
