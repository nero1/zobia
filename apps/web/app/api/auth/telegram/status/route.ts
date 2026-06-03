/**
 * app/api/auth/telegram/status/route.ts
 *
 * GET /api/auth/telegram/status?state=<shortState>
 *
 * Mobile polling endpoint for the Telegram bot login flow.
 *
 * Flow:
 *  1. Expo app opens t.me/ZobiaSocialBot?start=login_{state}
 *  2. Bot receives the /start command, validates, calls POST /api/auth/telegram/approve
 *  3. Expo app polls this endpoint until status = 'approved'
 *
 * Possible status values:
 *  - 'pending'  — waiting for user to complete in Telegram
 *  - 'approved' — login complete; token and user payload are included
 *  - 'expired'  — state token has expired (> 5 minutes old)
 *  - 'not_found' — unknown state token
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, getClientIp, RATE_LIMITS } from "@/lib/security/rateLimit";

// State token TTL — must complete Telegram login within this window
const STATE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TelegramLoginStateRow {
  state: string;
  status: "pending" | "approved" | "expired";
  token: string | null;
  user_payload: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// GET /api/auth/telegram/status
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const ip = getClientIp(req);
    await enforceRateLimit(ip, "ip", RATE_LIMITS.auth);

    const { searchParams } = new URL(req.url);
    const state = searchParams.get("state")?.trim();

    if (!state || state.length < 8 || state.length > 64) {
      throw badRequest("Invalid or missing state parameter");
    }

    const { rows } = await db.query<TelegramLoginStateRow>(
      `SELECT state, status, token, user_payload, created_at
       FROM telegram_login_states
       WHERE state = $1
       LIMIT 1`,
      [state]
    );

    if (!rows[0]) {
      return NextResponse.json({ status: "not_found" }, { status: 200 });
    }

    const row = rows[0];

    // Check if the state has expired
    const age = Date.now() - new Date(row.created_at).getTime();
    if (age > STATE_TTL_MS && row.status === "pending") {
      // Mark as expired in background
      db.query(
        `UPDATE telegram_login_states SET status = 'expired', updated_at = NOW() WHERE state = $1`,
        [state]
      ).catch(() => {});
      return NextResponse.json({ status: "expired" }, { status: 200 });
    }

    if (row.status === "approved" && row.token && row.user_payload) {
      let user: unknown;
      try {
        user = JSON.parse(row.user_payload);
      } catch {
        return NextResponse.json({ status: "pending" }, { status: 200 });
      }
      return NextResponse.json(
        { status: "approved", token: row.token, user },
        { status: 200 }
      );
    }

    return NextResponse.json({ status: row.status }, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
}
