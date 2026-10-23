import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, type AuthHandler } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
export const listQuery = z.object({
  tab: z
    .enum(["new", "popular", "trending", "random", "subscribed", "mine"])
    .default("new"),
  cursor: z.string().max(1000).optional(),
  q: z.string().max(200).optional(),
});
export function taleAuth<T = Record<string, string>>(
  handler: (...args: Parameters<AuthHandler<T>>) => Promise<unknown>,
) {
  return withAuth<T>(async (req, ctx) => {
    try {
      await enforceRateLimit(
        ctx.auth.user.sub,
        "user",
        req.method === "GET" ? RATE_LIMITS.apiRead : RATE_LIMITS.blogWrite,
      );
      return NextResponse.json({
        success: true,
        data: await handler(req, ctx),
        error: null,
      });
    } catch (error) {
      return handleApiError(error);
    }
  });
}
