export const dynamic = 'force-dynamic';

/**
 * app/api/admin/alerts/contacts/route.ts
 *
 * GET /api/admin/alerts/contacts
 *
 * Lists every admin/moderator with their SMS contact info for Level 1/2
 * alert paging (staff_alert_contacts). Admin-only.
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";

interface StaffContactRow {
  id: string;
  username: string;
  is_admin: boolean;
  is_moderator: boolean;
  phone_number: string | null;
  sms_enabled: boolean | null;
}

export const GET = withAdminAuth(async () => {
  try {
    const { rows } = await db.query<StaffContactRow>(
      `SELECT u.id, u.username, u.is_admin, u.is_moderator,
              sac.phone_number, sac.sms_enabled
       FROM users u
       LEFT JOIN staff_alert_contacts sac ON sac.user_id = u.id
       WHERE (u.is_admin = true OR u.is_moderator = true)
         AND COALESCE(u.is_banned, false) = false
         AND u.deleted_at IS NULL
       ORDER BY u.is_admin DESC, u.username ASC`
    );

    return NextResponse.json({
      success: true,
      data: {
        contacts: rows.map((r) => ({
          userId: r.id,
          username: r.username,
          isAdmin: r.is_admin,
          isModerator: r.is_moderator,
          phoneNumber: r.phone_number,
          smsEnabled: r.sms_enabled ?? true,
        })),
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
