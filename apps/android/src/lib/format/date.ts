/**
 * src/lib/format/date.ts
 *
 * Mirrors apps/web's lib/format/date.ts — "3 Jul 2024" style short date
 * formatter used across the blogs UI for consistency between web and app.
 */

export function formatShortDate(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
