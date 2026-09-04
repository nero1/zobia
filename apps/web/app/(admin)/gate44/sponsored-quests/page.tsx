"use client";

/**
 * app/(admin)/admin/sponsored-quests/page.tsx
 *
 * Admin Sponsored Quest Marketplace management page (PRD §14).
 *
 * Allows admins to publish Sponsored Quests on behalf of brands
 * and view application stats per quest.
 *
 * Data from GET/POST /api/admin/sponsored-quests.
 */

import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SponsoredQuest {
  id: string;
  brand_name: string;
  brand_logo_url: string | null;
  title: string;
  description: string;
  requirements: string;
  reward_coins: number;
  creator_share_percent: number;
  platform_share_percent: number;
  max_applications: number;
  deadline: string;
  min_creator_tier: string;
  is_active: boolean;
  created_at: string;
  application_count: number;
  approved_count: number;
  moderation_status: "pending" | "approved" | "rejected";
  moderation_reason: string | null;
  business_account_id: string | null;
  submitted_by_username: string | null;
}

interface FormData {
  brandName: string;
  brandLogoUrl: string;
  title: string;
  description: string;
  requirements: string;
  rewardCoins: number;
  creatorSharePercent: number;
  platformSharePercent: number;
  maxApplications: number;
  deadline: string;
  minCreatorTier: "verified" | "elite" | "icon";
}

const EMPTY_FORM: FormData = {
  brandName: "",
  brandLogoUrl: "",
  title: "",
  description: "",
  requirements: "",
  rewardCoins: 5000,
  creatorSharePercent: 70,
  platformSharePercent: 30,
  maxApplications: 10,
  deadline: "",
  minCreatorTier: "verified",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AdminSponsoredQuestsPage() {
  const { t } = useTranslation();

  const [quests, setQuests] = useState<SponsoredQuest[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Edit / delete state
  const [editingQuest, setEditingQuest] = useState<SponsoredQuest | null>(null);
  const [editForm, setEditForm] = useState<FormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SponsoredQuest | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [moderating, setModerating] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<SponsoredQuest | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const fetchQuests = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/sponsored-quests?active=false");
      const json = await res.json();
      if (json.success) setQuests(json.data.quests ?? []);
    } catch {
      setError("Failed to load sponsored quests");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchQuests();
  }, [fetchQuests]);

  function handleFormChange(field: keyof FormData, value: string | number) {
    setForm((prev) => {
      const updated = { ...prev, [field]: value };
      // Keep shares summing to 100
      if (field === "creatorSharePercent") {
        updated.platformSharePercent = 100 - Number(value);
      }
      if (field === "platformSharePercent") {
        updated.creatorSharePercent = 100 - Number(value);
      }
      return updated;
    });
  }

  function openEdit(q: SponsoredQuest) {
    setEditingQuest(q);
    setEditForm({
      brandName: q.brand_name,
      brandLogoUrl: q.brand_logo_url ?? "",
      title: q.title,
      description: q.description,
      requirements: q.requirements,
      rewardCoins: q.reward_coins,
      creatorSharePercent: q.creator_share_percent,
      platformSharePercent: q.platform_share_percent,
      maxApplications: q.max_applications,
      deadline: q.deadline ? q.deadline.slice(0, 16) : "",
      minCreatorTier: q.min_creator_tier as FormData["minCreatorTier"],
    });
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingQuest) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/sponsored-quests/${editingQuest.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandName: editForm.brandName,
          brandLogoUrl: editForm.brandLogoUrl || null,
          title: editForm.title,
          description: editForm.description,
          requirements: editForm.requirements,
          rewardCoins: Number(editForm.rewardCoins),
          creatorSharePercent: Number(editForm.creatorSharePercent),
          platformSharePercent: Number(editForm.platformSharePercent),
          maxApplications: Number(editForm.maxApplications),
          deadline: new Date(editForm.deadline).toISOString(),
          minCreatorTier: editForm.minCreatorTier,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? "Failed to save");
      setSuccess("Quest updated successfully");
      setEditingQuest(null);
      await fetchQuests();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/sponsored-quests/${deleteTarget.id}`, { method: "DELETE" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? "Failed to delete");
      setSuccess("Quest deleted");
      setDeleteTarget(null);
      await fetchQuests();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setDeleting(false);
    }
  }

  async function handleModerate(q: SponsoredQuest, action: "approve" | "reject", reason?: string) {
    setModerating(q.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/sponsored-quests/${q.id}/moderate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? "Failed to moderate");
      setSuccess(action === "approve" ? "Quest approved and is now live" : "Quest rejected");
      setRejectTarget(null);
      await fetchQuests();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to moderate");
    } finally {
      setModerating(null);
    }
  }

  async function handleToggleActive(q: SponsoredQuest) {
    setToggling(q.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/sponsored-quests/${q.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !q.is_active }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? "Failed to update");
      setSuccess(q.is_active ? "Quest paused" : "Quest activated");
      await fetchQuests();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setToggling(null);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/sponsored-quests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandName: form.brandName,
          brandLogoUrl: form.brandLogoUrl || null,
          title: form.title,
          description: form.description,
          requirements: form.requirements,
          rewardCoins: Number(form.rewardCoins),
          creatorSharePercent: Number(form.creatorSharePercent),
          platformSharePercent: Number(form.platformSharePercent),
          maxApplications: Number(form.maxApplications),
          deadline: new Date(form.deadline).toISOString(),
          minCreatorTier: form.minCreatorTier,
        }),
      });

      const json = await res.json();
      if (!json.success) {
        const e = new Error(json.error?.message ?? "Failed to create quest") as Error & { code?: string | null };
        e.code = json.error?.code ?? null;
        throw e;
      }

      setSuccess("Sponsored quest published successfully");
      setShowForm(false);
      setForm(EMPTY_FORM);
      await fetchQuests();
    } catch (err) {
      const e = err as Error & { code?: string | null };
      setError(err instanceof Error ? translateApiError(t, e.code, e.message || "Failed to create quest") : String(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-white">
            Sponsored Quest Marketplace
          </h1>
          <p className="text-sm text-neutral-500 mt-1">
            Publish quests on behalf of brands. Verified+ creators apply and earn 70% of the reward.
          </p>
        </div>
        <button
          onClick={() => { setShowForm(!showForm); setError(null); setSuccess(null); }}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          {showForm ? "Cancel" : "+ Publish Quest"}
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
          {success}
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <form onSubmit={handleCreate} className="mb-6 p-5 border border-neutral-200 dark:border-neutral-700 rounded-xl bg-white dark:bg-neutral-900 space-y-4">
          <h2 className="font-semibold text-neutral-800 dark:text-white">Publish New Sponsored Quest</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Brand Name *</label>
              <input
                required
                value={form.brandName}
                onChange={(e) => handleFormChange("brandName", e.target.value)}
                className="w-full px-3 py-2 border border-neutral-200 dark:border-neutral-700 rounded-lg text-sm bg-white dark:bg-neutral-800"
                placeholder="e.g. MTN Nigeria"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Brand Logo URL</label>
              <input
                value={form.brandLogoUrl}
                onChange={(e) => handleFormChange("brandLogoUrl", e.target.value)}
                className="w-full px-3 py-2 border border-neutral-200 dark:border-neutral-700 rounded-lg text-sm bg-white dark:bg-neutral-800"
                placeholder="https://..."
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Quest Title *</label>
            <input
              required
              value={form.title}
              onChange={(e) => handleFormChange("title", e.target.value)}
              className="w-full px-3 py-2 border border-neutral-200 dark:border-neutral-700 rounded-lg text-sm bg-white dark:bg-neutral-800"
              placeholder="e.g. MTN Data Day Promo Quest"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Description *</label>
            <textarea
              required
              rows={3}
              value={form.description}
              onChange={(e) => handleFormChange("description", e.target.value)}
              className="w-full px-3 py-2 border border-neutral-200 dark:border-neutral-700 rounded-lg text-sm bg-white dark:bg-neutral-800"
              placeholder="What is this quest about?"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Requirements *</label>
            <textarea
              required
              rows={2}
              value={form.requirements}
              onChange={(e) => handleFormChange("requirements", e.target.value)}
              className="w-full px-3 py-2 border border-neutral-200 dark:border-neutral-700 rounded-lg text-sm bg-white dark:bg-neutral-800"
              placeholder="What must creators do? What are the success criteria?"
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Reward (Coins) *</label>
              <input
                required
                type="number"
                min="100"
                value={form.rewardCoins}
                onChange={(e) => handleFormChange("rewardCoins", e.target.value)}
                className="w-full px-3 py-2 border border-neutral-200 dark:border-neutral-700 rounded-lg text-sm bg-white dark:bg-neutral-800"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Creator Share %</label>
              <input
                type="number"
                min="50"
                max="90"
                value={form.creatorSharePercent}
                onChange={(e) => handleFormChange("creatorSharePercent", e.target.value)}
                className="w-full px-3 py-2 border border-neutral-200 dark:border-neutral-700 rounded-lg text-sm bg-white dark:bg-neutral-800"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Platform Share %</label>
              <input
                readOnly
                value={form.platformSharePercent}
                className="w-full px-3 py-2 border border-neutral-200 dark:border-neutral-700 rounded-lg text-sm bg-neutral-50 dark:bg-neutral-800 text-neutral-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Max Applications</label>
              <input
                type="number"
                min="1"
                value={form.maxApplications}
                onChange={(e) => handleFormChange("maxApplications", e.target.value)}
                className="w-full px-3 py-2 border border-neutral-200 dark:border-neutral-700 rounded-lg text-sm bg-white dark:bg-neutral-800"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Deadline *</label>
              <input
                required
                type="datetime-local"
                value={form.deadline}
                onChange={(e) => handleFormChange("deadline", e.target.value)}
                className="w-full px-3 py-2 border border-neutral-200 dark:border-neutral-700 rounded-lg text-sm bg-white dark:bg-neutral-800"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Min Creator Tier</label>
              <select
                value={form.minCreatorTier}
                onChange={(e) => handleFormChange("minCreatorTier", e.target.value)}
                className="w-full px-3 py-2 border border-neutral-200 dark:border-neutral-700 rounded-lg text-sm bg-white dark:bg-neutral-800"
              >
                <option value="verified">Verified Creator</option>
                <option value="elite">Elite Creator</option>
                <option value="icon">Zobia Icon Creator</option>
              </select>
            </div>
          </div>

          <button
            type="submit"
            disabled={creating}
            className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {creating ? "Publishing..." : "Publish Quest"}
          </button>
        </form>
      )}

      {/* Quest table */}
      {loading ? (
        <div className="text-center py-12 text-neutral-500">Loading quests...</div>
      ) : quests.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-neutral-200 dark:border-neutral-700 rounded-xl text-neutral-500">
          No sponsored quests yet. Publish your first quest above.
        </div>
      ) : (
        <div className="space-y-3">
          {quests.map((q) => (
            <div key={q.id} className="p-4 border border-neutral-200 dark:border-neutral-700 rounded-xl bg-white dark:bg-neutral-900">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold text-blue-600 uppercase tracking-wide">{q.brand_name}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      q.is_active ? "bg-green-100 text-green-700" : "bg-neutral-100 text-neutral-500"
                    }`}>
                      {q.is_active ? "Active" : "Inactive"}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-700 font-medium">
                      Min: {q.min_creator_tier}
                    </span>
                    {q.business_account_id && (
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        q.moderation_status === "pending" ? "bg-amber-100 text-amber-700"
                        : q.moderation_status === "rejected" ? "bg-red-100 text-red-700"
                        : "bg-blue-100 text-blue-700"
                      }`}>
                        Business submission{q.submitted_by_username ? ` · @${q.submitted_by_username}` : ""} · {q.moderation_status}
                      </span>
                    )}
                  </div>
                  <h3 className="font-semibold text-neutral-900 dark:text-white">{q.title}</h3>
                  <p className="text-sm text-neutral-500 mt-1 line-clamp-2">{q.description}</p>
                  {q.moderation_status === "rejected" && q.moderation_reason && (
                    <p className="text-xs text-red-600 mt-1">Rejection reason: {q.moderation_reason}</p>
                  )}
                </div>
                <div className="ml-4 text-right flex-shrink-0">
                  <div className="text-lg font-bold text-neutral-900 dark:text-white">
                    {q.reward_coins.toLocaleString()} Coins
                  </div>
                  <div className="text-xs text-neutral-500">
                    {q.creator_share_percent}% creator / {q.platform_share_percent}% platform
                  </div>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-4 text-xs text-neutral-500">
                <span>📋 {q.application_count}/{q.max_applications} applications</span>
                <span>✅ {q.approved_count} approved</span>
                <span>⏰ Deadline: {formatDate(q.deadline)}</span>
                <span>Created: {formatDate(q.created_at)}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {q.moderation_status === "pending" && (
                  <>
                    <button
                      disabled={moderating === q.id}
                      onClick={() => void handleModerate(q, "approve")}
                      className="px-3 py-1 rounded-lg bg-green-600 text-white text-xs font-semibold hover:bg-green-700 disabled:opacity-50"
                    >
                      {moderating === q.id ? "…" : "Approve"}
                    </button>
                    <button
                      disabled={moderating === q.id}
                      onClick={() => { setRejectTarget(q); setRejectReason(""); }}
                      className="px-3 py-1 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </>
                )}
                <button
                  onClick={() => openEdit(q)}
                  className="px-3 py-1 rounded-lg bg-blue-50 text-blue-700 text-xs font-semibold hover:bg-blue-100"
                >
                  Edit
                </button>
                <button
                  disabled={toggling === q.id}
                  onClick={() => void handleToggleActive(q)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold ${
                    q.is_active
                      ? "bg-amber-100 text-amber-700 hover:bg-amber-200"
                      : "bg-green-100 text-green-700 hover:bg-green-200"
                  } disabled:opacity-50`}
                >
                  {toggling === q.id ? "…" : q.is_active ? "Pause" : "Activate"}
                </button>
                <button
                  onClick={() => setDeleteTarget(q)}
                  className="px-3 py-1 rounded-lg bg-red-100 text-red-700 text-xs font-semibold hover:bg-red-200"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit modal */}
      {editingQuest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto">
          <form onSubmit={(e) => void handleEdit(e)} className="w-full max-w-xl rounded-2xl bg-white p-5 dark:bg-neutral-900 space-y-4 my-4">
            <h2 className="font-semibold text-neutral-800 dark:text-white">Edit Sponsored Quest</h2>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Brand Name *</label>
                <input required value={editForm.brandName} onChange={(e) => setEditForm(f => ({ ...f, brandName: e.target.value }))} className="w-full px-3 py-2 border border-neutral-200 dark:border-neutral-700 rounded-lg text-sm bg-white dark:bg-neutral-800" />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Brand Logo URL</label>
                <input value={editForm.brandLogoUrl} onChange={(e) => setEditForm(f => ({ ...f, brandLogoUrl: e.target.value }))} className="w-full px-3 py-2 border border-neutral-200 dark:border-neutral-700 rounded-lg text-sm bg-white dark:bg-neutral-800" placeholder="https://..." />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Quest Title *</label>
              <input required value={editForm.title} onChange={(e) => setEditForm(f => ({ ...f, title: e.target.value }))} className="w-full px-3 py-2 border border-neutral-200 dark:border-neutral-700 rounded-lg text-sm bg-white dark:bg-neutral-800" />
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Description *</label>
              <textarea required rows={3} value={editForm.description} onChange={(e) => setEditForm(f => ({ ...f, description: e.target.value }))} className="w-full px-3 py-2 border border-neutral-200 dark:border-neutral-700 rounded-lg text-sm bg-white dark:bg-neutral-800" />
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Requirements *</label>
              <textarea required rows={2} value={editForm.requirements} onChange={(e) => setEditForm(f => ({ ...f, requirements: e.target.value }))} className="w-full px-3 py-2 border border-neutral-200 dark:border-neutral-700 rounded-lg text-sm bg-white dark:bg-neutral-800" />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Reward (Coins)</label>
                <input required type="number" min="100" value={editForm.rewardCoins} onChange={(e) => setEditForm(f => ({ ...f, rewardCoins: Number(e.target.value) }))} className="w-full px-3 py-2 border border-neutral-200 dark:border-neutral-700 rounded-lg text-sm bg-white dark:bg-neutral-800" />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Creator Share %</label>
                <input type="number" min="50" max="90" value={editForm.creatorSharePercent} onChange={(e) => { const v = Number(e.target.value); setEditForm(f => ({ ...f, creatorSharePercent: v, platformSharePercent: 100 - v })); }} className="w-full px-3 py-2 border border-neutral-200 dark:border-neutral-700 rounded-lg text-sm bg-white dark:bg-neutral-800" />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Platform Share %</label>
                <input readOnly value={editForm.platformSharePercent} className="w-full px-3 py-2 border border-neutral-200 dark:border-neutral-700 rounded-lg text-sm bg-neutral-50 dark:bg-neutral-800 text-neutral-500" />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Max Applications</label>
                <input type="number" min="1" value={editForm.maxApplications} onChange={(e) => setEditForm(f => ({ ...f, maxApplications: Number(e.target.value) }))} className="w-full px-3 py-2 border border-neutral-200 dark:border-neutral-700 rounded-lg text-sm bg-white dark:bg-neutral-800" />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Deadline *</label>
                <input required type="datetime-local" value={editForm.deadline} onChange={(e) => setEditForm(f => ({ ...f, deadline: e.target.value }))} className="w-full px-3 py-2 border border-neutral-200 dark:border-neutral-700 rounded-lg text-sm bg-white dark:bg-neutral-800" />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Min Creator Tier</label>
                <select value={editForm.minCreatorTier} onChange={(e) => setEditForm(f => ({ ...f, minCreatorTier: e.target.value as FormData["minCreatorTier"] }))} className="w-full px-3 py-2 border border-neutral-200 dark:border-neutral-700 rounded-lg text-sm bg-white dark:bg-neutral-800">
                  <option value="verified">Verified Creator</option>
                  <option value="elite">Elite Creator</option>
                  <option value="icon">Zobia Icon Creator</option>
                </select>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button type="button" onClick={() => setEditingQuest(null)} className="flex-1 px-4 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 text-sm font-medium">Cancel</button>
              <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">{saving ? "Saving…" : "Save Changes"}</button>
            </div>
          </form>
        </div>
      )}

      {/* Reject reason modal (business-submitted quests only) */}
      {rejectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 dark:bg-neutral-900">
            <h3 className="mb-1 font-semibold text-neutral-900 dark:text-white">Reject Sponsored Quest</h3>
            <p className="mb-4 text-xs text-neutral-500">Optionally provide a reason shown to the business owner.</p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Reason for rejection (optional)"
              rows={3}
              className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
            />
            <div className="mt-4 flex gap-2">
              <button onClick={() => setRejectTarget(null)} className="flex-1 rounded-lg border border-neutral-200 py-2 text-sm font-medium dark:border-neutral-700">Cancel</button>
              <button
                disabled={moderating === rejectTarget.id}
                onClick={() => void handleModerate(rejectTarget, "reject", rejectReason.trim() || undefined)}
                className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {moderating === rejectTarget.id ? "…" : "Reject"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 dark:bg-neutral-900">
            <h3 className="mb-2 font-semibold text-neutral-900 dark:text-white">Delete Quest?</h3>
            <p className="mb-1 text-sm font-medium text-neutral-700 dark:text-neutral-300">{deleteTarget.title}</p>
            <p className="mb-4 text-sm text-neutral-500">This will soft-delete the quest and cannot be undone.</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteTarget(null)} className="flex-1 rounded-lg border border-neutral-200 py-2 text-sm font-medium dark:border-neutral-700">Cancel</button>
              <button onClick={() => void handleDelete()} disabled={deleting} className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">{deleting ? "Deleting…" : "Delete Quest"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
