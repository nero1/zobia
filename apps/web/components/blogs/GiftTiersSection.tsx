"use client";

/**
 * components/blogs/GiftTiersSection.tsx
 *
 * Public "Send a Gift" section for a blog's home page (migration 0024).
 * Server-rendered tiers are passed in as props; purchase itself requires
 * login and happens client-side. Renders nothing when there are no active
 * tiers (feature off, or the owner hasn't set any up).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

type BenefitType = "vip_badge" | "vip_section_access" | "custom_reward";

export interface PublicGiftTier {
  id: string;
  name: string;
  description: string | null;
  credits_price: number | null;
  stars_price: number | null;
  benefit_type: BenefitType;
}

const BENEFIT_LABEL: Record<BenefitType, string> = {
  vip_badge: "VIP badge in comments",
  vip_section_access: "Unlocks a post",
  custom_reward: "Special reward",
};

export function GiftTiersSection({ blogSlug, tiers }: { blogSlug: string; tiers: PublicGiftTier[] }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [activeTierId, setActiveTierId] = useState<string | null>(null);
  const [busyTierId, setBusyTierId] = useState<string | null>(null);
  const [result, setResult] = useState<{ tierId: string; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (tiers.length === 0) return null;

  async function send(tier: PublicGiftTier, currency: "credits" | "stars") {
    setBusyTierId(tier.id);
    setError(null);
    try {
      const res = await fetch(`/api/blogs/${blogSlug}/gifts/${tier.id}/purchase`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currency }),
      });
      if (res.status === 401) { router.push("/auth/login"); return; }
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed to send gift");

      let message = t("blogs.gifts.sentGeneric", "Thank you! Your gift was sent.");
      if (json.data?.unlockedPostId) message = t("blogs.gifts.sentUnlock", "Thank you! A post is now unlocked for you.");
      if (json.data?.treasuryPayout) message = t("blogs.gifts.sentPayout", "Thank you! You received {{amount}} Credits.", { amount: json.data.treasuryPayout });
      if (json.data?.textInstructions) message = json.data.textInstructions;
      setResult({ tierId: tier.id, message });
      setActiveTierId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send gift");
    } finally {
      setBusyTierId(null);
    }
  }

  return (
    <div className="mt-8 rounded-2xl border border-border bg-card p-4">
      <h2 className="mb-1 text-lg font-bold text-foreground">{t("blogs.gifts.sectionTitle", "Blog Reward Tiers")}</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        {t("blogs.gifts.sectionHint", "Support this blog directly and unlock a benefit this blog's owner set up. (Looking to send a site gift instead? Use the gift button near the top of the page.)")}
      </p>
      {error && <p className="mb-2 text-xs text-red-400">{error}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {tiers.map((tier) => (
          <div key={tier.id} className="rounded-xl border border-border bg-background p-3">
            <div className="text-sm font-semibold text-foreground">{tier.name}</div>
            {tier.description && <p className="mt-1 text-xs text-muted-foreground">{tier.description}</p>}
            <div className="mt-1 text-[11px] font-medium text-primary">{t(`blogs.gifts.benefit.${tier.benefit_type}`, BENEFIT_LABEL[tier.benefit_type])}</div>

            {result?.tierId === tier.id ? (
              <p className="mt-2 rounded-lg bg-emerald-950/30 p-2 text-xs text-emerald-400 whitespace-pre-wrap">{result.message}</p>
            ) : activeTierId === tier.id ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {tier.credits_price != null && (
                  <button
                    disabled={busyTierId === tier.id}
                    onClick={() => send(tier, "credits")}
                    className="rounded-lg bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  >
                    {t("blogs.gifts.payCredits", "Pay {{amount}} Credits", { amount: tier.credits_price })}
                  </button>
                )}
                {tier.stars_price != null && (
                  <button
                    disabled={busyTierId === tier.id}
                    onClick={() => send(tier, "stars")}
                    className="rounded-lg bg-amber-600 px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {t("blogs.gifts.payStars", "Pay {{amount}} Stars", { amount: tier.stars_price })}
                  </button>
                )}
                <button onClick={() => setActiveTierId(null)} className="rounded-lg bg-neutral-800 px-2.5 py-1 text-xs font-medium text-neutral-300 hover:bg-neutral-700">
                  {t("blogs.gifts.cancel", "Cancel")}
                </button>
              </div>
            ) : (
              <button
                onClick={() => setActiveTierId(tier.id)}
                className="mt-2 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
              >
                {t("blogs.gifts.sendGift", "Send Gift")}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
