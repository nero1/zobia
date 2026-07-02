"use client";

/**
 * app/(app)/business/ads/page.tsx
 *
 * Advertising Panel (PRD §17 Pillar 3 — Platform Advertising). Single hub
 * over the platform's ads system:
 *   - "Ad Campaigns" tab: the full self-service ad system (this file's new
 *     addition) — requires a verified Business Account whose owner holds
 *     KYC Tier 1+ (lib/ads/limits.ts checkAdvertiserEligibility), separate
 *     from the Sponsored Quest tier gate below.
 *   - "Sponsored Quests" tab: pre-existing Growth+ self-service quest
 *     submission (reuses the Creator Economy Quest Marketplace, §14).
 */

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

interface BusinessPageOption {
  id: string;
  name: string;
  status: string;
}

function moderationBadge(status: string) {
  const map: Record<string, string> = {
    pending: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    approved: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
    rejected: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  };
  return map[status] ?? map.pending;
}

// ---------------------------------------------------------------------------
// Ad Campaigns tab
// ---------------------------------------------------------------------------

interface AdCampaign {
  id: string;
  name: string;
  objective: string;
  status: string;
  moderation_status: "pending" | "approved" | "rejected";
  moderation_reason: string | null;
  cpm_credits: string;
  total_budget_credits: string;
  spent_credits: string;
  created_at: string;
}

const PLACEMENTS = [
  { key: "feed_banner", label: "Feed banner (300×250)", size: "300x250" },
  { key: "messages_banner", label: "Messages banner (320×50)", size: "320x50" },
  { key: "games_banner", label: "Games banner (300×250)", size: "300x250" },
  { key: "blog_inline", label: "Blog inline native", size: "native" },
  { key: "room_instream", label: "Room in-stream native", size: "native" },
  { key: "business_page_native", label: "Business Page native", size: "native" },
  { key: "interstitial_global", label: "Interstitial (full-screen)", size: "interstitial" },
  { key: "rewarded_global", label: "Rewarded video", size: "rewarded" },
] as const;

function AdCampaignsPanel({ pages }: { pages: BusinessPageOption[] }) {
  const [eligible, setEligible] = useState<boolean | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<AdCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState("");
  const [objective, setObjective] = useState<"awareness" | "traffic" | "boost_post" | "boost_room">("traffic");
  const [businessPageId, setBusinessPageId] = useState("");
  const [placementKey, setPlacementKey] = useState<(typeof PLACEMENTS)[number]["key"]>("feed_banner");
  const [creativeTitle, setCreativeTitle] = useState("");
  const [creativeBody, setCreativeBody] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [clickUrl, setClickUrl] = useState("");
  const [ctaLabel, setCtaLabel] = useState("Learn more");
  const [budgetCredits, setBudgetCredits] = useState(5000);
  const [couponCode, setCouponCode] = useState("");
  const [couponTargetId, setCouponTargetId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [eligRes, campaignsRes] = await Promise.all([
        fetch("/api/business/ads/eligibility", { credentials: "include" }),
        fetch("/api/business/ads/campaigns", { credentials: "include" }),
      ]);
      const eligJson = await eligRes.json().catch(() => null);
      setEligible(Boolean(eligJson?.data?.eligible));
      setReason(eligJson?.data?.reason ?? null);

      const campaignsJson = await campaignsRes.json().catch(() => null);
      if (campaignsJson?.success) setCampaigns(campaignsJson.data.campaigns);
    } catch {
      setError("Failed to load ad campaigns");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const createRes = await fetch("/api/business/ads/campaigns", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), objective, businessPageId: businessPageId || null }),
      });
      const createJson = await createRes.json();
      if (!createJson.success) throw new Error(createJson.error?.message ?? "Failed to create campaign");
      const campaignId = createJson.data.campaign.id as string;

      const creativeRes = await fetch(`/api/business/ads/campaigns/${campaignId}/creatives`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          placementKey,
          format: imageUrl ? "image" : "text",
          size: PLACEMENTS.find((p) => p.key === placementKey)?.size ?? "native",
          title: creativeTitle.trim() || undefined,
          body: creativeBody.trim() || undefined,
          imageUrl: imageUrl.trim() || undefined,
          clickUrl: clickUrl.trim(),
          ctaLabel: ctaLabel.trim() || undefined,
        }),
      });
      const creativeJson = await creativeRes.json();
      if (!creativeJson.success) throw new Error(creativeJson.error?.message ?? "Failed to add creative");

      if (budgetCredits > 0) {
        const fundRes = await fetch(`/api/business/ads/campaigns/${campaignId}/fund`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amountCredits: Number(budgetCredits) }),
        });
        const fundJson = await fundRes.json();
        if (!fundJson.success) throw new Error(fundJson.error?.message ?? "Failed to fund campaign — check your Credit balance");
      }

      const submitRes = await fetch(`/api/business/ads/campaigns/${campaignId}/submit`, { method: "POST", credentials: "include" });
      const submitJson = await submitRes.json();
      if (!submitJson.success) throw new Error(submitJson.error?.message ?? "Failed to submit for review");

      setShowForm(false);
      setName(""); setCreativeTitle(""); setCreativeBody(""); setImageUrl(""); setClickUrl(""); setBudgetCredits(5000);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create ad campaign");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRunState(campaignId: string, action: "activate" | "pause" | "stop") {
    try {
      const res = await fetch(`/api/business/ads/campaigns/${campaignId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? "Failed to update campaign");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update campaign");
    }
  }

  async function handleRedeemCoupon() {
    if (!couponTargetId || !couponCode.trim()) return;
    try {
      const res = await fetch("/api/business/ads/coupons/redeem", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId: couponTargetId, code: couponCode.trim() }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? "Invalid coupon");
      setCouponCode("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to redeem coupon");
    }
  }

  if (loading) return <div className="h-40 animate-pulse rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900" />;

  if (!eligible) {
    return (
      <div className="rounded-2xl border border-neutral-200 bg-white p-6 text-center dark:border-neutral-800 dark:bg-neutral-900">
        <p className="text-sm text-neutral-600 dark:text-neutral-400">{reason ?? "You are not eligible to place ads yet."}</p>
        <div className="mt-3 flex justify-center gap-3">
          <Link href="/settings/business" className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
            Manage Business Account
          </Link>
          <Link href="/kyc" className="rounded-xl border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-700 dark:border-neutral-600 dark:text-neutral-200">
            Verify Identity
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">{error}</div>
      )}

      <div className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="font-semibold text-neutral-900 dark:text-neutral-100">Ad Campaigns</h2>
        <p className="mt-1 text-sm text-neutral-500">
          CPM billing (Credits per 1,000 impressions), AI-assisted or manual review, and multiple placements — banner, native,
          interstitial, and rewarded. Fund with Zobia Credits, or top up Credits with cash (Paystack/DodoPayments/Play Billing) first.
        </p>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="mt-3 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          {showForm ? "Cancel" : "+ New Ad Campaign"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-neutral-700 dark:text-neutral-300">Campaign Name</label>
            <input required maxLength={150} value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">Objective</label>
              <select value={objective} onChange={(e) => setObjective(e.target.value as typeof objective)} className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100">
                <option value="traffic">Drive traffic</option>
                <option value="awareness">Brand awareness</option>
                <option value="boost_post">Boost a Blog post</option>
                <option value="boost_room">Boost a Room</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">Attribute to Page (optional)</label>
              <select value={businessPageId} onChange={(e) => setBusinessPageId(e.target.value)} className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100">
                <option value="">— none —</option>
                {pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-neutral-700 dark:text-neutral-300">Placement</label>
            <select value={placementKey} onChange={(e) => setPlacementKey(e.target.value as typeof placementKey)} className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100">
              {PLACEMENTS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-neutral-700 dark:text-neutral-300">Ad Title</label>
            <input maxLength={150} value={creativeTitle} onChange={(e) => setCreativeTitle(e.target.value)} className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-neutral-700 dark:text-neutral-300">Ad Body</label>
            <textarea rows={2} maxLength={2000} value={creativeBody} onChange={(e) => setCreativeBody(e.target.value)} className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">Image URL (optional)</label>
              <input type="url" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">CTA Label</label>
              <input maxLength={40} value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100" />
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-neutral-700 dark:text-neutral-300">Destination URL</label>
            <input required type="url" value={clickUrl} onChange={(e) => setClickUrl(e.target.value)} className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-neutral-700 dark:text-neutral-300">Budget (Credits)</label>
            <input required type="number" min={0} value={budgetCredits} onChange={(e) => setBudgetCredits(Number(e.target.value))} className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100" />
            <p className="mt-1 text-xs text-neutral-400">Debited from your Credit balance now. Need more Credits? Top up on the <Link href="/wallet" className="underline">Wallet</Link> page with cash first.</p>
          </div>
          <button type="submit" disabled={submitting} className="w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
            {submitting ? "Submitting…" : "Create & Submit for Review"}
          </button>
        </form>
      )}

      {campaigns.length === 0 ? (
        <p className="text-sm text-neutral-400">No ad campaigns yet.</p>
      ) : (
        <div className="space-y-3">
          {campaigns.map((c) => (
            <div key={c.id} className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold text-neutral-900 dark:text-neutral-100">{c.name}</p>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${moderationBadge(c.moderation_status)}`}>{c.moderation_status}</span>
                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold capitalize text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">{c.status}</span>
              </div>
              {c.moderation_status === "rejected" && c.moderation_reason && (
                <p className="mt-1 text-xs text-red-600">Reason: {c.moderation_reason}</p>
              )}
              <p className="mt-2 text-xs text-neutral-400">
                CPM {Number(c.cpm_credits).toLocaleString()} Credits · Spent {Number(c.spent_credits).toLocaleString()} / {Number(c.total_budget_credits).toLocaleString()} Credits
              </p>
              {c.moderation_status === "approved" && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {c.status !== "active" && (
                    <button onClick={() => handleRunState(c.id, "activate")} className="rounded-lg bg-green-600 px-3 py-1 text-xs font-semibold text-white hover:bg-green-700">Activate</button>
                  )}
                  {c.status === "active" && (
                    <button onClick={() => handleRunState(c.id, "pause")} className="rounded-lg border border-neutral-300 px-3 py-1 text-xs font-semibold text-neutral-700 dark:border-neutral-600 dark:text-neutral-200">Pause</button>
                  )}
                  {c.status !== "stopped" && c.status !== "completed" && (
                    <button onClick={() => handleRunState(c.id, "stop")} className="rounded-lg border border-red-300 px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400">Stop</button>
                  )}
                  <button
                    onClick={() => { setCouponTargetId(c.id); }}
                    className="rounded-lg border border-neutral-300 px-3 py-1 text-xs font-semibold text-neutral-700 dark:border-neutral-600 dark:text-neutral-200"
                  >
                    Apply coupon…
                  </button>
                </div>
              )}
              {couponTargetId === c.id && (
                <div className="mt-2 flex gap-2">
                  <input
                    value={couponCode}
                    onChange={(e) => setCouponCode(e.target.value)}
                    placeholder="COUPON CODE"
                    className="flex-1 rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-1.5 text-xs uppercase dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
                  />
                  <button onClick={handleRedeemCoupon} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">Redeem</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sponsored Quests tab (pre-existing)
// ---------------------------------------------------------------------------

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

function SponsoredQuestsPanel({ pages }: { pages: BusinessPageOption[] }) {
  const [tierAllowed, setTierAllowed] = useState<boolean | null>(null);
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
      const [accountRes, questsRes] = await Promise.all([
        fetch("/api/business", { credentials: "include" }),
        fetch("/api/business/sponsored-quests", { credentials: "include" }),
      ]);
      const accountJson = await accountRes.json().catch(() => null);
      const tier = accountJson?.data?.business?.tier;
      setTierAllowed(tier === "growth" || tier === "enterprise");

      const questsJson = await questsRes.json();
      if (questsJson.success) setQuests(questsJson.data.quests);
    } catch {
      setError("Failed to load Sponsored Quests");
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

  if (loading) return <div className="h-40 animate-pulse rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900" />;

  return (
    <div className="space-y-4">
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function BusinessAdsPage() {
  const [tab, setTab] = useState<"campaigns" | "quests">("campaigns");
  const [pages, setPages] = useState<BusinessPageOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/business/pages", { credentials: "include" });
        const json = await res.json();
        if (json.success) setPages(json.data.pages.filter((p: BusinessPageOption) => p.status === "active"));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

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

      <div className="flex gap-2 rounded-xl bg-neutral-100 p-1 dark:bg-neutral-800">
        <button
          onClick={() => setTab("campaigns")}
          className={`flex-1 rounded-lg py-2 text-sm font-semibold ${tab === "campaigns" ? "bg-white text-neutral-900 shadow dark:bg-neutral-900 dark:text-neutral-50" : "text-neutral-500"}`}
        >
          Ad Campaigns
        </button>
        <button
          onClick={() => setTab("quests")}
          className={`flex-1 rounded-lg py-2 text-sm font-semibold ${tab === "quests" ? "bg-white text-neutral-900 shadow dark:bg-neutral-900 dark:text-neutral-50" : "text-neutral-500"}`}
        >
          Sponsored Quests
        </button>
      </div>

      {tab === "campaigns" ? <AdCampaignsPanel pages={pages} /> : <SponsoredQuestsPanel pages={pages} />}

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
