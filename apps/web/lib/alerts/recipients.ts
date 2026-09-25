/**
 * lib/alerts/recipients.ts
 *
 * Resolves who gets notified for a given alert: admins, moderators, or both,
 * with each recipient's contact info (email, telegram_id, phone for SMS).
 *
 * A single query per dispatch — deliberately not cached in Redis (admin/mod
 * headcount is tiny and this only runs when an alert actually fires, not on
 * every request), keeping to the project's low-Redis-call budget.
 */

import { and, eq, isNull, or, sql } from "drizzle-orm";
import { schema, type DbOrTx } from "@/lib/db/drizzle";

export interface AlertRecipient {
  userId: string;
  type: "admin" | "moderator";
  email: string | null;
  telegramId: string | null;
  phoneNumber: string | null;
  smsEnabled: boolean;
}

/**
 * Fetch admins and/or moderators eligible to receive an alert.
 *
 * @param includeAdmins    - Include users with is_admin = true
 * @param includeModerators - Include users with is_moderator = true (sitewide Platform Mods only — guild-scoped Forum Mods are not staff for this purpose)
 */
export async function resolveAlertRecipients(
  db: DbOrTx,
  includeAdmins: boolean,
  includeModerators: boolean
): Promise<AlertRecipient[]> {
  if (!includeAdmins && !includeModerators) return [];

  const roleConditions = [];
  if (includeAdmins) roleConditions.push(eq(schema.users.isAdmin, true));
  if (includeModerators) roleConditions.push(eq(schema.users.isModerator, true));

  const rows = await db
    .select({
      id: schema.users.id,
      isAdmin: schema.users.isAdmin,
      isModerator: schema.users.isModerator,
      email: schema.users.email,
      telegramId: schema.users.telegramId,
      phoneNumber: schema.staffAlertContacts.phoneNumber,
      smsEnabled: schema.staffAlertContacts.smsEnabled,
    })
    .from(schema.users)
    .leftJoin(schema.staffAlertContacts, eq(schema.staffAlertContacts.userId, schema.users.id))
    .where(
      and(
        or(...roleConditions),
        eq(schema.users.isBanned, false),
        sql`COALESCE(${schema.users.isSuspended}, false) = false`,
        isNull(schema.users.deletedAt)
      )
    );

  return rows.map((row) => ({
    userId: row.id,
    type: row.isAdmin ? "admin" : "moderator",
    email: row.email,
    telegramId: row.telegramId,
    phoneNumber: row.phoneNumber,
    smsEnabled: row.smsEnabled ?? false,
  }));
}
