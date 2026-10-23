import { NextRequest, NextResponse } from "next/server";
import { validateSearchParams } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import {
  enforceRateLimit,
  getClientIp,
  RATE_LIMITS,
} from "@/lib/security/rateLimit";
import { listTales } from "@/lib/tales/service";
import { listQuery } from "@/lib/tales/api";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  try {
    await enforceRateLimit(getClientIp(req), "ip", RATE_LIMITS.apiRead);
    const q = validateSearchParams(req.nextUrl.searchParams, listQuery);
    return NextResponse.json({
      success: true,
      data: await listTales(undefined, q.tab, q.cursor, q.q),
      error: null,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
