import { NextRequest, NextResponse } from "next/server";
import { validateCronSecret } from "@/lib/cron/auth";
import { runAutomation } from "@/lib/automation/service";
import { handleApiError } from "@/lib/api/errors";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(req: NextRequest) {
  if (!validateCronSecret(req))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, ...(await runAutomation()) });
  } catch (error) {
    return handleApiError(error);
  }
}
