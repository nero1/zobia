/**
 * lib/contact/service.ts
 *
 * Site-wide "Contact Us" page (app/contact) — backend for submissions.
 * Mirrors lib/blogs/service.ts `submitContactMessage`'s storage/notification
 * pattern (a dedicated table + an in-app `notifications` row), the closest
 * existing precedent for "a visitor sends a message that someone should see
 * in an inbox" — reused rather than inventing a parallel delivery mechanism.
 * Unlike the per-blog form, there's no single blog owner to notify, so every
 * current admin (`users.is_admin = true`) gets a notification instead.
 */

import { db } from "@/lib/db";
import { insertNotificationBatch } from "@/lib/notifications/insert";
import { logger } from "@/lib/logger";

export interface SubmitSiteContactMessageInput {
  senderUserId?: string | null;
  senderName?: string | null;
  senderEmail?: string | null;
  subject?: string | null;
  message: string;
}

export async function submitSiteContactMessage(
  input: SubmitSiteContactMessageInput
): Promise<{ id: string }> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO site_contact_messages (sender_user_id, sender_name, sender_email, subject, message)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      input.senderUserId ?? null,
      input.senderName?.trim() || null,
      input.senderEmail?.trim() || null,
      input.subject?.trim() || null,
      input.message.trim(),
    ]
  );

  // Best-effort: notify admins in-app. Never block/fail the submission on this.
  try {
    const { rows: adminRows } = await db.query<{ id: string }>(
      `SELECT id FROM users WHERE is_admin = true AND deleted_at IS NULL`
    );
    const adminIds = adminRows.map((r) => r.id);
    if (adminIds.length > 0) {
      await insertNotificationBatch(
        db,
        adminIds,
        "site_contact_message",
        input.subject?.trim() ? `New Contact Us message: ${input.subject.trim()}` : "New Contact Us message",
        input.message.trim().slice(0, 140),
        { messageId: rows[0].id }
      );
    }
  } catch (err) {
    logger.error({ err }, "[contact/service] failed to notify admins of a site contact message");
  }

  return { id: rows[0].id };
}

// ---------------------------------------------------------------------------
// Admin inbox — /gate44/contact-messages
// ---------------------------------------------------------------------------

export interface SiteContactMessageRow {
  id: string;
  sender_name: string | null;
  sender_email: string | null;
  sender_username: string | null;
  subject: string | null;
  message: string;
  is_read: boolean;
  created_at: string;
}

/** Platform-level inbox — every admin can read it, mirroring lib/blogs/service.ts's listContactMessages shape (no per-owner scoping needed here). */
export async function listSiteContactMessages(): Promise<SiteContactMessageRow[]> {
  const { rows } = await db.query<SiteContactMessageRow>(
    `SELECT m.id, m.sender_name, m.sender_email, u.username AS sender_username, m.subject, m.message, m.is_read, m.created_at
     FROM site_contact_messages m LEFT JOIN users u ON u.id = m.sender_user_id
     ORDER BY m.created_at DESC LIMIT 200`
  );
  return rows;
}

export async function markSiteContactMessageRead(messageId: string): Promise<void> {
  await db.query(`UPDATE site_contact_messages SET is_read = TRUE WHERE id = $1`, [messageId]);
}
