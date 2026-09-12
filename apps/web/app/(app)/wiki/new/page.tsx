"use client";

/**
 * app/(app)/wiki/new/page.tsx
 *
 * Create a wiki for the caller. POST /api/wiki can fail with:
 *  - 403 WIKI_CREATE_NOT_ELIGIBLE — the site admin hasn't allowed this
 *    user's plan/level/role to create wikis yet; show the eligibility
 *    reason returned by the API rather than a generic error.
 *  - 403 WIKI_OWNED_LIMIT_REACHED — the caller's plan quota of owned wikis
 *    is already used up.
 * On success, redirects into the new wiki's manage dashboard.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

type ContributePolicy = "everyone" | "friends" | "selected";

const ERROR_MESSAGE_KEYS: Record<string, [string, string]> = {
  WIKI_OWNED_LIMIT_REACHED: ["wiki.new.errors.limitReached", "You've reached your plan's limit for owned wikis. Upgrade your plan to create more."],
  FEATURE_DISABLED: ["wiki.new.errors.featureDisabled", "Wikis aren't available right now."],
};

export default function NewWikiPage() {
  const { t } = useTranslation();
  const router = useRouter();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [contributePolicy, setContributePolicy] = useState<ContributePolicy>("everyone");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notEligible, setNotEligible] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotEligible(null);
    try {
      const res = await fetch("/api/wiki", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: description || undefined,
          contributePolicy,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        const code = json?.error?.code as string | undefined;
        if (code === "WIKI_CREATE_NOT_ELIGIBLE") {
          setNotEligible(json?.error?.message ?? t("wiki.new.errors.notEligible", "You're not eligible to create a wiki yet."));
          return;
        }
        const mapped = code ? ERROR_MESSAGE_KEYS[code] : undefined;
        const message = mapped ? t(mapped[0], mapped[1]) : (json?.error?.message ?? t("wiki.new.errors.generic", "Failed to create wiki"));
        throw new Error(message);
      }
      const slug = json?.data?.slug as string | undefined;
      router.push(slug ? `/wiki/${slug}/manage` : "/wiki/me");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("wiki.new.errors.generic", "Failed to create wiki"));
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = !busy && name.trim().length >= 2;

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <h1 className="text-2xl font-bold text-foreground mb-1">{t("wiki.new.title", "Create a wiki")}</h1>
      <p className="text-sm text-muted-foreground mb-6">{t("wiki.new.subtitle", "Start a collaborative wiki other members can browse and contribute to.")}</p>

      {notEligible && (
        <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-950/10 px-4 py-3 text-sm text-amber-300">
          {notEligible}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">{t("wiki.new.nameLabel", "Wiki name")}</label>
          <input
            required
            minLength={2}
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("wiki.new.namePlaceholder", "e.g. Zobia Lore Wiki")}
            className="w-full rounded-xl border border-border bg-card px-4 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">{t("wiki.new.descriptionLabel", "Description (optional)")}</label>
          <textarea
            maxLength={2000}
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-xl border border-border bg-card px-4 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">{t("wiki.new.policyLabel", "Who can contribute pages?")}</label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {([
              ["everyone", t("wiki.policy.everyone", "Everyone"), t("wiki.policy.everyoneHint", "Any signed-in user can create and edit pages.")],
              ["friends", t("wiki.policy.friends", "Friends only"), t("wiki.policy.friendsHint", "Only your accepted friends can contribute.")],
              ["selected", t("wiki.policy.selected", "Selected people"), t("wiki.policy.selectedHint", "Only people you add or invite can contribute.")],
            ] as [ContributePolicy, string, string][]).map(([value, label, hint]) => (
              <button
                type="button"
                key={value}
                onClick={() => setContributePolicy(value)}
                className={`text-left rounded-xl border px-3 py-2.5 text-sm transition-colors ${
                  contributePolicy === value ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-foreground hover:bg-muted"
                }`}
              >
                <div className="font-medium">{label}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>
              </button>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {busy ? t("wiki.new.creating", "Creating…") : t("wiki.new.create", "Create wiki")}
        </button>
      </form>
    </div>
  );
}
