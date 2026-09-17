"use client";

/**
 * app/(admin)/gate44/ads/moderation-queue/page.tsx
 *
 * Ad Moderator review queue: ad creative images that neither DeepSeek
 * (primary) nor Gemini (fallback/escalation) could confidently classify —
 * see lib/ai/vision.ts and lib/ads/repo.ts submitCampaignForModeration.
 *
 * Unlike every other /gate44/ads/* page, this one is also reachable by
 * accounts with only the narrower `is_ad_moderator` role (not full
 * moderator/admin) — see middleware.ts AD_MODERATOR_PREFIXES and
 * lib/api/middleware.ts withAdModeratorOrAdminAuth.
 */

import { useState, useEffect, useCallback } from "react";

interface VisionAttempt {
  provider: string;
  model: string;
  success: boolean;
  confidence: number | null;
  rawContent: string | null;
  errorMessage: string | null;
}

interface Escalation {
  id: string;
  campaign_id: string;
  campaign_name: string;
  advertiser_name: string | null;
  creative_id: string | null;
  image_url: string;
  deepseek_result: VisionAttempt | null;
  gemini_result: VisionAttempt | null;
  status: "pending" | "approved" | "rejected";
  reviewed_by_username: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
}

function ProviderResult({ label, attempt }: { label: string; attempt: VisionAttempt | null }) {
  if (!attempt) {
    return (
      <div className="rounded-lg border border-neutral-200 p-2 text-xs text-neutral-400 dark:border-neutral-700">
        {label}: not attempted
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-neutral-200 p-2 text-xs dark:border-neutral-700">
      <p className="font-semibold text-neutral-700 dark:text-neutral-200">
        {label} ({attempt.model})
      </p>
      {attempt.success ? (
        <>
          <p>Confidence: {attempt.confidence !== null ? `${Math.round(attempt.confidence * 100)}%` : "n/a"}</p>
          {attempt.rawContent && <p className="mt-1 text-neutral-500">{attempt.rawContent}</p>}
        </>
      ) : (
        <p className="text-red-600 dark:text-red-400">Failed: {attempt.errorMessage ?? "unknown error"}</p>
      )}
    </div>
  );
}

export default function AdModerationQueuePage() {
  const [status, setStatus] = useState<"pending" | "approved" | "rejected">("pending");
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/ads/moderation-queue?status=${status}`, { credentials: "include" });
      const json = await res.json();
      if (json.success) setEscalations(json.data.escalations);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  async function resolve(id: string, action: "approve" | "reject") {
    setBusyId(id);
    try {
      const note = action === "reject" ? window.prompt("Rejection note (optional):") ?? undefined : undefined;
      await fetch(`/api/admin/ads/moderation-queue/${id}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note }),
      });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-50">Ad Moderation Queue</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Ad creative images that neither DeepSeek (primary) nor Gemini (fallback) could confidently classify. Review the image
          against both providers&apos; reasoning and approve or reject the campaign.
        </p>
      </div>

      <div className="flex gap-2 border-b border-neutral-200 dark:border-neutral-800">
        {(["pending", "approved", "rejected"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`px-3 py-2 text-sm font-semibold capitalize ${status === s ? "border-b-2 border-blue-600 text-blue-600" : "text-neutral-500"}`}
          >
            {s}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="h-40 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" />
      ) : escalations.length === 0 ? (
        <p className="text-sm text-neutral-400">No {status} escalations.</p>
      ) : (
        <div className="space-y-4">
          {escalations.map((e) => (
            <div key={e.id} className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="flex flex-col gap-4 sm:flex-row">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={e.image_url}
                  alt="Ad creative pending review"
                  className="h-40 w-full rounded-lg object-cover sm:w-56"
                />
                <div className="flex-1 space-y-2">
                  <div>
                    <p className="font-semibold text-neutral-900 dark:text-neutral-100">{e.campaign_name}</p>
                    <p className="text-xs text-neutral-500">{e.advertiser_name ?? "Unknown advertiser"} · submitted {new Date(e.created_at).toLocaleString()}</p>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <ProviderResult label="DeepSeek" attempt={e.deepseek_result} />
                    <ProviderResult label="Gemini" attempt={e.gemini_result} />
                  </div>
                  {e.status === "pending" ? (
                    <div className="flex gap-2 pt-1">
                      <button
                        disabled={busyId === e.id}
                        onClick={() => resolve(e.id, "approve")}
                        className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                      >
                        Approve
                      </button>
                      <button
                        disabled={busyId === e.id}
                        onClick={() => resolve(e.id, "reject")}
                        className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  ) : (
                    <p className="text-xs text-neutral-500">
                      {e.status === "approved" ? "Approved" : "Rejected"} by {e.reviewed_by_username ?? "unknown"} on{" "}
                      {e.reviewed_at ? new Date(e.reviewed_at).toLocaleString() : "n/a"}
                      {e.review_note ? ` — "${e.review_note}"` : ""}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
