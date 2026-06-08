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
import { db } from "@/lib/db";
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
    const { rows } = await db.query<{ chat_theme: string | null }>(
      "SELECT chat_theme FROM users WHERE id = $1 LIMIT 1",
      [auth.user.sub]
    );

    return NextResponse.json({
      success: true,
      data: { theme: rows[0]?.chat_theme ?? "default" },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// PUT
// ---------------------------------------------------------------------------

export const PUT = withAuth(async (req: NextRequest, { auth }) => {
  try {
    const body = await validateBody(req, themeSchema);

    // Non-default themes require Pro or Max
    if (PAID_THEMES.includes(body.theme)) {
      const { rows } = await db.query<{ plan: string }>(
        "SELECT plan FROM users WHERE id = $1 LIMIT 1",
        [auth.user.sub]
      );
      const plan = rows[0]?.plan ?? "free";
      if (plan !== "pro" && plan !== "max") {
        throw forbidden(
          "Custom chat themes require a Pro or Max plan. Upgrade to unlock this feature."
        );
      }
    }

    await db.query(
      "UPDATE users SET chat_theme = $1, updated_at = NOW() WHERE id = $2",
      [body.theme, auth.user.sub]
    );

    return NextResponse.json({
      success: true,
      data: { theme: body.theme },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
