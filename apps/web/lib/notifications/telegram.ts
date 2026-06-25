/**
 * lib/notifications/telegram.ts
 *
 * Telegram bot notification sender.
 *
 * Uses the Telegram Bot API to send DMs to users who have linked
 * their Telegram account. All sends are fire-and-forget — a Telegram
 * failure will never propagate to the caller.
 *
 * @module lib/notifications/telegram
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of a Telegram send attempt (for internal logging only). */
interface TelegramSendResult {
  ok: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

/**
 * Make a Telegram Bot API call to sendMessage.
 *
 * @param telegramId - Telegram user ID (numeric, as string)
 * @param text       - Message text (plain text or HTML with parse_mode=HTML)
 * @returns Result object (never throws)
 */
async function _sendTelegramMessage(
  telegramId: string,
  text: string
): Promise<TelegramSendResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    logger.warn("[telegram] TELEGRAM_BOT_TOKEN not set — skipping send");
    return { ok: false, error: "no_token" };
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: telegramId,
        text: text.slice(0, 4096), // Telegram message length cap
        parse_mode: "HTML",
      }),
      signal: AbortSignal.timeout(10_000), // 10 s timeout
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      logger.error({ status: response.status, body }, `[telegram] API error for user ${telegramId}`);
      return { ok: false, error: `http_${response.status}` };
    }

    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err: message }, `[telegram] Send failed for user ${telegramId}:`);
    return { ok: false, error: message };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send a DM to a user via the Telegram bot.
 *
 * This is fire-and-forget — the function returns immediately after
 * launching the send. Any failure is logged but never thrown.
 *
 * @param telegramId - The user's Telegram numeric ID
 * @param text       - Message text (plain or HTML, max 4096 chars)
 */
export function sendTelegramMessage(telegramId: string, text: string): void {
  // Fire-and-forget: deliberately not awaited
  _sendTelegramMessage(telegramId, text).then((result) => {
    if (!result.ok) {
      logger.warn({ telegramId, error: result.error }, `[telegram] Message delivery failed — continuing`);
    }
  });
}

/**
 * Send Telegram messages to multiple users concurrently.
 *
 * Like sendTelegramMessage, this is fire-and-forget. Individual failures
 * do not affect other recipients.
 *
 * @param recipients - Array of { telegramId, text } pairs
 */
export function sendBulkTelegramMessages(
  recipients: Array<{ telegramId: string; text: string }>
): void {
  for (const { telegramId, text } of recipients) {
    sendTelegramMessage(telegramId, text);
  }
}
