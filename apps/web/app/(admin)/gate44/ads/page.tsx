"use client";

/**
 * app/(admin)/admin/ads/page.tsx
 *
 * Admin ad control panel (PRD §17 Pillar 3 — Platform Advertising).
 * Tabs: platform revenue/performance overview, the moderation approval
 * queue (mirrors /gate44/sponsored-quests), the ad slot catalogue, and the
 * coupon system.
 */

import { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Overview tab
// ---------------------------------------------------------------------------

interface OverviewData {
  activeCampaigns: number;
  totalSpendCredits: string;
  totalBudgetCredits: string;
  pendingModeration: number;
  topCampaigns: { id: string; name: string; spent_credits: string; advertiser_name: string | null }[];
}

function OverviewTab() {
  const [data, setData] = useState<OverviewData | null>(null);

  useEffect(() => {
    fetch("/api/admin/ads/stats", { credentials: "include" })
      .then((r) => r.json())
      .then((j) => { if (j.success) setData(j.data); });
  }, []);

  if (!data) return <div className="h-40 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Active Campaigns", value: data.activeCampaigns },
          { label: "Pending Review", value: data.pendingModeration },
          { label: "Total Spend (Credits)", value: Number(data.totalSpendCredits).toLocaleString() },
          { label: "Total Budget (Credits)", value: Number(data.totalBudgetCredits).toLocaleString() },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <p className="text-xs text-neutral-500">{s.label}</p>
            <p className="mt-1 text-xl font-bold text-neutral-900 dark:text-neutral-50">{s.value}</p>
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <h3 className="mb-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100">Top campaigns by spend</h3>
        {data.topCampaigns.length === 0 ? (
          <p className="text-sm text-neutral-400">No spend yet.</p>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-sm">
            <tbody>
              {data.topCampaigns.map((c) => (
                <tr key={c.id} className="border-t border-neutral-100 dark:border-neutral-800">
                  <td className="py-1.5 pr-2">{c.name}</td>
                  <td className="py-1.5 pr-2 text-neutral-500">{c.advertiser_name}</td>
                  <td className="py-1.5 text-right font-semibold">{Number(c.spent_credits).toLocaleString()} Credits</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Moderation tab
// ---------------------------------------------------------------------------

interface AdCampaign {
  id: string;
  name: string;
  objective: string;
  status: string;
  moderation_status: "pending" | "approved" | "rejected";
  advertiser_name: string | null;
  cpm_credits: string;
  total_budget_credits: string;
  created_at: string;
}

function ModerationTab() {
  const [campaigns, setCampaigns] = useState<AdCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/ads/campaigns?moderationStatus=pending", { credentials: "include" });
    const json = await res.json();
    if (json.success) setCampaigns(json.data.campaigns);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function moderate(id: string, action: "approve" | "reject") {
    setBusyId(id);
    try {
      const reason = action === "reject" ? window.prompt("Rejection reason (optional):") ?? undefined : undefined;
      await fetch(`/api/admin/ads/campaigns/${id}/moderate`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason }),
      });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <div className="h-40 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" />;
  if (campaigns.length === 0) return <p className="text-sm text-neutral-400">No campaigns pending review.</p>;

  return (
    <div className="space-y-3">
      {campaigns.map((c) => (
        <div key={c.id} className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-semibold text-neutral-900 dark:text-neutral-100">{c.name}</p>
              <p className="text-xs text-neutral-500">{c.advertiser_name} · {c.objective} · CPM {c.cpm_credits} Credits · Budget {Number(c.total_budget_credits).toLocaleString()} Credits</p>
            </div>
            <div className="flex gap-2">
              <button disabled={busyId === c.id} onClick={() => moderate(c.id, "approve")} className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50">Approve</button>
              <button disabled={busyId === c.id} onClick={() => moderate(c.id, "reject")} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50">Reject</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Placements tab
// ---------------------------------------------------------------------------

interface Placement {
  key: string;
  label: string;
  size: string;
  is_active: boolean;
  base_cpm_credits: string;
}

function PlacementsTab() {
  const [placements, setPlacements] = useState<Placement[]>([]);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/ads/placements", { credentials: "include" });
    const json = await res.json();
    if (json.success) setPlacements(json.data.placements);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function toggle(key: string, isActive: boolean) {
    await fetch(`/api/admin/ads/placements/${key}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !isActive }),
    });
    await load();
  }

  async function updateCpm(key: string, value: string) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return;
    await fetch(`/api/admin/ads/placements/${key}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseCpmCredits: n }),
    });
  }

  return (
    <div className="space-y-2">
      {placements.map((p) => (
        <div key={p.key} className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
          <div>
            <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{p.label}</p>
            <p className="text-xs text-neutral-500">{p.key} · {p.size}</p>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="number"
              defaultValue={p.base_cpm_credits}
              onBlur={(e) => updateCpm(p.key, e.target.value)}
              className="w-24 rounded-lg border border-neutral-300 bg-neutral-50 px-2 py-1 text-xs dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
              title="Base CPM (Credits per 1000 impressions)"
            />
            <button
              onClick={() => toggle(p.key, p.is_active)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${p.is_active ? "bg-green-100 text-green-700" : "bg-neutral-200 text-neutral-500"}`}
            >
              {p.is_active ? "Active" : "Inactive"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Coupons tab
// ---------------------------------------------------------------------------

interface Coupon {
  id: string;
  code: string;
  discount_type: string;
  discount_value: string;
  redemptions_count: number;
  max_redemptions: number | null;
  is_active: boolean;
}

function CouponsTab() {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [code, setCode] = useState("");
  const [discountType, setDiscountType] = useState<"percent" | "flat_credits" | "free_credits">("flat_credits");
  const [discountValue, setDiscountValue] = useState(1000);
  const [maxRedemptions, setMaxRedemptions] = useState<number | "">("");

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/ads/coupons", { credentials: "include" });
    const json = await res.json();
    if (json.success) setCoupons(json.data.coupons);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function create() {
    if (!code.trim()) return;
    await fetch("/api/admin/ads/coupons", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: code.trim(),
        discountType,
        discountValue: Number(discountValue),
        maxRedemptions: maxRedemptions === "" ? undefined : Number(maxRedemptions),
      }),
    });
    setCode("");
    await load();
  }

  async function toggle(id: string, isActive: boolean) {
    await fetch(`/api/admin/ads/coupons/${id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !isActive }),
    });
    await load();
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900 sm:grid-cols-5">
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="CODE" className="rounded-lg border border-neutral-300 bg-neutral-50 px-2 py-1.5 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100" />
        <select value={discountType} onChange={(e) => setDiscountType(e.target.value as typeof discountType)} className="rounded-lg border border-neutral-300 bg-neutral-50 px-2 py-1.5 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100">
          <option value="flat_credits">Flat Credits</option>
          <option value="percent">Percent off budget</option>
          <option value="free_credits">Free Credits</option>
        </select>
        <input type="number" value={discountValue} onChange={(e) => setDiscountValue(Number(e.target.value))} className="rounded-lg border border-neutral-300 bg-neutral-50 px-2 py-1.5 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100" />
        <input type="number" placeholder="Max redemptions" value={maxRedemptions} onChange={(e) => setMaxRedemptions(e.target.value === "" ? "" : Number(e.target.value))} className="rounded-lg border border-neutral-300 bg-neutral-50 px-2 py-1.5 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100" />
        <button onClick={create} className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700">Create</button>
      </div>
      <div className="space-y-2">
        {coupons.map((c) => (
          <div key={c.id} className="flex items-center justify-between rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
            <div>
              <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{c.code}</p>
              <p className="text-xs text-neutral-500">{c.discount_type} · {c.discount_value} · {c.redemptions_count}/{c.max_redemptions ?? "∞"} redeemed</p>
            </div>
            <button onClick={() => toggle(c.id, c.is_active)} className={`rounded-full px-3 py-1 text-xs font-semibold ${c.is_active ? "bg-green-100 text-green-700" : "bg-neutral-200 text-neutral-500"}`}>
              {c.is_active ? "Active" : "Inactive"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings tab — advertiser eligibility rules (x_manifest, see
// lib/ads/limits.ts getAdsAdminConfig / migration 0014_ads_advertiser_wallet.sql)
// ---------------------------------------------------------------------------

interface AdsFieldMeta {
  key: string;
  label: string;
  description: string;
  type: "boolean" | "number";
}

const ADS_SETTINGS_FIELDS: AdsFieldMeta[] = [
  { key: "ad_allow_personal_accounts", label: "Allow Personal Accounts", description: "Let personal (non-business) accounts place ads, not just Business Accounts.", type: "boolean" },
  { key: "ad_require_kyc", label: "Require KYC", description: "Require identity verification before an account can place ads.", type: "boolean" },
  { key: "ad_min_kyc_tier_to_advertise", label: "Minimum KYC Tier", description: "Minimum KYC tier required to advertise, when KYC is required.", type: "number" },
  { key: "ad_allow_free_accounts", label: "Allow Free Accounts", description: "Let free-plan accounts place ads (only relevant if Personal Accounts is on).", type: "boolean" },
  { key: "ad_min_level_free_accounts", label: "Min Level — Free Accounts", description: "Minimum account level for a free-plan account to advertise, when allowed.", type: "number" },
  { key: "ad_enforce_min_level_paid_business", label: "Enforce Level — Paid/Business", description: "Also require a minimum level for paid-plan and Business Account advertisers.", type: "boolean" },
  { key: "ad_min_level_paid_business", label: "Min Level — Paid/Business", description: "Minimum account level for paid-plan/Business advertisers, when enforced.", type: "number" },
  { key: "ad_advertiser_grace_days", label: "Advertiser Grace Period (days)", description: "How long an ad keeps running under its original advertiser identity after the business account/page behind it lapses.", type: "number" },
];

function AdsToggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${checked ? "bg-primary-600" : "bg-neutral-300 dark:bg-neutral-700"}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${checked ? "translate-x-6" : "translate-x-1"}`} />
    </button>
  );
}

function SettingsTab() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => {
    fetch("/api/admin/config", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        const entries: { key: string; value: string }[] = json?.data ?? json?.entries ?? [];
        const map: Record<string, string> = {};
        for (const e of entries) map[e.key] = e.value;
        setValues(map);
      })
      .catch(() => showToast("Failed to load settings", "error"))
      .finally(() => setLoading(false));
  }, [showToast]);

  async function save(key: string, value: string) {
    setSaving(key);
    try {
      const res = await fetch(`/api/admin/config/${key}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
      if (!res.ok) throw new Error("Save failed");
      setValues((prev) => ({ ...prev, [key]: value }));
      showToast("Saved");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Save failed", "error");
    } finally {
      setSaving(null);
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" />)}
      </div>
    );
  }

  return (
    <div className="relative">
      <p className="mb-4 text-sm text-neutral-500">
        Controls who can create ads, and whether their identity/KYC/level qualifies. This also decides
        whether the &quot;Create Business Account&quot; and &quot;Complete KYC&quot; buttons show on the Ads page.
      </p>
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-modal ${toast.type === "success" ? "bg-teal-600" : "bg-red-600"}`}>
          {toast.msg}
        </div>
      )}
      <div className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
        {ADS_SETTINGS_FIELDS.map((field) => {
          const raw = values[field.key] ?? "";
          const isSaving = saving === field.key;
          return (
            <div key={field.key} className="flex items-center justify-between gap-4 px-4 py-3.5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">{field.label}</p>
                <p className="text-xs text-neutral-500">{field.description}</p>
              </div>
              {field.type === "boolean" ? (
                <AdsToggle checked={raw === "true"} disabled={isSaving} onChange={(v) => save(field.key, v ? "true" : "false")} />
              ) : (
                <input
                  type="number"
                  defaultValue={raw}
                  disabled={isSaving}
                  onBlur={(e) => { if (e.target.value !== raw) save(field.key, e.target.value); }}
                  className="w-24 rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-right text-sm text-neutral-900 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50"
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "moderation", label: "Moderation Queue" },
  { key: "placements", label: "Placements" },
  { key: "coupons", label: "Coupons" },
  { key: "settings", label: "Settings" },
] as const;

export default function AdminAdsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("overview");

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-50">Ads</h1>
      <div className="flex flex-wrap gap-2 border-b border-neutral-200 dark:border-neutral-800">
        {TABS.map((tb) => (
          <button
            key={tb.key}
            onClick={() => setTab(tb.key)}
            className={`px-3 py-2 text-sm font-semibold ${tab === tb.key ? "border-b-2 border-blue-600 text-blue-600" : "text-neutral-500"}`}
          >
            {tb.label}
          </button>
        ))}
      </div>
      {tab === "overview" && <OverviewTab />}
      {tab === "moderation" && <ModerationTab />}
      {tab === "placements" && <PlacementsTab />}
      {tab === "coupons" && <CouponsTab />}
      {tab === "settings" && <SettingsTab />}
    </div>
  );
}
