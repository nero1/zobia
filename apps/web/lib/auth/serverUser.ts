/**
 * lib/auth/serverUser.ts
 *
 * Best-effort current-user lookup for SSR server components (the public
 * /b/<slug> blog pages need to know if the visitor is the blog owner or
 * staff, to show the owner-only nav toolbar / gate the draft-preview mode —
 * without requiring auth, since these pages are otherwise public).
 * Mirrors app/(app)/layout.tsx's resolveAnnouncements() cookie+JWT read.
 */

import { cookies } from "next/headers";
import { authenticateAccessToken } from "@/lib/auth/principal";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth/session";

export interface OptionalServerUser {
  userId: string;
  isAdmin: boolean;
  isModerator: boolean;
  isSupport: boolean;
  isSeniorSupport: boolean;
}

export async function getOptionalServerUser(): Promise<OptionalServerUser | null> {
  try {
    const cookieStore = await cookies();
    const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;
    if (!accessToken) return null;
    const { user, session } = await authenticateAccessToken(accessToken);
    return {
      userId: user.id,
      isAdmin: !!user.is_admin && !!session.adminSession,
      isModerator: !!user.is_moderator,
      isSupport: !!user.is_support,
      isSeniorSupport: !!user.is_senior_support,
    };
  } catch {
    return null;
  }
}
