export const dynamic = 'force-dynamic';

/**
 * app/api/notices/route.ts
 *
 * GET /api/notices — merges active rows from THREE existing sources into one
 * normalized array for the Home carousel, so admins are not asked to
 * re-enter data that already exists elsewhere:
 *   - notices              (new, admin-managed at /gate44 — see migration 0051)
 *   - platform_events      (existing cultural/seasonal events engine)
 *   - announcement_banners (existing sitewide banner system, lib/announcements/engine.ts)
 *
 * Public — the carousel is shown on the Home Dashboard before/without login
 * in some surfaces. Cached briefly (memory + Redis, ~90s) since this is hit
 * on every home load.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handleApiError } from "@/lib/api/errors";
import { redis } from "@/lib/redis";
import { memGet, memSet } from "@/lib/cache/memory";
import { logger } from "@/lib/logger";
import { sanitizeAnnouncementContent } from "@/lib/security/htmlSanitizer";

interface MergedNotice {
  id: string;
  source: "notice" | "platform_event" | "announcement_banner";
  type: string;
  title: string;
  body: string | null;
  icon: string | null;
  imageUrl: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  startsAt: string | null;
  endsAt: string | null;
  sortOrder: number;
}

const MEM_KEY = "notices:merged:v1";
const MEM_TTL_MS = 20_000;
const REDIS_KEY = "notices:merged:v1";
const REDIS_TTL_SECONDS = 90;

async function loadMergedNotices(): Promise<MergedNotice[]> {
  const mem = memGet<MergedNotice[]>(MEM_KEY);
  if (mem) return mem;

  try {
    const cached = await redis.get(REDIS_KEY);
    if (cached) {
      const items = JSON.parse(cached) as MergedNotice[];
      memSet(MEM_KEY, items, MEM_TTL_MS);
      return items;
    }
  } catch (err) {
    logger.error({ err }, "[notices] Redis read failed — falling back to DB");
  }

  const [noticesResult, eventsResult, bannersResult] = await Promise.all([
    db.query<{
      id: string; notice_type: string; title: string; body: string | null; icon: string | null;
      image_url: string | null; cta_label: string | null; cta_url: string | null;
      starts_at: string | null; ends_at: string | null; sort_order: number;
    }>(
      `SELECT id, notice_type, title, body, icon, image_url, cta_label, cta_url, starts_at, ends_at, sort_order
       FROM notices
       WHERE is_active = true
         AND (starts_at IS NULL OR starts_at <= NOW())
         AND (ends_at IS NULL OR ends_at >= NOW())
       ORDER BY sort_order ASC, created_at DESC
       LIMIT 50`
    ),
    db.query<{ id: string; name: string; description: string | null; event_type: string; starts_at: string; ends_at: string }>(
      `SELECT id, name, description, event_type, starts_at, ends_at
       FROM platform_events
       WHERE is_active = true AND starts_at <= NOW() AND ends_at >= NOW()
       ORDER BY starts_at DESC
       LIMIT 20`
    ),
    db.query<{ id: string; title: string | null; content: string; content_type: string; link_url: string | null; starts_at: string | null; ends_at: string | null; display_order: number }>(
      `SELECT id, title, content, content_type, link_url, starts_at, ends_at, display_order
       FROM announcement_banners
       WHERE is_active = true AND deleted_at IS NULL
         AND (starts_at IS NULL OR starts_at <= NOW())
         AND (ends_at IS NULL OR ends_at >= NOW())
       ORDER BY display_order ASC
       LIMIT 20`
    ),
  ]);

  const merged: MergedNotice[] = [
    ...noticesResult.rows.map((r) => ({
      id: `notice:${r.id}`,
      source: "notice" as const,
      type: r.notice_type,
      title: r.title,
      body: r.body,
      icon: r.icon,
      imageUrl: r.image_url,
      ctaLabel: r.cta_label,
      ctaUrl: r.cta_url,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      sortOrder: r.sort_order,
    })),
    ...eventsResult.rows.map((r) => ({
      id: `platform_event:${r.id}`,
      source: "platform_event" as const,
      type: "event",
      title: r.name,
      body: r.description,
      icon: null,
      imageUrl: null,
      ctaLabel: null,
      ctaUrl: null,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      sortOrder: 100,
    })),
    ...bannersResult.rows.map((r) => ({
      id: `announcement_banner:${r.id}`,
      source: "announcement_banner" as const,
      type: "admin_news",
      title: r.title ?? "Announcement",
      body: sanitizeAnnouncementContent(r.content, r.content_type),
      icon: null,
      imageUrl: null,
      ctaLabel: r.link_url ? "Learn more" : null,
      ctaUrl: r.link_url,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      sortOrder: r.display_order,
    })),
  ].sort((a, b) => a.sortOrder - b.sortOrder);

  memSet(MEM_KEY, merged, MEM_TTL_MS);
  try {
    await redis.setex(REDIS_KEY, REDIS_TTL_SECONDS, JSON.stringify(merged));
  } catch {
    // best-effort
  }
  return merged;
}

export async function GET(_req: NextRequest): Promise<NextResponse> {
  try {
    const notices = await loadMergedNotices();
    return NextResponse.json({ success: true, data: { notices }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
}
