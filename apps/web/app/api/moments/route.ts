export const dynamic = 'force-dynamic';

/**
 * app/api/moments/route.ts
 *
 * GET  /api/moments  — Public feed of all non-expired moments (cursor-paginated)
 * POST /api/moments  — Create a new moment (expires in 24h, max 5 active)
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { createMoment } from "@/lib/moments/service";

// ---------------------------------------------------------------------------
// Media URL allowlist
// ---------------------------------------------------------------------------

/**
 * Returns the list of hostnames that are allowed as media_url / thumbnail_url
 * sources. Derived from configured storage/CDN environment variables so the
 * allowlist automatically reflects the deployment's storage provider.
 *
 * Sources considered (in priority order):
 *   1. R2_PUBLIC_URL          — Cloudflare R2 public bucket hostname
 *   2. NEXT_PUBLIC_SUPABASE_URL — Supabase storage hostname
 *   3. NEXT_PUBLIC_APP_URL    — same-origin uploads served via the app itself
 *
 * Additional domains can be added via the ALLOWED_MEDIA_HOSTS env var
 * (comma-separated list of hostnames, e.g. "cdn.example.com,assets.example.com").
 */
function getAllowedMediaHosts(): string[] {
  const hosts = new Set<string>();

  const addHost = (raw: string | undefined) => {
    if (!raw) return;
    try {
      const { hostname } = new URL(raw);
      if (hostname) hosts.add(hostname.toLowerCase());
    } catch {
      // ignore malformed URLs
    }
  };

  // Storage provider public URLs
  addHost(process.env.R2_PUBLIC_URL);
  addHost(process.env.NEXT_PUBLIC_SUPABASE_URL);
  // App origin (for locally-served uploads)
  addHost(process.env.NEXT_PUBLIC_APP_URL);

  // Additional opt-in CDN domains
  const extra = process.env.ALLOWED_MEDIA_HOSTS ?? "";
  for (const h of extra.split(",").map((s) => s.trim()).filter(Boolean)) {
    hosts.add(h.toLowerCase());
  }

  return [...hosts];
}

/**
 * Returns true if the given URL's hostname is in the configured CDN/storage
 * allowlist. Falls back to allowing any https URL during local development
 * when no storage env vars are configured (all allowed hosts would be empty).
 */
function isAllowedMediaUrl(raw: string): boolean {
  const allowedHosts = getAllowedMediaHosts();

  // If no storage env vars are configured (e.g. bare local dev), skip the
  // check rather than blocking every URL. This is safe because it only occurs
  // when NEXT_PUBLIC_SUPABASE_URL, R2_PUBLIC_URL, and NEXT_PUBLIC_APP_URL are
  // all unset — a configuration that implies no production data.
  if (allowedHosts.length === 0) return true;

  try {
    const { hostname } = new URL(raw);
    return allowedHosts.includes(hostname.toLowerCase());
  } catch {
    return false;
  }
}

const createMomentSchema = z.object({
  content: z.string().min(1).max(500),
  content_type: z.enum(["text", "image", "video"]).default("text"),
  media_url: z
    .string()
    .url()
    .refine(isAllowedMediaUrl, { message: "Media URL must be from allowed domain" })
    .optional(),
  thumbnail_url: z
    .string()
    .url()
    .refine(isAllowedMediaUrl, { message: "Media URL must be from allowed domain" })
    .optional(),
  caption: z.string().max(200).optional(),
  /** Currency to pay with when Moments cost Credits and/or Stars. Ignored when the feature is free. */
  currency: z.enum(["credits", "stars"]).optional(),
});

/**
 * Public feed — every non-expired moment from every user, newest first.
 * Cursor-paginated (created_at keyset) so the feed scales to thousands of
 * moments/day without a full table scan; see idx_moments_active_feed.
 */
export const GET = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const userId = auth.user.sub;
    const cursor = req.nextUrl.searchParams.get("cursor");
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") ?? "20", 10), 50);

    const { rows } = await db.query(
      `SELECT m.id, m.user_id,
              u.username, u.avatar_emoji, u.avatar_url,
              m.content, m.content_type, m.media_url, m.caption,
              m.view_count, m.reactions_count, m.expires_at, m.created_at,
              (EXISTS (
                SELECT 1 FROM moment_views mv
                WHERE mv.moment_id = m.id AND mv.viewer_id = $1
              )) AS has_viewed,
              COALESCE(
                (SELECT jsonb_agg(jsonb_build_object(
                    'emoji', r.emoji,
                    'count', r.cnt,
                    'userReacted', r.user_reacted
                  ) ORDER BY r.cnt DESC)
                 FROM (
                   SELECT mr.emoji, COUNT(*) AS cnt, BOOL_OR(mr.user_id = $1) AS user_reacted
                   FROM moment_reactions mr
                   WHERE mr.moment_id = m.id
                   GROUP BY mr.emoji
                 ) r),
                '[]'::jsonb
              ) AS reactions
       FROM moments m
       JOIN users u ON u.id = m.user_id
       WHERE m.expires_at > NOW()
         ${cursor ? "AND m.created_at < $3" : ""}
       ORDER BY m.created_at DESC
       LIMIT $2`,
      cursor ? [userId, limit, cursor] : [userId, limit]
    );

    const nextCursor = rows.length === limit ? rows[rows.length - 1].created_at : null;
    return NextResponse.json({ success: true, data: { moments: rows, nextCursor }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const userId = auth.user.sub;
    const body = await validateBody(req, createMomentSchema);

    if (body.content_type !== "text" && !body.media_url) {
      throw badRequest("media_url is required for image/video moments");
    }

    const result = await createMoment({
      userId,
      content: body.content,
      contentType: body.content_type,
      mediaUrl: body.media_url ?? null,
      thumbnailUrl: body.thumbnail_url ?? null,
      caption: body.caption ?? null,
      currency: body.currency ?? null,
      source: "feed",
    });

    return NextResponse.json({ success: true, data: result, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
