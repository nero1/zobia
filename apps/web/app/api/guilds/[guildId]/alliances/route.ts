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
import { db } from "@/lib/db";
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
  const { rows } = await db.query<{ captain_id: string }>(
    `SELECT captain_id FROM guilds WHERE id = $1 AND is_active = TRUE LIMIT 1`,
    [guildId]
  );
  if (!rows[0]) throw notFound("Guild not found");
  if (rows[0].captain_id !== userId) {
    throw forbidden("Only the guild leader can manage alliances");
  }
  return rows[0];
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

      const { rows } = await db.query<{
        alliance_id: string;
        alliance_name: string;
        alliance_description: string | null;
        founded_by: string;
        wars_won: number;
        is_active: boolean;
        alliance_created_at: string;
        joined_at: string;
        member_count: string;
      }>(
        `SELECT
           ga.id AS alliance_id,
           ga.name AS alliance_name,
           ga.description AS alliance_description,
           ga.founded_by,
           ga.wars_won,
           ga.is_active,
           ga.created_at AS alliance_created_at,
           gam.joined_at,
           (
             SELECT COUNT(*)::TEXT
             FROM guild_alliance_members gam2
             WHERE gam2.alliance_id = ga.id
           ) AS member_count
         FROM guild_alliance_members gam
         JOIN guild_alliances ga ON ga.id = gam.alliance_id
         WHERE gam.guild_id = $1
           AND ga.is_active = TRUE
         LIMIT 1`,
        [guildId]
      );

      return NextResponse.json({
        success: true,
        data: { alliance: rows[0] ?? null },
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

      if (body.action === "create") {
        if (!body.name) throw badRequest("name is required when creating an alliance");

        // Check guild tier is Platinum+
        const { rows: guildRows } = await db.query<{ tier: string }>(
          `SELECT tier FROM guilds WHERE id = $1 LIMIT 1`,
          [guildId]
        );
        if (!PLATINUM_TIERS.includes(guildRows[0]?.tier ?? "")) {
          throw forbidden("Guild must be Platinum tier or higher to create an alliance");
        }

        // Check guild not already in an alliance
        const { rows: existingRows } = await db.query<{ id: string }>(
          `SELECT gam.id FROM guild_alliance_members gam
           JOIN guild_alliances ga ON ga.id = gam.alliance_id
           WHERE gam.guild_id = $1 AND ga.is_active = TRUE LIMIT 1`,
          [guildId]
        );
        if (existingRows.length > 0) {
          throw conflict("Guild is already in an alliance");
        }

        const result = await db.transaction(async (tx) => {
          const { rows: allianceRows } = await tx.query<{ id: string }>(
            `INSERT INTO guild_alliances (name, description, founded_by, is_active, wars_won, created_at, updated_at)
             VALUES ($1, $2, $3, TRUE, 0, NOW(), NOW())
             RETURNING id`,
            [body.name, body.description ?? null, guildId]
          );
          const allianceId = allianceRows[0].id;

          await tx.query(
            `INSERT INTO guild_alliance_members (alliance_id, guild_id, joined_at)
             VALUES ($1, $2, NOW())`,
            [allianceId, guildId]
          );

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
        const { rows: existingRows } = await db.query<{ id: string }>(
          `SELECT gam.id FROM guild_alliance_members gam
           JOIN guild_alliances ga ON ga.id = gam.alliance_id
           WHERE gam.guild_id = $1 AND ga.is_active = TRUE LIMIT 1`,
          [guildId]
        );
        if (existingRows.length > 0) {
          throw conflict("Guild is already in an alliance");
        }

        // Check alliance exists, is active, and has room (max 4 guilds per PRD §13)
        const { rows: allianceRows } = await db.query<{ id: string; is_active: boolean; member_count: string }>(
          `SELECT ga.id, ga.is_active,
                  COUNT(gam2.guild_id)::TEXT AS member_count
           FROM guild_alliances ga
           LEFT JOIN guild_alliance_members gam2 ON gam2.alliance_id = ga.id
           WHERE ga.id = $1
           GROUP BY ga.id
           LIMIT 1`,
          [body.allianceId]
        );
        if (!allianceRows[0]) throw notFound("Alliance not found");
        if (!allianceRows[0].is_active) throw badRequest("Alliance is no longer active");
        if (parseInt(allianceRows[0].member_count, 10) >= 4) {
          throw conflict("Alliance is full — a maximum of 4 guilds can join an alliance");
        }

        await db.query(
          `INSERT INTO guild_alliance_members (alliance_id, guild_id, joined_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (alliance_id, guild_id) DO NOTHING`,
          [body.allianceId, guildId]
        );

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

      const { rowCount } = await db.query(
        `DELETE FROM guild_alliance_members
         WHERE alliance_id = $1 AND guild_id = $2`,
        [allianceId, guildId]
      );

      if (!rowCount || rowCount === 0) {
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
