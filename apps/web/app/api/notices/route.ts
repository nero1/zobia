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
import { and, desc, eq, isNull, lte, or, gte, asc, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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

// REDIS-COST-01: notices are global — every user sees the same merged list —
// and are scheduled by start/end timestamps rather than edited constantly, so
// they tolerate minutes of staleness. The previous 20 s memory TTL meant a warm
// instance still went back to Redis three times a minute for an unchanged
// value. The response is additionally served with CDN cache headers (see the
// handler below), so most clients never reach the origin at all.
const MEM_KEY = "notices:merged:v1";
const MEM_TTL_MS = 120_000; // 2 minutes
const REDIS_KEY = "notices:merged:v1";
const REDIS_TTL_SECONDS = 600; // 10 minutes

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

  const db = await getDb();
  const now = new Date();

  const [noticesRows, eventsRows, bannersRows] = await Promise.all([
    db
      .select({
        id: schema.notices.id,
        noticeType: schema.notices.noticeType,
        title: schema.notices.title,
        body: schema.notices.body,
        icon: schema.notices.icon,
        imageUrl: schema.notices.imageUrl,
        ctaLabel: schema.notices.ctaLabel,
        ctaUrl: schema.notices.ctaUrl,
        startsAt: schema.notices.startsAt,
        endsAt: schema.notices.endsAt,
        sortOrder: schema.notices.sortOrder,
      })
      .from(schema.notices)
      .where(
        and(
          eq(schema.notices.isActive, true),
          or(isNull(schema.notices.startsAt), lte(schema.notices.startsAt, now)),
          or(isNull(schema.notices.endsAt), gte(schema.notices.endsAt, now))
        )
      )
      .orderBy(asc(schema.notices.sortOrder), desc(schema.notices.createdAt))
      .limit(50),
    db
      .select({
        id: schema.platformEvents.id,
        name: schema.platformEvents.name,
        description: schema.platformEvents.description,
        eventType: schema.platformEvents.eventType,
        startsAt: schema.platformEvents.startsAt,
        endsAt: schema.platformEvents.endsAt,
      })
      .from(schema.platformEvents)
      .where(
        and(
          eq(schema.platformEvents.isActive, true),
          lte(schema.platformEvents.startsAt, now),
          gte(schema.platformEvents.endsAt, now)
        )
      )
      .orderBy(desc(schema.platformEvents.startsAt))
      .limit(20),
    db
      .select({
        id: schema.announcementBanners.id,
        title: schema.announcementBanners.title,
        content: schema.announcementBanners.content,
        contentType: schema.announcementBanners.contentType,
        linkUrl: schema.announcementBanners.linkUrl,
        startsAt: schema.announcementBanners.startsAt,
        endsAt: schema.announcementBanners.endsAt,
        displayOrder: schema.announcementBanners.displayOrder,
      })
      .from(schema.announcementBanners)
      .where(
        and(
          eq(schema.announcementBanners.isActive, true),
          isNull(schema.announcementBanners.deletedAt),
          or(isNull(schema.announcementBanners.startsAt), lte(schema.announcementBanners.startsAt, now)),
          or(isNull(schema.announcementBanners.endsAt), gte(schema.announcementBanners.endsAt, now))
        )
      )
      .orderBy(asc(schema.announcementBanners.displayOrder))
      .limit(20),
  ]);

  const merged: MergedNotice[] = [
    ...noticesRows.map((r) => ({
      id: `notice:${r.id}`,
      source: "notice" as const,
      type: r.noticeType,
      title: r.title,
      body: r.body,
      icon: r.icon,
      imageUrl: r.imageUrl,
      ctaLabel: r.ctaLabel,
      ctaUrl: r.ctaUrl,
      startsAt: r.startsAt as unknown as string | null,
      endsAt: r.endsAt as unknown as string | null,
      sortOrder: r.sortOrder,
    })),
    ...eventsRows.map((r) => ({
      id: `platform_event:${r.id}`,
      source: "platform_event" as const,
      type: "event",
      title: r.name,
      body: r.description,
      icon: null,
      imageUrl: null,
      ctaLabel: null,
      ctaUrl: null,
      startsAt: r.startsAt as unknown as string | null,
      endsAt: r.endsAt as unknown as string | null,
      sortOrder: 100,
    })),
    ...bannersRows.map((r) => ({
      id: `announcement_banner:${r.id}`,
      source: "announcement_banner" as const,
      type: "admin_news",
      title: r.title ?? "Announcement",
      body: sanitizeAnnouncementContent(r.content, r.contentType),
      icon: null,
      imageUrl: null,
      ctaLabel: r.linkUrl ? "Learn more" : null,
      ctaUrl: r.linkUrl,
      startsAt: r.startsAt as unknown as string | null,
      endsAt: r.endsAt as unknown as string | null,
      sortOrder: r.displayOrder,
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
    return NextResponse.json(
      { success: true, data: { notices }, error: null },
      {
        headers: {
          // REDIS-COST-01: identical for every caller and carries no per-user
          // state, so let the CDN answer it. `s-maxage` is the directive that
          // makes the edge hold it; `max-age` alone would only have cached in
          // the browser, leaving cold browsers and native (Capacitor) clients
          // hitting the origin every time.
          "Cache-Control": "public, s-maxage=120, max-age=60, stale-while-revalidate=600",
        },
      }
    );
  } catch (err) {
    return handleApiError(err);
  }
}
