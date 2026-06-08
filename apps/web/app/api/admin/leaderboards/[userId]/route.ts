export const dynamic = 'force-dynamic';

/**
 * app/api/admin/leaderboards/[userId]/route.ts
 *
 * PATCH /api/admin/leaderboards/[userId]
 *   Override a user's season_xp. Admin only.
 *   Logs to admin_audit_log.
 *
 * Body: { season_xp: number, reason: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, forbidden, notFound } from "@/lib/api/errors";

const patchSchema = z.object({
  season_xp: z.number().int().min(0).max(10_000_000),
  reason: z.string().min(1).max(500),
  action: z.enum(["override", "disqualify"]).default("override"),
});

export const PATCH = withAuth(
  async (
    req: NextRequest,
    { params, auth }: { params: { userId: string }; auth: { user: { sub: string } } }
  ) => {
    try {
      const { userId } = await params;

      // Verify caller is admin
      const { rows: adminRows } = await db.query<{ is_admin: boolean }>(
        `SELECT COALESCE(is_admin, false) AS is_admin FROM users WHERE id = $1 LIMIT 1`,
        [auth.user.sub]
      );
      if (!adminRows[0]?.is_admin) return forbidden("Admin access required");

      // Verify target user exists
      const { rows: targetRows } = await db.query<{ id: string; season_xp: number; username: string }>(
        `SELECT id, COALESCE(season_xp, 0)::int AS season_xp, username
         FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [userId]
      );
      if (!targetRows[0]) return notFound("User not found");

      const body = await validateBody(req, patchSchema);
      const previousXp = targetRows[0].season_xp;
      const newXp = body.action === "disqualify" ? 0 : body.season_xp;

      await db.transaction(async (tx) => {
        await tx.query(
          `UPDATE users SET season_xp = $1, updated_at = NOW() WHERE id = $2`,
          [newXp, userId]
        );

        await tx.query(
          `INSERT INTO admin_audit_log
             (admin_id, action, target_type, target_id, metadata, created_at)
           VALUES ($1, $2, 'user', $3, $4::jsonb, NOW())`,
          [
            auth.user.sub,
            body.action === "disqualify" ? "leaderboard_disqualify" : "leaderboard_override",
            userId,
            JSON.stringify({
              username: targetRows[0].username,
              previous_xp: previousXp,
              new_xp: newXp,
              reason: body.reason,
            }),
          ]
        );
      });

      return NextResponse.json({
        success: true,
        data: { userId, previousXp, newXp, action: body.action },
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
