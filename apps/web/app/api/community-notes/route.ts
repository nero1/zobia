/**
 * app/api/community-notes/route.ts
 *
 * Community notes — crowdsourced context on flagged content.
 *
 * GET /api/community-notes?targetType=&targetId=
 *   Fetch notes for a target. Returns notes with status='shown' plus any
 *   notes authored by the caller.
 *
 * POST /api/community-notes
 *   Submit a new community note. Inserted with status 'needs_review'.
 *   Body: { targetType, targetId, content }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { requireFeatureEnabled } from "@/lib/manifest";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { verifyAccessToken, extractBearerToken } from "@/lib/auth/jwt";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth/session";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const createNoteSchema = z.object({
  targetType: z.enum(["message", "room", "user", "guild"]),
  targetId: z.string().uuid(),
  content: z.string().min(10).max(500),
});

// ---------------------------------------------------------------------------
// Helper: optional auth
// ---------------------------------------------------------------------------

async function tryGetUserId(req: NextRequest): Promise<string | null> {
  try {
    const bearerToken = extractBearerToken(req.headers.get("authorization"));
    const token = bearerToken ?? req.cookies.get(ACCESS_TOKEN_COOKIE)?.value ?? null;
    if (!token) return null;
    const payload = await verifyAccessToken(token);
    return payload.sub;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CommunityNoteRow {
  id: string;
  target_type: string;
  target_id: string;
  author_id: string;
  content: string;
  helpful_votes: number;
  unhelpful_votes: number;
  status: string;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// GET /api/community-notes
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(req.url);
    const targetType = searchParams.get("targetType");
    const targetId = searchParams.get("targetId");

    if (!targetType || !targetId) {
      throw badRequest("targetType and targetId are required");
    }

    const validTargetTypes = ["message", "room", "user", "guild"];
    if (!validTargetTypes.includes(targetType)) {
      throw badRequest("Invalid targetType");
    }

    const userId = await tryGetUserId(req);

    let rows: CommunityNoteRow[];

    if (userId) {
      const result = await db.query<CommunityNoteRow>(
        `SELECT id, target_type, target_id, author_id, content,
                helpful_votes, unhelpful_votes, status, created_at, updated_at
         FROM community_notes
         WHERE target_type = $1
           AND target_id = $2
           AND (status = 'shown' OR author_id = $3)
         ORDER BY helpful_votes DESC, created_at DESC`,
        [targetType, targetId, userId]
      );
      rows = result.rows;
    } else {
      const result = await db.query<CommunityNoteRow>(
        `SELECT id, target_type, target_id, author_id, content,
                helpful_votes, unhelpful_votes, status, created_at, updated_at
         FROM community_notes
         WHERE target_type = $1
           AND target_id = $2
           AND status = 'shown'
         ORDER BY helpful_votes DESC, created_at DESC`,
        [targetType, targetId]
      );
      rows = result.rows;
    }

    return NextResponse.json({
      success: true,
      data: { notes: rows },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

// ---------------------------------------------------------------------------
// POST /api/community-notes
// ---------------------------------------------------------------------------

export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await requireFeatureEnabled("communityNotes");
    const userId = auth.user.sub;
    await enforceRateLimit(userId, "user", RATE_LIMITS.apiWrite);

    const body = await validateBody(req, createNoteSchema);

    const { rows } = await db.query<CommunityNoteRow>(
      `INSERT INTO community_notes
         (target_type, target_id, author_id, content,
          helpful_votes, unhelpful_votes, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 0, 0, 'needs_review', NOW(), NOW())
       RETURNING id, target_type, target_id, author_id, content,
                 helpful_votes, unhelpful_votes, status, created_at, updated_at`,
      [body.targetType, body.targetId, userId, body.content]
    );

    return NextResponse.json(
      { success: true, data: { note: rows[0] }, error: null },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
