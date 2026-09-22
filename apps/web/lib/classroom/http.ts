/**
 * lib/classroom/http.ts
 *
 * Tiny helpers shared by every /api/classroom/** route: the standard
 * `{ success, data, error }` envelope and resolving the classroom + caller
 * role from route params (a uuid `roomId`; a malformed id is a 404, never a
 * Postgres cast error).
 */

import { NextResponse } from "next/server";
import { looksLikeUuid } from "@zobia/shared/utils";
import { notFound } from "@/lib/api/errors";
import { requireFeatureEnabled } from "@/lib/manifest";
import { loadClassroomContext, type ClassroomContext } from "@/lib/classroom/access";

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ success: true, data, error: null }, { status });
}

export function assertUuid(value: string | undefined, what = "Classroom"): string {
  if (!value || !looksLikeUuid(value)) throw notFound(`${what} not found`);
  return value;
}

/** Feature-flag gate + classroom/role resolution for a `[roomId]` route. */
export async function classroomContextFromParams(
  params: { roomId?: string },
  userId: string
): Promise<ClassroomContext> {
  await requireFeatureEnabled("classrooms");
  const roomId = assertUuid(params.roomId);
  return loadClassroomContext({ id: roomId }, userId);
}
