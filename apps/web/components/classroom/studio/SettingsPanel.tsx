"use client";

/**
 * components/classroom/studio/SettingsPanel.tsx
 *
 * Per-classroom settings (PATCH /api/classroom/:id): details, access cost
 * (enrolment fee — re-checked against the Trust Score gate server-side when
 * set above 0), dates, visibility, archive, the creator-listing toggle,
 * community rules (posting policy + post categories), custom level names and
 * what moderators are allowed to do.
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";
import { classroomApi, ClassroomApiError } from "@/lib/classroom/clientApi";
import type { ClassroomHomePayload, ClassroomSettings, ModeratorPermissions } from "@/components/classroom/types";

const DEFAULT_LEVEL_NAMES = ["Newcomer", "Learner", "Contributor", "Regular", "Achiever", "Expert", "Mentor", "Master", "Legend"];

export function SettingsPanel({ home }: { home: ClassroomHomePayload }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const c = home.classroom;
  const settings = home.settings as ClassroomSettings;
  const [name, setName] = useState(c.name);
  const [description, setDescription] = useState(c.description ?? "");
  const [category, setCategory] = useState(c.category ?? "");
  const [coverEmoji, setCoverEmoji] = useState(c.coverEmoji);
  const [coverImageUrl, setCoverImageUrl] = useState(c.coverImageUrl ?? "");
  const [fee, setFee] = useState(String(c.enrolmentFeeNgn));
  const [start, setStart] = useState(c.classStartDate ?? "");
  const [end, setEnd] = useState(c.classEndDate ?? "");
  const [isPublic, setIsPublic] = useState(c.isPublic);
  const [isActive, setIsActive] = useState(c.isActive);
  const [listed, setListed] = useState(c.showInCreatorListing);
  const [postingPolicy, setPostingPolicy] = useState(settings.postingPolicy);
  const [categories, setCategories] = useState(settings.postCategories.join(", "));
  const [levelNames, setLevelNames] = useState<string[]>(settings.levelNames);
  const [perms, setPerms] = useState<ModeratorPermissions>(settings.moderatorPermissions);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  const save = useMutation({
    mutationFn: () =>
      classroomApi(`/${c.id}`, {
        method: "PATCH",
        body: {
          name: name.trim(),
          description: description.trim() || null,
          category: category.trim() || "Education",
          coverEmoji: coverEmoji || "📚",
          coverImageUrl: coverImageUrl.trim() || null,
          enrolmentFeeNgn: Math.max(0, parseInt(fee || "0", 10) || 0),
          classStartDate: start || null,
          classEndDate: end || null,
          isPublic,
          isActive,
          showInCreatorListing: listed,
          settings: {
            postingPolicy,
            postCategories: categories
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
            levelNames,
            moderatorPermissions: perms,
          },
        },
      }),
    onSuccess: () => {
      setStatus({ ok: true, msg: t("classroom.settings.saved", "Settings saved") });
      void qc.invalidateQueries({ queryKey: ["classroom", c.id] });
    },
    onError: (e) => setStatus({ ok: false, msg: translateApiError(t, (e as ClassroomApiError).code, (e as Error).message) }),
  });

  const field = "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";
  const label = "mb-1 block text-xs font-semibold uppercase tracking-wider text-neutral-500";
  const section = "space-y-3 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900";
  const check = "flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300";

  const permLabels: Record<keyof ModeratorPermissions, string> = {
    managePosts: t("classroom.settings.perm.managePosts", "Pin, lock, hide and delete posts & comments"),
    manageMembers: t("classroom.settings.perm.manageMembers", "Mute members"),
    manageEvents: t("classroom.settings.perm.manageEvents", "Schedule live sessions and add recordings"),
    handleReports: t("classroom.settings.perm.handleReports", "Review member reports"),
  };

  return (
    <div className="space-y-4">
      <section className={section}>
        <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">{t("classroom.settings.details", "Details")}</h3>
        <div>
          <label className={label}>{t("classroom.create.name", "Name")}</label>
          <input className={field} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className={label}>{t("classroom.create.description", "Description")}</label>
          <textarea className={field} rows={4} value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className={label}>{t("classroom.create.category", "Category")}</label>
            <input className={field} value={category} maxLength={50} onChange={(e) => setCategory(e.target.value)} />
          </div>
          <div>
            <label className={label}>{t("classroom.settings.emoji", "Cover emoji")}</label>
            <input className={field} value={coverEmoji} maxLength={10} onChange={(e) => setCoverEmoji(e.target.value)} />
          </div>
          <div>
            <label className={label}>{t("classroom.settings.coverImage", "Cover image URL")}</label>
            <input className={field} value={coverImageUrl} onChange={(e) => setCoverImageUrl(e.target.value)} placeholder="https://" />
          </div>
        </div>
      </section>

      <section className={section}>
        <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">{t("classroom.settings.access", "Access & pricing")}</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className={label}>{t("classroom.create.fee", "Enrolment fee (Credits, 0 = free)")}</label>
            <input type="number" min={0} className={field} value={fee} onChange={(e) => setFee(e.target.value)} />
          </div>
          <div>
            <label className={label}>{t("classroom.create.startDate", "Start date (optional)")}</label>
            <input type="date" className={field} value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div>
            <label className={label}>{t("classroom.create.endDate", "End date (optional)")}</label>
            <input type="date" className={field} value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        <p className="text-[11px] text-neutral-500">
          {t("classroom.settings.feeHint", "You receive 80% of each enrolment (85% for Icon creators). It lands in your creator balance and is withdrawn from the Classroom Studio.")}
        </p>
        <label className={check}>
          <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
          {t("classroom.settings.public", "Public — listed in Discover and indexed by search engines")}
        </label>
        <label className={check}>
          <input type="checkbox" checked={listed} onChange={(e) => setListed(e.target.checked)} />
          {t("classroom.create.showInListing", "Show on my public “Classrooms by” page")}
        </label>
        <label className={check}>
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          {t("classroom.settings.active", "Active — accepting new members (uncheck to archive)")}
        </label>
      </section>

      <section className={section}>
        <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">{t("classroom.settings.community", "Community")}</h3>
        <div>
          <label className={label}>{t("classroom.settings.postingPolicy", "Who can start posts")}</label>
          <select className={field} value={postingPolicy} onChange={(e) => setPostingPolicy(e.target.value as ClassroomSettings["postingPolicy"])}>
            <option value="members">{t("classroom.settings.posting.members", "All members")}</option>
            <option value="moderators">{t("classroom.settings.posting.moderators", "Only me and moderators")}</option>
          </select>
        </div>
        <div>
          <label className={label}>{t("classroom.settings.categories", "Post categories (comma-separated)")}</label>
          <input className={field} value={categories} onChange={(e) => setCategories(e.target.value)} />
          <p className="mt-1 text-[11px] text-neutral-500">{t("classroom.settings.categoriesHint", "“Announcements” posts are reserved for you and moderators, and notify every member.")}</p>
        </div>
      </section>

      <section className={section}>
        <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">{t("classroom.settings.levels", "Level names")}</h3>
        <div className="grid gap-2 sm:grid-cols-3">
          {levelNames.map((n, i) => (
            <label key={i} className="text-xs text-neutral-500">
              {t("classroom.level.number", "Level {{level}}", { level: i + 1 })}
              <input
                className={`mt-1 ${field}`}
                value={n}
                maxLength={40}
                placeholder={DEFAULT_LEVEL_NAMES[i]}
                onChange={(e) => setLevelNames(levelNames.map((x, j) => (j === i ? e.target.value : x)))}
              />
            </label>
          ))}
        </div>
      </section>

      <section className={section}>
        <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">{t("classroom.settings.moderatorPerms", "What moderators can do")}</h3>
        {(Object.keys(permLabels) as Array<keyof ModeratorPermissions>).map((k) => (
          <label key={k} className={check}>
            <input type="checkbox" checked={perms[k]} onChange={(e) => setPerms({ ...perms, [k]: e.target.checked })} />
            {permLabels[k]}
          </label>
        ))}
      </section>

      {status && <p className={`text-sm ${status.ok ? "text-teal-600" : "text-red-600"}`}>{status.msg}</p>}
      <button
        type="button"
        onClick={() => save.mutate()}
        disabled={save.isPending || name.trim().length < 2}
        className="rounded-xl bg-violet-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
      >
        {save.isPending ? t("classroom.module.saving", "Saving…") : t("classroom.settings.save", "Save settings")}
      </button>
    </div>
  );
}
