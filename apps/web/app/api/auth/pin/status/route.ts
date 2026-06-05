/**
 * app/api/auth/pin/status/route.ts
 *
 * GET /api/auth/pin/status
 *
 * Returns whether the authenticated user has a PIN configured.
 * Used by the Expo app to decide whether to gate sensitive operations
 * (payments, payout requests) behind PIN entry.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";

export const GET = withAuth(async (req: NextRequest, { auth }) => {
  try {
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM user_pins WHERE user_id = $1 LIMIT 1`,
      [auth.user.sub]
    );

    return NextResponse.json({ hasPinSet: rows.length > 0 });
  } catch (err) {
    return handleApiError(err);
  }
});
