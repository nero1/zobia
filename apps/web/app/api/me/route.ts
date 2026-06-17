export const dynamic = 'force-dynamic';

/**
 * app/api/me/route.ts
 *
 * GET /api/me
 *
 * Lightweight endpoint returning the authenticated user's id and locale.
 * Used by client-side page components that need to identify the current user
 * without fetching the full profile from /api/users/me.
 *
 * Response: { id: string, locale: string | null, username: string | null }
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;

    const { rows } = await db.query<{ locale: string | null; username: string | null }>(
      `SELECT locale, username FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId]
    );

    return NextResponse.json({
      id: userId,
      locale: rows[0]?.locale ?? null,
      username: rows[0]?.username ?? null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
