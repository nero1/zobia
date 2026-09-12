/**
 * lib/notifications/sms.ts
 *
 * SMS sender for admin/mod CRITICAL alert paging ONLY (Level 1/2 alerts, see
 * lib/alerts/dispatch.ts). The platform has an explicit no-SMS policy
 * everywhere else (PRD §16 "No SMS re-engagement of any kind", §22 "No phone
 * number or SMS authentication. No SMS anything.") — this is the one
 * deliberate exception, and it is never used for user-facing messaging,
 * auth, or marketing.
 *
 * Provider-abstracted (SmsProvider interface) so a second/backup SMS service
 * can be added later without touching call sites — set SMS_PROVIDER to
 * switch. Starts with Termii (pay-as-you-go, has a free tier, good African
 * carrier coverage) per project's zero/near-zero-cost deployment goal.
 *
 * Fire-and-forget is NOT used here (unlike telegram.ts) because
 * lib/alerts/dispatch.ts needs to know whether the send succeeded, to log it
 * in alert_notification_log and decide whether to retry on the next
 * escalation tick. Callers should still never let an SMS failure block
 * anything else — always awaited via Promise.allSettled.
 */

import { logger } from "@/lib/logger";
import { safeFetch } from "@/lib/security/ssrf";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SmsSendResult {
  ok: boolean;
  error?: string;
}

export interface SmsProvider {
  readonly name: string;
  send(to: string, message: string): Promise<SmsSendResult>;
}

// ---------------------------------------------------------------------------
// Termii provider
// ---------------------------------------------------------------------------

const TERMII_SEND_URL = "https://api.ng.termii.com/api/sms/send";
/** Termii's plain "generic" SMS channel — no DND bypass fees, fine for staff alerting. */
const TERMII_CHANNEL = "generic";

class TermiiProvider implements SmsProvider {
  readonly name = "termii";

  async send(to: string, message: string): Promise<SmsSendResult> {
    const apiKey = process.env.TERMII_API_KEY;
    const senderId = process.env.TERMII_SENDER_ID;
    if (!apiKey || !senderId) {
      logger.warn("[sms/termii] TERMII_API_KEY or TERMII_SENDER_ID not set — skipping send");
      return { ok: false, error: "not_configured" };
    }

    try {
      const response = await safeFetch(
        TERMII_SEND_URL,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to,
            from: senderId,
            sms: message.slice(0, 640), // ~4 concatenated SMS segments
            type: "plain",
            channel: TERMII_CHANNEL,
            api_key: apiKey,
          }),
        },
        { requireAllowlist: true }
      );

      const body = (await response.json().catch(() => ({}))) as { code?: string; message?: string };

      if (!response.ok) {
        logger.error({ status: response.status, body }, `[sms/termii] API error for ${to}`);
        return { ok: false, error: `http_${response.status}` };
      }

      return { ok: true };
    } catch (err) {
      const message2 = err instanceof Error ? err.message : String(err);
      logger.error({ err: message2 }, `[sms/termii] Send failed for ${to}:`);
      return { ok: false, error: message2 };
    }
  }
}

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------

const PROVIDERS: Record<string, SmsProvider> = {
  termii: new TermiiProvider(),
};

/**
 * Resolve the active SMS provider from the manifest-configured key
 * (falls back to SMS_PROVIDER env var, then "termii"). Add a new provider by
 * implementing SmsProvider and registering it in PROVIDERS above.
 */
function getSmsProvider(providerKey?: string): SmsProvider {
  const key = providerKey ?? process.env.SMS_PROVIDER ?? "termii";
  return PROVIDERS[key] ?? PROVIDERS.termii;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send a single SMS. Never throws — always returns a result object so the
 * caller (lib/alerts/dispatch.ts) can log delivery status per recipient.
 *
 * @param to          - E.164 phone number (e.g. "+2348012345678")
 * @param message     - SMS body (truncated to ~640 chars / 4 segments)
 * @param providerKey - Optional override, otherwise reads manifest/env default
 */
export async function sendSms(to: string, message: string, providerKey?: string): Promise<SmsSendResult> {
  const provider = getSmsProvider(providerKey);
  return provider.send(to, message);
}

/**
 * Send the same SMS to multiple recipients concurrently.
 * Individual failures do not affect other recipients.
 */
export async function sendBulkSms(
  recipients: Array<{ to: string; message: string }>,
  providerKey?: string
): Promise<Array<{ to: string; result: SmsSendResult }>> {
  const provider = getSmsProvider(providerKey);
  const settled = await Promise.allSettled(
    recipients.map(async (r) => ({ to: r.to, result: await provider.send(r.to, r.message) }))
  );
  return settled.map((s, i) =>
    s.status === "fulfilled" ? s.value : { to: recipients[i].to, result: { ok: false, error: "unexpected_error" } }
  );
}
