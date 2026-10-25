import { buildCookieHeaders } from "@/lib/auth/session";
import { extractBearerToken } from "@/lib/auth/jwt";
import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import {
  enforceRateLimit,
  getClientIp,
  RATE_LIMITS,
} from "@/lib/security/rateLimit";
import { googleAdminStatus, googleAdminStep } from "@/lib/auth/googleAdmin";
export const dynamic = "force-dynamic";
const response = (data: unknown) =>
  NextResponse.json(
    { success: true, data },
    { headers: { "Cache-Control": "no-store" } },
  );
export const GET = withAuth(async (_req, { auth }) => {
  await enforceRateLimit(auth.user.sub, "user", {
    ...RATE_LIMITS.apiRead,
    name: "google-admin:status",
  });
  return response(await googleAdminStatus(auth.user.sub, auth.user.sid));
});
export const POST = withAuth(async (req, { auth }) => {
  await enforceRateLimit(auth.user.sub, "user", {
    name: "google-admin:step",
    limit: 10,
    windowMs: 15 * 60 * 1000,
    bypassL1: true,
  });
  await enforceRateLimit(getClientIp(req), "ip", {
    name: "google-admin:step:ip",
    limit: 30,
    windowMs: 15 * 60 * 1000,
    bypassL1: true,
  });
  const body = await validateBody(
    req,
    z.object({
      action: z.enum(["setup", "enroll", "verify"]),
      code: z
        .string()
        .regex(/^\d{6}$/)
        .optional(),
    }),
  );
  const result = await googleAdminStep(
    auth.user.sub,
    auth.user.sid,
    body.action,
    body.code,
  );
  if (!result.tokens) return response(result);
  if (extractBearerToken(req.headers.get("authorization")))
    return response({ state: result.state, ...result.tokens });
  const cookies = buildCookieHeaders(result.tokens),
    res = response({ state: result.state });
  res.headers.append("Set-Cookie", cookies.accessCookie);
  res.headers.append("Set-Cookie", cookies.refreshCookie);
  return res;
});
