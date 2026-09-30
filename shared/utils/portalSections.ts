/**
 * shared/utils/portalSections.ts
 *
 * The Portal page section registry (display order + keys), shared by the web
 * server (lib/portals), the web admin UI and the Capacitor admin UI so all of
 * them agree on the valid section keys.
 */

import type { PortalSectionKey } from "../types/portals";

export const PORTAL_SECTION_KEYS: readonly PortalSectionKey[] = [
  "feed",
  "rooms",
  "guilds",
  "people",
  "forum",
  "questions",
  "wiki",
  "blogs",
  "polls",
] as const;
