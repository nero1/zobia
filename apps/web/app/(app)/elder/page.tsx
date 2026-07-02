"use client";

/**
 * app/(app)/elder/page.tsx
 *
 * Elder system page.
 * - Elder view: mentees list, progress, mentorship XP earned
 * - Eligible (non-Elder) view: eligibility info + requirements
 * - Non-eligible view: "Request a Mentor" button (for below Hustler rank)
 * - Mentee management: accept/remove via API
 */

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Mentee {
  userId: string;
  username: string;
  displayName: string;
  avatarEmoji?: string;
  rankName: string;
  xpEarned: number;
  joinedAt: string;
  status: "active" | "pending" | "inactive";
}

interface AvailableElder {
  id: string;
  username: string;
  displayName: string;
  avatarEmoji?: string;
  rankName: string;
  menteeCount: number;
}

interface ElderData {
  isElder: boolean;
  isEligible: boolean;
  eligibilityReason?: string;
  prestigeLevel?: number;
  lastActiveAt?: string;
  mentees?: Mentee[];
  mentorshipXpEarned?: number;
  maxMentees?: number;
  hasMentor?: boolean;
  canRequestMentor?: boolean;
  rankName?: string;
  availableElders?: AvailableElder[];
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-neutral-200 dark:bg-neutral-700 ${className}`} />;
}

function PageSkeleton() {
  return (
    <div className="animate-pulse space-y-5">
      <SkeletonBlock className="h-8 w-40" />
      <SkeletonBlock className="h-32 rounded-xl" />
      <SkeletonBlock className="h-48 rounded-xl" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Elder dashboard
// ---------------------------------------------------------------------------

interface ElderDashboardProps {
  data: ElderData;
  onRemoveMentee: (userId: string) => Promise<void>;
  removing: string | null;
}

function ElderDashboard({ data, onRemoveMentee, removing }: ElderDashboardProps) {
  const mentees = data.mentees ?? [];

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
          <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Mentees</p>
          <p className="mt-1 text-2xl font-bold text-neutral-900 dark:text-neutral-50">
            {mentees.length} / {data.maxMentees ?? 5}
          </p>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
          <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Mentorship XP</p>
          <p className="mt-1 text-2xl font-bold text-neutral-900 dark:text-neutral-50">
            {(data.mentorshipXpEarned ?? 0).toLocaleString()}
          </p>
        </div>
        <div className="col-span-2 rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-card dark:border-amber-800 dark:bg-amber-950/30 sm:col-span-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">Status</p>
          <p className="mt-1 text-sm font-bold text-amber-700 dark:text-amber-300">Elder</p>
          <p className="text-xs text-amber-600 dark:text-amber-400">
            Prestige {data.prestigeLevel ?? 0}
          </p>
        </div>
      </div>

      {/* Mentees list */}
      <div className="rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
        <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Your Mentees</h2>
        </div>
        {mentees.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-neutral-500">
            No mentees yet. Share your mentor link to attract mentees.
          </div>
        ) : (
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {mentees.map((m) => (
              <div key={m.userId} className="flex items-center gap-3 px-5 py-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xl dark:bg-neutral-800">
                  {m.avatarEmoji ?? "👤"}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Link href={`/profile/${m.userId}`} className="text-sm font-semibold text-neutral-900 hover:underline dark:text-neutral-100">
                      {m.displayName}
                    </Link>
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-xs font-medium ${
                        m.status === "active"
                          ? "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300"
                          : m.status === "pending"
                          ? "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300"
                          : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"
                      }`}
                    >
                      {m.status}
                    </span>
                  </div>
                  <p className="text-xs text-neutral-500">
                    @{m.username} · {m.rankName} · {m.xpEarned.toLocaleString()} XP earned
                  </p>
                </div>
                <button
                  onClick={() => onRemoveMentee(m.userId)}
                  disabled={removing === m.userId}
                  className="shrink-0 rounded-lg border border-red-300 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950"
                >
                  {removing === m.userId ? "…" : "Remove"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Eligibility view
// ---------------------------------------------------------------------------

function EligibilityView({ data }: { data: ElderData }) {
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 dark:border-amber-800 dark:bg-amber-950/30">
        <h2 className="text-lg font-bold text-amber-700 dark:text-amber-300">Become an Elder</h2>
        <p className="mt-2 text-sm text-amber-600 dark:text-amber-400">
          Elders are experienced members who guide newer players. You are eligible to apply!
        </p>
        {data.eligibilityReason && (
          <p className="mt-2 text-xs text-amber-500 dark:text-amber-500">{data.eligibilityReason}</p>
        )}
      </div>
      <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
        <h3 className="mb-3 text-sm font-semibold text-neutral-700 dark:text-neutral-300">Requirements</h3>
        <ul className="space-y-2 text-sm text-neutral-600 dark:text-neutral-400">
          <li className="flex items-center gap-2">
            <span className={data.prestigeLevel && data.prestigeLevel >= 3 ? "text-teal-500" : "text-neutral-400"}>
              {data.prestigeLevel && data.prestigeLevel >= 3 ? "✓" : "○"}
            </span>
            Prestige 3+ (currently: Prestige {data.prestigeLevel ?? 0})
          </li>
          <li className="flex items-center gap-2">
            <span className="text-teal-500">✓</span>
            Active in the last 30 days
          </li>
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Non-eligible view
// ---------------------------------------------------------------------------

interface NonEligibleViewProps {
  data: ElderData;
  onRequestMentor: (elderId: string) => Promise<void>;
  requesting: string | null;
  requested: boolean;
}

function NonEligibleView({ data, onRequestMentor, requesting, requested }: NonEligibleViewProps) {
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="text-lg font-bold text-neutral-900 dark:text-neutral-50">Elder System</h2>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          Elders are experienced Zobia members who mentor newer players. As you grow, you can become
          eligible to be an Elder yourself.
        </p>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
        <h3 className="mb-3 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
          How to become an Elder
        </h3>
        <ul className="space-y-2 text-sm text-neutral-600 dark:text-neutral-400">
          <li className="flex items-center gap-2">
            <span className="text-neutral-400">○</span>
            Reach Prestige 3
          </li>
          <li className="flex items-center gap-2">
            <span className="text-neutral-400">○</span>
            Stay active in the last 30 days
          </li>
        </ul>
      </div>

      {data.canRequestMentor && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-5 dark:border-blue-800 dark:bg-blue-950/30">
          <h3 className="mb-2 text-sm font-semibold text-blue-700 dark:text-blue-300">Want a Mentor?</h3>
          <p className="mb-4 text-xs text-blue-600 dark:text-blue-400">
            Request an Elder mentor to help guide your journey on Zobia.
          </p>
          {requested ? (
            <p className="text-sm font-semibold text-teal-600 dark:text-teal-400">
              Request sent! Your chosen Elder can accept it from their dashboard.
            </p>
          ) : data.availableElders && data.availableElders.length > 0 ? (
            <ul className="space-y-2">
              {data.availableElders.map((elder) => (
                <li
                  key={elder.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-blue-100 bg-white px-3 py-2 dark:border-blue-900 dark:bg-neutral-900"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="text-lg leading-none" aria-hidden="true">{elder.avatarEmoji ?? "🎓"}</span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-50">
                        {elder.displayName}
                      </p>
                      <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                        {elder.rankName} · {elder.menteeCount}/{data.maxMentees ?? 5} mentees
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => onRequestMentor(elder.id)}
                    disabled={requesting !== null}
                    className="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                  >
                    {requesting === elder.id ? "Sending…" : "Request"}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              No Elders are available to mentor right now — check back soon.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ElderPage() {
  const [data, setData] = useState<ElderData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [requesting, setRequesting] = useState<string | null>(null);
  const [requested, setRequested] = useState(false);

  const { t } = useTranslation();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/elder", { credentials: "include" });
        if (res.status === 401) { window.location.href = "/auth/login"; return; }
        if (!res.ok) {
          const body = await res.json().catch(() => ({} as { error?: { code?: string; message?: string } | string; message?: string }));
          const errMsg = typeof body.error === "string" ? body.error : body.error?.message;
          const errCode = typeof body.error === "string" ? null : body.error?.code ?? null;
          const err = new Error(errMsg ?? body.message ?? "Failed to load Elder data") as Error & { code?: string | null };
          err.code = errCode;
          throw err;
        }
        const json = (await res.json()) as ElderData | { data?: ElderData };
        const elderData: ElderData =
          (json as { data?: ElderData }).data ?? (json as ElderData);
        setData(elderData);
      } catch (e) {
        const err = e as Error & { code?: string | null };
        setError(e instanceof Error ? translateApiError(tRef.current, err.code, err.message || "Unknown error") : "Unknown error");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleRemoveMentee(userId: string) {
    setRemoving(userId);
    try {
      await fetch(`/api/elder/mentees/${userId}`, {
        method: "DELETE",
        credentials: "include",
      });
      setData((prev) =>
        prev ? { ...prev, mentees: prev.mentees?.filter((m) => m.userId !== userId) } : prev
      );
    } catch {
      // Ignore
    } finally {
      setRemoving(null);
    }
  }

  async function handleRequestMentor(elderId: string) {
    setRequesting(elderId);
    try {
      const res = await fetch("/api/elder/request", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ elderId }),
      });
      if (res.ok) setRequested(true);
    } catch {
      // Ignore
    } finally {
      setRequesting(null);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl p-4 sm:p-6">
        <PageSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl p-4 sm:p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4 sm:p-6">
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Elder System</h1>

      {data.isElder ? (
        <ElderDashboard data={data} onRemoveMentee={handleRemoveMentee} removing={removing} />
      ) : data.isEligible ? (
        <EligibilityView data={data} />
      ) : (
        <NonEligibleView
          data={data}
          onRequestMentor={handleRequestMentor}
          requesting={requesting}
          requested={requested}
        />
      )}
    </div>
  );
}
