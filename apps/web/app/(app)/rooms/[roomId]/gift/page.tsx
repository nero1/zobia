"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { useCurrency } from "@/lib/hooks/useCurrency";
import { translateApiError } from "@/lib/i18n/apiErrors";

interface GiftItem {
  id: string;
  name: string;
  emoji: string;
  coinCost: number;
  tier: number;
}

interface GiftTier {
  tier: number;
  label: string;
  gifts: GiftItem[];
}

export default function RoomGiftPage() {
  const params = useParams();
  const router = useRouter();
  const roomId = params.roomId as string;
  const currency = useCurrency();
  const { t } = useTranslation();

  const [tiers, setTiers] = useState<GiftTier[]>([]);
  const [loadingCatalogue, setLoadingCatalogue] = useState(true);
  const [balance, setBalance] = useState<number | null>(null);
  const [creatorId, setCreatorId] = useState<string | null>(null);
  const [creatorUsername, setCreatorUsername] = useState<string>("");
  const [selected, setSelected] = useState<GiftItem | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch room info for creator id
  useEffect(() => {
    fetch(`/api/rooms/${roomId}`, { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((data: { room?: { creator_id?: string; creator_username?: string } } | null) => {
        if (data?.room) {
          setCreatorId(data.room.creator_id ?? null);
          setCreatorUsername(data.room.creator_username ?? "");
        }
      })
      .catch(() => {});
  }, [roomId]);

  // Fetch gift catalogue
  useEffect(() => {
    fetch("/api/economy/gifts/catalogue", { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((data: { tiers?: GiftTier[] } | null) => {
        setTiers(data?.tiers ?? []);
      })
      .catch(() => {})
      .finally(() => setLoadingCatalogue(false));
  }, []);

  // Fetch coin balance
  useEffect(() => {
    fetch("/api/economy/coins/balance", { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((data: { balance?: number } | null) => {
        if (data?.balance != null) setBalance(data.balance);
      })
      .catch(() => {});
  }, []);

  async function handleSend() {
    if (!selected || !creatorId) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/economy/gifts/send", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          giftItemId: selected.id,
          recipientId: creatorId,
          roomId,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: { code?: string; message?: string } | string };
        const code = typeof body.error === "object" ? body.error?.code : undefined;
        const message = typeof body.error === "object" ? body.error?.message : body.error;
        const err = new Error(message ?? "Failed to send gift") as Error & { code?: string | null };
        err.code = code ?? null;
        throw err;
      }
      setSent(true);
      setTimeout(() => router.push(`/rooms/${roomId}`), 2000);
    } catch (e) {
      const err = e as Error & { code?: string | null };
      setError(translateApiError(t, err.code, err.message || "Error sending gift"));
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 p-6">
        <span className="text-6xl">{selected?.emoji ?? "🎁"}</span>
        <h2 className="text-xl font-bold text-neutral-900 dark:text-neutral-50">Gift Sent!</h2>
        <p className="text-sm text-neutral-500">Redirecting back to room…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-[100dvh] max-w-lg p-4 sm:p-6">
      {/* Header */}
      <div className="mb-5 flex items-center gap-3">
        <Link href={`/rooms/${roomId}`} className="text-sm text-blue-600 hover:underline dark:text-blue-400">
          ← Back
        </Link>
        <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-50">Send a Gift</h1>
      </div>

      {/* Recipient */}
      {creatorUsername && (
        <div className="mb-4 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
          Gifting to <span className="font-semibold text-neutral-900 dark:text-neutral-100">@{creatorUsername}</span>
        </div>
      )}

      {/* Coin balance */}
      {balance != null && (
        <div className="mb-4 flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
          <span>🪙</span>
          <span>Your balance: <span className="font-semibold text-neutral-900 dark:text-neutral-100">{balance.toLocaleString()} {currency.softPlural.toLowerCase()}</span></span>
        </div>
      )}

      {/* Catalogue */}
      {loadingCatalogue ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
              <div className="mb-3 h-3 w-20 rounded bg-neutral-200 dark:bg-neutral-700" />
              <div className="grid grid-cols-4 gap-2">
                {[1, 2, 3, 4].map((j) => (
                  <div key={j} className="aspect-square rounded-xl bg-neutral-200 dark:bg-neutral-700" />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : tiers.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-white py-12 text-center dark:border-neutral-800 dark:bg-neutral-900">
          <span className="text-4xl">🎁</span>
          <p className="mt-3 text-sm text-neutral-500">No gifts available right now.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {tiers.map((tier) => (
            <div key={tier.tier} className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-400">
                {tier.label}
              </p>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                {tier.gifts.map((gift) => (
                  <button
                    key={gift.id}
                    onClick={() => setSelected(selected?.id === gift.id ? null : gift)}
                    className={`flex flex-col items-center rounded-xl border p-2 transition-colors ${
                      selected?.id === gift.id
                        ? "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/40"
                        : "border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
                    }`}
                  >
                    <span className="text-2xl">{gift.emoji}</span>
                    <span className="mt-1 text-center text-[10px] leading-tight text-neutral-500 dark:text-neutral-400">
                      {gift.name}
                    </span>
                    <span className="mt-0.5 text-[10px] font-bold text-amber-600">
                      🪙{gift.coinCost.toLocaleString()}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Selected gift summary + send */}
      {selected && (
        <div className="sticky bottom-4 mt-4 rounded-2xl border border-blue-200 bg-white p-4 shadow-lg dark:border-blue-800 dark:bg-neutral-900">
          <div className="mb-3 flex items-center gap-3">
            <span className="text-3xl">{selected.emoji}</span>
            <div>
              <p className="font-semibold text-neutral-900 dark:text-neutral-100">{selected.name}</p>
              <p className="text-sm text-amber-600">🪙 {selected.coinCost.toLocaleString()} {currency.softPlural.toLowerCase()}</p>
            </div>
          </div>
          {error && <p className="mb-2 text-xs text-red-500">{error}</p>}
          <button
            onClick={handleSend}
            disabled={sending || !creatorId}
            className="w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {sending ? "Sending…" : `Send ${selected.emoji} ${selected.name}`}
          </button>
        </div>
      )}
    </div>
  );
}
