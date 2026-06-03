"use client";

/**
 * app/(app)/creator/broadcasts/page.tsx
 *
 * Creator Broadcasts page.
 * - Only accessible to Rising tier+ creators
 * - Compose modal (subject + body, max 1000 chars)
 * - POST /api/creator/broadcasts to send
 * - Broadcast history with recipient count, date, body preview
 * - Monthly allowance display
 * - Additional broadcast coin cost
 */

import { useState, useEffect } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BroadcastAllowance {
  tier: string;
  freeRemaining: number;
  freeTotal: number;
  additionalCoinCost: number;
  canSend: boolean;
  reason?: string;
}

interface Broadcast {
  id: string;
  subject: string;
  body: string;
  sentAt: string;
  recipientCount: number;
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-neutral-200 dark:bg-neutral-700 ${className}`} />;
}

function PageSkeleton() {
  return (
    <div className="space-y-5">
      <SkeletonBlock className="h-24 rounded-xl" />
      <SkeletonBlock className="h-48 rounded-xl" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compose modal
// ---------------------------------------------------------------------------

interface ComposeModalProps {
  allowance: BroadcastAllowance;
  onSend: (subject: string, body: string) => Promise<void>;
  onClose: () => void;
  sending: boolean;
}

function ComposeModal({ allowance, onSend, onClose, sending }: ComposeModalProps) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    if (!subject.trim()) { setLocalError("Subject is required"); return; }
    if (!body.trim()) { setLocalError("Message body is required"); return; }
    if (body.length > 1000) { setLocalError("Message must be 1000 characters or fewer"); return; }
    await onSend(subject.trim(), body.trim());
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="compose-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-lg rounded-2xl border border-neutral-200 bg-white shadow-modal dark:border-neutral-800 dark:bg-neutral-900">
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
        >
          ✕
        </button>

        <div className="p-6 pt-5">
          <h2 id="compose-title" className="mb-4 text-lg font-bold text-neutral-900 dark:text-neutral-50">
            Send Broadcast
          </h2>

          {/* Allowance info */}
          <div className="mb-4 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-xs text-neutral-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400">
            {allowance.freeRemaining > 0 ? (
              <span>
                <span className="font-semibold">{allowance.freeRemaining}</span> free broadcast{allowance.freeRemaining !== 1 ? "s" : ""} remaining this month
                {allowance.tier && ` (${allowance.tier} tier)`}
              </span>
            ) : (
              <span>
                No free broadcasts left this month. Additional broadcasts cost{" "}
                <span className="font-semibold">{allowance.additionalCoinCost.toLocaleString()} 🪙</span> each.
              </span>
            )}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">Subject</label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Broadcast subject…"
                maxLength={200}
                className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              />
            </div>
            <div>
              <label className="mb-1 flex items-center justify-between text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                <span>Message</span>
                <span className={`tabular-nums ${body.length > 950 ? "text-red-500" : "text-neutral-400"}`}>
                  {body.length} / 1000
                </span>
              </label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={6}
                maxLength={1000}
                placeholder="Write your broadcast message…"
                className="w-full resize-none rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              />
            </div>

            {localError && (
              <p className="text-xs text-red-600 dark:text-red-400">{localError}</p>
            )}

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={sending || !allowance.canSend}
                className="flex-1 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {sending
                  ? "Sending…"
                  : allowance.freeRemaining > 0
                  ? "Send Broadcast"
                  : `Send (${allowance.additionalCoinCost.toLocaleString()} 🪙)`}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-neutral-300 px-4 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Broadcast history card
// ---------------------------------------------------------------------------

function BroadcastHistoryCard({ broadcast }: { broadcast: Broadcast }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{broadcast.subject}</h3>
          <p className="mt-1 line-clamp-2 text-sm text-neutral-600 dark:text-neutral-400">{broadcast.body}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xs text-neutral-400">
            {new Date(broadcast.sentAt).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </p>
          <p className="mt-0.5 text-xs font-semibold text-neutral-700 dark:text-neutral-300">
            {broadcast.recipientCount.toLocaleString()} recipients
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Access denied view
// ---------------------------------------------------------------------------

function AccessDenied({ reason }: { reason?: string }) {
  return (
    <div className="flex flex-col items-center py-16 text-center">
      <span className="text-5xl">🔒</span>
      <h2 className="mt-4 text-xl font-bold text-neutral-900 dark:text-neutral-50">Creator Broadcasts</h2>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
        {reason ?? "You need to be a Rising tier creator or above to send broadcasts."}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

interface BroadcastsData {
  allowance: BroadcastAllowance | null;
  history: Broadcast[];
  accessDenied: boolean;
  accessReason?: string;
}

export default function BroadcastsPage() {
  const [data, setData] = useState<BroadcastsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  function showToast(msg: string, type: "success" | "error" = "success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/creator/broadcasts", { credentials: "include" });
        if (res.status === 401) { window.location.href = "/login"; return; }
        if (res.status === 403) {
          const d = (await res.json()) as { message?: string; reason?: string };
          setData({ allowance: null, history: [], accessDenied: true, accessReason: d.message ?? d.reason });
          return;
        }
        if (!res.ok) throw new Error("Failed to load broadcasts");

        const json = (await res.json()) as {
          allowance?: BroadcastAllowance;
          broadcasts?: Broadcast[];
          history?: Broadcast[];
        };
        setData({
          allowance: json.allowance ?? {
            tier: "Unknown",
            freeRemaining: 0,
            freeTotal: 0,
            additionalCoinCost: 0,
            canSend: false,
          },
          history: json.broadcasts ?? json.history ?? [],
          accessDenied: false,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleSend(subject: string, body: string) {
    setSending(true);
    try {
      const res = await fetch("/api/creator/broadcasts", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, body }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { message?: string; error?: string };
        throw new Error(d.message ?? d.error ?? "Send failed");
      }
      const newBroadcast = (await res.json()) as { broadcast?: Broadcast } | Broadcast;
      const broadcast: Broadcast =
        (newBroadcast as { broadcast?: Broadcast }).broadcast ?? (newBroadcast as Broadcast);

      setData((prev) =>
        prev
          ? {
              ...prev,
              history: [broadcast, ...prev.history],
              allowance: prev.allowance
                ? { ...prev.allowance, freeRemaining: Math.max(0, prev.allowance.freeRemaining - 1) }
                : prev.allowance,
            }
          : prev
      );
      setComposing(false);
      showToast("Broadcast sent!");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to send", "error");
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl p-4 sm:p-6">
        <h1 className="mb-5 text-2xl font-bold text-neutral-900 dark:text-neutral-50">Creator Broadcasts</h1>
        <PageSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl p-4 sm:p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      </div>
    );
  }

  if (data?.accessDenied) {
    return (
      <div className="mx-auto max-w-2xl p-4 sm:p-6">
        <AccessDenied reason={data.accessReason} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Creator Broadcasts</h1>
        {data?.allowance?.canSend && (
          <button
            onClick={() => setComposing(true)}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Send Broadcast
          </button>
        )}
      </div>

      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-modal ${
            toast.type === "success" ? "bg-teal-600" : "bg-red-600"
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* Allowance card */}
      {data?.allowance && (
        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="mb-3 text-sm font-semibold text-neutral-700 dark:text-neutral-300">Monthly Allowance</h2>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                <span className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">
                  {data.allowance.freeRemaining}
                </span>{" "}
                / {data.allowance.freeTotal} free broadcasts remaining
              </p>
              <p className="mt-0.5 text-xs text-neutral-500">
                Tier: {data.allowance.tier}
                {data.allowance.additionalCoinCost > 0 &&
                  ` · Additional: ${data.allowance.additionalCoinCost.toLocaleString()} 🪙 each`}
              </p>
            </div>
            {!data.allowance.canSend && data.allowance.reason && (
              <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                {data.allowance.reason}
              </span>
            )}
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
            <div
              className="h-full rounded-full bg-blue-500 transition-all"
              style={{
                width: `${data.allowance.freeTotal > 0 ? Math.round((data.allowance.freeRemaining / data.allowance.freeTotal) * 100) : 0}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Broadcast history */}
      <div className="rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
        <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Broadcast History</h2>
        </div>
        {!data?.history?.length ? (
          <div className="px-5 py-8 text-center text-sm text-neutral-500">
            No broadcasts sent yet. Send your first broadcast to your followers!
          </div>
        ) : (
          <div className="divide-y divide-neutral-100 p-4 dark:divide-neutral-800">
            {data.history.map((b) => (
              <div key={b.id} className="py-3 first:pt-0 last:pb-0">
                <BroadcastHistoryCard broadcast={b} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Compose modal */}
      {composing && data?.allowance && (
        <ComposeModal
          allowance={data.allowance}
          onSend={handleSend}
          onClose={() => setComposing(false)}
          sending={sending}
        />
      )}
    </div>
  );
}
