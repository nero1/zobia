"use client";

/**
 * app/(app)/wallet/page.tsx
 *
 * Coin Store / Wallet page.
 * - Coin & star balance
 * - Transaction history (last 20)
 * - Coin packs for purchase (Paystack checkout)
 * - Active booster packs & subscription plan info
 * - Coin transfer panel (opened via ?transfer=<userId>)
 */

import { Suspense, useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { useCurrency, type CurrencyNames } from "@/lib/hooks/useCurrency";
import { translateApiError } from "@/lib/i18n/apiErrors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Balance {
  coins: number;
  stars: number;
  xp: number;
  plan?: string;
}

interface Transaction {
  id: string;
  type: string;
  amount: number;
  balanceBefore?: number;
  balanceAfter?: number;
  description: string | null;
  createdAt: string;
}

interface CoinPack {
  id: string;
  name: string;
  coins: number;
  price: number;
  currency: string;
  badge?: string;
}

interface BoosterPack {
  id: string;
  name: string;
  description: string;
  expiresAt: string;
}

interface EarningsData {
  totalMonthNgn: number;
  pendingPayouts: { id: string; amount: number; currency: string; method: string; status: string; createdAt: string }[];
}

interface StoreData {
  balance: Balance;
  transactions: Transaction[];
  starTransactions: Transaction[];
  coinPacks: CoinPack[];
  boosters: BoosterPack[];
  activePlan: string | null;
  earnings: EarningsData | null;
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-neutral-200 dark:bg-neutral-700 ${className}`} />;
}

function WalletSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <SkeletonBlock className="h-24 rounded-xl" />
        <SkeletonBlock className="h-24 rounded-xl" />
      </div>
      <SkeletonBlock className="h-48 rounded-xl" />
      <SkeletonBlock className="h-64 rounded-xl" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Balance Cards
// ---------------------------------------------------------------------------

function BalanceCard({ balance, activePlan, currency }: { balance: Balance; activePlan: string | null; currency: CurrencyNames }) {
  const plan = activePlan ?? balance.plan ?? "Free";
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
          <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">XP</p>
          <div className="mt-2 flex items-center gap-1.5">
            <span className="text-xl">⚡</span>
            <span className="text-xl font-bold text-neutral-900 dark:text-neutral-50">
              {(balance.xp ?? 0).toLocaleString()}
            </span>
          </div>
          <p className="mt-1 text-xs text-neutral-400">Experience</p>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
          <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{currency.softPlural}</p>
          <div className="mt-2 flex items-center gap-1.5">
            <span className="text-xl">🪙</span>
            <span className="text-xl font-bold text-neutral-900 dark:text-neutral-50">
              {balance.coins.toLocaleString()}
            </span>
          </div>
          <p className="mt-1 text-xs text-neutral-400">Soft currency</p>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
          <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{currency.premiumPlural}</p>
          <div className="mt-2 flex items-center gap-1.5">
            <span className="text-xl">⭐</span>
            <span className="text-xl font-bold text-neutral-900 dark:text-neutral-50">
              {balance.stars.toLocaleString()}
            </span>
          </div>
          <p className="mt-1 text-xs text-neutral-400">Premium</p>
        </div>
      </div>
      <div className="flex items-center justify-between rounded-xl border border-neutral-200 bg-white px-5 py-3 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Current Plan</p>
          <p className="mt-0.5 font-bold text-neutral-900 capitalize dark:text-neutral-50">{plan}</p>
        </div>
        <a
          href="/settings/subscription"
          className="text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400"
        >
          Manage →
        </a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Income & Pending Payouts
// ---------------------------------------------------------------------------

function EarningsSection({ earnings }: { earnings: EarningsData }) {
  return (
    <div className="space-y-3">
      {/* Income this month */}
      <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
        <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Income This Month</p>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-2xl">💰</span>
          <span className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">
            ₦{earnings.totalMonthNgn.toLocaleString()}
          </span>
        </div>
        <p className="mt-1 text-xs text-neutral-400">From gifts, tips, and sponsorships</p>
      </div>

      {/* Pending payouts */}
      {earnings.pendingPayouts.length > 0 && (
        <div className="rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
          <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
            <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Pending Payouts</h2>
          </div>
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {earnings.pendingPayouts.map((p) => (
              <div key={p.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="text-sm font-medium capitalize text-neutral-900 dark:text-neutral-100">
                    {p.method.replace(/_/g, " ")}
                  </p>
                  <p className="text-xs text-neutral-500">
                    {new Date(p.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-neutral-800 dark:text-neutral-200">
                    ₦{(p.amount / 100).toLocaleString()}
                  </p>
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold capitalize text-amber-700 dark:bg-amber-900 dark:text-amber-300">
                    {p.status.replace(/_/g, " ")}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Coin Packs
// ---------------------------------------------------------------------------

interface CoinPacksProps {
  packs: CoinPack[];
  onPurchase: (packId: string) => Promise<void>;
  purchasing: string | null;
}

function CoinPacks({ packs, onPurchase, purchasing, currency }: CoinPacksProps & { currency: CurrencyNames }) {
  if (packs.length === 0) return null;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
        <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Buy {currency.softPlural}</h2>
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
        {packs.map((pack) => (
          <div
            key={pack.id}
            className="flex flex-col rounded-xl border border-neutral-200 p-4 dark:border-neutral-700"
          >
            {pack.badge && (
              <span className="mb-2 self-start rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900 dark:text-amber-300">
                {pack.badge}
              </span>
            )}
            <div className="flex items-center gap-2">
              <span className="text-2xl">🪙</span>
              <span className="text-xl font-bold text-neutral-900 dark:text-neutral-50">
                {pack.coins.toLocaleString()}
              </span>
            </div>
            <p className="mt-1 text-sm font-semibold text-neutral-700 dark:text-neutral-300">{pack.name}</p>
            <button
              onClick={() => onPurchase(pack.id)}
              disabled={purchasing === pack.id}
              className="mt-3 rounded-xl bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {purchasing === pack.id
                ? "Processing…"
                : `${pack.currency} ${(pack.price / 100).toLocaleString()}`}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Transaction History (coins + stars tabs)
// ---------------------------------------------------------------------------

function txLabel(type: string): string {
  const map: Record<string, string> = {
    purchase: "Purchase",
    gift_sent: "Gift Sent",
    gift_received: "Gift Received",
    quest_reward: "Quest Reward",
    dm_cost: "Message",
    transfer_sent: "Transfer Out",
    transfer_received: "Transfer In",
    admin_grant: "Bonus",
    refund: "Refund",
    room_entry_fee: "Room Entry",
    room_subscription: "Room Subscription",
    creator_earning: "Creator Earning",
    payout: "Payout",
    booster_purchase: "Booster",
    season_reward: "Season Reward",
    xp_reward: "XP Reward",
    star_gift: "Star Gift",
    star_purchase: "Star Purchase",
  };
  return map[type] ?? type.replace(/_/g, " ");
}

function TransactionHistory({ transactions, starTransactions, currency }: { transactions: Transaction[]; starTransactions: Transaction[]; currency: CurrencyNames }) {
  const [tab, setTab] = useState<"coins" | "stars">("coins");
  const list = tab === "coins" ? transactions : starTransactions;
  const icon = tab === "coins" ? "🪙" : "⭐";

  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
        <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Transaction History</h2>
        <div className="flex gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-0.5 dark:border-neutral-700 dark:bg-neutral-800">
          <button
            onClick={() => setTab("coins")}
            className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${tab === "coins" ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-50" : "text-neutral-500"}`}
          >
            🪙 {currency.softPlural}
          </button>
          <button
            onClick={() => setTab("stars")}
            className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${tab === "stars" ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-50" : "text-neutral-500"}`}
          >
            ⭐ {currency.premiumPlural}
          </button>
        </div>
      </div>
      {list.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-neutral-500">No {tab === "coins" ? currency.softPlural.toLowerCase() : currency.premiumPlural.toLowerCase()} transactions yet.</div>
      ) : (
        <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {list.map((tx) => (
            <div key={tx.id} className="flex items-center justify-between px-5 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium capitalize text-neutral-900 dark:text-neutral-100">
                  {tx.description ?? txLabel(tx.type)}
                </p>
                <p className="text-xs text-neutral-500">
                  {new Date(tx.createdAt).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
              <span className={`ml-3 shrink-0 font-bold tabular-nums ${tx.amount >= 0 ? "text-teal-600" : "text-red-500"}`}>
                {tx.amount >= 0 ? "+" : ""}{tx.amount.toLocaleString()} {icon}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Booster Packs
// ---------------------------------------------------------------------------

/** Returns a live countdown string for a booster expiry timestamp. */
function useBoosterCountdown(expiresAt: string): string {
  const [label, setLabel] = useState(() => computeCountdown(expiresAt));

  useEffect(() => {
    const t = setInterval(() => setLabel(computeCountdown(expiresAt)), 60_000);
    return () => clearInterval(t);
  }, [expiresAt]);

  return label;
}

function computeCountdown(expiresAt: string): string {
  const msLeft = new Date(expiresAt).getTime() - Date.now();
  if (msLeft <= 0) return "Expired";
  const h = Math.floor(msLeft / 3_600_000);
  const m = Math.floor((msLeft % 3_600_000) / 60_000);
  if (h >= 24) {
    const d = Math.floor(h / 24);
    return `${d}d ${h % 24}h left`;
  }
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m left`;
}

function BoosterRow({ booster }: { booster: BoosterPack }) {
  const countdown = useBoosterCountdown(booster.expiresAt);
  const isExpiringSoon = new Date(booster.expiresAt).getTime() - Date.now() < 3_600_000;

  return (
    <div className="flex items-start justify-between px-5 py-3">
      <div>
        <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{booster.name}</p>
        <p className="text-xs text-neutral-500">{booster.description}</p>
      </div>
      <span className={`ml-3 shrink-0 text-xs font-semibold tabular-nums ${isExpiringSoon ? "text-red-500 dark:text-red-400" : "text-neutral-400"}`}>
        {countdown}
      </span>
    </div>
  );
}

function BoosterPacks({ boosters }: { boosters: BoosterPack[] }) {
  if (boosters.length === 0) return null;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
        <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Active Boosters</h2>
      </div>
      <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
        {boosters.map((b) => <BoosterRow key={b.id} booster={b} />)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Coin Transfer Panel
// ---------------------------------------------------------------------------

interface TransferRecipient {
  id: string;
  username: string;
  display_name?: string;
}

interface CoinTransferPanelProps {
  recipientId: string;
  onSuccess: (msg: string) => void;
  onClose: () => void;
}

function CoinTransferPanel({ recipientId, onSuccess, onClose, currency }: CoinTransferPanelProps & { currency: CurrencyNames }) {
  const { t } = useTranslation();
  const [recipient, setRecipient] = useState<TransferRecipient | null>(null);
  const [loadingRecipient, setLoadingRecipient] = useState(true);
  const [amount, setAmount] = useState<string>("");
  const [sending, setSending] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ fee: number; net: number } | null>(null);

  useEffect(() => {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(recipientId)) {
      setLoadingRecipient(false);
      return;
    }
    fetch(`/api/users/${recipientId}`, { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) return;
        const d = (await r.json()) as { user?: TransferRecipient; id?: string; username?: string };
        const u = (d as { user?: TransferRecipient }).user ?? (d as TransferRecipient);
        if (u?.id) setRecipient(u as TransferRecipient);
      })
      .catch(() => {})
      .finally(() => setLoadingRecipient(false));
  }, [recipientId]);

  useEffect(() => {
    const n = parseInt(amount, 10);
    if (!isNaN(n) && n >= 10) {
      const fee = Math.floor(n * 0.05);
      setPreview({ fee, net: n - fee });
    } else {
      setPreview(null);
    }
  }, [amount]);

  async function handleTransfer() {
    setTransferError(null);
    const n = parseInt(amount, 10);
    if (isNaN(n) || n < 10) {
      setTransferError(`Minimum transfer amount is 10 ${currency.softPlural.toLowerCase()}`);
      return;
    }
    if (n > 100_000) {
      setTransferError(`Maximum single transfer is 100,000 ${currency.softPlural.toLowerCase()}`);
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/api/economy/coins/transfer", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientId, amount: n }),
      });
      const data = (await res.json()) as { success?: boolean; message?: string; error?: string | { code?: string; message?: string }; transfer?: { netAmount: number; recipient: { username: string } } };
      if (!res.ok) {
        const errMsg = typeof data.error === "string" ? data.error : data.error?.message;
        const errCode = typeof data.error === "string" ? null : data.error?.code ?? null;
        const err = new Error(data.message ?? errMsg ?? "Transfer failed") as Error & { code?: string | null };
        err.code = errCode;
        throw err;
      }
      const label = data.transfer?.recipient?.username ?? "user";
      onSuccess(`Sent ${n} ${currency.softPlural.toLowerCase()} to @${label} (they received ${data.transfer?.netAmount ?? n - Math.floor(n * 0.05)})`);
      onClose();
    } catch (e) {
      const err = e as Error & { code?: string | null };
      setTransferError(e instanceof Error ? translateApiError(t, err.code, err.message || "Transfer failed") : "Transfer failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 shadow-card dark:border-amber-800 dark:bg-amber-950">
      <div className="flex items-center justify-between border-b border-amber-200 px-5 py-4 dark:border-amber-800">
        <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-100">Send {currency.softPlural}</h2>
        <button onClick={onClose} className="text-sm text-amber-600 hover:text-amber-800 dark:text-amber-400">
          ✕
        </button>
      </div>
      <div className="p-5 space-y-4">
        {loadingRecipient ? (
          <div className="h-8 w-40 animate-pulse rounded bg-amber-200 dark:bg-amber-800" />
        ) : recipient ? (
          <p className="text-sm text-amber-800 dark:text-amber-200">
            Sending to{" "}
            <span className="font-semibold">
              {recipient.display_name ? `${recipient.display_name} (@${recipient.username})` : `@${recipient.username}`}
            </span>
          </p>
        ) : (
          <p className="text-sm text-red-600 dark:text-red-400">Recipient not found.</p>
        )}

        <div>
          <label className="mb-1 block text-xs font-medium text-amber-800 dark:text-amber-200">
            Amount ({currency.softPlural.toLowerCase()})
          </label>
          <input
            type="number"
            min={10}
            max={100000}
            step={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g. 100"
            className="w-full rounded-xl border border-amber-300 bg-white px-4 py-2 text-sm text-neutral-900 placeholder-neutral-400 focus:border-amber-500 focus:outline-none dark:border-amber-700 dark:bg-neutral-900 dark:text-neutral-100"
          />
        </div>

        {preview && (
          <div className="rounded-lg bg-white px-4 py-3 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300 space-y-0.5">
            <div className="flex justify-between"><span>Platform fee (5%)</span><span>−{preview.fee} 🪙</span></div>
            <div className="flex justify-between font-semibold text-neutral-900 dark:text-neutral-100">
              <span>Recipient receives</span><span>{preview.net} 🪙</span>
            </div>
          </div>
        )}

        {transferError && (
          <p className="text-xs text-red-600 dark:text-red-400">{transferError}</p>
        )}

        <button
          onClick={handleTransfer}
          disabled={sending || !recipient || !amount}
          className="w-full rounded-xl bg-amber-500 py-2.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
        >
          {sending ? "Sending…" : `Send ${currency.softPlural}`}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

function WalletContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { t } = useTranslation();
  const transferRecipientId = searchParams.get("transfer");
  const currency = useCurrency();

  const [data, setData] = useState<StoreData>({
    balance: { coins: 0, stars: 0, xp: 0 },
    transactions: [],
    starTransactions: [],
    coinPacks: [],
    boosters: [],
    activePlan: null,
    earnings: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const dismissTransfer = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("transfer");
    router.replace(url.pathname + (url.search === "?" ? "" : url.search));
  }, [router]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }

  useEffect(() => {
    (async () => {
      try {
        const [balRes, storeRes, planRes, earningsRes, payoutsRes] = await Promise.all([
          fetch("/api/economy/coins/balance?limit=30", { credentials: "include" }),
          fetch("/api/economy/store", { credentials: "include" }),
          fetch("/api/economy/subscriptions", { credentials: "include" }),
          fetch("/api/creator/earnings", { credentials: "include" }).catch(() => null),
          fetch("/api/creator/payouts", { credentials: "include" }).catch(() => null),
        ]);

        if (balRes.status === 401) { window.location.href = "/auth/login"; return; }

        const balData = balRes.ok
          ? ((await balRes.json()) as {
              coins?: number;
              stars?: number;
              xp?: number;
              plan?: string;
              transactions?: Transaction[];
              starTransactions?: Transaction[];
            })
          : null;

        const storeData = storeRes.ok
          ? ((await storeRes.json()) as { items?: (CoinPack & { item_type?: string })[]; data?: (CoinPack & { item_type?: string })[] })
          : null;
        const allItems: (CoinPack & { item_type?: string })[] =
          (storeData as { items?: (CoinPack & { item_type?: string })[] })?.items ??
          (storeData as { data?: (CoinPack & { item_type?: string })[] })?.data ??
          [];
        const coinPacks = allItems.filter((i) => !i.item_type || i.item_type === "coin_pack");

        // Extract active plan from subscriptions endpoint or balance response
        const planData = planRes.ok
          ? ((await planRes.json()) as { data?: { plan?: string; subscription?: { plan?: string } } | null })
          : null;
        const activePlan =
          planData?.data?.plan ??
          planData?.data?.subscription?.plan ??
          balData?.plan ??
          null;

        // Parse creator earnings and payouts (non-fatal — only shown for creators)
        let earnings: EarningsData | null = null;
        try {
          const earningsJson = earningsRes?.ok ? await earningsRes.json() as Record<string, unknown> : null;
          const payoutsJson = payoutsRes?.ok ? await payoutsRes.json() as Record<string, unknown> : null;
          const earningsData = (earningsJson?.data ?? earningsJson) as { month?: { total_ngn?: number } } | null;
          const payoutsData = (payoutsJson?.data ?? payoutsJson) as {
            payouts?: { id: string; gross_kobo?: number; net_kobo?: number; payout_method?: string; status?: string; created_at?: string }[];
          } | null;
          const pendingStatuses = new Set(["pending", "awaiting_approval", "processing"]);
          const pending = (payoutsData?.payouts ?? [])
            .filter((p) => pendingStatuses.has(p.status ?? ""))
            .map((p) => ({
              id: p.id,
              amount: p.gross_kobo ?? 0,
              currency: "NGN",
              method: p.payout_method ?? "bank_transfer",
              status: p.status ?? "pending",
              createdAt: p.created_at ?? new Date().toISOString(),
            }));
          const totalMonthNgn = (earningsData?.month?.total_ngn ?? 0);
          if (totalMonthNgn > 0 || pending.length > 0) {
            earnings = { totalMonthNgn, pendingPayouts: pending };
          }
        } catch { /* creator data is non-fatal */ }

        setData({
          balance: {
            coins: balData?.coins ?? 0,
            stars: balData?.stars ?? 0,
            xp: balData?.xp ?? 0,
            plan: balData?.plan ?? activePlan ?? undefined,
          },
          transactions: (balData?.transactions ?? []).slice(0, 30),
          starTransactions: (balData?.starTransactions ?? []).slice(0, 30),
          coinPacks,
          boosters: [],
          activePlan,
          earnings,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load wallet");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handlePurchase(packId: string) {
    setPurchasing(packId);
    try {
      const res = await fetch("/api/economy/coins/purchase", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packId, provider: "paystack" }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { message?: string; error?: string | { code?: string; message?: string } };
        const errMsg = typeof d.error === "string" ? d.error : d.error?.message;
        const errCode = typeof d.error === "string" ? null : d.error?.code ?? null;
        const err = new Error(d.message ?? errMsg ?? "Purchase failed") as Error & { code?: string | null };
        err.code = errCode;
        throw err;
      }
      const result = (await res.json()) as { checkoutUrl?: string; authorization_url?: string };
      const url = result.checkoutUrl ?? result.authorization_url;
      if (url) {
        window.location.href = url;
      } else {
        showToast("Purchase initiated — check your email for confirmation.");
      }
    } catch (e) {
      const err = e as Error & { code?: string | null };
      showToast(e instanceof Error ? translateApiError(t, err.code, err.message || "Purchase failed") : "Purchase failed");
    } finally {
      setPurchasing(null);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <WalletSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Wallet</h1>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl bg-teal-600 px-4 py-3 text-sm font-medium text-white shadow-modal">
          {toast}
        </div>
      )}

      <BalanceCard balance={data.balance} activePlan={data.activePlan} currency={currency} />

      {data.earnings && <EarningsSection earnings={data.earnings} />}

      {transferRecipientId && (
        <CoinTransferPanel
          recipientId={transferRecipientId}
          onSuccess={showToast}
          onClose={dismissTransfer}
          currency={currency}
        />
      )}

      <CoinPacks packs={data.coinPacks} onPurchase={handlePurchase} purchasing={purchasing} currency={currency} />

      <BoosterPacks boosters={data.boosters} />

      <TransactionHistory transactions={data.transactions} starTransactions={data.starTransactions} currency={currency} />
    </div>
  );
}

export default function WalletPage() {
  return (
    <Suspense>
      <WalletContent />
    </Suspense>
  );
}
