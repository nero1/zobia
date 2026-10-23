import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError } from "@/lib/api/errors";
import {
  enforceRateLimit,
  getClientIp,
  RATE_LIMITS,
} from "@/lib/security/rateLimit";
import { getTale, readTaleChapter } from "@/lib/tales/service";
export const dynamic = "force-dynamic";
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    await enforceRateLimit(getClientIp(req), "ip", RATE_LIMITS.apiRead);
    const chapter = req.nextUrl.searchParams.get("chapter");
    const data = chapter
      ? await readTaleChapter(
          slug,
          z.coerce.number().int().min(1).max(10000).parse(chapter),
        )
      : await getTale(slug);
    return NextResponse.json({ success: true, data, error: null });
  } catch (error) {
    return handleApiError(error);
  }
}
