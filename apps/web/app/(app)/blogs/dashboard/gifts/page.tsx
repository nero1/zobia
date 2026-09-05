"use client";

/**
 * app/(app)/blogs/dashboard/gifts/page.tsx
 *
 * Owner-facing Rewarded Gifts manager (migration 0024): create/edit/enable
 * gift tiers, fund a custom_reward tier's reward pot, write its text-unlock
 * instructions, and see a recent-redemptions feed. Mirrors
 * dashboard/messages/page.tsx's blog-resolution shape.
 */

import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { formatShortDate } from "@/lib/format/date";

type BenefitType = "vip_badge" | "vip_section_access" | "custom_reward";

interface TierRow {
  id: string;
  name: string;
  description: string | null;
  credits_price: number | null;
  stars_price: number | null;
  benefit_type: BenefitType;
  benefit_config: { unlockPostId?: string; treasuryAmount?: number; textInstructions?: string };
  max_redemptions: number | null;
  redemption_count: number;
  expires_at: string | null;
  enabled: boolean;
}

interface PostOption {
  id: string;
  slug: string;
  title: string;
}

interface PurchaseRow {
  id: string;
  tier_name: string;
  buyer_username: string | null;
  currency: string;
  amount_paid: number;
  created_at: string;
}

const emptyForm = {
  name: "",
  description: "",
  creditsPrice: "",
  starsPrice: "",
  benefitType: "vip_badge" as BenefitType,
  unlockPostId: "",
  treasuryAmount: "",
  textInstructions: "",
  maxRedemptions: "",
  expiresAt: "",
};

export default function BlogGiftsPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const blogParam = searchParams.get("blog");
  const [blogSlug, setBlogSlug] = useState<string | null>(null);
  const [tiers, setTiers] = useState<TierRow[]>([]);
  const [posts, setPosts] = useState<PostOption[]>([]);
  const [purchases, setPurchases] = useState<PurchaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fundingTierId, setFundingTierId] = useState<string | null>(null);
  const [fundAmount, setFundAmount] = useState("");

  const load = useCallback(async (slug: string) => {
    setLoading(true);
    try {
      const [tiersRes, postsRes, purchasesRes] = await Promise.all([
        fetch(`/api/blogs/${slug}/gifts/mine`, { credentials: "include" }),
        fetch(`/api/blogs/${slug}/posts?type=article&status=published&limit=100`, { credentials: "include" }),
        fetch(`/api/blogs/${slug}/gifts/redemptions`, { credentials: "include" }),
      ]);
      const tiersJson = await tiersRes.json().catch(() => null);
      const postsJson = await postsRes.json().catch(() => null);
      const purchasesJson = await purchasesRes.json().catch(() => null);
      setTiers(tiersJson?.data?.tiers ?? []);
      setPosts(postsJson?.data?.posts ?? []);
      setPurchases(purchasesJson?.data?.purchases ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const meRes = await fetch("/api/blogs/me", { credentials: "include" });
      const meJson = await meRes.json().catch(() => null);
      const blogs = meJson?.data?.blogs ?? [];
      if (blogs.length === 0) { router.replace("/blogs/new"); return; }
      const blog = blogs.length === 1 ? blogs[0] : blogs.find((b: { slug: string }) => b.slug === blogParam);
      if (!blog) { router.replace("/blogs/dashboard"); return; }
      setBlogSlug(blog.slug);
      await load(blog.slug);
    })();
  }, [router, blogParam, load]);

  async function createTier() {
    if (!blogSlug || saving) return;
    setError(null);
    if (!form.name.trim()) { setError(t("blogs.gifts.errorName", "Give this tier a name.")); return; }
    if (!form.creditsPrice && !form.starsPrice) { setError(t("blogs.gifts.errorPrice", "Set a Credits and/or Stars price.")); return; }
    if (form.benefitType === "vip_section_access" && !form.unlockPostId) { setError(t("blogs.gifts.errorUnlockPost", "Pick a post to unlock.")); return; }

    const benefitConfig: TierRow["benefit_config"] =
      form.benefitType === "vip_section_access" ? { unlockPostId: form.unlockPostId } :
      form.benefitType === "custom_reward" ? {
        ...(form.treasuryAmount ? { treasuryAmount: Number(form.treasuryAmount) } : {}),
        ...(form.textInstructions.trim() ? { textInstructions: form.textInstructions.trim() } : {}),
      } : {};

    setSaving(true);
    try {
      const res = await fetch(`/api/blogs/${blogSlug}/gifts`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          creditsPrice: form.creditsPrice ? Number(form.creditsPrice) : undefined,
          starsPrice: form.starsPrice ? Number(form.starsPrice) : undefined,
          benefitType: form.benefitType,
          benefitConfig,
          maxRedemptions: form.maxRedemptions ? Number(form.maxRedemptions) : undefined,
          expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed to create tier");
      setForm(emptyForm);
      await load(blogSlug);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create tier");
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled(tier: TierRow) {
    if (!blogSlug) return;
    setTiers((prev) => prev.map((t2) => (t2.id === tier.id ? { ...t2, enabled: !t2.enabled } : t2)));
    await fetch(`/api/blogs/${blogSlug}/gifts/${tier.id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !tier.enabled }),
    });
  }

  async function fundTreasury(tierId: string) {
    if (!blogSlug || !fundAmount) return;
    await fetch(`/api/blogs/${blogSlug}/gifts/${tierId}/treasury`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: Number(fundAmount) }),
    });
    setFundingTierId(null);
    setFundAmount("");
  }

  if (!blogSlug) return null;

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="mb-1 text-2xl font-bold text-foreground">{t("blogs.dashboard.gifts", "Gifts")}</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        {t("blogs.gifts.hint", "Readers can send a gift to support your blog and unlock a benefit you choose.")}
      </p>

      <div className="mb-6 rounded-2xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-bold text-foreground">{t("blogs.gifts.newTier", "New gift tier")}</h2>
        {error && <p className="mb-2 text-xs text-red-400">{error}</p>}
        <div className="space-y-2">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder={t("blogs.gifts.namePlaceholder", "Tier name, e.g. Supporter")}
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder={t("blogs.gifts.descriptionPlaceholder", "What does this gift do? (shown to readers)")}
            rows={2}
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
          <div className="flex gap-2">
            <input
              value={form.creditsPrice}
              onChange={(e) => setForm({ ...form, creditsPrice: e.target.value.replace(/\D/g, "") })}
              placeholder={t("blogs.gifts.creditsPricePlaceholder", "Credits price")}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
            <input
              value={form.starsPrice}
              onChange={(e) => setForm({ ...form, starsPrice: e.target.value.replace(/\D/g, "") })}
              placeholder={t("blogs.gifts.starsPricePlaceholder", "Stars price")}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </div>

          <select
            value={form.benefitType}
            onChange={(e) => setForm({ ...form, benefitType: e.target.value as BenefitType })}
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"
          >
            <option value="vip_badge">{t("blogs.gifts.benefitVipBadge", "VIP badge in comments")}</option>
            <option value="vip_section_access">{t("blogs.gifts.benefitUnlock", "Unlock a post")}</option>
            <option value="custom_reward">{t("blogs.gifts.benefitCustom", "Custom reward")}</option>
          </select>

          {form.benefitType === "vip_section_access" && (
            <select
              value={form.unlockPostId}
              onChange={(e) => setForm({ ...form, unlockPostId: e.target.value })}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="">{t("blogs.gifts.pickPost", "Pick a post to unlock…")}</option>
              {posts.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          )}

          {form.benefitType === "custom_reward" && (
            <>
              <input
                value={form.treasuryAmount}
                onChange={(e) => setForm({ ...form, treasuryAmount: e.target.value.replace(/\D/g, "") })}
                placeholder={t("blogs.gifts.treasuryAmountPlaceholder", "Credits paid out per buyer (optional)")}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
              <textarea
                value={form.textInstructions}
                onChange={(e) => setForm({ ...form, textInstructions: e.target.value })}
                placeholder={t("blogs.gifts.textInstructionsPlaceholder", "Text revealed after purchase (e.g. claim steps, an invite link)…")}
                rows={2}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
              <p className="text-xs text-muted-foreground">
                {t("blogs.gifts.maxRedemptionsHint", "Use \"Max redemptions\" below for the \"first X people\" cap.")}
              </p>
            </>
          )}

          <div className="flex gap-2">
            <input
              value={form.maxRedemptions}
              onChange={(e) => setForm({ ...form, maxRedemptions: e.target.value.replace(/\D/g, "") })}
              placeholder={t("blogs.gifts.maxRedemptionsPlaceholder", "Max redemptions (optional)")}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
            <input
              type="datetime-local"
              value={form.expiresAt}
              onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </div>

          <button
            onClick={createTier}
            disabled={saving}
            className="w-full rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {saving ? t("blogs.gifts.creating", "Creating…") : t("blogs.gifts.createTier", "Create tier")}
          </button>
        </div>
      </div>

      <h2 className="mb-2 text-sm font-bold text-foreground">{t("blogs.gifts.yourTiers", "Your tiers")}</h2>
      {loading ? (
        <div className="space-y-2">{Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-16 rounded-xl bg-neutral-800 animate-pulse" />)}</div>
      ) : tiers.length === 0 ? (
        <p className="mb-6 text-sm text-muted-foreground">{t("blogs.gifts.noTiers", "No gift tiers yet.")}</p>
      ) : (
        <div className="mb-6 space-y-2">
          {tiers.map((tier) => (
            <div key={tier.id} className="rounded-xl border border-border bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-foreground">{tier.name}</span>
                <button
                  onClick={() => toggleEnabled(tier)}
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${tier.enabled ? "bg-emerald-950/40 text-emerald-400" : "bg-neutral-800 text-neutral-400"}`}
                >
                  {tier.enabled ? t("blogs.gifts.enabled", "Enabled") : t("blogs.gifts.disabled", "Disabled")}
                </button>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {[tier.credits_price ? `${tier.credits_price} Credits` : null, tier.stars_price ? `${tier.stars_price} Stars` : null].filter(Boolean).join(" · ")}
                {" — "}{tier.benefit_type.replace(/_/g, " ")}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {t("blogs.gifts.redemptionCount", "{{count}} redeemed", { count: tier.redemption_count })}
                {tier.max_redemptions ? ` / ${tier.max_redemptions}` : ""}
                {tier.expires_at ? ` · ${t("blogs.gifts.expires", "expires")} ${formatShortDate(tier.expires_at)}` : ""}
              </div>

              {tier.benefit_type === "custom_reward" && (
                <div className="mt-2 flex gap-2">
                  {fundingTierId === tier.id ? (
                    <>
                      <input
                        value={fundAmount}
                        onChange={(e) => setFundAmount(e.target.value.replace(/\D/g, ""))}
                        placeholder={t("blogs.gifts.fundAmountPlaceholder", "Credits to add")}
                        className="w-full rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground"
                      />
                      <button onClick={() => fundTreasury(tier.id)} className="rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground">
                        {t("blogs.gifts.fund", "Fund")}
                      </button>
                    </>
                  ) : (
                    <button onClick={() => setFundingTierId(tier.id)} className="rounded-lg bg-neutral-800 px-2.5 py-1 text-xs font-medium text-neutral-200 hover:bg-neutral-700">
                      {t("blogs.gifts.fundPot", "Fund reward pot")}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <h2 className="mb-2 text-sm font-bold text-foreground">{t("blogs.gifts.recentGifts", "Recent gifts")}</h2>
      {purchases.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("blogs.gifts.noGiftsYet", "No gifts sent yet.")}</p>
      ) : (
        <div className="space-y-1.5">
          {purchases.map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded-xl border border-border bg-card px-3 py-2 text-xs">
              <span className="text-foreground">
                {p.buyer_username ? `@${p.buyer_username}` : t("blogs.gifts.anonymous", "A reader")} → {p.tier_name}
              </span>
              <span className="text-muted-foreground">{p.amount_paid} {p.currency} · {formatShortDate(p.created_at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
