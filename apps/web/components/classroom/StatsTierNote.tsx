"use client";

/**
 * components/classroom/StatsTierNote.tsx
 *
 * Upsell note explaining what the next classroom-stats tier unlocks
 * (lib/classroom/limits.ts: plan + creator tier gating). Hidden at "detailed".
 */

import Link from "next/link";
import { useTranslation } from "react-i18next";

export function StatsTierNote({ tier }: { tier: string }) {
  const { t } = useTranslation();
  if (tier === "detailed") return null;
  return (
    <p className="rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-800 dark:bg-violet-950/40 dark:text-violet-300">
      {tier === "basic"
        ? t(
            "classroom.studio.tierBasic",
            "You're seeing basic stats. Upgrade to Plus (or reach Rising creator tier) for activity trends, or to Pro/Max (or Verified creator) for daily charts, lesson funnels and conversion."
          )
        : t("classroom.studio.tierMore", "Upgrade to Pro/Max (or reach Verified creator tier) for daily charts, lesson funnels and conversion analytics.")}{" "}
      <Link href="/settings/subscription" className="font-semibold underline">
        {t("classroom.studio.upgrade", "See plans")}
      </Link>
    </p>
  );
}
