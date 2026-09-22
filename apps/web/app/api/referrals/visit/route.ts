export const dynamic = 'force-dynamic';

/**
 * app/api/referrals/visit/route.ts
 *
 * POST /api/referrals/visit — record a referral-link visit. Open to anyone,
 * logged in or not: the whole point is to see traffic on a referral link
 * before a visitor ever signs up. Called by components/referral/ReferralCapture.tsx
 * (web/PWA) whenever a valid `?r=<code>` is captured, and by the Capacitor
 * app's deep-link handler (lib/deeplinks/referral.ts) on appUrlOpen — both
 * fire-and-forget with `keepalive`, never blocking the page.
 *
 * Body: { code: string, path: string, visitorKey: string }
 *
 * `visitorKey` is a random, non-PII id the client generates once and
 * persists (localStorage / Preferences) — never an IP or device fingerprint.
 * The database-level unique index on (referrer, visitor, day) is the real
 * dedup; the IP rate limit here just bounds abuse/spam volume.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, getClientIp, RATE_LIMITS } from "@/lib/security/rateLimit";
import { recordReferralVisit } from "@/lib/referrals/visits";

const bodySchema = z.object({
  code: z.string().min(1).max(20).regex(/^[A-Za-z0-9_-]+$/),
  path: z.string().min(1).max(500),
  visitorKey: z.string().min(8).max(200),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const ip = getClientIp(req);
    await enforceRateLimit(ip, "ip", RATE_LIMITS.referralVisit);

    const body = await validateBody(req, bodySchema);
    await recordReferralVisit(body);

    return NextResponse.json({ success: true, data: { recorded: true }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
}
