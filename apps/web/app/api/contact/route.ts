export const dynamic = "force-dynamic";

/**
 * app/api/contact/route.ts
 *
 * POST /api/contact — the site-wide Contact Us page. Open to every visitor,
 * logged in or not (same access model as the per-blog contact form — see
 * app/api/blogs/[slug]/contact/route.ts).
 *
 * Logged-in senders: identity comes from the session; `name`/`email` in the
 * body are ignored. Logged-out senders: `name` is optional, `email` is
 * required (so the platform can reply); a CAPTCHA token is required ONLY
 * when the "contact_us" surface is enabled (per-surface toggle — see
 * lib/security/captcha.ts `isCaptchaSurfaceEnabled`).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getOptionalServerUser } from "@/lib/auth/serverUser";
import { validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, getClientIp, RATE_LIMITS } from "@/lib/security/rateLimit";
import { submitSiteContactMessage } from "@/lib/contact/service";
import { isCaptchaSurfaceEnabled, verifyCaptcha } from "@/lib/security/captcha";
import { db } from "@/lib/db";

const bodySchema = z.object({
  message: z.string().trim().min(1).max(4000),
  subject: z.string().trim().max(200).optional(),
  name: z.string().trim().max(100).optional(),
  email: z.string().trim().email().max(200).optional().or(z.literal("")),
  captchaToken: z.string().max(4000).optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const ip = getClientIp(req);
    await enforceRateLimit(ip, "ip", RATE_LIMITS.blogWrite);

    const body = await validateBody(req, bodySchema);
    const viewer = await getOptionalServerUser();

    let senderName: string | null = null;
    let senderEmail: string | null = null;

    if (viewer) {
      const { rows } = await db.query<{ username: string }>(
        `SELECT username FROM users WHERE id = $1 LIMIT 1`,
        [viewer.userId]
      );
      senderName = rows[0]?.username ?? null;
    } else {
      if (await isCaptchaSurfaceEnabled("contact_us")) {
        if (!body.captchaToken || !(await verifyCaptcha(body.captchaToken, ip, "contact_us"))) {
          throw badRequest("CAPTCHA verification failed. Please try again.", "CAPTCHA_FAILED");
        }
      }
      if (!body.email) {
        throw badRequest("Email is required.", "EMAIL_REQUIRED");
      }
      senderName = body.name?.trim() || null;
      senderEmail = body.email?.trim() || null;
    }

    const { id } = await submitSiteContactMessage({
      senderUserId: viewer?.userId ?? null,
      senderName,
      senderEmail,
      subject: body.subject,
      message: body.message,
    });

    return NextResponse.json({ success: true, data: { id }, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
