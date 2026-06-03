/**
 * lib/notifications/email.ts
 *
 * Mailgun email sender (REST API, no SDK).
 * Reads MAILGUN_API_KEY and MAILGUN_DOMAIN from env.
 */

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
    console.warn(
      "[email] MAILGUN_API_KEY or MAILGUN_DOMAIN is not set — email sending is disabled."
    );
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
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: buildMailgunAuth(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "(unreadable)");
      console.error(
        `[email] Mailgun returned ${response.status} for ${payload.to}: ${text}`
      );
    }
  } catch (err) {
    console.error(`[email] Failed to send email to ${payload.to}:`, err);
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
 * Read the platform-wide email_all_enabled flag from x_manifest.
 * Returns true (enabled) if the flag is not set or set to "true".
 * This is called lazily per-send to respect real-time admin changes.
 */
async function isPlatformEmailEnabled(): Promise<boolean> {
  try {
    const { db } = await import("@/lib/db");
    const { rows } = await db.query<{ value: string }>(
      `SELECT value FROM x_manifest WHERE key = 'email_all_enabled' LIMIT 1`
    );
    return (rows[0]?.value ?? "true") !== "false";
  } catch {
    return true; // fail open — don't silence emails if manifest is unavailable
  }
}

export async function sendEmail(
  to: string,
  subject: string,
  text: string,
  html?: string
): Promise<void> {
  if (!hasMailgunConfig()) return;
  if (!(await isPlatformEmailEnabled())) return;

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
  emails: Array<{ to: string; subject: string; text: string; html?: string }>
): Promise<void> {
  if (!hasMailgunConfig()) return;
  if (emails.length === 0) return;
  if (!(await isPlatformEmailEnabled())) return;

  for (let i = 0; i < emails.length; i++) {
    const email = emails[i];
    await postToMailgun(email);

    // Rate-limit gap between sends (skip after last)
    if (i < emails.length - 1) {
      await sleep(100);
    }
  }
}
