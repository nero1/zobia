/**
 * shared/utils/nav.ts
 *
 * Path-segment-aware "is this nav item active?" check shared by the web
 * Navbar/Sidebar and the Capacitor TopBar. A plain `pathname.startsWith(href)`
 * breaks for short hrefs: `/h` (Portals) matches `/home`. Matching on a
 * segment boundary fixes that for every item.
 */
export function isNavPathActive(pathname: string | null | undefined, href: string): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}
