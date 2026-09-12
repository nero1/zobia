"use client";

/**
 * app/(app)/quests/manage/page.tsx
 *
 * "My Sponsored Quests" panel for a user an admin assigned as the
 * quest "creator"/campaign manager (sponsored_quests.owner_user_id).
 * Shows stats and campaign progress; can revive/extend/add budget, but can
 * never edit the quest's public-facing details (title, reward, etc.) — see
 * app/api/quests/owned/[questId]/route.ts.
 */

import { useState, useEffect, useCallback } from "react";
import { useCurrency } from "@/lib/hooks/useCurrency";

interface OwnedQuest {
  id: string;
  brand_name: string;
  title: string;
  description: string;
  reward_coins: number;
  is_active: boolean;
  moderation_status: string;
  auto_paused: boolean;
  pause_reason: string | null;
  flag_status: string;
  is_daily_quest_eligible: boolean;
  starts_at: string | null;
  ends_at: string | null;
  deadline: string;
  total_budget_credits: string;
  spent_credits: string;
  estimated_reach: number | null;
  impressions_count: number;
  completions_count: number;
  application_count: number;
  approved_count: number;
  created_at: string;
}

export default function ManageMyQuestsPage() {
  const currency = useCurrency();
  const [quests, setQuests] = useState<OwnedQuest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [extendTarget, setExtendTarget] = useState<OwnedQuest | null>(null);
  const [newEndsAt, setNewEndsAt] = useState("");
  const [budgetTarget, setBudgetTarget] = useState<OwnedQuest | null>(null);
  const [addBudget, setAddBudget] = useState(1000);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/quests/owned", { credentials: "include" });
      const json = await res.json();
      if (json.success) setQuests(json.data.quests);
    } catch {
      setError("Failed to load your quests");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function act(questId: string, body: object) {
    setBusy(questId);
    setError(null);
    try {
      const res = await fetch(`/api/quests/owned/${questId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? "Failed to update");
      setExtendTarget(null);
      setBudgetTarget(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return <div className="mx-auto max-w-3xl p-4 sm:p-6"><div className="h-8 w-56 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" /></div>;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-50">My Sponsored Quests</h1>
      <p className="text-sm text-neutral-500">
        Quests an admin has attributed to your account. You can see stats and campaign progress, and revive, extend,
        or add budget — public details (title, description, reward) can only be changed by an admin.
      </p>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">{error}</div>}

      {quests.length === 0 ? (
        <p className="text-sm text-neutral-400">No quests attributed to you yet.</p>
      ) : (
        <div className="space-y-3">
          {quests.map((q) => (
            <div key={q.id} className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold text-neutral-900 dark:text-neutral-100">{q.title}</p>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${q.is_active ? "bg-green-100 text-green-700" : "bg-neutral-100 text-neutral-500"}`}>
                  {q.is_active ? "Live" : "Stopped"}
                </span>
                {q.flag_status === "flagged" && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">🚩 Flagged</span>}
              </div>
              <p className="mt-1 line-clamp-2 text-sm text-neutral-500">{q.description}</p>
              {q.pause_reason && (
                <p className="mt-1 text-xs text-amber-600">
                  {q.auto_paused ? "⚠️ Auto-paused: " : "Paused: "}{q.pause_reason}
                  {q.auto_paused && " — resolve the underlying account issue and restart from your Business panel."}
                </p>
              )}
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-neutral-500 sm:grid-cols-4">
                <div>📋 {q.application_count} applications</div>
                <div>✅ {q.approved_count} approved</div>
                <div>🏁 {q.completions_count} completions</div>
                <div>🪙 {q.reward_coins.toLocaleString()} {currency.softPlural} reward</div>
              </div>
              {q.is_daily_quest_eligible && (
                <p className="mt-2 text-xs text-neutral-400">
                  Daily deck boost: {Number(q.spent_credits).toLocaleString()}/{Number(q.total_budget_credits).toLocaleString()} {currency.softPlural} spent ·{" "}
                  {q.impressions_count.toLocaleString()} impressions
                  {q.estimated_reach ? ` · est. reach ${q.estimated_reach.toLocaleString()}` : ""}
                  {q.ends_at ? ` · ends ${new Date(q.ends_at).toLocaleDateString()}` : ""}
                </p>
              )}
              {q.flag_status !== "flagged" && q.moderation_status === "approved" && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {!q.is_active && !q.auto_paused && (
                    <button disabled={busy === q.id} onClick={() => act(q.id, { action: "revive" })} className="rounded-lg bg-green-600 px-3 py-1 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50">
                      Revive
                    </button>
                  )}
                  {q.is_daily_quest_eligible && (
                    <>
                      <button onClick={() => { setExtendTarget(q); setNewEndsAt(q.ends_at ? q.ends_at.slice(0, 16) : ""); }} className="rounded-lg border border-neutral-300 px-3 py-1 text-xs font-semibold text-neutral-700 dark:border-neutral-600 dark:text-neutral-200">
                        Extend
                      </button>
                      <button onClick={() => { setBudgetTarget(q); setAddBudget(1000); }} className="rounded-lg border border-neutral-300 px-3 py-1 text-xs font-semibold text-neutral-700 dark:border-neutral-600 dark:text-neutral-200">
                        Add Budget
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {extendTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 dark:bg-neutral-900">
            <h3 className="mb-3 font-semibold text-neutral-900 dark:text-white">Extend &quot;{extendTarget.title}&quot;</h3>
            <input type="datetime-local" value={newEndsAt} onChange={(e) => setNewEndsAt(e.target.value)} className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800" />
            <div className="mt-4 flex gap-2">
              <button onClick={() => setExtendTarget(null)} className="flex-1 rounded-lg border border-neutral-200 py-2 text-sm font-medium dark:border-neutral-700">Cancel</button>
              <button disabled={busy === extendTarget.id} onClick={() => act(extendTarget.id, { action: "extend", newEndsAt: new Date(newEndsAt).toISOString() })} className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {budgetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 dark:bg-neutral-900">
            <h3 className="mb-3 font-semibold text-neutral-900 dark:text-white">Add Budget to &quot;{budgetTarget.title}&quot;</h3>
            <input type="number" min={1} value={addBudget} onChange={(e) => setAddBudget(Number(e.target.value))} className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800" />
            <div className="mt-4 flex gap-2">
              <button onClick={() => setBudgetTarget(null)} className="flex-1 rounded-lg border border-neutral-200 py-2 text-sm font-medium dark:border-neutral-700">Cancel</button>
              <button disabled={busy === budgetTarget.id} onClick={() => act(budgetTarget.id, { action: "add_budget", addBudgetCredits: Number(addBudget) })} className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                Add
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
