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
import { db } from "@/lib/db";

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

    const { rows } = await db.query<{
      notification_type: string;
      is_enabled: boolean;
    }>(
      `SELECT notification_type, is_enabled
       FROM user_email_preferences
       WHERE user_id = $1`,
      [userId]
    );

    // Build a full map with defaults (true = opted in)
    const prefs: Record<string, boolean> = {};
    for (const type of EMAIL_TYPES) {
      prefs[type] = true; // default: opted in
    }
    for (const row of rows) {
      prefs[row.notification_type] = row.is_enabled;
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

    for (const [type, enabled] of Object.entries(updates) as [EmailType, boolean][]) {
      await db.query(
        `INSERT INTO user_email_preferences (user_id, notification_type, is_enabled, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (user_id, notification_type)
         DO UPDATE SET is_enabled = $3, updated_at = NOW()`,
        [userId, type, enabled]
      );
    }

    return NextResponse.json({ success: true, updated: Object.keys(updates) });
  } catch (err) {
    return handleApiError(err);
  }
});
