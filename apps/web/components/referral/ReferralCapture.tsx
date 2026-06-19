"use client";

/**
 * components/referral/ReferralCapture.tsx
 *
 * Global, render-nothing client component mounted once in the root layout.
 * On every navigation it inspects the current URL for a `?r=<code>` referral
 * parameter and, if present and valid, persists it (see clientStore). This is
 * what makes the referral link work when `?r=` is attached to ANY page —
 * the landing page, a profile, a room, a course or a game.
 *
 * It reads `window.location.search` inside an effect (rather than
 * useSearchParams) so it never forces a Suspense boundary or opts pages out of
 * static rendering.
 */

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { extractReferralCode } from "@zobia/shared/utils";
import { storeReferralCode } from "@/lib/referral/clientStore";

export function ReferralCapture() {
  // Re-run on client-side route changes so a referral arriving on a deep link
  // navigated to within the SPA is still captured.
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const code = extractReferralCode(params);
    if (code) storeReferralCode(code);
  }, [pathname]);

  return null;
}
