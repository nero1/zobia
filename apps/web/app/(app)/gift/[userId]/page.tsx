"use client";

/**
 * app/(app)/gift/[userId]/page.tsx
 *
 * Gift-to-user page — /gift/:userId
 *
 * Lets a visitor send coins or a gift item directly to another user.
 * Linked from user profile share cards, deep links (zobia://gift/:userId),
 * and the Expo app.
 *
 * Data flow:
 *   GET  /api/users/:userId/public   — fetch recipient profile
 *   POST /api/economy/gifts/send     — send gift
 */

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useCurrency } from "@/lib/hooks/useCurrency";

interface RecipientProfile {
  id: string;
  username: string;
  displayName: string;
  avatarEmoji: string;
  rankName: string;
}

interface GiftItem {
  id: string;
  name: string;
  emoji: string;
  coinValue: number;
  description: string;
}

export default function GiftUserPage() {
  const params = useParams();
  const router = useRouter();
  const currency = useCurrency();
  const userId = params.userId as string;

  const [recipient, setRecipient] = useState<RecipientProfile | null>(null);
  const [giftItems, setGiftItems] = useState<GiftItem[]>([]);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [selectedGift, setSelectedGift] = useState<GiftItem | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    Promise.all([
      fetch(`/api/users/${userId}/public`, { credentials: "include" }),
      fetch("/api/economy/gift-items", { credentials: "include" }),
    ])
      .then(async ([profileRes, itemsRes]) => {
        if (profileRes.ok) {
          const d = (await profileRes.json()) as { user?: RecipientProfile; data?: RecipientProfile };
          setRecipient(d.user ?? d.data ?? null);
        } else if (profileRes.status === 404) {
          setError("User not found.");
        }
        if (itemsRes.ok) {
          const d = (await itemsRes.json()) as { items?: GiftItem[]; data?: { items?: GiftItem[] } };
          const items = d.items ?? d.data?.items ?? [];
          setGiftItems(items.slice(0, 8));
        }
      })
      .catch(() => setError("Could not load profile."))
      .finally(() => setLoadingProfile(false));
  }, [userId]);

  async function handleSend() {
    if (!selectedGift || !recipient) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/economy/gifts/send", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientId: recipient.id, giftItemId: selectedGift.id }),
      });
      if (res.ok) {
        setSent(true);
      } else {
        const d = (await res.json()) as { error?: { message?: string } };
        setError(d.error?.message ?? "Failed to send gift.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSending(false);
    }
  }

  if (loadingProfile) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  if (error && !recipient) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6">
        <p className="text-neutral-500">{error}</p>
        <Link href="/home" className="text-sm text-blue-600 hover:underline">← Back to Home</Link>
      </div>
    );
  }

  if (sent) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6">
        <span className="text-6xl">🎉</span>
        <h1 className="text-xl font-bold text-neutral-900 dark:text-white">Gift Sent!</h1>
        <p className="text-sm text-neutral-500">
          You sent <strong>{selectedGift?.name}</strong> to <strong>@{recipient?.username}</strong>.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => { setSent(false); setSelectedGift(null); }}
            className="rounded-xl border border-neutral-200 px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300"
          >
            Send Another
          </button>
          <Link
            href={`/profile/${userId}`}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            View Profile
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md p-6">
      {/* Recipient card */}
      {recipient && (
        <div className="mb-6 flex items-center gap-4 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-neutral-100 text-3xl dark:bg-neutral-800">
            {recipient.avatarEmoji}
          </span>
          <div>
            <p className="font-bold text-neutral-900 dark:text-white">{recipient.displayName}</p>
            <p className="text-sm text-neutral-500">@{recipient.username}</p>
            <p className="text-xs text-neutral-400">{recipient.rankName}</p>
          </div>
          <Link
            href={`/profile/${userId}`}
            className="ml-auto text-xs text-blue-600 hover:underline dark:text-blue-400"
          >
            View profile
          </Link>
        </div>
      )}

      <h1 className="mb-4 text-lg font-bold text-neutral-900 dark:text-white">
        🎁 Send a Gift
      </h1>

      {giftItems.length === 0 ? (
        <p className="text-sm text-neutral-500">No gift items available.</p>
      ) : (
        <div className="grid grid-cols-4 gap-2">
          {giftItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelectedGift(item)}
              className={`flex flex-col items-center rounded-xl border p-2 transition-colors ${
                selectedGift?.id === item.id
                  ? "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/30"
                  : "border-neutral-200 bg-white hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900"
              }`}
            >
              <span className="text-2xl">{item.emoji}</span>
              <span className="mt-1 text-[10px] font-semibold text-neutral-700 dark:text-neutral-300 truncate w-full text-center">{item.name}</span>
              <span className="text-[10px] text-amber-600 dark:text-amber-400">
                🪙 {item.coinValue}
              </span>
            </button>
          ))}
        </div>
      )}

      {selectedGift && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
            Sending <strong>{selectedGift.name}</strong> {selectedGift.emoji} for{" "}
            <strong>🪙 {selectedGift.coinValue} {currency.softPlural.toLowerCase()}</strong>
          </p>
        </div>
      )}

      {error && (
        <p className="mt-3 text-sm font-medium text-red-600 dark:text-red-400">{error}</p>
      )}

      <button
        type="button"
        onClick={() => void handleSend()}
        disabled={!selectedGift || sending}
        className="mt-4 w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {sending ? "Sending…" : "Send Gift 🎁"}
      </button>

      <Link
        href={`/profile/${userId}`}
        className="mt-3 block text-center text-xs text-neutral-400 hover:text-neutral-600"
      >
        View @{recipient?.username ?? "user"}&apos;s profile instead
      </Link>
    </div>
  );
}
