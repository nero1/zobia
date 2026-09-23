/**
 * lib/format/date.ts
 *
 * Shared short date formatter — "3 Jul 2024" style (day, no leading zero;
 * abbreviated month; full year; no time). Blogs previously used a mix of
 * bare `toLocaleDateString()` calls with no fixed locale/format, which
 * renders inconsistently across viewers' browser locales. Use this
 * wherever a blog-related date is displayed.
 */

export function formatShortDate(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Shared short date+time formatter — "3 Jul 2024, 14:30" style. Use wherever
 * an exact moment (not just a day) needs to be shown, e.g. when a suspension
 * lifts — consistent across viewers regardless of browser locale.
 */
export function formatShortDateTime(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
