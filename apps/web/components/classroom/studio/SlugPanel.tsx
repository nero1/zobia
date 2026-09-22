"use client";

/**
 * components/classroom/studio/SlugPanel.tsx
 *
 * The classroom's public URL (/c/<slug>) and its change policy.
 *   - Change the slug: live availability check, a server-issued quote (cost
 *     in Credits, free changes left, cooldown) that the creator confirms;
 *     the server re-quotes inside the transaction and refuses on mismatch.
 *   - Policy: fully free/uncapped, or N free changes then X Credits each,
 *     with an optional cooldown (every N days / months).
 * Old URLs keep working — they 301 to the new one.
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";
import { classroomApi, ClassroomApiError } from "@/lib/classroom/clientApi";
import type { ClassroomHomePayload, SlugAvailability, SlugChangeQuote, SlugHistoryEntry, SlugPolicy } from "@/components/classroom/types";

interface SlugData {
  slug: string | null;
  quote: SlugChangeQuote;
  history: SlugHistoryEntry[];
}

export function SlugPanel({ home }: { home: ClassroomHomePayload }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const roomId = home.classroom.id;
  const key = ["classroom", roomId, "slug"];
  const data = useQuery({ queryKey: key, queryFn: () => classroomApi<SlugData>(`/${roomId}/slug`) });

  const [candidate, setCandidate] = useState("");
  const [availability, setAvailability] = useState<SlugAvailability | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [policy, setPolicy] = useState<SlugPolicy | null>(null);

  useEffect(() => {
    if (data.data && !policy) setPolicy(data.data.quote.policy);
  }, [data.data, policy]);

  useEffect(() => {
    if (!candidate.trim()) {
      setAvailability(null);
      return;
    }
    const id = setTimeout(() => {
      classroomApi<SlugAvailability>(`/slug?slug=${encodeURIComponent(candidate.trim())}&roomId=${roomId}`)
        .then(setAvailability)
        .catch(() => setAvailability(null));
    }, 400);
    return () => clearTimeout(id);
  }, [candidate, roomId]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ["classroom", roomId, "home"] });
  };

  const change = useMutation({
    mutationFn: () =>
      classroomApi<{ newSlug: string; costCredits: number }>(`/${roomId}/slug`, {
        method: "POST",
        body: { slug: availability?.slug ?? candidate.trim(), expectedCostCredits: data.data?.quote.costCredits ?? 0 },
      }),
    onSuccess: (r) => {
      setMsg({ ok: true, text: t("classroom.slug.changed", "URL changed to /c/{{slug}}", { slug: r.newSlug }) });
      setCandidate("");
      setConfirming(false);
      refresh();
    },
    onError: (e) => {
      const err = e as ClassroomApiError;
      setConfirming(false);
      setMsg({
        ok: false,
        text:
          err.code === "INSUFFICIENT_BALANCE"
            ? t("classroom.slug.insufficient", "You don't have enough Credits for this change.")
            : translateApiError(t, err.code, err.message),
      });
      refresh();
    },
  });

  const savePolicy = useMutation({
    mutationFn: (p: SlugPolicy) => classroomApi(`/${roomId}`, { method: "PATCH", body: { settings: { slugPolicy: p } } }),
    onSuccess: () => {
      setMsg({ ok: true, text: t("classroom.slug.policySaved", "URL change policy saved") });
      refresh();
    },
    onError: (e) => setMsg({ ok: false, text: translateApiError(t, (e as ClassroomApiError).code, (e as Error).message) }),
  });

  if (data.isPending || !policy) return <div className="h-40 animate-pulse rounded-xl bg-white dark:bg-neutral-900" />;
  if (!data.data) return null;
  const { quote, history, slug } = data.data;
  const field = "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";
  const section = "space-y-3 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900";

  const reasonText = (r: SlugAvailability["reason"]) =>
    r === "taken" || r === "retired"
      ? t("classroom.slug.taken", "That URL is already taken.")
      : r === "reserved"
        ? t("classroom.slug.reserved", "That URL is reserved.")
        : r === "too_short"
          ? t("classroom.slug.tooShort", "Use at least 3 characters.")
          : t("classroom.slug.invalid", "Use lowercase letters, numbers and single hyphens.");

  return (
    <div className="space-y-4">
      <section className={section}>
        <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">{t("classroom.slug.title", "Classroom URL")}</h3>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          {t("classroom.slug.current", "Current URL:")} <span className="font-mono">/c/{slug ?? roomId}</span>
        </p>
        <p className="text-xs text-neutral-500">
          {quote.policy.mode === "free"
            ? t("classroom.slug.quoteFree", "URL changes are free and unlimited.")
            : quote.costCredits === 0
              ? t("classroom.slug.quoteFreeLeft", "Your next change is free ({{count}} free change(s) left).", { count: quote.freeChangesRemaining ?? 0 })
              : t("classroom.slug.quoteCost", "Your next change costs {{cost}} Credits.", { cost: quote.costCredits })}
          {!quote.eligible && quote.nextEligibleAt && (
            <>
              {" "}
              {t("classroom.slug.cooldown", "You can change it again after {{date}}.", { date: new Date(quote.nextEligibleAt).toLocaleString() })}
            </>
          )}
        </p>
        <div className="flex items-center gap-1 rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800">
          <span className="text-neutral-400">/c/</span>
          <input
            className="min-w-0 flex-1 bg-transparent outline-none dark:text-neutral-100"
            value={candidate}
            maxLength={60}
            placeholder={slug ?? ""}
            onChange={(e) => {
              setCandidate(e.target.value.toLowerCase());
              setConfirming(false);
            }}
          />
        </div>
        {availability && (
          <p className={`text-xs ${availability.available ? "text-teal-600" : "text-red-600"}`}>
            {availability.available ? t("classroom.slug.available", "Available: /c/{{slug}}", { slug: availability.slug }) : reasonText(availability.reason)}
          </p>
        )}
        {confirming ? (
          <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            <p>
              {quote.costCredits > 0
                ? t("classroom.slug.confirmPaid", "Change the URL to /c/{{slug}} for {{cost}} Credits? The old URL will redirect here.", { slug: availability?.slug, cost: quote.costCredits })
                : t("classroom.slug.confirmFree", "Change the URL to /c/{{slug}}? The old URL will redirect here.", { slug: availability?.slug })}
            </p>
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={() => change.mutate()} disabled={change.isPending} className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                {t("classroom.slug.confirm", "Confirm change")}
              </button>
              <button type="button" onClick={() => setConfirming(false)} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs dark:border-neutral-700">
                {t("classroom.common.cancel", "Cancel")}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            disabled={!availability?.available || !quote.eligible || availability.slug === slug}
            onClick={() => setConfirming(true)}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {t("classroom.slug.change", "Change URL")}
          </button>
        )}
        {msg && <p className={`text-sm ${msg.ok ? "text-teal-600" : "text-red-600"}`}>{msg.text}</p>}
      </section>

      <section className={section}>
        <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">{t("classroom.slug.policyTitle", "URL change policy")}</h3>
        <p className="text-xs text-neutral-500">{t("classroom.slug.policyHint", "Decide how often this classroom's URL may change and what each change costs you.")}</p>
        <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
          <input type="radio" checked={policy.mode === "paid"} onChange={() => setPolicy({ ...policy, mode: "paid" })} />
          {t("classroom.slug.modePaid", "Free changes, then a Credit cost per change")}
        </label>
        <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
          <input type="radio" checked={policy.mode === "free"} onChange={() => setPolicy({ ...policy, mode: "free" })} />
          {t("classroom.slug.modeFree", "Always free and uncapped")}
        </label>
        {policy.mode === "paid" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-neutral-500">
              {t("classroom.slug.freeChanges", "Free changes")}
              <input type="number" min={0} max={100} className={`mt-1 ${field}`} value={policy.freeChanges} onChange={(e) => setPolicy({ ...policy, freeChanges: Math.max(0, parseInt(e.target.value || "0", 10) || 0) })} />
            </label>
            <label className="text-xs text-neutral-500">
              {t("classroom.slug.costPerChange", "Credits per change after that")}
              <input type="number" min={0} className={`mt-1 ${field}`} value={policy.costCredits} onChange={(e) => setPolicy({ ...policy, costCredits: Math.max(0, parseInt(e.target.value || "0", 10) || 0) })} />
            </label>
            <label className="text-xs text-neutral-500">
              {t("classroom.slug.cooldownUnit", "Limit how often")}
              <select className={`mt-1 ${field}`} value={policy.cooldownUnit} onChange={(e) => setPolicy({ ...policy, cooldownUnit: e.target.value as SlugPolicy["cooldownUnit"] })}>
                <option value="none">{t("classroom.slug.cooldown.none", "No cap")}</option>
                <option value="days">{t("classroom.slug.cooldown.days", "Once every N days")}</option>
                <option value="months">{t("classroom.slug.cooldown.months", "Once every N months")}</option>
              </select>
            </label>
            {policy.cooldownUnit !== "none" && (
              <label className="text-xs text-neutral-500">
                {t("classroom.slug.cooldownValue", "N")}
                <input type="number" min={1} max={365} className={`mt-1 ${field}`} value={policy.cooldownValue} onChange={(e) => setPolicy({ ...policy, cooldownValue: Math.min(365, Math.max(1, parseInt(e.target.value || "1", 10) || 1)) })} />
              </label>
            )}
          </div>
        )}
        <button type="button" onClick={() => savePolicy.mutate(policy)} disabled={savePolicy.isPending} className="rounded-lg border border-violet-600 px-4 py-2 text-sm font-semibold text-violet-700 disabled:opacity-50 dark:text-violet-300">
          {t("classroom.slug.savePolicy", "Save policy")}
        </button>
      </section>

      {history.length > 0 && (
        <section className={section}>
          <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">{t("classroom.slug.history", "Change history")}</h3>
          <ul className="space-y-1 text-sm">
            {history.map((h) => (
              <li key={h.changedAt} className="flex justify-between gap-2 text-neutral-600 dark:text-neutral-300">
                <span className="font-mono">
                  /c/{h.oldSlug ?? "—"} → /c/{h.newSlug}
                </span>
                <span className="text-xs text-neutral-400">
                  {new Date(h.changedAt).toLocaleDateString()} · {h.costCredits > 0 ? t("classroom.slug.paid", "{{cost}} Credits", { cost: h.costCredits }) : t("classroom.card.free", "Free")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
