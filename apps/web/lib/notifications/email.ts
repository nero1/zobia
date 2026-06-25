/**
 * lib/notifications/email.ts
 *
 * Mailgun email sender (REST API, no SDK).
 * Reads MAILGUN_API_KEY and MAILGUN_DOMAIN from env.
 */

import { safeFetch } from "@/lib/security/ssrf";
import { getManifestValue } from "@/lib/manifest";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EmailPayload {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check that required Mailgun environment variables are set.
 * Returns false and logs a warning if any are missing.
 */
function hasMailgunConfig(): boolean {
  const apiKey = process.env.MAILGUN_API_KEY;
  const domain = process.env.MAILGUN_DOMAIN;

  if (!apiKey || !domain) {
    logger.warn("[email] MAILGUN_API_KEY or MAILGUN_DOMAIN is not set — email sending is disabled.");
    return false;
  }
  return true;
}

/**
 * Build the Basic Auth header value for Mailgun.
 * Mailgun uses "api:<key>" as the credential.
 */
function buildMailgunAuth(): string {
  const apiKey = process.env.MAILGUN_API_KEY ?? "";
  const credential = `api:${apiKey}`;
  return `Basic ${Buffer.from(credential).toString("base64")}`;
}

/**
 * Derive the sender address from the configured domain.
 * Uses "noreply@<domain>" as the from address.
 */
function buildFromAddress(): string {
  const domain = process.env.MAILGUN_DOMAIN ?? "";
  return `Zobia <noreply@${domain}>`;
}

/**
 * POST a single email message to the Mailgun REST API.
 * All errors are caught and logged; never thrown.
 *
 * @param payload - Email fields: to, subject, text, optional html
 */
async function postToMailgun(payload: EmailPayload): Promise<void> {
  const domain = process.env.MAILGUN_DOMAIN ?? "";
  const url = `https://api.mailgun.net/v3/${domain}/messages`;

  const form = new URLSearchParams();
  form.append("from", buildFromAddress());
  form.append("to", payload.to);
  form.append("subject", payload.subject);
  form.append("text", payload.text);
  if (payload.html) {
    form.append("html", payload.html);
  }

  try {
    const response = await safeFetch(url, {
      method: "POST",
      headers: {
        Authorization: buildMailgunAuth(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    }, { requireAllowlist: true });

    if (!response.ok) {
      const text = await response.text().catch(() => "(unreadable)");
      logger.error({ status: response.status, to: payload.to, body: text }, `[email] Mailgun error`);
    }
  } catch (err) {
    logger.error({ err: err }, `[email] Failed to send email to ${payload.to}:`);
  }
}

/**
 * Sleep for the given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send a single transactional email via Mailgun.
 *
 * If MAILGUN_API_KEY or MAILGUN_DOMAIN are not set, this is a graceful no-op.
 * All errors are caught and logged; never thrown.
 *
 * @param to      - Recipient email address
 * @param subject - Email subject line
 * @param text    - Plain-text email body
 * @param html    - Optional HTML email body
 */
/**
 * Read the platform-wide email_all_enabled flag from x_manifest via the
 * manifest cache (Redis + in-process) rather than a direct DB query.
 * Returns true (enabled) if the flag is not set or set to "true".
 */
async function isPlatformEmailEnabled(): Promise<boolean> {
  try {
    const value = await getManifestValue("email_all_enabled");
    return (value ?? "true") !== "false";
  } catch {
    return true; // fail open — don't silence emails if manifest is unavailable
  }
}

/**
 * Email notification type categories for per-type opt-out (PRD §email).
 * Maps to user_email_preferences.notification_type.
 */
export type EmailNotificationType =
  | "marketing"
  | "reengagement"
  | "security"
  | "transactional"
  | "guild"
  | "season"
  | "moderation"
  | "referral"
  | "council";

/**
 * Check if a user has opted out of a specific email notification type.
 * Returns true (enabled) if no preference found (opt-in by default).
 * Security emails cannot be disabled.
 *
 * FIX-E4 (BUG-20): Accepts userId and queries user_email_preferences directly
 * by user_id, avoiding an unnecessary JOIN through the users table on email.
 */
async function isEmailTypeEnabledForUser(
  userId: string,
  type: string,
  db: import("@/lib/db/interface").DatabaseAdapter
): Promise<boolean> {
  if (!type) return true;
  if (type === "security") return true; // security emails always sent

  try {
    const { rows } = await db.query<{ is_enabled: boolean }>(
      `SELECT is_enabled FROM user_email_preferences WHERE user_id = $1 AND notification_type = $2 LIMIT 1`,
      [userId, type]
    );
    return rows.length === 0 || rows[0].is_enabled;
  } catch {
    return true;
  }
}

export async function sendEmail(
  to: string,
  subject: string,
  text: string,
  html?: string,
  notificationType?: EmailNotificationType,
  userId?: string
): Promise<void> {
  if (!hasMailgunConfig()) return;
  if (!(await isPlatformEmailEnabled())) return;

  // Warn when a notification type is specified without a userId — per-user opt-out
  // cannot be checked, so the email will bypass the user's preferences.
  if (notificationType && !userId && notificationType !== "security" && notificationType !== "transactional") {
    logger.warn(`[email] sendEmail called with notificationType='${notificationType}' but no userId — user opt-out not checked for ${to}`);
  }

  if (userId && notificationType) {
    const { db } = await import("@/lib/db");
    if (!(await isEmailTypeEnabledForUser(userId, notificationType, db))) return;
  }

  await postToMailgun({ to, subject, text, html });
}

/**
 * Send a batch of emails sequentially via Mailgun.
 *
 * Inserts a 100ms delay between sends to stay within Mailgun rate limits.
 * If MAILGUN_API_KEY or MAILGUN_DOMAIN are not set, this is a graceful no-op.
 * All errors are caught and logged; never thrown.
 *
 * @param emails - Array of email payloads to send in order
 */
export async function sendEmailBatch(
  emails: Array<{ to: string; subject: string; text: string; html?: string; notificationType?: EmailNotificationType; userId?: string }>
): Promise<void> {
  if (!hasMailgunConfig()) return;
  if (emails.length === 0) return;
  if (!(await isPlatformEmailEnabled())) return;

  const { db } = await import("@/lib/db");
  for (let i = 0; i < emails.length; i++) {
    const email = emails[i];
    if (email.userId && email.notificationType) {
      if (!(await isEmailTypeEnabledForUser(email.userId, email.notificationType, db))) {
        continue;
      }
    }
    await postToMailgun(email);

    // Rate-limit gap between sends (skip after last)
    if (i < emails.length - 1) {
      await sleep(100);
    }
  }
}
