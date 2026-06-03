/**
 * app/api/moments/[momentId]/route.ts
 *
 * GET    /api/moments/:momentId  — View a moment and record the view
 * DELETE /api/moments/:momentId  — Delete own moment
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden } from "@/lib/api/errors";

export const GET = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const { momentId } = await params as { momentId: string };
    const viewerId = auth.user.sub;

    const { rows } = await db.query(
      `SELECT m.*, u.username, u.avatar_emoji
       FROM moments m JOIN users u ON u.id = m.user_id
       WHERE m.id = $1 AND m.expires_at > NOW()`,
      [momentId]
    );
    if (!rows[0]) throw notFound("Moment not found or expired");

    void db.query(
      `INSERT INTO moment_views (moment_id, viewer_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [momentId, viewerId]
    ).then(() => db.query(`UPDATE moments SET view_count = view_count + 1 WHERE id = $1`, [momentId]))
     .catch(() => {});

    return NextResponse.json({ success: true, data: rows[0], error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const DELETE = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const { momentId } = await params as { momentId: string };
    const userId = auth.user.sub;

    const { rows } = await db.query<{ user_id: string }>(
      `SELECT user_id FROM moments WHERE id = $1`, [momentId]
    );
    if (!rows[0]) throw notFound("Moment not found");
    if (rows[0].user_id !== userId) throw forbidden("Cannot delete another user's moment");

    await db.query(`DELETE FROM moments WHERE id = $1`, [momentId]);
    return NextResponse.json({ success: true, data: null, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
