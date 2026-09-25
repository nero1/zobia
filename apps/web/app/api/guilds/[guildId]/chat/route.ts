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
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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
      const orm = await getDb();

      // Verify guild exists and user is a member
      const memberRows = await orm
        .select({ role: schema.guildMembers.role })
        .from(schema.guildMembers)
        .innerJoin(schema.guilds, eq(schema.guilds.id, schema.guildMembers.guildId))
        .where(
          and(
            eq(schema.guildMembers.guildId, guildId),
            eq(schema.guildMembers.userId, userId),
            isNull(schema.guildMembers.leftAt),
            isNull(schema.guilds.deletedAt)
          )
        )
        .limit(1);
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

      const cursorClause =
        cursorTs && cursorId
          ? sql`AND (${schema.guildMessages.createdAt}, ${schema.guildMessages.id}) < (${cursorTs}::timestamptz, ${cursorId}::uuid)`
          : cursorTs
            ? sql`AND ${schema.guildMessages.createdAt} < ${cursorTs}::timestamptz`
            : sql``;

      const messages = await orm
        .select({
          id: schema.guildMessages.id,
          senderId: schema.guildMessages.senderId,
          senderUsername: schema.users.username,
          senderDisplayName: schema.users.displayName,
          senderAvatarEmoji: schema.users.avatarEmoji,
          senderRankName: schema.users.rankName,
          content: schema.guildMessages.content,
          type: schema.guildMessages.type,
          stickerId: schema.guildMessages.stickerId,
          gifUrl: schema.guildMessages.gifUrl,
          createdAt: schema.guildMessages.createdAt,
        })
        .from(schema.guildMessages)
        .innerJoin(schema.users, eq(schema.users.id, schema.guildMessages.senderId))
        .where(
          sql`${eq(schema.guildMessages.guildId, guildId)} AND ${eq(schema.guildMessages.isDeleted, false)} ${cursorClause}`
        )
        .orderBy(desc(schema.guildMessages.createdAt), desc(schema.guildMessages.id))
        .limit(limit);

      const lastMsg = messages[messages.length - 1];
      const nextCursor = messages.length === limit && lastMsg
        ? `${lastMsg.createdAt instanceof Date ? lastMsg.createdAt.toISOString() : lastMsg.createdAt}_${lastMsg.id}`
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
      const orm = await getDb();

      // Verify guild membership
      const memberRows = await orm
        .select({ role: schema.guildMembers.role })
        .from(schema.guildMembers)
        .innerJoin(schema.guilds, eq(schema.guilds.id, schema.guildMembers.guildId))
        .where(
          and(
            eq(schema.guildMembers.guildId, guildId),
            eq(schema.guildMembers.userId, userId),
            isNull(schema.guildMembers.leftAt),
            isNull(schema.guilds.deletedAt)
          )
        )
        .limit(1);
      if (!memberRows[0]) {
        return notFound('Guild not found or you are not a member');
      }

      const result = await orm.transaction(async (tx) => {
        // Insert message
        const msgRows = await tx
          .insert(schema.guildMessages)
          .values({
            guildId,
            senderId: userId,
            content: body.content,
            type: body.type,
            stickerId: body.stickerId ?? null,
            gifUrl: body.gifUrl ?? null,
          })
          .returning({ id: schema.guildMessages.id, createdAt: schema.guildMessages.createdAt });
        const message = msgRows[0];

        // Award XP — 2 Social + 2 Competitor per message, capped daily
        const today = new Date().toISOString().slice(0, 10);
        // Count only social-track entries (one per message) to avoid double-counting
        // the concurrent competitor-track insert and firing at half the intended cap (BUG-XP-01).
        const xpCountRows = await tx
          .select({ dailyCount: sql<string>`COUNT(*)` })
          .from(schema.xpLedger)
          .where(
            and(
              eq(schema.xpLedger.userId, userId),
              eq(schema.xpLedger.source, 'guild_chat'),
              eq(schema.xpLedger.track, 'social'),
              sql`${schema.xpLedger.createdAt}::date = ${today}::date`
            )
          );
        const dailyCount = parseInt(xpCountRows[0]?.dailyCount ?? '0');

        if (dailyCount < CHAT_XP_DAILY_CAP) {
          const xpEach = CHAT_XP_PER_MESSAGE;
          await tx
            .update(schema.users)
            .set({
              xpTotal: sql`${schema.users.xpTotal} + ${xpEach * 2}`,
              xpSocial: sql`COALESCE(${schema.users.xpSocial}, 0) + ${xpEach}`,
              xpCompetitor: sql`COALESCE(${schema.users.xpCompetitor}, 0) + ${xpEach}`,
              updatedAt: sql`NOW()`,
            })
            .where(eq(schema.users.id, userId));
          await tx.insert(schema.xpLedger).values([
            {
              userId,
              amount: xpEach,
              track: 'social',
              source: 'guild_chat',
              referenceId: message.id,
              baseAmount: xpEach,
            },
            {
              userId,
              amount: xpEach,
              track: 'competitor',
              source: 'guild_chat',
              referenceId: message.id,
              baseAmount: xpEach,
            },
          ]);
        }

        return message;
      });

      // Record war contribution (fire-and-forget)
      recordWarContribution(userId, 'send_message', orm).catch(() => {});

      return NextResponse.json({ success: true, message: result }, { status: 201 });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
