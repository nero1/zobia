/**
 * app/robots.ts
 *
 * Dynamic robots.txt so the Sitemap URL tracks NEXT_PUBLIC_APP_URL instead of
 * being hard-coded to a single domain (replaces the old static public/robots.txt
 * that pointed at the retired zobia.social host). Disallows admin/api/auth and
 * the internal /rooms app surface, while allowing the public SEO routes
 * (/u, /r, /c, /g).
 */

import type { MetadataRoute } from "next";
import { env } from "@/lib/env";

const BASE_URL = env.NEXT_PUBLIC_APP_URL;

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/u/", "/c/", "/r/", "/g/", "/help", "/about", "/terms", "/privacy"],
      disallow: ["/admin", "/api/", "/auth/", "/pwa-start", "/onboarding"],
    },
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
