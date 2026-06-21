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
// Regex factories (BUG-REGEX-01)
// ---------------------------------------------------------------------------
// Exported as factory functions rather than singleton RegExp instances so that
// callers always get a fresh object with lastIndex = 0. Singleton globals with
// the /g flag are stateful — external callers that forget to reset lastIndex
// before reuse will silently miss matches.

/**
 * Returns a fresh RegExp that matches international phone numbers.
 * Covers:
 *  - +234 801 234 5678  (international prefix)
 *  - 0801 234 5678      (local Nigerian format with leading 0)
 *  - (555) 123-4567     (US format with area code parens)
 *
 * BUG-ANTISPAM-01 FIX: the previous pattern matched ANY nine-plus-digit
 * sequence in three groups (e.g. "Score: 234 567 891"), causing false
 * positives on reference numbers, game scores, and prices. The new pattern
 * requires the number to begin with an internationally recognised indicator:
 *  - `+` followed by a country code (international format), OR
 *  - a leading `0` (Nigerian and many other local formats), OR
 *  - an area code in parentheses `(NNN)`
 * Bare digit sequences without any of these prefixes are NOT treated as
 * phone numbers.
 *
 * BUG-L02: \b word boundary prevents ISO date strings like 2026-06-20 from
 * being partially matched.
 */
export function getPhoneRegex(): RegExp {
  return /(?:\+\d{1,3}[\s\-.]?\(?\d{1,4}\)?[\s\-.]?\d{3,4}[\s\-.]?\d{3,4}[\s\-.]?\d{0,4}|0\d{1}[\s\-.]?\d{3,4}[\s\-.]?\d{3,4}[\s\-.]?\d{0,4}|\(\d{2,4}\)[\s\-.]?\d{3,4}[\s\-.]?\d{3,4})\b/g;
}

/**
 * Returns a fresh RegExp that matches RFC 5321-compliant email addresses.
 */
export function getEmailRegex(): RegExp {
  return /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}/g;
}

/**
 * Returns a fresh RegExp that matches URLs — http/https/ftp/www-prefixed links
 * and bare domains with a known TLD suffix.
 */
export function getUrlRegex(): RegExp {
  return /(?:https?|ftp):\/\/[^\s/$.?#].[^\s]*|www\.[a-zA-Z0-9\-]+\.[a-zA-Z0-9\-]{2,}(?:\/[^\s]*)?|\b(?:xn--[a-zA-Z0-9\-]+|[a-zA-Z0-9\-]+)\.(?:xn--[a-zA-Z0-9\-]+|com|org|net|io|co|uk|ng|app|dev|xyz|info|biz|me|tv|us|ca|au|de|fr|jp|in|br|ru|cn|ai)\b(?:\/[^\s]*)?/gi;
}

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
  // Each getXxxRegex() call returns a new instance so lastIndex is always 0.
  return content
    .replace(getUrlRegex(), "")
    .replace(getEmailRegex(), "")
    .replace(getPhoneRegex(), (match) => {
      // Only strip if the match has ≥ 10 numeric chars (minimum for any valid
      // international phone number). This is a secondary guard against edge-case
      // false positives not caught by the regex prefix requirement.
      const digits = match.replace(/\D/g, "");
      return digits.length >= 10 ? "" : match;
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
  if (getUrlRegex().test(content)) return true;
  if (getEmailRegex().test(content)) return true;

  // Phone check: only count if 7+ consecutive digits are present
  const phoneMatches = content.match(getPhoneRegex()) ?? [];
  return phoneMatches.some((m) => m.replace(/\D/g, "").length >= 7);
}
