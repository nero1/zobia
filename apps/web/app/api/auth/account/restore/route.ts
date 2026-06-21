export const dynamic = "force-dynamic";

/**
 * app/api/auth/account/restore/route.ts
 *
 * POST /api/auth/account/restore   — Initiate account restore (sends email)
 * PATCH /api/auth/account/restore  — Complete restore with signed token
 *
 * Both endpoints are public (no auth required — the user's account is deleted).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, getClientIp } from "@/lib/security/rateLimit";
import { initiateAccountRestore, completeAccountRestore } from "@/lib/auth/restore";

const initiateSchema = z.object({
  email: z.string().email("Must be a valid email address"),
});

const completeSchema = z.object({
  token: z.string().min(10, "Invalid restore token"),
});

/** POST — send restore email */
export const POST = async (req: NextRequest) => {
  try {
    const ip = getClientIp(req) ?? "unknown";
    await enforceRateLimit(`restore:init:${ip}`, "ip", {
      name: "auth:account-restore",
      windowMs: 3600 * 1000,
      limit: 3,
    });

    const body = await validateBody(req, initiateSchema);

    // Always return 200 to avoid email enumeration
    await initiateAccountRestore(body.email).catch(() => {});

    return NextResponse.json({
      success: true,
      data: { message: "If that email belongs to a deleted account, a restore link has been sent." },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
};

/** PATCH — complete restore with token */
export const PATCH = async (req: NextRequest) => {
  try {
    const body = await validateBody(req, completeSchema);
    const result = await completeAccountRestore(body.token);

    if (!result.success) {
      throw badRequest(result.error ?? "Restore failed", "RESTORE_FAILED");
    }

    return NextResponse.json({
      success: true,
      data: {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        message: "Account restored successfully. Welcome back!",
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
};
