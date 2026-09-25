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
import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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

      const orm = await getDb();

      // Verify caller is admin
      const [adminRow] = await orm
        .select({ is_admin: sql<boolean>`COALESCE(${schema.users.isAdmin}, false)` })
        .from(schema.users)
        .where(eq(schema.users.id, auth.user.sub))
        .limit(1);
      if (!adminRow?.is_admin) throw forbidden("Admin access required");

      // Verify target user exists
      const [target] = await orm
        .select({
          id: schema.users.id,
          season_xp: sql<number>`COALESCE(${schema.users.seasonXp}, 0)::int`,
          username: schema.users.username,
        })
        .from(schema.users)
        .where(sql`${schema.users.id} = ${userId} AND ${schema.users.deletedAt} IS NULL`)
        .limit(1);
      if (!target) throw notFound("User not found");

      const body = await validateBody(req, patchSchema);
      const previousXp = target.season_xp;
      const newXp = body.action === "disqualify" ? 0 : body.season_xp;

      await orm.transaction(async (tx) => {
        await tx
          .update(schema.users)
          .set({ seasonXp: BigInt(newXp), updatedAt: new Date() })
          .where(eq(schema.users.id, userId));

        await tx.insert(schema.adminAuditLog).values({
          adminId: auth.user.sub,
          action: body.action === "disqualify" ? "leaderboard_disqualify" : "leaderboard_override",
          targetType: "user",
          targetId: userId,
          metadata: {
            username: target.username,
            previous_xp: previousXp,
            new_xp: newXp,
            reason: body.reason,
          },
        });
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
