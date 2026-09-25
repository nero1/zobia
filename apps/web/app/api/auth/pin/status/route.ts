export const dynamic = 'force-dynamic';

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
import { getDb, schema } from "@/lib/db/drizzle";
import { eq } from "drizzle-orm";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";

export const GET = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const orm = await getDb();
    const rows = await orm
      .select({ id: schema.userPins.id })
      .from(schema.userPins)
      .where(eq(schema.userPins.userId, auth.user.sub))
      .limit(1);

    return NextResponse.json({ hasPinSet: rows.length > 0 });
  } catch (err) {
    return handleApiError(err);
  }
});
