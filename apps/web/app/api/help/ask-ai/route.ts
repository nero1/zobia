export const dynamic = "force-dynamic";

/**
 * app/api/help/ask-ai/route.ts
 *
 * POST — Help Center "Ask AI" block (Feature 2 §5-6).
 *
 * Authenticated ONLY — withAuth requires a valid access token, so a
 * logged-out visitor's request 401s before any AI call is made (both
 * client AND server gate abuse per the spec; this is the server half).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { askAi } from "@/lib/help/service";

const askSchema = z.object({
  question: z.string().trim().min(3).max(1000),
  docId: z.string().uuid().optional(),
});

export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const body = await validateBody(req, askSchema);
    const answer = await askAi(body.question, body.docId);
    return NextResponse.json({ success: true, data: { answer }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
