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
import { and, asc, desc, eq, isNull, or } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";

export const GET = withAdminAuth(async () => {
  try {
    const orm = await getDb();

    const rows = await orm
      .select({
        id: schema.users.id,
        username: schema.users.username,
        is_admin: schema.users.isAdmin,
        is_moderator: schema.users.isModerator,
        phone_number: schema.staffAlertContacts.phoneNumber,
        sms_enabled: schema.staffAlertContacts.smsEnabled,
      })
      .from(schema.users)
      .leftJoin(schema.staffAlertContacts, eq(schema.staffAlertContacts.userId, schema.users.id))
      .where(
        and(
          or(eq(schema.users.isAdmin, true), eq(schema.users.isModerator, true)),
          eq(schema.users.isBanned, false),
          isNull(schema.users.deletedAt)
        )
      )
      .orderBy(desc(schema.users.isAdmin), asc(schema.users.username));

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
