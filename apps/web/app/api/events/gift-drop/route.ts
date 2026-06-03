/**
 * app/api/events/gift-drop/route.ts
 *
 * GET /api/events/gift-drop
 *
 * Returns the currently active Monthly Mystery Gift Drop and/or the upcoming
 * announced drop, plus a countdown in seconds to the relevant event boundary.
 *
 * Response shape:
 *   {
 *     active:    MonthlyGiftDrop | null,  // live 48-hour window
 *     upcoming:  MonthlyGiftDrop | null,  // announced, starts within 24 hours
 *     countdown: number | null,           // seconds until next state change
 *   }
 *
 * The `countdown` value represents:
 *   - If active: seconds until the drop expires (availableUntil - now).
 *   - If only upcoming: seconds until the drop goes live (availableFrom - now).
 *   - null if neither active nor upcoming.
 *
 * Auth: public (no authentication required) — clients show the countdown banner.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handleApiError } from "@/lib/api/errors";
import { getActiveGiftDrop, getUpcomingGiftDrop } from "@/lib/events/monthlyGiftDrop";

/**
 * GET /api/events/gift-drop
 */
export async function GET(_req: NextRequest): Promise<NextResponse> {
  try {
    const [active, upcoming] = await Promise.all([
      getActiveGiftDrop(db),
      getUpcomingGiftDrop(db),
    ]);

    let countdown: number | null = null;
    const now = Date.now();

    if (active) {
      // Countdown to expiry
      countdown = Math.max(
        0,
        Math.floor((new Date(active.availableUntil).getTime() - now) / 1000)
      );
    } else if (upcoming) {
      // Countdown to launch
      countdown = Math.max(
        0,
        Math.floor((new Date(upcoming.availableFrom).getTime() - now) / 1000)
      );
    }

    return NextResponse.json(
      { active, upcoming, countdown },
      {
        status: 200,
        headers: {
          // Cache for 60 seconds so CDN doesn't hammer the DB
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
        },
      }
    );
  } catch (err) {
    return handleApiError(err);
  }
}
