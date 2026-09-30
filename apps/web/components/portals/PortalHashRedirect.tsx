"use client";

/**
 * components/portals/PortalHashRedirect.tsx
 *
 * Vanity alias: `zobia.org/#/edo` -> `/h/edo`. A URL fragment never reaches
 * the server, so this runs client-side, only on the landing page ("/"), and
 * only for fragments of the form `#/<slug>` that normalise to a valid
 * hashtag. The canonical, crawlable URL stays /h/<slug>.
 */

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { portalPath, portalSlugFromHash } from "@zobia/shared/utils";

export function PortalHashRedirect() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (pathname !== "/") return;
    const slug = portalSlugFromHash(window.location.hash);
    // Only `#/slug` (leading slash) is the vanity form; a bare `#section` anchor is left alone.
    if (slug && window.location.hash.startsWith("#/")) router.replace(portalPath(slug));
  }, [pathname, router]);

  return null;
}
