import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { NextResponse } from "next/server";
import { z } from "zod";
import { withModeratorOrAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { taleModerationQueue, moderateTale } from "@/lib/tales/admin";
export const dynamic = "force-dynamic";
export const GET = withModeratorOrAdminAuth(async (_req, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    return NextResponse.json({
      success: true,
      data: await taleModerationQueue(),
      error: null,
    });
  } catch (error) {
    return handleApiError(error);
  }
});
const input = z
  .object({
    targetType: z.enum(["story", "chapter", "account"]),
    targetId: z.string().uuid(),
    version: z.number().int().nonnegative(),
    decision: z.enum([
      "approved",
      "rejected",
      "active",
      "banned",
      "suspended",
      "demonetized",
    ]),
    reason: z.string().trim().min(10).max(2000),
    expiresAt: z.string().datetime().nullable().optional(),
    appealId: z.string().uuid().optional(),
  })
  .refine(
    (v) =>
      v.targetType === "account"
        ? ["active", "banned", "suspended", "demonetized"].includes(v.decision)
        : ["approved", "rejected"].includes(v.decision),
    "Decision does not match target type.",
  );
export const POST = withModeratorOrAdminAuth(async (req, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    return NextResponse.json({
      success: true,
      data: await moderateTale(auth.user.sub, await validateBody(req, input)),
      error: null,
    });
  } catch (error) {
    return handleApiError(error);
  }
});
