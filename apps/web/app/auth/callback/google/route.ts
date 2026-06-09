/**
 * app/auth/callback/google/route.ts
 *
 * Legacy Google OAuth callback — preserved for backward compatibility with
 * any Google OAuth console entries that still point here.
 *
 * All new traffic uses /api/auth/google/callback which handles onboarding.
 * This handler forwards the full query string to the canonical route.
 */

import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const destination = new URL("/api/auth/google/callback", env.NEXT_PUBLIC_APP_URL);
  // Forward all query params (code, state, error, etc.)
  searchParams.forEach((value, key) => destination.searchParams.set(key, value));
  return NextResponse.redirect(destination, { status: 302 });
}
