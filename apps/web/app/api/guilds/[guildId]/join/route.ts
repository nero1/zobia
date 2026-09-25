export const dynamic = 'force-dynamic';

/**
 * app/api/guilds/[guildId]/join/route.ts
 *
 * POST /api/guilds/[guildId]/join
 *   - open:        Joins immediately
 *   - approval:    Creates a pending application
 *   - invite_only: Requires a valid invite token in the request body
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, forbidden, notFound } from "@/lib/api/errors";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const joinGuildSchema = z.object({
  /** Required when recruitment_type is 'invite_only'. */
  inviteToken: z.string().optional(),
});

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------

interface GuildRow {
  id: string;
  recruitment_type: string;
  member_count: number;
  is_active: boolean;
}

interface InviteRow {
  id: string;
  guild_id: string;
  invited_user_id: string | null;
  expires_at: string;
  used_at: string | null;
}

/**
 * Join a guild. Behaviour depends on the guild's recruitment_type:
 *   - open:        Immediate membership
 *   - approval:    Pending application created
 *   - invite_only: Requires a valid invite token
 */
export const POST = withAuth(
  async (
    req: NextRequest,
    
    { params, auth }: { params: { guildId: string }; auth: { user: { sub: string } } }
  ) => {
    try {
      const { guildId } = params;
      const userId = auth.user.sub;
      const body = await validateBody(req, joinGuildSchema);

      const orm = await getDb();
      const result = await orm.transaction(async (client) => {
        // 1. Verify guild exists and is active
        const guildRows = await client
          .select({
            id: schema.guilds.id,
            recruitment_type: schema.guilds.recruitmentType,
            member_count: schema.guilds.memberCount,
            is_active: schema.guilds.isActive,
          })
          .from(schema.guilds)
          .where(eq(schema.guilds.id, guildId))
          .for("update");
        if (!guildRows[0] || !guildRows[0].is_active) {
          throw notFound("Guild not found");
        }
        const guild = guildRows[0];

        // 2. Check user isn't already a member
        const existingMember = await client
          .select({ id: schema.guildMembers.id })
          .from(schema.guildMembers)
          .where(eq(schema.guildMembers.userId, userId))
          .limit(1);
        if (existingMember.length > 0) {
          throw badRequest("You already belong to a guild", "ALREADY_IN_GUILD");
        }

        // 3. Handle recruitment type
        if (guild.recruitment_type === "open") {
          // Immediate membership
          await client.insert(schema.guildMembers).values({
            guildId,
            userId,
            role: "member",
            contributionScore: 0,
            warPointsTotal: 0,
            joinedAt: sql`NOW()`,
          });
          await client
            .update(schema.guilds)
            .set({ memberCount: sql`${schema.guilds.memberCount} + 1`, updatedAt: sql`NOW()` })
            .where(eq(schema.guilds.id, guildId));
          await client
            .update(schema.users)
            .set({ guildId, updatedAt: sql`NOW()` })
            .where(eq(schema.users.id, userId));
          return { status: "joined" };
        }

        if (guild.recruitment_type === "approval") {
          // Create pending application
          await client
            .insert(schema.guildApplications)
            .values({ guildId, userId, status: "pending" })
            .onConflictDoNothing({ target: [schema.guildApplications.guildId, schema.guildApplications.userId] });
          return { status: "pending" };
        }

        if (guild.recruitment_type === "invite_only") {
          if (!body.inviteToken) {
            throw forbidden("An invite token is required to join this guild");
          }
          // Validate invite token
          const inviteRows = await client
            .select({
              id: schema.guildInvites.id,
              guild_id: schema.guildInvites.guildId,
              invited_user_id: schema.guildInvites.invitedUserId,
              expires_at: schema.guildInvites.expiresAt,
              used_at: schema.guildInvites.usedAt,
            })
            .from(schema.guildInvites)
            .where(and(eq(schema.guildInvites.token, body.inviteToken), eq(schema.guildInvites.guildId, guildId)))
            .for("update");
          const invite = inviteRows[0];
          if (!invite) throw forbidden("Invalid or expired invite token");
          if (invite.used_at) throw forbidden("This invite has already been used");
          if (invite.expires_at < new Date()) {
            throw forbidden("This invite has expired");
          }
          if (invite.invited_user_id && invite.invited_user_id !== userId) {
            throw forbidden("This invite is not for your account");
          }

          // Mark invite as used
          await client
            .update(schema.guildInvites)
            .set({ usedAt: sql`NOW()`, usedByUserId: userId })
            .where(eq(schema.guildInvites.id, invite.id));

          // Join guild
          await client.insert(schema.guildMembers).values({
            guildId,
            userId,
            role: "member",
            contributionScore: 0,
            warPointsTotal: 0,
            joinedAt: sql`NOW()`,
          });
          await client
            .update(schema.guilds)
            .set({ memberCount: sql`${schema.guilds.memberCount} + 1`, updatedAt: sql`NOW()` })
            .where(eq(schema.guilds.id, guildId));
          await client
            .update(schema.users)
            .set({ guildId, updatedAt: sql`NOW()` })
            .where(eq(schema.users.id, userId));
          return { status: "joined" };
        }

        throw badRequest("Unknown guild recruitment type");
      });

      return NextResponse.json({ success: true, data: result, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
