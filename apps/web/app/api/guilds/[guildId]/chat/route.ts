export const dynamic = 'force-dynamic';

/**
 * app/api/guilds/[guildId]/chat/route.ts
 *
 * Guild Chat — PRD §13 (unlocked at Bronze I tier).
 *
 * GET  /api/guilds/[guildId]/chat
 *   Returns paginated message history (cursor-based, newest-first).
 *   Query params: cursor (created_at ISO string), limit (max 50).
 *
 * POST /api/guilds/[guildId]/chat
 *   Send a message to the guild chat.
 *   Body: { content: string, type?: 'text'|'sticker'|'gif', stickerId?: string, gifUrl?: string }
 *   - Requires guild membership
 *   - Awards 2 Social XP + 2 Competitor XP (capped 20/day each track)
 *   - Records war contribution point (send_message) if war is active
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, forbidden, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { recordWarContribution } from "@/lib/guilds/recordWarContribution";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHAT_XP_PER_MESSAGE = 2;
const CHAT_XP_DAILY_CAP   = 20;
const DEFAULT_LIMIT        = 30;
const MAX_LIMIT            = 50;

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const sendMessageSchema = z.object({
  content:   z.string().min(1).max(1000),
  type:      z.enum(['text', 'sticker', 'gif']).default('text'),
  stickerId: z.string().optional(),
  gifUrl:    z.string().url().optional(),
});

// ---------------------------------------------------------------------------
// GET /api/guilds/[guildId]/chat
// ---------------------------------------------------------------------------

export const GET = withAuth(
  async (
    req: NextRequest,
    { params, auth }: { params: { guildId: string }; auth: { user: { sub: string } } }
  ) => {
    try {
      const { guildId } = await params;
      const userId = auth.user.sub;
      await enforceRateLimit(userId, 'user', RATE_LIMITS.apiRead);

      // Verify guild exists and user is a member
      const { rows: memberRows } = await db.query<{ role: string }>(
        `SELECT gm.role
         FROM guild_members gm
         JOIN guilds g ON g.id = gm.guild_id
         WHERE gm.guild_id = $1
           AND gm.user_id = $2
           AND gm.left_at IS NULL
           AND g.disbanded_at IS NULL
         LIMIT 1`,
        [guildId, userId]
      );
      if (!memberRows[0]) {
        return forbidden('You must be a guild member to view guild chat');
      }

      const url = new URL(req.url);
      // Composite cursor: "<iso-timestamp>_<uuid>" (IMP-CURSOR-01)
      // Using (created_at, id) pair eliminates pagination gaps when messages
      // share the same millisecond timestamp.
      const cursorParam = url.searchParams.get('cursor') ?? null;
      const limit  = Math.min(parseInt(url.searchParams.get('limit') ?? `${DEFAULT_LIMIT}`), MAX_LIMIT);

      let cursorTs: string | null = null;
      let cursorId: string | null = null;
      if (cursorParam) {
        const sep = cursorParam.lastIndexOf('_');
        cursorTs = sep > 0 ? cursorParam.slice(0, sep) : cursorParam;
        cursorId = sep > 0 ? cursorParam.slice(sep + 1) : null;
      }

      const { rows: messages } = await db.query<{
        id: string;
        sender_id: string;
        sender_username: string;
        sender_display_name: string | null;
        sender_avatar_emoji: string | null;
        sender_rank_name: string | null;
        content: string;
        type: string;
        sticker_id: string | null;
        gif_url: string | null;
        created_at: string;
      }>(
        `SELECT gm.id,
                gm.sender_id,
                u.username       AS sender_username,
                u.display_name   AS sender_display_name,
                u.avatar_emoji   AS sender_avatar_emoji,
                u.rank_name      AS sender_rank_name,
                gm.content,
                gm.type,
                gm.sticker_id,
                gm.gif_url,
                gm.created_at
         FROM guild_messages gm
         JOIN users u ON u.id = gm.sender_id
         WHERE gm.guild_id = $1
           AND gm.is_deleted = FALSE
           ${cursorTs && cursorId
             ? `AND (gm.created_at, gm.id) < ($3::timestamptz, $4::uuid)`
             : cursorTs
               ? `AND gm.created_at < $3::timestamptz`
               : ''}
         ORDER BY gm.created_at DESC, gm.id DESC
         LIMIT $2`,
        cursorTs && cursorId
          ? [guildId, limit, cursorTs, cursorId]
          : cursorTs
            ? [guildId, limit, cursorTs]
            : [guildId, limit]
      );

      const lastMsg = messages[messages.length - 1];
      const nextCursor = messages.length === limit && lastMsg
        ? `${lastMsg.created_at}_${lastMsg.id}`
        : null;

      return NextResponse.json({
        messages: messages.reverse(), // return oldest-first for display
        nextCursor,
        hasMore: !!nextCursor,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/guilds/[guildId]/chat
// ---------------------------------------------------------------------------

export const POST = withAuth(
  async (
    req: NextRequest,
    { params, auth }: { params: { guildId: string }; auth: { user: { sub: string } } }
  ) => {
    try {
      const { guildId } = await params;
      const userId = auth.user.sub;
      await enforceRateLimit(userId, 'user', RATE_LIMITS.apiWrite);

      const body = await validateBody(req, sendMessageSchema);

      // Verify guild membership
      const { rows: memberRows } = await db.query<{ role: string }>(
        `SELECT gm.role
         FROM guild_members gm
         JOIN guilds g ON g.id = gm.guild_id
         WHERE gm.guild_id = $1
           AND gm.user_id = $2
           AND gm.left_at IS NULL
           AND g.disbanded_at IS NULL
         LIMIT 1`,
        [guildId, userId]
      );
      if (!memberRows[0]) {
        return notFound('Guild not found or you are not a member');
      }

      const result = await db.transaction(async (client) => {
        // Insert message
        const { rows: msgRows } = await client.query<{
          id: string;
          created_at: string;
        }>(
          `INSERT INTO guild_messages
             (guild_id, sender_id, content, type, sticker_id, gif_url)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, created_at`,
          [guildId, userId, body.content, body.type, body.stickerId ?? null, body.gifUrl ?? null]
        );
        const message = msgRows[0];

        // Award XP — 2 Social + 2 Competitor per message, capped daily
        const today = new Date().toISOString().slice(0, 10);
        // Count only social-track entries (one per message) to avoid double-counting
        // the concurrent competitor-track insert and firing at half the intended cap (BUG-XP-01).
        const { rows: xpCountRows } = await client.query<{ daily_count: string }>(
          `SELECT COUNT(*) AS daily_count
           FROM xp_ledger
           WHERE user_id = $1
             AND source = 'guild_chat'
             AND track = 'social'
             AND created_at::date = $2::date`,
          [userId, today]
        );
        const dailyCount = parseInt(xpCountRows[0]?.daily_count ?? '0');

        if (dailyCount < CHAT_XP_DAILY_CAP) {
          const xpEach = CHAT_XP_PER_MESSAGE;
          await client.query(
            `UPDATE users
             SET xp_total       = xp_total + $1,
                 xp_social      = COALESCE(xp_social, 0) + $2,
                 xp_competitor  = COALESCE(xp_competitor, 0) + $2,
                 updated_at     = NOW()
             WHERE id = $3`,
            [xpEach * 2, xpEach, userId]
          );
          await client.query(
            `INSERT INTO xp_ledger (user_id, amount, track, source, reference_id, base_amount, created_at)
             VALUES
               ($1, $2, 'social',     'guild_chat', $3, $2, NOW()),
               ($1, $2, 'competitor', 'guild_chat', $3, $2, NOW())`,
            [userId, xpEach, message.id]
          );
        }

        return message;
      });

      // Record war contribution (fire-and-forget)
      recordWarContribution(userId, 'send_message', db).catch(() => {});

      return NextResponse.json({ success: true, message: result }, { status: 201 });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
