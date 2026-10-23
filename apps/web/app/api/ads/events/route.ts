export const dynamic = 'force-dynamic';

/**
 * app/api/ads/events/route.ts
 *
 * POST /api/ads/events — batched impression/click reporting. The client
 * (components/ads/AdSlot.tsx) queues events in localStorage and flushes
 * them in small batches (navigator.sendBeacon on unload, or a debounced
 * fetch), so a single page view generates at most a couple of requests
 * instead of one per ad. Each event carries a client-generated
 * `clientEventId` so a retried flush can't double-bill a campaign's budget
 * (see lib/ads/serve.ts recordAdEvents).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody, type AuthContext } from "@/lib/api/middleware";
import { requireFeatureEnabled } from "@/lib/manifest";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { recordAdEvents } from "@/lib/ads/serve";

const bodySchema = z.object({
  events: z
    .array(
      z.object({
        creativeId: z.string().uuid(),
        placementKey: z.string().min(1).max(50),
        type: z.enum(["impression", "click"]),
        clientEventId: z.string().min(8).max(100),
        receipt:z.string().min(32).max(1024),
      })
    )
    .min(1)
    .max(20),
});

export const POST = withAuth(async (req: NextRequest, { auth }: { auth: AuthContext }) => {
  try {
    await requireFeatureEnabled("nativeAds");
    await enforceRateLimit(auth.user.sub, "user", {limit:60,windowMs:60_000,name:"ads:events",globalLimit:10000,bypassL1:true});
    const body = await validateBody(req, bodySchema);

    const result=await recordAdEvents(body.events,auth.user.sub);
    return NextResponse.json({success:true,data:result,error:null});
  } catch (err) {
    return handleApiError(err);
  }
});
