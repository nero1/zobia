/**
 * app/sitemap.ts
 *
 * Dynamic SEO sitemap for Zobia Social web app.
 *
 * Returns entries for:
 *   - Static public pages (landing, terms, privacy)
 *   - Public user profiles (active users, last 30 days)
 *   - Public rooms (free_open rooms, discoverable)
 *
 * Auth-gated routes (/home, /rooms, /leaderboards, /seasons, /council,
 * /moments, /quests, etc.) are intentionally excluded — they redirect
 * unauthenticated visitors to /auth/login and must not appear in a sitemap.
 *
 * Follows the Next.js MetadataRoute.Sitemap API.
 * PRD §26 Phase 7: SEO with sitemap.
 */

import type { MetadataRoute } from "next";
import { db } from "@/lib/db";

// Revalidate the sitemap at most once per hour so it doesn't run on every request.
export const revalidate = 3600;

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://zobia.vercel.app";

// ---------------------------------------------------------------------------
// Static public pages (no authentication required per middleware.ts)
// ---------------------------------------------------------------------------

const STATIC_PAGES: MetadataRoute.Sitemap = [
  // Landing page — public
  { url: BASE_URL, lastModified: new Date(), changeFrequency: "daily", priority: 1.0 },
  // Help / FAQ — public
  { url: `${BASE_URL}/help`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.6 },
  // Legal pages — public
  { url: `${BASE_URL}/terms`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.3 },
  { url: `${BASE_URL}/privacy`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.3 },
  // NOTE: /home, /rooms, /leaderboards, /seasons, /council, /moments, /quests
  // are all auth-gated (middleware default-deny) and must NOT appear here.
];

// ---------------------------------------------------------------------------
// Sitemap generator
// ---------------------------------------------------------------------------

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [...STATIC_PAGES];

  // Public user profiles — active in last 30 days.
  // These are served at /u/[username] (public, SSR, crawlable).
  try {
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
        url: `${BASE_URL}/u/${encodeURIComponent(p.username)}`,
        lastModified: new Date(p.updated_at),
        changeFrequency: "weekly",
        priority: 0.5,
      });
    }
  } catch {
    // Profiles unavailable (e.g. build-time DB not connected) — skip silently
  }

  // Public discoverable rooms (free_open only — no private rooms in sitemap).
  // Served at /r/<slug> (public, SSR, crawlable). Falls back to the UUID for
  // any legacy room not yet backfilled with a slug (still resolves + 301s).
  try {
    const { rows: rooms } = await db.query<{ id: string; slug: string | null; updated_at: string }>(
      `SELECT id, slug, updated_at
       FROM rooms
       WHERE type = 'free_open'
         AND deleted_at IS NULL
         AND is_active = TRUE
       ORDER BY updated_at DESC NULLS LAST
       LIMIT 2000`
    );

    for (const r of rooms) {
      entries.push({
        url: `${BASE_URL}/r/${encodeURIComponent(r.slug ?? r.id)}`,
        lastModified: new Date(r.updated_at),
        changeFrequency: "hourly",
        priority: 0.6,
      });
    }
  } catch {
    // Rooms unavailable — skip silently; profile entries are still returned
  }

  // Public courses (classroom rooms). Served at /c/<slug>.
  try {
    const { rows: courses } = await db.query<{ id: string; slug: string | null; updated_at: string }>(
      `SELECT id, slug, updated_at
       FROM rooms
       WHERE type = 'classroom'
         AND deleted_at IS NULL
         AND is_active = TRUE
       ORDER BY updated_at DESC NULLS LAST
       LIMIT 2000`
    );

    for (const c of courses) {
      entries.push({
        url: `${BASE_URL}/c/${encodeURIComponent(c.slug ?? c.id)}`,
        lastModified: new Date(c.updated_at),
        changeFrequency: "daily",
        priority: 0.6,
      });
    }
  } catch {
    // Courses unavailable — skip silently
  }

  // Public games. Served at /g/<slug>. The table may not exist on older DBs
  // (pre-0012 migration) — the catch keeps the sitemap working regardless.
  try {
    const { rows: gameRows } = await db.query<{ slug: string; updated_at: string }>(
      `SELECT slug, updated_at
       FROM games
       WHERE deleted_at IS NULL
         AND is_active = TRUE
         AND is_public = TRUE
       ORDER BY updated_at DESC NULLS LAST
       LIMIT 2000`
    );

    for (const g of gameRows) {
      entries.push({
        url: `${BASE_URL}/g/${encodeURIComponent(g.slug)}`,
        lastModified: new Date(g.updated_at),
        changeFrequency: "daily",
        priority: 0.5,
      });
    }
  } catch {
    // Games table absent or unavailable — skip silently
  }

  return entries;
}
