export const dynamic = 'force-dynamic';

/**
 * app/api/users/me/theme/route.ts
 *
 * Chat theme preference for the authenticated user.
 *
 * GET  /api/users/me/theme  – return current chat theme
 * PUT  /api/users/me/theme  – update chat theme (Pro/Max plan required for non-default)
 *
 * Available themes: default, midnight, ocean, forest, sunset
 * Non-default themes require Pro or Max plan (PRD §3).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, forbidden } from "@/lib/api/errors";

const THEMES = ["default", "midnight", "ocean", "forest", "sunset"] as const;
type ChatTheme = (typeof THEMES)[number];

const PAID_THEMES: ChatTheme[] = ["midnight", "ocean", "forest", "sunset"];

const themeSchema = z.object({
  theme: z.enum(THEMES, {
    errorMap: () => ({ message: `Theme must be one of: ${THEMES.join(", ")}` }),
  }),
});

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    const db = await getDb();
    const [row] = await db
      .select({ chatTheme: schema.users.chatTheme })
      .from(schema.users)
      .where(eq(schema.users.id, auth.user.sub))
      .limit(1);

    return NextResponse.json({
      success: true,
      data: { theme: row?.chatTheme ?? "default" },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// PUT
// ---------------------------------------------------------------------------

export const PUT = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const body = await validateBody(req, themeSchema);

    // Non-default themes require Pro or Max
    const db = await getDb();

    if (PAID_THEMES.includes(body.theme)) {
      const [row] = await db
        .select({ plan: schema.users.plan })
        .from(schema.users)
        .where(eq(schema.users.id, auth.user.sub))
        .limit(1);
      const plan = row?.plan ?? "free";
      if (plan !== "pro" && plan !== "max") {
        throw forbidden(
          "Custom chat themes require a Pro or Max plan. Upgrade to unlock this feature."
        );
      }
    }

    await db
      .update(schema.users)
      .set({ chatTheme: body.theme, updatedAt: new Date() })
      .where(eq(schema.users.id, auth.user.sub));

    return NextResponse.json({
      success: true,
      data: { theme: body.theme },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
