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

import type { DatabaseAdapter, TransactionClient } from "@/lib/db/interface";

export interface AlertRecipient {
  userId: string;
  type: "admin" | "moderator";
  email: string | null;
  telegramId: string | null;
  phoneNumber: string | null;
  smsEnabled: boolean;
}

interface RecipientRow {
  id: string;
  is_admin: boolean;
  is_moderator: boolean;
  email: string | null;
  telegram_id: string | null;
  phone_number: string | null;
  sms_enabled: boolean | null;
}

/**
 * Fetch admins and/or moderators eligible to receive an alert.
 *
 * @param includeAdmins    - Include users with is_admin = true
 * @param includeModerators - Include users with is_moderator = true (sitewide Platform Mods only — guild-scoped Forum Mods are not staff for this purpose)
 */
export async function resolveAlertRecipients(
  db: DatabaseAdapter | TransactionClient,
  includeAdmins: boolean,
  includeModerators: boolean
): Promise<AlertRecipient[]> {
  if (!includeAdmins && !includeModerators) return [];

  const conditions: string[] = [];
  if (includeAdmins) conditions.push("u.is_admin = true");
  if (includeModerators) conditions.push("u.is_moderator = true");

  const { rows } = await db.query<RecipientRow>(
    `SELECT u.id, u.is_admin, u.is_moderator, u.email, u.telegram_id,
            sac.phone_number, sac.sms_enabled
     FROM users u
     LEFT JOIN staff_alert_contacts sac ON sac.user_id = u.id
     WHERE (${conditions.join(" OR ")})
       AND COALESCE(u.is_banned, false) = false
       AND COALESCE(u.is_suspended, false) = false
       AND u.deleted_at IS NULL`
  );

  return rows.map((row) => ({
    userId: row.id,
    type: row.is_admin ? "admin" : "moderator",
    email: row.email,
    telegramId: row.telegram_id,
    phoneNumber: row.phone_number,
    smsEnabled: row.sms_enabled ?? false,
  }));
}
