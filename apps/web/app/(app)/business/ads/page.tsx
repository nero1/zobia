"use client";

/**
 * app/(app)/business/ads/page.tsx
 *
 * Advertising Panel (PRD §17 — "biz accounts should have links to a
 * dedicated advertising panel (from the ads system)"). Growth+ tiers can
 * submit Sponsored Quests attributed to one of their Business Pages; each
 * submission requires admin (or AI, per the admin's moderation-mode
 * toggle) approval before it goes live — reuses the existing Sponsored
 * Quest Marketplace (§14) rather than a parallel ads system.
 */

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface BusinessPageOption {
  id: string;
  name: string;
  status: string;
}

interface SponsoredQuest {
  id: string;
  title: string;
  description: string;
  reward_coins: number;
  max_applications: number;
  deadline: string;
  is_active: boolean;
  moderation_status: "pending" | "approved" | "rejected";
  moderation_reason: string | null;
  business_page_id: string | null;
  created_at: string;
  application_count: number;
}

function moderationBadge(status: string) {
  const map: Record<string, string> = {
    pending: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    approved: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
    rejected: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  };
  return map[status] ?? map.pending;
}

export default function BusinessAdsPage() {
  const [tierAllowed, setTierAllowed] = useState<boolean | null>(null);
  const [pages, setPages] = useState<BusinessPageOption[]>([]);
  const [quests, setQuests] = useState<SponsoredQuest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [businessPageId, setBusinessPageId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [requirements, setRequirements] = useState("");
  const [rewardCoins, setRewardCoins] = useState(1000);
  const [maxApplications, setMaxApplications] = useState(10);
  const [deadline, setDeadline] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [accountRes, questsRes, pagesRes] = await Promise.all([
        fetch("/api/business", { credentials: "include" }),
        fetch("/api/business/sponsored-quests", { credentials: "include" }),
        fetch("/api/business/pages", { credentials: "include" }),
      ]);
      const accountJson = await accountRes.json().catch(() => null);
      const tier = accountJson?.data?.business?.tier;
      setTierAllowed(tier === "growth" || tier === "enterprise");

      const questsJson = await questsRes.json();
      if (questsJson.success) setQuests(questsJson.data.quests);

      const pagesJson = await pagesRes.json();
      if (pagesJson.success) setPages(pagesJson.data.pages.filter((p: BusinessPageOption) => p.status === "active"));
    } catch {
      setError("Failed to load advertising data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/business/sponsored-quests", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessPageId,
          title: title.trim(),
          description: description.trim(),
          requirements: requirements.trim(),
          rewardCoins: Number(rewardCoins),
          maxApplications: Number(maxApplications),
          deadline: new Date(deadline).toISOString(),
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? "Failed to submit quest");
      setShowForm(false);
      setTitle(""); setDescription(""); setRequirements(""); setRewardCoins(1000); setMaxApplications(10); setDeadline("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit quest");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel(questId: string) {
    try {
      const res = await fetch(`/api/business/sponsored-quests/${questId}`, { method: "DELETE", credentials: "include" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? "Failed to cancel");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel");
    }
  }

  if (loading) {
    return <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6"><div className="h-8 w-56 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" /></div>;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <Link href="/business" className="text-sm text-neutral-500 hover:underline">← Business</Link>
        <span className="text-neutral-300">/</span>
        <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-50">Advertising Panel</h1>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">{error}</div>
      )}

      {tierAllowed === false ? (
        <div className="rounded-2xl border border-neutral-200 bg-white p-6 text-center dark:border-neutral-800 dark:bg-neutral-900">
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Sponsored Quests require the <span className="font-semibold">Growth</span> tier or higher.
          </p>
          <Link href="/settings/business" className="mt-3 inline-block rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
            Upgrade Tier
          </Link>
        </div>
      ) : (
        <>
          <div className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
            <h2 className="font-semibold text-neutral-900 dark:text-neutral-100">Sponsored Quests</h2>
            <p className="mt-1 text-sm text-neutral-500">
              Creators complete a quest you define and earn Coins from your reward pool. Every submission requires
              approval (manual by an admin, or automatic AI review — set by the platform) before it goes live, and is
              shown as coming from the Business Page you select.
            </p>
            <button
              onClick={() => setShowForm((s) => !s)}
              disabled={pages.length === 0}
              className="mt-3 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
              title={pages.length === 0 ? "Create a Business Page first" : undefined}
            >
              {showForm ? "Cancel" : "+ Submit Sponsored Quest"}
            </button>
            {pages.length === 0 && (
              <p className="mt-2 text-xs text-neutral-400">
                You need an active <Link href="/business/pages" className="underline">Business Page</Link> before submitting a quest.
              </p>
            )}
          </div>

          {showForm && (
            <form onSubmit={handleSubmit} className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-neutral-700 dark:text-neutral-300">Business Page</label>
                <select required value={businessPageId} onChange={(e) => setBusinessPageId(e.target.value)} className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100">
                  <option value="">Select a page…</option>
                  {pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-neutral-700 dark:text-neutral-300">Quest Title</label>
                <input required maxLength={150} value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-neutral-700 dark:text-neutral-300">Description</label>
                <textarea required rows={3} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-neutral-700 dark:text-neutral-300">Requirements</label>
                <textarea required rows={2} maxLength={2000} value={requirements} onChange={(e) => setRequirements(e.target.value)} className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">Reward (Coins)</label>
                  <input required type="number" min={100} value={rewardCoins} onChange={(e) => setRewardCoins(Number(e.target.value))} className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100" />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">Max Applications</label>
                  <input required type="number" min={1} value={maxApplications} onChange={(e) => setMaxApplications(Number(e.target.value))} className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100" />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">Deadline</label>
                  <input required type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100" />
                </div>
              </div>
              <button type="submit" disabled={submitting} className="w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
                {submitting ? "Submitting…" : "Submit for Approval"}
              </button>
            </form>
          )}

          {quests.length === 0 ? (
            <p className="text-sm text-neutral-400">No Sponsored Quests submitted yet.</p>
          ) : (
            <div className="space-y-3">
              {quests.map((q) => (
                <div key={q.id} className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-neutral-900 dark:text-neutral-100">{q.title}</p>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${moderationBadge(q.moderation_status)}`}>{q.moderation_status}</span>
                        {q.moderation_status === "approved" && (
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${q.is_active ? "bg-blue-100 text-blue-700" : "bg-neutral-100 text-neutral-500"}`}>
                            {q.is_active ? "Live" : "Stopped"}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm text-neutral-500">{q.description}</p>
                      {q.moderation_status === "rejected" && q.moderation_reason && (
                        <p className="mt-1 text-xs text-red-600">Reason: {q.moderation_reason}</p>
                      )}
                      <p className="mt-2 text-xs text-neutral-400">
                        🪙 {q.reward_coins.toLocaleString()} coins · 📋 {q.application_count}/{q.max_applications} applications · ⏰ {new Date(q.deadline).toLocaleDateString()}
                      </p>
                    </div>
                    {q.moderation_status !== "approved" && (
                      <button onClick={() => handleCancel(q.id)} className="flex-shrink-0 rounded-lg border border-red-300 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400">
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-5 dark:border-neutral-700 dark:bg-neutral-900">
        <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">More advertising options</h3>
        <p className="mt-1 text-sm text-neutral-500">
          Branded Room sponsorships and Sponsored Leaderboard Banners are arranged directly with the Zobia team.
        </p>
        <a href="mailto:sales@zobia.app?subject=Advertising%20Enquiry" className="mt-2 inline-block text-sm font-semibold text-blue-600 hover:underline">
          Contact sales@zobia.app →
        </a>
      </div>
    </div>
  );
}
