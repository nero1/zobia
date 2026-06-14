/**
 * lib/api/response.ts
 *
 * Standardised API response helpers. (BUG-36)
 *
 * All API routes should use these helpers for consistent response shapes:
 *   { data: T | null, error: string | null, code?: string }
 */

import { NextResponse } from "next/server";

/** Successful API response envelope. */
export function apiSuccess<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ data, error: null }, { status });
}

/** Error API response envelope. */
export function apiError(
  message: string,
  code: string,
  status: number
): NextResponse {
  return NextResponse.json({ data: null, error: message, code }, { status });
}
