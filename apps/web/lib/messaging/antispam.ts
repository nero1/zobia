/**
 * lib/messaging/antispam.ts
 *
 * Anti-spam content filter for Zobia Social.
 *
 * IMPORTANT — SECURITY SENSITIVE:
 * The filtering in this module is intentionally silent. When content is
 * stripped, NO error is returned to the sender and NO notification is issued.
 * This prevents bad actors from probing the filter.
 *
 * Rules (per PRD):
 *  - DMs:     phone numbers, links, and email addresses are stripped until
 *             the recipient has sent at least TWO replies.
 *  - Rooms / public areas: same patterns are always stripped UNLESS the
 *             sender is a Room or Group admin.
 *
 * DO NOT expose these rules in public-facing documentation or UI text.
 */

// ---------------------------------------------------------------------------
// Regex patterns
// ---------------------------------------------------------------------------

/**
 * Matches international phone numbers in common formats.
 * Covers:
 *  - +234 801 234 5678  (international prefix)
 *  - 0801 234 5678      (local Nigerian format)
 *  - (555) 123-4567     (US format)
 *  - 555.123.4567
 *  - 5551234567         (bare 10-digit)
 *
 * The pattern intentionally avoids matching short numbers (< 7 digits)
 * to reduce false positives on prices and other numeric strings.
 */
export const PHONE_REGEX =
  /(?:\+?\d{1,3}[\s\-.])?(?:\(?\d{1,4}\)?[\s\-.]?)?\d{3,4}[\s\-.]?\d{3,4}[\s\-.]?\d{3,4}/g;

/**
 * Matches RFC 5321-compliant email addresses.
 * Uses a deliberately broad local-part to avoid false negatives.
 */
export const EMAIL_REGEX =
  /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}/g;

/**
 * Matches URLs — http/https/ftp/www-prefixed links and bare domains with
 * a TLD suffix. Avoids matching plain numbers like "1.5".
 *
 * Covers:
 *  - https://example.com/path?q=1
 *  - http://sub.domain.co.uk
 *  - www.example.com
 *  - ftp://files.example.com
 */
export const URL_REGEX =
  /(?:https?|ftp):\/\/[^\s/$.?#].[^\s]*|www\.[a-zA-Z0-9\-]+\.[a-zA-Z]{2,}(?:\/[^\s]*)?|\b[a-zA-Z0-9\-]+\.(?:com|org|net|io|co|uk|ng|app|dev|xyz|info|biz|me|tv|us|ca|au|de|fr|jp|in|br|ru|cn|ai)\b(?:\/[^\s]*)?/gi;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Strip all phone numbers, emails, and URLs from a string.
 *
 * @param content - Raw message content
 * @returns Content with all contact-info patterns removed
 */
function stripContactInfo(content: string): string {
  // Order matters: strip URLs first (they may contain @ signs),
  // then emails, then phone numbers.
  // Reset lastIndex on ALL global regexes before each replace to prevent
  // stale state from a previous call causing missed matches (BUG-SEC-08).
  URL_REGEX.lastIndex = 0;
  EMAIL_REGEX.lastIndex = 0;
  PHONE_REGEX.lastIndex = 0;
  return content
    .replace(URL_REGEX, "")
    .replace(EMAIL_REGEX, "")
    .replace(PHONE_REGEX, (match) => {
      // Only strip if the match looks like a real phone number (≥ 7 numeric chars)
      const digits = match.replace(/\D/g, "");
      return digits.length >= 7 ? "" : match;
    })
    .replace(/\s{2,}/g, " ") // collapse leftover whitespace
    .trim();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Filter content for a direct-message conversation.
 *
 * Phone numbers, links, and email addresses are silently removed when
 * `replyCountFromRecipient` is fewer than 2 and the sender is not an admin.
 *
 * The caller receives the sanitised string; the sender receives no indication
 * that anything was removed.
 *
 * @param content                 - Original message text from the sender
 * @param replyCountFromRecipient - How many times the recipient has replied in
 *                                  this conversation so far
 * @param senderIsAdmin           - When true, bypasses all filters (platform admins)
 * @returns Filtered message content (may be empty string if all content was stripped)
 */
export function filterDMContent(
  content: string,
  replyCountFromRecipient: number,
  senderIsAdmin = false
): string {
  if (senderIsAdmin) return content;
  if (replyCountFromRecipient >= 2) return content;

  return stripContactInfo(content);
}

/**
 * Filter content for public areas (Rooms, public group chats).
 *
 * Phone numbers, links, and email addresses are always stripped unless the
 * sender is a Room or Group admin/moderator.
 *
 * @param content       - Original message text from the sender
 * @param senderIsAdmin - True if the sender is a Room or Group admin/moderator
 * @returns Filtered message content
 */
export function filterPublicContent(
  content: string,
  senderIsAdmin: boolean
): string {
  if (senderIsAdmin) return content;

  return stripContactInfo(content);
}

/**
 * Determine whether a given message content contains any contact information
 * that would be subject to filtering.
 *
 * Useful for logging/metrics pipelines (never expose to end users).
 *
 * @param content - Message content to inspect
 * @returns True if the content contains phone numbers, emails, or URLs
 */
export function containsContactInfo(content: string): boolean {
  // Reset lastIndex for ALL global regexes before testing (BUG-SEC-08)
  URL_REGEX.lastIndex = 0;
  EMAIL_REGEX.lastIndex = 0;
  PHONE_REGEX.lastIndex = 0;

  if (URL_REGEX.test(content)) return true;
  if (EMAIL_REGEX.test(content)) return true;

  // Phone check: only count if 7+ consecutive digits are present
  const phoneMatches = content.match(PHONE_REGEX) ?? [];
  return phoneMatches.some((m) => m.replace(/\D/g, "").length >= 7);
}
