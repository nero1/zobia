export const dynamic = "force-dynamic";

/**
 * app/api/blogs/[slug]/contact/route.ts
 *
 * POST /api/blogs/<slug>/contact — the blog's Contact form. Open to every
 * visitor by product spec, logged in or not (this is NOT gated by any
 * "only logged-in users can interact" setting) — that's what distinguishes
 * it from comments, which already require login (see
 * components/blogs/CommentsSection.tsx / POST .../comments, both withAuth).
 *
 * Logged-in senders: identity comes from the session; `name`/`email` in the
 * body are ignored. Logged-out senders: `name`/`email` are optional; a
 * CAPTCHA token is required ONLY when the sitewide captcha_provider manifest
 * key is not "none" — when it's off, logged-out senders are never blocked
 * by a captcha widget that isn't configured (see lib/security/captcha.ts).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getOptionalServerUser } from "@/lib/auth/serverUser";
import { validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, notFound } from "@/lib/api/errors";
import { enforceRateLimit, getClientIp, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getBlogBySlug } from "@/lib/blogs/repo";
import { submitContactMessage } from "@/lib/blogs/service";
import { getCaptchaProvider, verifyCaptcha } from "@/lib/security/captcha";
import { db } from "@/lib/db";

const bodySchema = z.object({
  message: z.string().trim().min(1).max(4000),
  name: z.string().trim().max(100).optional(),
  email: z.string().trim().email().max(200).optional().or(z.literal("")),
  captchaToken: z.string().max(4000).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const ip = getClientIp(req);
    await enforceRateLimit(ip, "ip", RATE_LIMITS.blogWrite);

    const blog = await getBlogBySlug(slug);
    if (!blog) throw notFound("Blog not found");

    const body = await validateBody(req, bodySchema);
    const viewer = await getOptionalServerUser();

    let senderName: string | null = null;
    let senderEmail: string | null = null;

    if (viewer) {
      // Username is authoritative for a logged-in sender — ignore any
      // client-supplied name/email per spec ("auto-filled, not editable").
      const { rows } = await db.query<{ username: string }>(`SELECT username FROM users WHERE id = $1 LIMIT 1`, [viewer.userId]);
      senderName = rows[0]?.username ?? null;
    } else {
      const provider = await getCaptchaProvider();
      if (provider !== "none") {
        if (!body.captchaToken || !(await verifyCaptcha(body.captchaToken, ip, "blog_contact"))) {
          throw badRequest("CAPTCHA verification failed. Please try again.", "CAPTCHA_FAILED");
        }
      }
      senderName = body.name?.trim() || null;
      senderEmail = body.email?.trim() || null;
    }

    const { id } = await submitContactMessage({
      blogId: blog.id,
      senderUserId: viewer?.userId ?? null,
      senderName,
      senderEmail,
      message: body.message,
    });

    return NextResponse.json({ success: true, data: { id }, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
