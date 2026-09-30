/**
 * lib/portals/constants.ts
 *
 * Section registry, reserved slugs and small pure helpers for Portals.
 * Pure (no DB / Redis) so it is trivially unit-testable and shared by the
 * page builder, the admin API and the admin UI.
 */

import type { PortalSectionConfig, PortalSectionKey } from "@zobia/shared/types";
import { PORTAL_SECTION_KEYS } from "@zobia/shared/utils";

/** Display order of every portal section; admins can reorder/hide per portal. Defined in shared so the web and Capacitor admin UIs use the same keys. */
export { PORTAL_SECTION_KEYS };

export const DEFAULT_PORTAL_SECTIONS: PortalSectionConfig[] = PORTAL_SECTION_KEYS.map((key) => ({ key, enabled: true }));

/**
 * Slugs that must never become portals: they would shadow future /h/<x>
 * sub-routes or read as system pages in the vanity `/#/<slug>` alias.
 */
export const RESERVED_PORTAL_SLUGS: ReadonlySet<string> = new Set([
  "all",
  "new",
  "trending",
  "explore",
  "search",
  "following",
  "mine",
  "admin",
  "gate44",
  "api",
  "zobia",
  "official",
]);

/**
 * Normalises any stored/submitted section config: drops unknown keys and
 * duplicates, keeps the submitted order, appends any missing section
 * (enabled) so a newly shipped section shows up on existing portals.
 */
export function normalizeSections(raw: unknown): PortalSectionConfig[] {
  const known = new Set<string>(PORTAL_SECTION_KEYS);
  const out: PortalSectionConfig[] = [];
  const seen = new Set<string>();
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") continue;
      const key = (entry as { key?: unknown }).key;
      if (typeof key !== "string" || !known.has(key) || seen.has(key)) continue;
      seen.add(key);
      out.push({ key: key as PortalSectionKey, enabled: (entry as { enabled?: unknown }).enabled !== false });
    }
  }
  for (const key of PORTAL_SECTION_KEYS) {
    if (!seen.has(key)) out.push({ key, enabled: true });
  }
  return out;
}

/** Title-cases a tag slug for display when an admin does not supply a title (edo_food -> Edo Food). */
export function titleFromSlug(slug: string): string {
  return slug
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** True while an admin boost window is open. A null bound means open-ended. */
export function isBoostActive(
  p: { boostWeight: number; boostStartsAt: Date | string | null; boostEndsAt: Date | string | null },
  now: number = Date.now()
): boolean {
  if (p.boostWeight <= 0) return false;
  if (p.boostStartsAt && new Date(p.boostStartsAt).getTime() > now) return false;
  if (p.boostEndsAt && new Date(p.boostEndsAt).getTime() < now) return false;
  return true;
}

export function isSponsorshipActive(sponsoredUntil: Date | string | null, now: number = Date.now()): boolean {
  return !!sponsoredUntil && new Date(sponsoredUntil).getTime() > now;
}
