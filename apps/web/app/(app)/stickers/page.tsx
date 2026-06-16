"use client";

/**
 * app/(app)/stickers/page.tsx
 *
 * Sticker store page. Shows all sticker packs in a mobile-first card grid.
 * Packs can be free, purchasable with coins, or earnable.
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { useCurrency } from "@/lib/hooks/useCurrency";
import { translateApiError } from "@/lib/i18n/apiErrors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PackUnlockType = "free" | "coins" | "earn";

interface StickerPack {
  id: string;
  name: string;
  coverEmoji: string;
  unlockType: PackUnlockType;
  coinPrice: number | null;
  earnCondition: string | null;
  stickerCount: number;
  owned: boolean;
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function PackSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-3 h-16 w-16 rounded-2xl bg-neutral-200 dark:bg-neutral-700" />
      <div className="mb-2 h-4 w-3/4 rounded bg-neutral-200 dark:bg-neutral-700" />
      <div className="h-3 w-1/2 rounded bg-neutral-200 dark:bg-neutral-700" />
      <div className="mt-4 h-9 rounded-xl bg-neutral-200 dark:bg-neutral-700" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pack card
// ---------------------------------------------------------------------------

interface PackCardProps {
  pack: StickerPack;
  onUnlock: (packId: string) => void;
  unlocking: boolean;
}

function PackCard({ pack, onUnlock, unlocking }: PackCardProps) {
  const currency = useCurrency();
  const badgeLabel =
    pack.unlockType === "free"
      ? "Free"
      : pack.unlockType === "coins"
      ? `🪙 ${pack.coinPrice?.toLocaleString()} ${currency.softPlural}`
      : "Earn";

  const badgeClasses =
    pack.unlockType === "free"
      ? "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-400"
      : pack.unlockType === "coins"
      ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"
      : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400";

  return (
    <div className="flex flex-col rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900">
      {/* Cover emoji */}
      <div className="relative mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-neutral-100 text-4xl dark:bg-neutral-800">
        {pack.coverEmoji}
        {pack.owned && (
          <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-teal-500 text-xs text-white">
            ✓
          </span>
        )}
      </div>

      {/* Info */}
      <p className="mb-0.5 font-semibold text-neutral-900 dark:text-neutral-100">{pack.name}</p>
      <p className="mb-2 text-xs text-neutral-500">{pack.stickerCount} stickers</p>

      {/* Price badge */}
      <span className={`self-start rounded-full px-2.5 py-0.5 text-xs font-semibold ${badgeClasses}`}>
        {badgeLabel}
      </span>

      {/* Earn condition */}
      {pack.unlockType === "earn" && pack.earnCondition && (
        <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 dark:border-blue-900 dark:bg-blue-950/30">
          <p className="text-xs font-medium text-blue-700 dark:text-blue-300">
            🔒 {pack.earnCondition}
          </p>
        </div>
      )}

      {/* Action */}
      <div className="mt-auto pt-4">
        {pack.owned ? (
          <div className="flex items-center justify-center gap-1.5 rounded-xl bg-teal-50 py-2 text-sm font-semibold text-teal-700 dark:bg-teal-900/30 dark:text-teal-400">
            <span>✓</span> Owned
          </div>
        ) : pack.unlockType === "earn" ? (
          <div className="flex items-center justify-center gap-1.5 rounded-xl bg-neutral-100 py-2 text-sm font-semibold text-neutral-500 dark:bg-neutral-800">
            🔒 Locked
          </div>
        ) : (
          <button
            onClick={() => onUnlock(pack.id)}
            disabled={unlocking}
            className="w-full rounded-xl bg-blue-600 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
          >
            {unlocking ? "Unlocking…" : pack.unlockType === "free" ? "Get Free" : "Unlock"}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function StickersPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const [packs, setPacks] = useState<StickerPack[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unlockingId, setUnlockingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  function showToast(msg: string, type: "success" | "error" = "success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/stickers", { credentials: "include" });
        if (res.status === 401) { router.push("/auth/login"); return; }
        if (!res.ok) throw new Error("Failed to load sticker packs");
        // API returns { success, data: { packs: [...snake_case rows] }, error }
        const json = await res.json() as {
          data?: { packs?: Array<Record<string, unknown>> };
          packs?: Array<Record<string, unknown>>;
        };
        const rows = json.data?.packs ?? json.packs ?? [];
        setPacks(rows.map((r): StickerPack => {
          const packType = (r.pack_type ?? r.unlockType) as string;
          const unlockType: PackUnlockType =
            packType === "earnable" ? "earn" : packType === "premium" ? "coins" : "free";
          return {
            id: r.id as string,
            name: r.name as string,
            coverEmoji: (r.cover_sticker_url ?? r.coverEmoji ?? "🎨") as string,
            unlockType,
            coinPrice: (r.coin_price ?? r.coinPrice ?? null) as number | null,
            earnCondition: (r.unlock_condition ?? r.earnCondition ?? null) as string | null,
            stickerCount: (r.sticker_count ?? r.stickerCount ?? 0) as number,
            owned: (r.unlocked ?? r.owned ?? false) as boolean,
          };
        }));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  async function handleUnlock(packId: string) {
    setUnlockingId(packId);
    try {
      const res = await fetch(`/api/stickers/${packId}/unlock`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const d = (await res.json()) as { message?: string; code?: string };
        const err = new Error(d.message ?? "Failed to unlock") as Error & { code?: string | null };
        err.code = d.code ?? null;
        throw err;
      }
      setPacks((prev) => prev.map((p) => (p.id === packId ? { ...p, owned: true } : p)));
      showToast("Sticker pack unlocked!");
    } catch (e) {
      const err = e as Error & { code?: string | null };
      showToast(e instanceof Error ? translateApiError(t, err.code, err.message || "Unlock failed") : "Unlock failed", "error");
    } finally {
      setUnlockingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Sticker Store</h1>
        <p className="mt-1 text-sm text-neutral-500">Unlock sticker packs to use in messages and rooms</p>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${
            toast.type === "success" ? "bg-teal-600" : "bg-red-600"
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <PackSkeleton key={i} />
          ))}
        </div>
      ) : packs.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-neutral-200 bg-white py-20 dark:border-neutral-800 dark:bg-neutral-900">
          <span className="text-5xl">😶</span>
          <p className="mt-3 text-lg font-semibold text-neutral-700 dark:text-neutral-300">No sticker packs yet</p>
          <p className="mt-1 text-sm text-neutral-500">Check back soon!</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {packs.map((pack) => (
            <PackCard
              key={pack.id}
              pack={pack}
              onUnlock={handleUnlock}
              unlocking={unlockingId === pack.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
