export const dynamic = 'force-dynamic';

/**
 * app/api/guilds/[guildId]/alliances/route.ts
 *
 * Guild Alliance management endpoints.
 *
 * GET /api/guilds/:guildId/alliances
 *   Fetch alliance info for a guild (join guild_alliance_members → guild_alliances).
 *
 * POST /api/guilds/:guildId/alliances
 *   Create or join an alliance. Guild leader only.
 *   Creating: guild must be Platinum tier; insert guild_alliances + guild_alliance_members.
 *   Joining: insert guild_alliance_members for an existing alliance.
 *
 * DELETE /api/guilds/:guildId/alliances
 *   Leave alliance. Removes row from guild_alliance_members.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { requireFeatureEnabled } from "@/lib/manifest";
import {
  handleApiError,
  notFound,
  forbidden,
  conflict,
  badRequest,
} from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const createAllianceSchema = z.object({
  action: z.enum(["create", "join"]),
  // Required when creating
  name: z.string().min(3).max(60).optional(),
  description: z.string().max(300).optional(),
  // Required when joining
  allianceId: z.string().uuid().optional(),
});

const leaveAllianceSchema = z.object({
  allianceId: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PLATINUM_TIERS = ["platinum_1", "platinum_2", "platinum_3", "legend"];

async function assertGuildLeader(guildId: string, userId: string) {
  const orm = await getDb();
  const [row] = await orm
    .select({ captain_id: schema.guilds.captainId })
    .from(schema.guilds)
    .where(and(eq(schema.guilds.id, guildId), eq(schema.guilds.isActive, true)))
    .limit(1);
  if (!row) throw notFound("Guild not found");
  if (row.captain_id !== userId) {
    throw forbidden("Only the guild leader can manage alliances");
  }
  return row;
}

// ---------------------------------------------------------------------------
// GET /api/guilds/:guildId/alliances
// ---------------------------------------------------------------------------

export const GET = withAuth(
  async (
    _req: NextRequest,
    { params }: { params: { guildId: string }; auth: unknown }
  ) => {
    try {
      const { guildId } = await params;

      const orm = await getDb();
      const gam2 = alias(schema.guildAllianceMembers, "gam2");
      const [row] = await orm
        .select({
          alliance_id: schema.guildAlliances.id,
          alliance_name: schema.guildAlliances.name,
          alliance_description: schema.guildAlliances.description,
          founded_by: schema.guildAlliances.foundedBy,
          wars_won: schema.guildAlliances.warsWon,
          is_active: schema.guildAlliances.isActive,
          alliance_created_at: schema.guildAlliances.createdAt,
          joined_at: schema.guildAllianceMembers.joinedAt,
          member_count: sql<string>`(SELECT COUNT(*)::TEXT FROM ${gam2} WHERE ${gam2.allianceId} = ${schema.guildAlliances.id})`,
        })
        .from(schema.guildAllianceMembers)
        .innerJoin(schema.guildAlliances, eq(schema.guildAlliances.id, schema.guildAllianceMembers.allianceId))
        .where(and(eq(schema.guildAllianceMembers.guildId, guildId), eq(schema.guildAlliances.isActive, true)))
        .limit(1);

      return NextResponse.json({
        success: true,
        data: { alliance: row ?? null },
        error: null,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/guilds/:guildId/alliances
// ---------------------------------------------------------------------------

export const POST = withAuth(
  async (
    req: NextRequest,
    { params, auth }: { params: { guildId: string }; auth: { user: { sub: string } } }
  ) => {
    try {
      await requireFeatureEnabled("allianceSystem");
      const { guildId } = await params;
      const userId = auth.user.sub;
      await enforceRateLimit(userId, "user", RATE_LIMITS.apiWrite);

      const body = await validateBody(req, createAllianceSchema);
      await assertGuildLeader(guildId, userId);
      const orm = await getDb();

      if (body.action === "create") {
        if (!body.name) throw badRequest("name is required when creating an alliance");

        // Check guild tier is Platinum+
        const [guildRow] = await orm
          .select({ tier: schema.guilds.tier })
          .from(schema.guilds)
          .where(eq(schema.guilds.id, guildId))
          .limit(1);
        if (!PLATINUM_TIERS.includes(guildRow?.tier ?? "")) {
          throw forbidden("Guild must be Platinum tier or higher to create an alliance");
        }

        // Check guild not already in an alliance
        const [existing] = await orm
          .select({ id: schema.guildAllianceMembers.id })
          .from(schema.guildAllianceMembers)
          .innerJoin(schema.guildAlliances, eq(schema.guildAlliances.id, schema.guildAllianceMembers.allianceId))
          .where(and(eq(schema.guildAllianceMembers.guildId, guildId), eq(schema.guildAlliances.isActive, true)))
          .limit(1);
        if (existing) {
          throw conflict("Guild is already in an alliance");
        }

        const result = await orm.transaction(async (tx) => {
          const [allianceRow] = await tx
            .insert(schema.guildAlliances)
            .values({ name: body.name!, description: body.description ?? null, foundedBy: guildId, isActive: true, warsWon: 0 })
            .returning({ id: schema.guildAlliances.id });
          const allianceId = allianceRow.id;

          await tx.insert(schema.guildAllianceMembers).values({ allianceId, guildId });

          return { allianceId };
        });

        return NextResponse.json(
          { success: true, data: result, error: null },
          { status: 201 }
        );
      } else {
        // action === "join"
        if (!body.allianceId) throw badRequest("allianceId is required when joining an alliance");

        // Check guild not already in an alliance
        const [existing] = await orm
          .select({ id: schema.guildAllianceMembers.id })
          .from(schema.guildAllianceMembers)
          .innerJoin(schema.guildAlliances, eq(schema.guildAlliances.id, schema.guildAllianceMembers.allianceId))
          .where(and(eq(schema.guildAllianceMembers.guildId, guildId), eq(schema.guildAlliances.isActive, true)))
          .limit(1);
        if (existing) {
          throw conflict("Guild is already in an alliance");
        }

        // Check alliance exists, is active, and has room (max 4 guilds per PRD §13)
        const gam2 = alias(schema.guildAllianceMembers, "gam2");
        const [allianceRow] = await orm
          .select({
            id: schema.guildAlliances.id,
            is_active: schema.guildAlliances.isActive,
            member_count: sql<string>`COUNT(${gam2.guildId})::TEXT`,
          })
          .from(schema.guildAlliances)
          .leftJoin(gam2, eq(gam2.allianceId, schema.guildAlliances.id))
          .where(eq(schema.guildAlliances.id, body.allianceId))
          .groupBy(schema.guildAlliances.id)
          .limit(1);
        if (!allianceRow) throw notFound("Alliance not found");
        if (!allianceRow.is_active) throw badRequest("Alliance is no longer active");
        if (parseInt(allianceRow.member_count, 10) >= 4) {
          throw conflict("Alliance is full — a maximum of 4 guilds can join an alliance");
        }

        await orm
          .insert(schema.guildAllianceMembers)
          .values({ allianceId: body.allianceId, guildId })
          .onConflictDoNothing({ target: [schema.guildAllianceMembers.allianceId, schema.guildAllianceMembers.guildId] });

        return NextResponse.json(
          { success: true, data: { allianceId: body.allianceId, joined: true }, error: null },
          { status: 201 }
        );
      }
    } catch (err) {
      return handleApiError(err);
    }
  }
);

// ---------------------------------------------------------------------------
// DELETE /api/guilds/:guildId/alliances
// ---------------------------------------------------------------------------

export const DELETE = withAuth(
  async (
    req: NextRequest,
    { params, auth }: { params: { guildId: string }; auth: { user: { sub: string } } }
  ) => {
    try {
      const { guildId } = await params;
      const userId = auth.user.sub;
      await enforceRateLimit(userId, "user", RATE_LIMITS.apiWrite);

      const { allianceId } = await validateBody(req, leaveAllianceSchema);
      await assertGuildLeader(guildId, userId);

      const orm = await getDb();
      const deleted = await orm
        .delete(schema.guildAllianceMembers)
        .where(and(eq(schema.guildAllianceMembers.allianceId, allianceId), eq(schema.guildAllianceMembers.guildId, guildId)))
        .returning({ id: schema.guildAllianceMembers.id });

      if (deleted.length === 0) {
        throw notFound("Guild is not a member of this alliance");
      }

      return NextResponse.json({
        success: true,
        data: { allianceId, left: true },
        error: null,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
