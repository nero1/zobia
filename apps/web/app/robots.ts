/**
 * app/robots.ts
 *
 * Dynamic robots.txt so the Sitemap URL tracks NEXT_PUBLIC_APP_URL instead of
 * being hard-coded to a single domain (replaces the old static public/robots.txt
 * that pointed at the retired zobia.social host). Disallows api/auth and
 * the internal /rooms app surface, while allowing the public SEO routes
 * (/u, /r, /c, /g, /a).
 *
 * The staff login/management area is deliberately NOT listed here (neither
 * allow nor disallow) — a disallow rule would itself advertise the path to
 * anyone reading robots.txt. It stays unindexed purely because nothing on
 * the public site links to it and it is never in the sitemap.
 */

import type { MetadataRoute } from "next";
import { env } from "@/lib/env";

const BASE_URL = env.NEXT_PUBLIC_APP_URL;

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/u/", "/c/", "/r/", "/g/", "/a/", "/help", "/about", "/terms", "/privacy"],
      disallow: ["/api/", "/auth/", "/pwa-start", "/onboarding"],
    },
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
