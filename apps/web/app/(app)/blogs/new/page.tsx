"use client";

/**
 * app/(app)/blogs/new/page.tsx
 *
 * Create a blog for the caller — a personal blog, or (if the caller owns a
 * business account) a business blog, matching what POST /api/blogs
 * (lib/blogs/service.ts's createBlog) actually supports. Fetches the
 * caller's quota status from GET /api/blogs/quota up front so the form
 * can show, for whichever scope is selected, whether the new blog fits the
 * scope's included quota for free or needs an extra-slot Credits/Stars
 * unlock — the admin-configurable price comes from that endpoint, never
 * hardcoded here. On success, redirects to the creator dashboard.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { useCurrency } from "@/lib/hooks/useCurrency";

type BlogScope = "personal" | "business";
type SlotCurrency = "credits" | "stars";

interface ExtraSlotCost {
  credits: number;
  stars: number;
  acceptedCurrencies: SlotCurrency[];
}

interface ScopeQuota {
  used: number;
  included: number;
  remaining: number;
  atCapacity: boolean;
}

interface QuotaData {
  personal: ScopeQuota & { plan: string; extraSlotCost: ExtraSlotCost };
  business: (ScopeQuota & { id: string; name: string; tier: string; status: string; extraSlotCost: ExtraSlotCost }) | null;
}

interface WalletBalance {
  coins: number;
  stars: number;
}

const ERROR_MESSAGE_KEYS: Record<string, [string, string]> = {
  INSUFFICIENT_BALANCE: ["blogs.new.errors.insufficientCredits", "You don't have enough Credits to unlock an extra blog slot."],
  INSUFFICIENT_STAR_BALANCE: ["blogs.new.errors.insufficientStars", "You don't have enough Stars to unlock an extra blog slot."],
  BLOG_SLOT_PAYMENT_UNAVAILABLE: ["blogs.new.errors.paymentUnavailable", "Extra blog slots aren't available for purchase right now. Please try again later."],
  BUSINESS_ACCOUNT_INACTIVE: ["blogs.new.errors.businessInactive", "Your business account must be active to create a blog."],
  FEATURE_DISABLED: ["blogs.new.errors.featureDisabled", "Blogs aren't available right now."],
};

export default function NewBlogPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const currency = useCurrency();

  const [title, setTitle] = useState("");
  const [tagline, setTagline] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [quota, setQuota] = useState<QuotaData | null>(null);
  const [quotaLoading, setQuotaLoading] = useState(true);
  const [balance, setBalance] = useState<WalletBalance | null>(null);

  const [scope, setScope] = useState<BlogScope>("personal");
  const [payCurrency, setPayCurrency] = useState<SlotCurrency | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/blogs/quota", { credentials: "include" }).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/economy/coins/balance", { credentials: "include" }).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([quotaJson, balanceJson]) => {
        if (cancelled) return;
        setQuota(quotaJson?.data ?? null);
        if (balanceJson) setBalance({ coins: balanceJson.coins ?? 0, stars: balanceJson.stars ?? 0 });
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setQuotaLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const scopeQuota = scope === "business" ? quota?.business ?? null : quota?.personal ?? null;
  const extraSlotCost = scopeQuota?.extraSlotCost ?? null;
  const needsPayment = !!scopeQuota?.atCapacity;

  // Default the currency choice to the first admin-accepted one once we know it.
  useEffect(() => {
    if (!needsPayment || !extraSlotCost) { setPayCurrency(null); return; }
    setPayCurrency((prev) => (prev && extraSlotCost.acceptedCurrencies.includes(prev) ? prev : extraSlotCost.acceptedCurrencies[0] ?? null));
  }, [needsPayment, extraSlotCost]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/blogs", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          tagline: tagline || undefined,
          description: description || undefined,
          businessAccountId: scope === "business" ? quota?.business?.id : undefined,
          paymentCurrency: needsPayment && payCurrency ? payCurrency : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        const code = json?.error?.code as string | undefined;
        const mapped = code ? ERROR_MESSAGE_KEYS[code] : undefined;
        const message = mapped ? t(mapped[0], mapped[1]) : (json?.error?.message ?? t("blogs.new.errors.generic", "Failed to create blog"));
        throw new Error(message);
      }
      router.push("/blogs/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("blogs.new.errors.generic", "Failed to create blog"));
    } finally {
      setBusy(false);
    }
  }

  const insufficientBalance =
    needsPayment && payCurrency && balance
      ? payCurrency === "credits"
        ? balance.coins < (extraSlotCost?.credits ?? 0)
        : balance.stars < (extraSlotCost?.stars ?? 0)
      : false;

  const canSubmit = !busy && !!title.trim() && !quotaLoading && (!needsPayment || (!!payCurrency && !insufficientBalance));

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <h1 className="text-2xl font-bold text-foreground mb-1">{t("blogs.new.title", "Start a Blog")}</h1>
      <p className="text-sm text-muted-foreground mb-6">{t("blogs.new.subtitle", "Your blog gets a public page at zobia.org/b/your-slug.")}</p>

      {quota?.business && (
        <div className="mb-4">
          <label className="block text-xs font-medium text-muted-foreground mb-1">{t("blogs.new.scopeLabel", "Create this blog as")}</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setScope("personal")}
              className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors ${
                scope === "personal" ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-foreground hover:bg-muted"
              }`}
            >
              {t("blogs.new.scopePersonal", "Personal blog")}
            </button>
            <button
              type="button"
              onClick={() => setScope("business")}
              className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors ${
                scope === "business" ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-foreground hover:bg-muted"
              }`}
            >
              {t("blogs.new.scopeBusiness", "Business: {{name}}", { name: quota.business.name })}
            </button>
          </div>
          {scope === "business" && quota.business.status !== "active" && (
            <p className="mt-2 text-xs text-red-500">{t("blogs.new.errors.businessInactive", "Your business account must be active to create a blog.")}</p>
          )}
        </div>
      )}

      {!quotaLoading && scopeQuota && (
        <div className={`mb-4 rounded-xl border px-3 py-2.5 text-xs ${needsPayment ? "border-amber-500/40 bg-amber-950/10 text-amber-300" : "border-border bg-card text-muted-foreground"}`}>
          {needsPayment
            ? t("blogs.new.quotaExceeded", "You've used all {{included}} of your included {{scope}} blog slots. Creating another one requires an extra-slot unlock.", {
                included: scopeQuota.included,
                scope: scope === "business" ? t("blogs.new.scopeWordBusiness", "business") : t("blogs.new.scopeWordPersonal", "personal"),
              })
            : t("blogs.new.quotaRemaining", "{{used}} of {{included}} {{scope}} blog slots used — this one is free.", {
                used: scopeQuota.used,
                included: scopeQuota.included,
                scope: scope === "business" ? t("blogs.new.scopeWordBusiness", "business") : t("blogs.new.scopeWordPersonal", "personal"),
              })}
        </div>
      )}

      {needsPayment && extraSlotCost && (
        <div className="mb-4 rounded-xl border border-border bg-card p-3">
          <p className="mb-2 text-sm font-medium text-foreground">{t("blogs.new.payTitle", "Unlock an extra blog slot")}</p>
          {extraSlotCost.acceptedCurrencies.length === 0 ? (
            <p className="text-xs text-red-500">{t("blogs.new.errors.paymentUnavailable", "Extra blog slots aren't available for purchase right now. Please try again later.")}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {extraSlotCost.acceptedCurrencies.includes("credits") && (
                <button
                  type="button"
                  onClick={() => setPayCurrency("credits")}
                  className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                    payCurrency === "credits" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:opacity-80"
                  }`}
                >
                  {t("blogs.new.payWithCredits", "Pay {{amount}} {{currency}}", { amount: extraSlotCost.credits, currency: currency.softPlural })}
                </button>
              )}
              {extraSlotCost.acceptedCurrencies.includes("stars") && (
                <button
                  type="button"
                  onClick={() => setPayCurrency("stars")}
                  className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                    payCurrency === "stars" ? "bg-amber-600 text-white" : "bg-muted text-foreground hover:opacity-80"
                  }`}
                >
                  {t("blogs.new.payWithStars", "Pay {{amount}} {{currency}}", { amount: extraSlotCost.stars, currency: currency.premiumPlural })}
                </button>
              )}
            </div>
          )}
          {balance && payCurrency && (
            <p className="mt-2 text-xs text-muted-foreground">
              {t("blogs.new.yourBalance", "Your balance: {{amount}} {{currency}}", {
                amount: payCurrency === "credits" ? balance.coins : balance.stars,
                currency: payCurrency === "credits" ? currency.softPlural : currency.premiumPlural,
              })}
            </p>
          )}
          {insufficientBalance && (
            <p className="mt-1 text-xs text-red-500">
              {payCurrency === "credits"
                ? t("blogs.new.errors.insufficientCredits", "You don't have enough Credits to unlock an extra blog slot.")
                : t("blogs.new.errors.insufficientStars", "You don't have enough Stars to unlock an extra blog slot.")}
            </p>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">{t("blogs.new.titleLabel", "Blog title")}</label>
          <input
            required
            maxLength={100}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("blogs.new.titlePlaceholder", "e.g. Muna's World")}
            className="w-full rounded-xl border border-border bg-card px-4 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">{t("blogs.new.taglineLabel", "Tagline (optional)")}</label>
          <input
            maxLength={160}
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            className="w-full rounded-xl border border-border bg-card px-4 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">{t("blogs.new.descriptionLabel", "Description (optional)")}</label>
          <textarea
            maxLength={2000}
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-xl border border-border bg-card px-4 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {busy
            ? t("blogs.new.creating", "Creating…")
            : needsPayment && extraSlotCost
            ? t("blogs.new.createAndPay", "Create blog & unlock slot")
            : t("blogs.new.create", "Create blog")}
        </button>
      </form>
    </div>
  );
}
