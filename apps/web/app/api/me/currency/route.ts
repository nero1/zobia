export const dynamic = "force-dynamic";

/**
 * /api/me/currency
 *
 * The single source of truth the client uses to decide whether to render
 * Naira or USD-equivalent prices (see lib/currency/). Cheap and cacheable —
 * callers should stash the result in React Query with a long staleTime
 * rather than refetching per page.
 *
 * GET   — Resolved { currency, isNigeria, usdToNgnRate }. Self-heals a
 *         never-confirmed `users.country` from the request's geo header.
 * PATCH — Set an explicit currency preference ("NGN" | "USD" | null = auto).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getUserRegion } from "@/lib/currency/region";
import { getUsdToNgnRate } from "@/lib/payments/crypto/settings";

export const GET = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const [region, rate] = await Promise.all([
      getUserRegion(auth.user.sub, req),
      getUsdToNgnRate(),
    ]);
    return NextResponse.json({
      success: true,
      data: {
        currency: region.currency,
        isNigeria: region.isNigeria,
        usdToNgnRate: rate.toString(),
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

const PatchSchema = z.object({
  currencyPreference: z.enum(["NGN", "USD"]).nullable(),
});

export const PATCH = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const body = await validateBody(req, PatchSchema);
    await db.query(`UPDATE users SET currency_preference = $1 WHERE id = $2`, [
      body.currencyPreference,
      auth.user.sub,
    ]);
    const region = await getUserRegion(auth.user.sub, req);
    return NextResponse.json({ success: true, data: { currency: region.currency }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
