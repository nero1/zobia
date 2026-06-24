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
 * Returns a fresh RegExp that matches URLs — http/https/ftp/www-prefixed links only.
 *
 * BUG-SPAM-01 FIX: the previous pattern matched bare domain-like tokens (e.g.
 * "word.io", "game.app") causing false positives on ordinary English words.
 * The new pattern REQUIRES an explicit protocol prefix (https?://, ftp://) OR
 * a "www." prefix. Bare "domain.tld" tokens are intentionally NOT matched since
 * they produce too many false positives to be useful.
 */
export function getUrlRegex(): RegExp {
  // Word-boundary before "www." prevents matching mid-word tokens like "notawww.example.com".
  return /(?:https?|ftp):\/\/[^\s/$.?#][^\s]*|(?<![a-zA-Z0-9])www\.[a-zA-Z0-9\-]+\.[a-zA-Z0-9\-]{2,}(?:\/[^\s]*)?/gi;
}

/**
 * Returns a fresh RegExp that matches known spam/phishing link-sharing domains.
 * These are blocked regardless of context in both DMs and public rooms.
 *
 * Covers: Discord invites, common URL shorteners, WhatsApp group/contact links.
 */
export function getSpamDomainRegex(): RegExp {
  return /\b(?:discord\.gg|bit\.ly|t\.co|tinyurl\.com|ow\.ly|buff\.ly|rebrand\.ly|chat\.whatsapp\.com|wa\.me)\b(?:\/[^\s]*)?/gi;
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
// BUG-002 FIX: unified minimum digit threshold used by both stripContactInfo
// and containsContactInfo so the two functions agree on what counts as a phone
// number.  Previously stripContactInfo used 10 while containsContactInfo used 7,
// meaning a 7-9 digit sequence would be flagged by containsContactInfo but not
// stripped — leaving the number in the message.
const MIN_PHONE_DIGITS = 7;

function stripContactInfo(content: string): string {
  // Order matters: strip URLs first (they may contain @ signs),
  // then emails, then phone numbers.
  // Each getXxxRegex() call returns a new instance so lastIndex is always 0.
  return content
    .replace(getSpamDomainRegex(), "")
    .replace(getUrlRegex(), "")
    .replace(getEmailRegex(), "")
    .replace(getPhoneRegex(), (match) => {
      // Only strip if the match has ≥ MIN_PHONE_DIGITS numeric chars.
      const digits = match.replace(/\D/g, "");
      return digits.length >= MIN_PHONE_DIGITS ? "" : match;
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

  const phoneMatches = content.match(getPhoneRegex()) ?? [];
  return phoneMatches.some((m) => m.replace(/\D/g, "").length >= MIN_PHONE_DIGITS);
}
