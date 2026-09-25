export const dynamic = 'force-dynamic';

/**
 * app/api/users/me/email-preferences/route.ts
 *
 * GET  /api/users/me/email-preferences — Return current per-type email opt-in state.
 * PUT  /api/users/me/email-preferences — Update opt-in state for one or more types.
 *
 * Security emails (type = "security") cannot be disabled and are ignored in PUT.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";

const EMAIL_TYPES = [
  "marketing",
  "reengagement",
  "guild",
  "season",
  "moderation",
  "referral",
  "council",
  "transactional",
] as const;

type EmailType = (typeof EMAIL_TYPES)[number];

const UpdateSchema = z.record(
  z.enum(EMAIL_TYPES),
  z.boolean()
);

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;

    const db = await getDb();
    const rows = await db
      .select({
        notificationType: schema.userEmailPreferences.notificationType,
        isEnabled: schema.userEmailPreferences.isEnabled,
      })
      .from(schema.userEmailPreferences)
      .where(eq(schema.userEmailPreferences.userId, userId));

    // Build a full map with defaults (true = opted in)
    const prefs: Record<string, boolean> = {};
    for (const type of EMAIL_TYPES) {
      prefs[type] = true; // default: opted in
    }
    for (const row of rows) {
      prefs[row.notificationType] = row.isEnabled;
    }

    // Security is always enabled
    return NextResponse.json({ preferences: prefs, security: true });
  } catch (err) {
    return handleApiError(err);
  }
});

export const PUT = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const userId = auth.user.sub;
    const body = await req.json().catch(() => ({}));
    const parsed = UpdateSchema.safeParse(body);
    if (!parsed.success) {
      throw badRequest("Invalid preferences payload");
    }

    const updates = parsed.data;
    if (Object.keys(updates).length === 0) {
      throw badRequest("No preferences to update");
    }

    const db = await getDb();
    for (const [type, enabled] of Object.entries(updates) as [EmailType, boolean][]) {
      await db
        .insert(schema.userEmailPreferences)
        .values({ userId, notificationType: type, isEnabled: enabled })
        .onConflictDoUpdate({
          target: [
            schema.userEmailPreferences.userId,
            schema.userEmailPreferences.notificationType,
          ],
          set: { isEnabled: enabled, updatedAt: new Date() },
        });
    }

    return NextResponse.json({ success: true, updated: Object.keys(updates) });
  } catch (err) {
    return handleApiError(err);
  }
});
