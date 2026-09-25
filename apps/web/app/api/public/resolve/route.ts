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
import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { handleApiError } from "@/lib/api/errors";
import { resolvePublicRoom } from "@/lib/public/resolveRoom";
import { resolvePublicGame } from "@/lib/public/resolveGame";
import { resolvePublicForumQuestion } from "@/lib/public/resolveForumQuestion";
import { resolvePublicWiki } from "@/lib/public/resolveWiki";
import { resolveOldUsername } from "@/lib/username/availability";

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

      case "wiki": {
        const resolved = await resolvePublicWiki(identifier);
        if (!resolved) return NextResponse.json({ found: false }, { headers: CACHE_HEADERS_SHORT });
        return NextResponse.json({
          found: true,
          type,
          id: resolved.wiki.id,
          slug: resolved.wiki.slug,
          canonicalSlug: resolved.canonicalRedirectSlug ?? resolved.wiki.slug,
        }, { headers: CACHE_HEADERS });
      }

      case "profile": {
        // Profiles are addressed by username; accept it directly. Only public
        // (non-deleted, non-banned) users resolve.
        const orm = await getDb();
        const [row] = await orm
          .select({ id: schema.users.id, username: schema.users.username })
          .from(schema.users)
          .where(and(eq(schema.users.username, identifier), isNull(schema.users.deletedAt), eq(schema.users.isBanned, false)))
          .limit(1);
        if (row) {
          return NextResponse.json({
            found: true,
            type,
            id: row.id,
            username: row.username,
          }, { headers: CACHE_HEADERS });
        }

        // Not a live username — an old username that changed (with redirect
        // enabled) should still deep-link to the current profile.
        const resolution = await resolveOldUsername(identifier);
        if (resolution.kind === "redirect") {
          const [redirected] = await orm
            .select({ id: schema.users.id, username: schema.users.username })
            .from(schema.users)
            .where(and(eq(schema.users.username, resolution.toUsername), isNull(schema.users.deletedAt), eq(schema.users.isBanned, false)))
            .limit(1);
          if (redirected) {
            return NextResponse.json({
              found: true,
              type,
              id: redirected.id,
              username: redirected.username,
              canonicalUsername: redirected.username,
            }, { headers: CACHE_HEADERS });
          }
        }

        return NextResponse.json({ found: false }, { headers: CACHE_HEADERS_SHORT });
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
