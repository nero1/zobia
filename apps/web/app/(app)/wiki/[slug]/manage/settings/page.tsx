"use client";

/**
 * app/(app)/wiki/[slug]/manage/settings/page.tsx
 *
 * Wiki settings: name/description/avatar/cover image and the
 * contribute_policy picker (everyone/friends/selected). Owner-only —
 * PATCH /api/wiki/<slug> enforces this server-side.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

type ContributePolicy = "everyone" | "friends" | "selected";

interface WikiRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  cover_image_url: string | null;
  contribute_policy: ContributePolicy;
  owner_id: string;
}

export default function WikiSettingsPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  const [wiki, setWiki] = useState<WikiRow | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [contributePolicy, setContributePolicy] = useState<ContributePolicy>("everyone");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/wiki/${slug}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!json?.data?.isOwner) { router.replace(`/wiki/${slug}`); return; }
        const w: WikiRow = json.data.wiki;
        setWiki(w);
        setName(w.name);
        setDescription(w.description ?? "");
        setAvatarUrl(w.avatar_url ?? "");
        setCoverImageUrl(w.cover_image_url ?? "");
        setContributePolicy(w.contribute_policy);
      })
      .catch(() => router.replace(`/wiki/${slug}`));
  }, [slug, router]);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch(`/api/wiki/${slug}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: description || null,
          avatarUrl: avatarUrl || null,
          coverImageUrl: coverImageUrl || null,
          contributePolicy,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? t("wiki.settings.errors.generic", "Failed to save settings"));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("wiki.settings.errors.generic", "Failed to save settings"));
    } finally {
      setSaving(false);
    }
  }

  if (!wiki) return null;

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 space-y-6">
      <div>
        <Link href={`/wiki/${slug}/manage`} className="mb-2 inline-block text-xs text-muted-foreground hover:text-foreground">
          ← {t("wiki.dashboard.backToManage", "Back to manage")}
        </Link>
        <h1 className="text-2xl font-bold text-foreground">{t("wiki.dashboard.settings", "Settings")}</h1>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">{t("wiki.new.nameLabel", "Wiki name")}</label>
          <input
            minLength={2}
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
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
          <label className="block text-xs font-medium text-muted-foreground mb-1">{t("wiki.settings.avatarLabel", "Avatar image URL")}</label>
          <input
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
            placeholder="https://…"
            className="w-full rounded-xl border border-border bg-card px-4 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">{t("wiki.settings.coverLabel", "Cover image URL")}</label>
          <input
            value={coverImageUrl}
            onChange={(e) => setCoverImageUrl(e.target.value)}
            placeholder="https://…"
            className="w-full rounded-xl border border-border bg-card px-4 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
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
          {contributePolicy === "selected" && (
            <p className="mt-2 text-xs text-muted-foreground">
              {t("wiki.settings.selectedHint", "Manage who's allowed to contribute from the Collaborators page.")}{" "}
              <Link href={`/wiki/${slug}/manage/collaborators`} className="text-primary hover:underline">
                {t("wiki.dashboard.collaborators", "Collaborators")}
              </Link>
            </p>
          )}
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}
        {saved && !error && <p className="text-sm text-emerald-500">{t("wiki.settings.saved", "Settings saved.")}</p>}

        <button
          type="button"
          onClick={handleSave}
          disabled={saving || name.trim().length < 2}
          className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {saving ? t("wiki.settings.saving", "Saving…") : t("wiki.settings.save", "Save settings")}
        </button>
      </div>
    </div>
  );
}
