export const dynamic = 'force-dynamic';

/**
 * app/api/users/me/crest/route.ts
 *
 * PUT /api/users/me/crest
 *
 * Set or update the custom crest for the calling user.
 * Exclusively available to Hall of Fame users (Prestige 10, PRD §9).
 *
 * Body: { crest: string }  — emoji or URL string, max 500 chars, or null to clear.
 *
 * Returns: { customCrest: string | null }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, forbidden } from "@/lib/api/errors";

const CrestSchema = z.object({
  crest: z.string().max(500).nullable(),
});

export const PUT = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const userId = auth.user.sub;
    const body = await validateBody(req, CrestSchema);

    const db = await getDb();

    // Only Hall of Fame users (prestige_count >= 10) may set a custom crest
    const [row] = await db
      .select({ prestigeCount: schema.users.prestigeCount })
      .from(schema.users)
      .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
      .limit(1);

    if (!row || (row.prestigeCount ?? 0) < 10) {
      throw forbidden("Custom crests are exclusively available to Hall of Fame users (Prestige 10).", "HOF_REQUIRED");
    }

    await db
      .update(schema.users)
      .set({ customCrest: body.crest, updatedAt: new Date() })
      .where(eq(schema.users.id, userId));

    return NextResponse.json({
      success: true,
      data: { customCrest: body.crest },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;

    const db = await getDb();
    const [row] = await db
      .select({
        customCrest: schema.users.customCrest,
        prestigeCount: schema.users.prestigeCount,
      })
      .from(schema.users)
      .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
      .limit(1);

    return NextResponse.json({
      success: true,
      data: {
        customCrest: row?.customCrest ?? null,
        eligible: (row?.prestigeCount ?? 0) >= 10,
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
