"use client";

/**
 * app/(app)/classroom/new/page.tsx
 *
 * Create a classroom. Uses POST /api/rooms (type 'classroom') so every
 * existing creator-eligibility, Trust Score (paid classrooms), CAPTCHA and
 * room-cap rule still applies. The public URL is pre-filled with a unique
 * suggestion derived from the name (GET /api/classroom/slug?name=) and can
 * be edited before creation — availability is checked live and again
 * server-side. After creation the creator lands in the classroom's Studio.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";
import { classroomApi } from "@/lib/classroom/clientApi";
import { useCaptchaWidget } from "@/components/security/useCaptchaWidget";
import type { SlugAvailability } from "@/components/classroom/types";

const CATEGORIES = ["Education", "Technology", "Business", "Finance", "Creativity", "Music", "Lifestyle", "Health", "Languages", "Other"];
const EMOJIS = ["📚", "🎓", "💡", "💻", "📈", "🎨", "🎵", "🧠", "🌍", "🏋️"];

export default function NewClassroomPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("Education");
  const [coverEmoji, setCoverEmoji] = useState("📚");
  const [fee, setFee] = useState("0");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [showInListing, setShowInListing] = useState(true);
  const [modules, setModules] = useState<string[]>([""]);
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugStatus, setSlugStatus] = useState<SlugAvailability | null>(null);
  const [eligible, setEligible] = useState<boolean | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { enabled: captchaEnabled, getToken, WidgetSlot, ScriptTags } = useCaptchaWidget("create_room");

  useEffect(() => {
    fetch("/api/rooms/eligibility", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { data?: { allowedTypes?: string[] } } | null) => setEligible(!!body?.data?.allowedTypes?.includes("classroom")))
      .catch(() => setEligible(null));
  }, []);

  // Suggest a slug from the name until the creator edits it themselves.
  useEffect(() => {
    if (slugTouched || name.trim().length < 2) return;
    const id = setTimeout(() => {
      classroomApi<{ suggestion: string }>(`/slug?name=${encodeURIComponent(name.trim())}`)
        .then((d) => {
          setSlug(d.suggestion);
          setSlugStatus({ slug: d.suggestion, available: true, reason: null });
        })
        .catch(() => {});
    }, 400);
    return () => clearTimeout(id);
  }, [name, slugTouched]);

  // Live availability for a hand-edited slug.
  useEffect(() => {
    if (!slugTouched || !slug.trim()) return;
    const id = setTimeout(() => {
      classroomApi<SlugAvailability>(`/slug?slug=${encodeURIComponent(slug.trim())}`)
        .then(setSlugStatus)
        .catch(() => setSlugStatus(null));
    }, 400);
    return () => clearTimeout(id);
  }, [slug, slugTouched]);

  const slugReason = (r: SlugAvailability["reason"]) =>
    r === "taken" || r === "retired"
      ? t("classroom.slug.taken", "That URL is already taken.")
      : r === "reserved"
        ? t("classroom.slug.reserved", "That URL is reserved.")
        : r === "too_short"
          ? t("classroom.slug.tooShort", "Use at least 3 characters.")
          : t("classroom.slug.invalid", "Use lowercase letters, numbers and single hyphens.");

  async function handleSubmit() {
    if (name.trim().length < 2) {
      setError(t("classroom.create.nameRequired", "Give your classroom a name (at least 2 characters)."));
      return;
    }
    if (slugStatus && !slugStatus.available) {
      setError(slugReason(slugStatus.reason));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const captchaToken = await getToken();
      if (captchaEnabled && !captchaToken) {
        setError(t("classroom.create.captcha", "Please complete the verification widget."));
        return;
      }
      const body = {
        name: name.trim(),
        description: description.trim() || undefined,
        type: "classroom",
        category,
        coverEmoji,
        enrolmentFeeNgn: Math.max(0, parseInt(fee || "0", 10) || 0),
        classStartDate: startDate || undefined,
        classEndDate: endDate || undefined,
        slug: (slugStatus?.slug ?? slug.trim()) || undefined,
        showInCreatorListing: showInListing,
        curriculum: modules
          .map((m) => m.trim())
          .filter(Boolean)
          .map((title, order) => ({ title, order })),
        ...(captchaToken ? { captchaToken } : {}),
      };
      const res = await fetch("/api/rooms", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => null)) as { room?: { id: string }; error?: { code?: string; message?: string } } | null;
      if (!res.ok || !json?.room) {
        setError(translateApiError(t, json?.error?.code ?? null, json?.error?.message ?? t("classroom.create.failed", "Couldn't create the classroom.")));
        return;
      }
      router.push(`/classroom/studio/${json.room.id}`);
    } finally {
      setSubmitting(false);
    }
  }

  const field = "w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";
  const label = "mb-1 block text-xs font-semibold uppercase tracking-wider text-neutral-500";

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4 sm:p-6">
      <Link href="/classroom" className="text-sm text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200">
        ← {t("classroom.home.back", "All classrooms")}
      </Link>
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">{t("classroom.create.title", "Create a classroom")}</h1>

      {eligible === false && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          {t("classroom.create.notEligible", "A creator account is required to create classrooms. Reach Rising tier or apply for creator status.")}
        </div>
      )}

      <div className="space-y-4 rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
        <div>
          <label className={label} htmlFor="cls-name">{t("classroom.create.name", "Name")}</label>
          <input id="cls-name" className={field} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder={t("classroom.create.namePlaceholder", "e.g. YouTube Monetization for Beginners")} />
        </div>

        <div>
          <label className={label} htmlFor="cls-slug">{t("classroom.create.url", "Public URL")}</label>
          <div className="flex items-center gap-1 rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800">
            <span className="text-neutral-400">/c/</span>
            <input
              id="cls-slug"
              className="min-w-0 flex-1 bg-transparent text-neutral-900 outline-none dark:text-neutral-100"
              value={slug}
              maxLength={60}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value.toLowerCase());
              }}
            />
          </div>
          {slugStatus && (
            <p className={`mt-1 text-xs ${slugStatus.available ? "text-teal-600" : "text-red-600"}`}>
              {slugStatus.available
                ? t("classroom.slug.available", "Available: /c/{{slug}}", { slug: slugStatus.slug })
                : slugReason(slugStatus.reason)}
            </p>
          )}
          <p className="mt-1 text-[11px] text-neutral-400">
            {t("classroom.create.urlHint", "You can change it later from the classroom's settings (your first change is free).")}
          </p>
        </div>

        <div>
          <label className={label} htmlFor="cls-desc">{t("classroom.create.description", "Description")}</label>
          <textarea id="cls-desc" className={field} rows={4} value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="cls-cat">{t("classroom.create.category", "Category")}</label>
            <select id="cls-cat" className={field} value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="cls-fee">{t("classroom.create.fee", "Enrolment fee (Credits, 0 = free)")}</label>
            <input id="cls-fee" type="number" min={0} className={field} value={fee} onChange={(e) => setFee(e.target.value)} />
          </div>
          <div>
            <label className={label} htmlFor="cls-start">{t("classroom.create.startDate", "Start date (optional)")}</label>
            <input id="cls-start" type="date" className={field} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div>
            <label className={label} htmlFor="cls-end">{t("classroom.create.endDate", "End date (optional)")}</label>
            <input id="cls-end" type="date" className={field} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        </div>

        <div>
          <span className={label}>{t("classroom.create.cover", "Cover")}</span>
          <div className="flex flex-wrap gap-1.5">
            {EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setCoverEmoji(e)}
                className={`h-10 w-10 rounded-lg text-2xl ${coverEmoji === e ? "bg-violet-100 ring-2 ring-violet-500 dark:bg-violet-900/40" : "bg-neutral-100 dark:bg-neutral-800"}`}
              >
                {e}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className={label}>{t("classroom.create.modules", "First lessons (optional)")}</span>
          <div className="space-y-2">
            {modules.map((m, i) => (
              <div key={i} className="flex gap-2">
                <input
                  className={field}
                  value={m}
                  maxLength={200}
                  placeholder={t("classroom.create.modulePlaceholder", "Lesson {{n}} title", { n: i + 1 })}
                  onChange={(e) => setModules(modules.map((x, j) => (j === i ? e.target.value : x)))}
                />
                {modules.length > 1 && (
                  <button type="button" onClick={() => setModules(modules.filter((_, j) => j !== i))} className="rounded-lg px-2 text-neutral-400 hover:text-red-500" aria-label={t("classroom.module.delete", "Delete")}>
                    ✕
                  </button>
                )}
              </div>
            ))}
            {modules.length < 50 && (
              <button type="button" onClick={() => setModules([...modules, ""])} className="text-xs font-semibold text-violet-600 hover:underline">
                {t("classroom.card.addModule", "+ Add Module")}
              </button>
            )}
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
          <input type="checkbox" checked={showInListing} onChange={(e) => setShowInListing(e.target.checked)} />
          {t("classroom.create.showInListing", "Show on my public “Classrooms by” page")}
        </label>

        <WidgetSlot />
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}

        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={submitting || eligible === false}
          className="w-full rounded-xl bg-violet-600 py-3 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
        >
          {submitting ? t("classroom.create.creating", "Creating…") : t("classroom.create.submit", "Create classroom")}
        </button>
      </div>
      <ScriptTags />
    </div>
  );
}
