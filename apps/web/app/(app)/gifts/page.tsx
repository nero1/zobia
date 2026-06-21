"use client";

/**
 * app/(app)/gifts/page.tsx
 *
 * Gifts hub — send gifts to friends and view sent/received gift history.
 */

import { Suspense, useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { clsx } from "clsx";
import { Avatar } from "@/components/ui/Avatar";
import { useCurrency } from "@/lib/hooks/useCurrency";
import { translateApiError } from "@/lib/i18n/apiErrors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GiftUser {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarEmoji: string | null;
}

interface GiftRecord {
  id: string;
  createdAt: string;
  coinValue: number;
  status: string;
  direction: "sent" | "received";
  sender: GiftUser;
  recipient: GiftUser;
  giftItem: { name: string; emoji: string; tier: number };
}

interface GiftItem {
  id: string;
  name: string;
  emoji: string;
  coinCost: number;
  starCost: number | null;
  tier: number;
}

interface GiftTier {
  tier: number;
  label: string;
  gifts: GiftItem[];
}

interface Catalogue {
  tiers: GiftTier[];
}

interface UserSuggestion {
  id: string;
  username: string;
  displayName: string | null;
  avatarEmoji: string | null;
  isFriend?: boolean;
}

interface WalletBalance {
  coins: number;
  stars: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TIER_COLOUR: Record<number, string> = {
  1: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
  2: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
  3: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  4: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  5: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
};

function tierColour(tier: number) {
  return TIER_COLOUR[tier] ?? TIER_COLOUR[1];
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

// ---------------------------------------------------------------------------
// Send Gift modal
// ---------------------------------------------------------------------------

function SendGiftModal({
  onClose,
  prefilledRecipientId,
  prefilledUsername,
}: {
  onClose: () => void;
  prefilledRecipientId?: string;
  prefilledUsername?: string;
}) {
  const currency = useCurrency();
  const { t } = useTranslation();
  const [search, setSearch] = useState(prefilledUsername ?? "");
  const [suggestions, setSuggestions] = useState<UserSuggestion[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [recipient, setRecipient] = useState<UserSuggestion | null>(null);
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [wallet, setWallet] = useState<WalletBalance | null>(null);
  const [activeTier, setActiveTier] = useState<number | null>(null);
  const [selectedGift, setSelectedGift] = useState<GiftItem | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [verifyingPin, setVerifyingPin] = useState(false);
  const pendingSend = useRef<{ giftItemId: string; recipientId: string } | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load catalogue and wallet balance on mount
  useEffect(() => {
    fetch("/api/economy/gifts/catalogue", { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) {
          setCatalogue(data);
          setActiveTier(data.tiers[0]?.tier ?? 1);
        }
      })
      .catch(() => {});

    fetch("/api/economy/coins/balance", { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) setWallet(data); })
      .catch(() => {});
  }, []);

  // Pre-fill recipient if provided
  useEffect(() => {
    if (prefilledRecipientId && prefilledUsername) {
      setRecipient({
        id: prefilledRecipientId,
        username: prefilledUsername,
        displayName: null,
        avatarEmoji: null,
      });
    }
  }, [prefilledRecipientId, prefilledUsername]);

  // Search users
  useEffect(() => {
    if (recipient) return;
    if (search.length < 2) { setSuggestions([]); return; }

    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearchLoading(true);
      fetch(`/api/users/search?q=${encodeURIComponent(search)}&limit=6`, { credentials: "include" })
        .then((r) => r.ok ? r.json() : null)
        .then((data) => { setSuggestions(data?.data?.users ?? data?.users ?? []); })
        .catch(() => {})
        .finally(() => setSearchLoading(false));
    }, 300);
  }, [search, recipient]);

  const doSend = async (giftItemId: string, recipientId: string) => {
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/economy/gifts/send", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ giftItemId, recipientId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errCode = typeof data.error === "string" ? null : data.error?.code ?? null;
        const errMsg = typeof data.error === "string" ? data.error : data.error?.message;
        if (errCode === "PIN_REQUIRED") {
          pendingSend.current = { giftItemId, recipientId };
          setPinInput("");
          setPinError(null);
          setShowPinModal(true);
          return;
        }
        const err = new Error(errMsg ?? "Send failed") as Error & { code?: string | null };
        err.code = errCode;
        throw err;
      }
      setSent(true);
    } catch (err) {
      const e = err as Error & { code?: string | null };
      setError(err instanceof Error ? translateApiError(t, e.code, e.message || "Send failed") : "Send failed");
    } finally {
      setSending(false);
    }
  };

  const handleSend = async () => {
    if (!recipient || !selectedGift) return;
    await doSend(selectedGift.id, recipient.id);
  };

  const handlePinVerify = async () => {
    if (!pinInput.trim()) { setPinError("Enter your PIN"); return; }
    setVerifyingPin(true);
    setPinError(null);
    try {
      const res = await fetch("/api/auth/pin/verify", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: pinInput.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setPinError(data.error?.message ?? "Incorrect PIN");
        return;
      }
      setShowPinModal(false);
      setPinInput("");
      if (pendingSend.current) {
        const { giftItemId, recipientId } = pendingSend.current;
        pendingSend.current = null;
        await doSend(giftItemId, recipientId);
      }
    } catch {
      setPinError("Network error. Try again.");
    } finally {
      setVerifyingPin(false);
    }
  };

  const tierData = catalogue?.tiers.find((t) => t.tier === activeTier);

  // Escape closes modal
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  if (showPinModal) {
    return (
      <div className="flex flex-col gap-4 py-4">
        <h3 className="text-base font-bold text-neutral-900 dark:text-neutral-50">Enter your PIN</h3>
        <p className="text-sm text-neutral-500">Your account has PIN protection enabled. Enter your PIN to send this gift.</p>
        <input
          type="password"
          inputMode="numeric"
          maxLength={6}
          value={pinInput}
          onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => { if (e.key === "Enter") void handlePinVerify(); }}
          placeholder="PIN"
          className="w-full rounded-xl border border-neutral-200 px-4 py-3 text-center text-xl tracking-widest outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-200 dark:border-neutral-700 dark:bg-neutral-800"
          autoFocus
        />
        {pinError && <p className="text-sm text-red-500">{pinError}</p>}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => { setShowPinModal(false); setPinInput(""); }}
            className="flex-1 rounded-xl border border-neutral-200 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handlePinVerify()}
            disabled={verifyingPin || pinInput.length < 4}
            className="flex-1 rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-60"
          >
            {verifyingPin ? "Verifying…" : "Confirm"}
          </button>
        </div>
      </div>
    );
  }

  if (sent) {
    return (
      <div className="flex flex-col items-center gap-4 py-8 text-center">
        <span className="text-5xl" aria-hidden="true">{selectedGift?.emoji}</span>
        <p className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
          Gift sent to @{recipient?.username}!
        </p>
        <p className="text-sm text-neutral-500">
          You sent {selectedGift?.name} — they&apos;ll love it 🎉
        </p>
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl bg-primary-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-primary-700"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Recipient picker */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
          Send to
        </label>
        {recipient ? (
          <div className="flex items-center justify-between rounded-xl border border-primary-300 bg-primary-50 px-3 py-2.5 dark:border-primary-700 dark:bg-primary-950">
            <div className="flex items-center gap-2">
              <Avatar name={recipient.displayName ?? recipient.username} emoji={recipient.avatarEmoji ?? undefined} size="xs" rankTier="none" />
              <span className="text-sm font-medium text-neutral-900 dark:text-neutral-50">
                @{recipient.username}
              </span>
            </div>
            <button
              type="button"
              onClick={() => { setRecipient(null); setSearch(""); setSelectedGift(null); }}
              className="text-xs text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
            >
              Change
            </button>
          </div>
        ) : (
          <div className="relative">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by username…"
              className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-900 placeholder-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50 dark:placeholder-neutral-500"
            />
            {(suggestions.length > 0 || searchLoading) && (
              <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-800">
                {searchLoading && (
                  <div className="px-4 py-3 text-sm text-neutral-500">Searching…</div>
                )}
                {suggestions.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => { setRecipient(u); setSearch(u.username); setSuggestions([]); }}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-neutral-50 dark:hover:bg-neutral-700"
                  >
                    <Avatar name={u.displayName ?? u.username} emoji={u.avatarEmoji ?? undefined} size="xs" rankTier="none" />
                    <div>
                      <p className="font-medium text-neutral-900 dark:text-neutral-50">
                        {u.displayName ?? u.username}
                      </p>
                      <p className="text-xs text-neutral-500">@{u.username}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Gift catalogue */}
      {catalogue && recipient && (
        <>
          {/* Wallet balance */}
          {wallet && (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              🪙 <span className="font-medium text-neutral-700 dark:text-neutral-300">{wallet.coins.toLocaleString()} {currency.softPlural.toLowerCase()}</span> available
            </p>
          )}

          {/* Tier tabs */}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {catalogue.tiers.map((t) => (
              <button
                key={t.tier}
                type="button"
                onClick={() => { setActiveTier(t.tier); setSelectedGift(null); }}
                className={clsx(
                  "shrink-0 rounded-full border-2 px-3 py-1 text-xs font-semibold transition-colors",
                  activeTier === t.tier
                    ? "border-primary-500 bg-primary-50 text-primary-700 dark:border-primary-400 dark:bg-primary-950 dark:text-primary-300"
                    : "border-neutral-200 bg-white text-neutral-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Gift grid */}
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {(tierData?.gifts ?? []).map((gift) => {
              const canAfford = (wallet?.coins ?? 0) >= gift.coinCost;
              const isSelected = selectedGift?.id === gift.id;
              return (
                <button
                  key={gift.id}
                  type="button"
                  onClick={() => canAfford && setSelectedGift(isSelected ? null : gift)}
                  disabled={!canAfford}
                  className={clsx(
                    "flex flex-col items-center gap-1 rounded-xl border-2 p-2.5 text-center transition-colors",
                    isSelected
                      ? "border-primary-500 bg-primary-50 dark:border-primary-400 dark:bg-primary-950"
                      : canAfford
                      ? "border-neutral-200 bg-neutral-50 hover:border-neutral-300 dark:border-neutral-700 dark:bg-neutral-800"
                      : "cursor-not-allowed border-neutral-100 bg-neutral-50 opacity-40 dark:border-neutral-800 dark:bg-neutral-900"
                  )}
                >
                  <span className="text-2xl leading-none" aria-hidden="true">{gift.emoji}</span>
                  <span className="text-[10px] font-medium leading-tight text-neutral-700 dark:text-neutral-300">{gift.name}</span>
                  <span className={clsx("rounded-full px-1.5 py-0.5 text-[9px] font-semibold", tierColour(gift.tier))}>
                    🪙 {gift.coinCost.toLocaleString()}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950 dark:text-red-400">{error}</p>
      )}

      {/* Send button */}
      <div className="flex justify-end gap-2 border-t border-neutral-100 pt-4 dark:border-neutral-800">
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSend}
          disabled={!recipient || !selectedGift || sending}
          className="rounded-xl bg-primary-600 px-5 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? "Sending…" : selectedGift ? `Send ${selectedGift.emoji} ${selectedGift.name}` : "Send Gift"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gift history row
// ---------------------------------------------------------------------------

function GiftRow({ gift, currentUserId }: { gift: GiftRecord; currentUserId: string }) {
  const isSent = gift.direction === "sent";
  const other = isSent ? gift.recipient : gift.sender;
  const displayName = other.displayName ?? other.username ?? "Unknown";

  return (
    <div className="flex items-center gap-3 rounded-xl px-3 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
      <span className="text-2xl leading-none" aria-hidden="true">{gift.giftItem.emoji}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-50">
          {gift.giftItem.name}
        </p>
        <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
          {isSent ? "To" : "From"} @{other.username ?? "unknown"}
        </p>
      </div>
      <div className="flex flex-col items-end gap-0.5">
        <span className={clsx("rounded-full px-2 py-0.5 text-[10px] font-semibold", tierColour(gift.giftItem.tier))}>
          Tier {gift.giftItem.tier}
        </span>
        <span className="text-[10px] text-neutral-400 dark:text-neutral-500">
          {relativeTime(gift.createdAt)}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main gifts page
// ---------------------------------------------------------------------------

function GiftsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefilledId = searchParams.get("recipientId") ?? undefined;
  const prefilledUsername = searchParams.get("username") ?? undefined;
  const { t } = useTranslation();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const [tab, setTab] = useState<"received" | "sent">("received");
  const [gifts, setGifts] = useState<GiftRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(!!prefilledId);
  const [currentUserId, setCurrentUserId] = useState<string>("");

  // Get current user
  useEffect(() => {
    fetch("/api/users/me", { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data?.id) setCurrentUserId(data.id); })
      .catch(() => {});
  }, []);

  const loadGifts = useCallback((direction: "received" | "sent") => {
    setLoading(true);
    setError(null);
    fetch(`/api/economy/gifts?type=${direction}&limit=40`, { credentials: "include" })
      .then((r) =>
        r.ok
          ? r.json()
          : r.json().catch(() => ({})).then((body) => {
              const errMsg = typeof body.error === "string" ? body.error : body.error?.message;
              const errCode = typeof body.error === "string" ? null : body.error?.code ?? null;
              const err = new Error(errMsg ?? "Load failed") as Error & { code?: string | null };
              err.code = errCode;
              return Promise.reject(err);
            })
      )
      .then((data) => setGifts(data.gifts ?? []))
      .catch((e) => {
        const err = e as Error & { code?: string | null };
        setError(e instanceof Error ? translateApiError(tRef.current, err.code, err.message || "Load failed") : "Load failed");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadGifts(tab);
  }, [tab, loadGifts]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6">
      {/* Page header */}
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">🎁 Gifts</h1>
          <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">
            Send gifts to friends and see your gift history
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-700 active:bg-primary-800"
          >
            🎁 Send a Gift
          </button>
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="text-xs text-neutral-400 underline hover:text-neutral-600 dark:hover:text-neutral-300"
          >
            Browse gift catalog
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-1 rounded-xl border border-neutral-200 bg-neutral-100 p-1 dark:border-neutral-700 dark:bg-neutral-800">
        {(["received", "sent"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={clsx(
              "flex-1 rounded-lg py-2 text-sm font-medium transition-colors capitalize",
              tab === t
                ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-900 dark:text-neutral-50"
                : "text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
            )}
          >
            {t === "received" ? "📥 Received" : "📤 Sent"}
          </button>
        ))}
      </div>

      {/* Gift list */}
      <div className="rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        {loading ? (
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-3">
                <div className="h-8 w-8 animate-pulse rounded-full bg-neutral-200 dark:bg-neutral-700" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-32 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
                  <div className="h-2.5 w-20 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 py-10">
            <p className="text-sm text-neutral-500 dark:text-neutral-400">{error}</p>
            <button
              type="button"
              onClick={() => loadGifts(tab)}
              className="rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              Retry
            </button>
          </div>
        ) : gifts.length === 0 ? (
          <div className="flex flex-col items-center gap-4 py-12 text-center">
            <span className="text-4xl" aria-hidden="true">🎁</span>
            <div>
              <p className="font-semibold text-neutral-900 dark:text-neutral-50">
                {tab === "received" ? "No gifts received yet" : "No gifts sent yet"}
              </p>
              <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                {tab === "received"
                  ? "Share your profile with friends — they might surprise you!"
                  : "Spread some love — send a gift to a friend!"}
              </p>
            </div>
            {tab === "sent" && (
              <button
                type="button"
                onClick={() => setShowModal(true)}
                className="rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-700"
              >
                🎁 Send a Gift
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {gifts.map((gift) => (
              <GiftRow key={gift.id} gift={gift} currentUserId={currentUserId} />
            ))}
          </div>
        )}
      </div>

      {/* Send gift modal */}
      {showModal && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40"
            aria-hidden="true"
            onClick={() => setShowModal(false)}
          />
          <div
            role="dialog"
            aria-label="Send a gift"
            className="fixed left-4 right-4 top-1/2 z-50 max-h-[85vh] -translate-y-1/2 overflow-y-auto rounded-2xl bg-white shadow-2xl dark:bg-neutral-900 sm:left-1/2 sm:right-auto sm:w-full sm:max-w-lg sm:-translate-x-1/2"
          >
            <div className="sticky top-0 flex items-center justify-between border-b border-neutral-100 bg-white px-5 py-4 dark:border-neutral-800 dark:bg-neutral-900">
              <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-50">
                🎁 Send a Gift
              </h2>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="rounded-full p-2 text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
                aria-label="Close"
              >
                <span aria-hidden="true" className="text-lg leading-none">✕</span>
              </button>
            </div>
            <div className="px-5 py-4">
              <SendGiftModal
                onClose={() => {
                  setShowModal(false);
                  loadGifts(tab);
                }}
                prefilledRecipientId={prefilledId}
                prefilledUsername={prefilledUsername}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function GiftsPage() {
  return (
    <Suspense>
      <GiftsPageContent />
    </Suspense>
  );
}
