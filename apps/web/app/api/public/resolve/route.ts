/**
 * app/api/public/resolve/route.ts
 *
 * GET /api/public/resolve?type=<room|course|game|profile>&id=<slug|username|uuid>
 *
 * Resolves a public, SEO-friendly identifier (slug or username — or a legacy
 * UUID) to the internal record needed to deep-link into the app. Used by the
 * Expo universal-link redirect screens (app/u|r|c|g/[..].tsx) to turn an
 * incoming https://<host>/r/<slug> link into a /rooms/<uuid> navigation.
 *
 * Public (no auth): only ever returns public, live entities. Listed in
 * middleware PUBLIC_PREFIXES under /api/public.
 *
 * Response: { found: boolean, type, id, slug|username, canonicalSlug }
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handleApiError } from "@/lib/api/errors";
import { resolvePublicRoom } from "@/lib/public/resolveRoom";
import { resolvePublicGame } from "@/lib/public/resolveGame";
import { resolvePublicForumQuestion } from "@/lib/public/resolveForumQuestion";

const ROOM_TYPES = ["free_open", "vip", "drop", "tipping", "limited"];
const COURSE_TYPES = ["classroom"];

// BUG-23 FIX: cache public slug→id lookups to reduce DB load from crawlers/CDN.
// Hits: 60s CDN + 5m stale-while-revalidate. Misses: 10s (entity may be created soon).
const CACHE_HEADERS = { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" };
const CACHE_HEADERS_SHORT = { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=30" };

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const type = url.searchParams.get("type");
    const identifier = url.searchParams.get("id");

    if (!identifier || !type) {
      return NextResponse.json(
        { found: false, error: "Missing type or id" },
        { status: 400 }
      );
    }

    switch (type) {
      case "room":
      case "course": {
        const resolved = await resolvePublicRoom(
          identifier,
          type === "course" ? COURSE_TYPES : ROOM_TYPES
        );
        if (!resolved) return NextResponse.json({ found: false }, { headers: CACHE_HEADERS_SHORT });
        return NextResponse.json({
          found: true,
          type,
          id: resolved.room.id,
          slug: resolved.room.slug,
          canonicalSlug: resolved.canonicalRedirectSlug ?? resolved.room.slug,
        }, { headers: CACHE_HEADERS });
      }

      case "game": {
        const resolved = await resolvePublicGame(identifier);
        if (!resolved) return NextResponse.json({ found: false }, { headers: CACHE_HEADERS_SHORT });
        return NextResponse.json({
          found: true,
          type,
          id: resolved.game.id,
          slug: resolved.game.slug,
          canonicalSlug: resolved.canonicalRedirectSlug ?? resolved.game.slug,
        }, { headers: CACHE_HEADERS });
      }

      case "forum_question": {
        const resolved = await resolvePublicForumQuestion(identifier);
        if (!resolved) return NextResponse.json({ found: false }, { headers: CACHE_HEADERS_SHORT });
        return NextResponse.json({
          found: true,
          type,
          id: resolved.question.id,
          slug: resolved.question.slug,
          canonicalSlug: resolved.canonicalRedirectSlug ?? resolved.question.slug,
        }, { headers: CACHE_HEADERS });
      }

      case "profile": {
        // Profiles are addressed by username; accept it directly. Only public
        // (non-deleted, non-banned) users resolve.
        const { rows } = await db.query<{ id: string; username: string }>(
          `SELECT id, username FROM users
           WHERE username = $1 AND deleted_at IS NULL AND COALESCE(is_banned, false) = false
           LIMIT 1`,
          [identifier]
        );
        if (!rows[0]) return NextResponse.json({ found: false }, { headers: CACHE_HEADERS_SHORT });
        return NextResponse.json({
          found: true,
          type,
          id: rows[0].id,
          username: rows[0].username,
        }, { headers: CACHE_HEADERS });
      }

      default:
        return NextResponse.json(
          { found: false, error: "Unknown type" },
          { status: 400 }
        );
    }
  } catch (err) {
    return handleApiError(err);
  }
}
