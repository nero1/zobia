"use client";

/**
 * components/market/MarketItemCard.tsx
 *
 * One item on the Market page — works for both creator items (merch) and
 * platform items (store_items/boosts/credits), in grid or list layout.
 */

import { useState } from "react";
import Link from "next/link";
import type { MarketItem } from "@/lib/market/types";
import { ReferralShareDropdown } from "@/components/merch/ReferralShareDropdown";

const CATEGORY_LABEL: Record<MarketItem["category"], string> = {
  digital: "Digital",
  physical: "Physical",
  cosmetics_themes: "Cosmetics & Themes",
  boosts_passes: "Boosts & Passes",
  credits: "Credits",
};

function Badge({ children, tone }: { children: React.ReactNode; tone: "amber" | "teal" | "blue" }) {
  const tones = {
    amber: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
    teal: "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300",
    blue: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  } as const;
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${tones[tone]}`}>{children}</span>;
}

/** Boosts are bought directly with Coins (no checkout flow needed) — see POST /api/economy/boosters. */
function BuyBoostButton({ item }: { item: MarketItem }) {
  const [state, setState] = useState<"idle" | "buying" | "done" | "error">("idle");

  async function buy() {
    if (!window.confirm(`Buy ${item.name} for ${item.priceCoin?.toLocaleString()} coins?`)) return;
    setState("buying");
    try {
      const res = await fetch("/api/economy/boosters", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boosterType: item.id }),
      });
      if (!res.ok) throw new Error();
      setState("done");
      setTimeout(() => setState("idle"), 3000);
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 3000);
    }
  }

  return (
    <button
      type="button"
      onClick={buy}
      disabled={state === "buying"}
      className="mt-2 w-full rounded-xl bg-blue-600 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
    >
      {state === "buying" ? "Buying…" : state === "done" ? "Activated!" : state === "error" ? "Failed — try again" : "Buy"}
    </button>
  );
}

export function MarketItemCard({ item, view }: { item: MarketItem; view: "grid" | "list" }) {
  const isBoost = item.kind === "platform" && item.category === "boosts_passes";
  const price =
    item.priceCoin != null
      ? `🪙 ${item.priceCoin.toLocaleString()}`
      : item.starsCost != null
      ? `⭐ ${item.starsCost.toLocaleString()}`
      : null;

  const badges = (
    <div className="flex flex-wrap gap-1">
      {item.isSponsored && <Badge tone="amber">Sponsored</Badge>}
      {item.isAdminFeatured && <Badge tone="blue">Featured</Badge>}
      <Badge tone="teal">{CATEGORY_LABEL[item.category]}</Badge>
    </div>
  );

  const ratingLine =
    item.kind === "creator" && item.rating != null ? (
      <p className="text-xs text-amber-600">★ {item.rating.toFixed(1)} ({item.ratingCount})</p>
    ) : null;

  if (view === "list") {
    const inner = (
      <>
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-2xl dark:bg-neutral-800">
          {item.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.imageUrl} alt={item.name} className="h-12 w-12 rounded-lg object-cover" />
          ) : (
            "🛍️"
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-neutral-900 dark:text-neutral-100">{item.name}</p>
          {item.creatorUsername && <p className="text-xs text-neutral-500">by @{item.creatorUsername}</p>}
          {ratingLine}
          {badges}
        </div>
        {price && <span className="shrink-0 font-bold text-amber-600">{price}</span>}
      </>
    );
    if (isBoost) {
      return (
        <div className="flex flex-col gap-2 rounded-xl border border-neutral-200 bg-white p-3 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex items-center gap-3">{inner}</div>
          <BuyBoostButton item={item} />
        </div>
      );
    }
    return (
      <Link
        href={item.href}
        className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-3 shadow-sm transition-shadow hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900"
      >
        {inner}
      </Link>
    );
  }

  const cardBody = (
    <>
      <div className="mb-3 flex h-28 items-center justify-center overflow-hidden rounded-xl bg-neutral-100 text-4xl dark:bg-neutral-800">
        {item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.imageUrl} alt={item.name} className="h-full w-full object-cover" />
        ) : (
          "🛍️"
        )}
      </div>
      <div className="mb-1">{badges}</div>
      <p className="mb-0.5 truncate font-semibold text-neutral-900 dark:text-neutral-100">{item.name}</p>
      {item.creatorUsername && <p className="mb-1 text-xs text-neutral-500">by @{item.creatorUsername}</p>}
      {ratingLine}
      {price && <p className="mt-1 text-lg font-bold text-amber-600">{price}</p>}
    </>
  );

  return (
    <div className="flex flex-col rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900">
      {isBoost ? <div className="flex flex-col">{cardBody}</div> : <Link href={item.href} className="flex flex-col">{cardBody}</Link>}
      {isBoost && <BuyBoostButton item={item} />}
      {item.referralEnabled && (
        <ReferralShareDropdown
          itemUrl={item.href}
          isPhysical={item.category === "physical"}
          commissionPct={item.referralCommissionPct}
        />
      )}
    </div>
  );
}
