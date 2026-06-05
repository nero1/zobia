/**
 * app/sitemap.ts
 *
 * Dynamic SEO sitemap for Zobia Social web app.
 *
 * Returns entries for:
 *   - Static app pages (home, rooms, leaderboards, seasons, etc.)
 *   - Public user profiles (active users, last 30 days)
 *   - Public rooms (free_open rooms, discoverable)
 *
 * Follows the Next.js MetadataRoute.Sitemap API.
 * PRD §26 Phase 7: SEO with sitemap.
 */

import type { MetadataRoute } from "next";
import { db } from "@/lib/db";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://zobia.social";

// ---------------------------------------------------------------------------
// Static pages
// ---------------------------------------------------------------------------

const STATIC_PAGES: MetadataRoute.Sitemap = [
  { url: BASE_URL, lastModified: new Date(), changeFrequency: "daily", priority: 1.0 },
  { url: `${BASE_URL}/rooms`, lastModified: new Date(), changeFrequency: "hourly", priority: 0.9 },
  { url: `${BASE_URL}/leaderboards`, lastModified: new Date(), changeFrequency: "hourly", priority: 0.8 },
  { url: `${BASE_URL}/seasons`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.7 },
  { url: `${BASE_URL}/council`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.5 },
  { url: `${BASE_URL}/moments`, lastModified: new Date(), changeFrequency: "hourly", priority: 0.6 },
  { url: `${BASE_URL}/quests`, lastModified: new Date(), changeFrequency: "daily", priority: 0.6 },
];

// ---------------------------------------------------------------------------
// Sitemap generator
// ---------------------------------------------------------------------------

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [...STATIC_PAGES];

  try {
    // Public user profiles — active in last 30 days
    const { rows: profiles } = await db.query<{ username: string; updated_at: string }>(
      `SELECT username, updated_at
       FROM users
       WHERE deleted_at IS NULL
         AND last_active_at > NOW() - INTERVAL '30 days'
         AND username IS NOT NULL
       ORDER BY last_active_at DESC
       LIMIT 5000`
    );

    for (const p of profiles) {
      entries.push({
        url: `${BASE_URL}/profile/${encodeURIComponent(p.username)}`,
        lastModified: new Date(p.updated_at),
        changeFrequency: "weekly",
        priority: 0.5,
      });
    }

    // Public discoverable rooms (free_open only — no private rooms in sitemap)
    const { rows: rooms } = await db.query<{ id: string; name: string; updated_at: string }>(
      `SELECT id, name, updated_at
       FROM rooms
       WHERE room_type = 'free_open'
         AND deleted_at IS NULL
         AND is_active = TRUE
       ORDER BY last_activity_at DESC NULLS LAST
       LIMIT 2000`
    );

    for (const r of rooms) {
      entries.push({
        url: `${BASE_URL}/rooms/${r.id}`,
        lastModified: new Date(r.updated_at),
        changeFrequency: "hourly",
        priority: 0.6,
      });
    }
  } catch {
    // Return static pages if DB is unavailable (e.g. build-time)
  }

  return entries;
}
