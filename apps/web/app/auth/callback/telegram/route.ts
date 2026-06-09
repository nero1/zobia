/**
 * app/auth/callback/telegram/route.ts
 *
 * Legacy Telegram login callback — preserved for backward compatibility.
 * All new traffic uses /api/auth/telegram/callback which handles onboarding.
 * This handler forwards the full query string to the canonical route.
 */

import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const destination = new URL("/api/auth/telegram/callback", env.NEXT_PUBLIC_APP_URL);
  searchParams.forEach((value, key) => destination.searchParams.set(key, value));
  return NextResponse.redirect(destination, { status: 302 });
}
