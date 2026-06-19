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

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://zobia.vercel.app";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/api/", "/auth/"],
    },
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
