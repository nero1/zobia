"use client";

/**
 * app/(admin)/gate44/ai-monitoring/page.tsx
 *
 * Centralized Admin AI Monitoring panel: a single view across every
 * AI-backed feature on the platform (report/ad/quest text moderation, ad
 * creative + KYC document image classification) — see lib/ai/monitoring.ts
 * (ai_call_log), lib/ai/vision.ts, lib/moderation/aiClassifier.ts.
 *
 * Shows: the rotating 48h call log with a per-row "Details" drawer (raw
 * model output, structured metadata, token counts), aggregate usage/token
 * stats per feature+provider, live circuit-breaker state, a summary of
 * pending human-review escalations with links to their queues, and the
 * ability to reverse an AI auto-approval on an ad campaign.
 */

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AiCallLogRow {
  id: string;
  provider: string;
  model: string;
  feature: string;
  success: boolean;
  confidence: number | null;
  latency_ms: number;
  result_preview: string | null;
  error_message: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

interface UsageStat {
  feature: string;
  provider: string;
  callCount: number;
  successCount: number;
  avgLatencyMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

interface CircuitInfo {
  status: "closed" | "open" | "half-open";
  failures: number;
  openedAt: number | null;
}

interface MonitoringData {
  calls: AiCallLogRow[];
  usageStats: UsageStat[];
  circuits: Record<string, CircuitInfo>;
  pendingEscalations: { reports: number; adImages: number; kyc: number };
}

const FEATURE_FILTERS = [
  { key: "", label: "All features" },
  { key: "moderation:report", label: "Report moderation" },
  { key: "moderation:sponsored_quest", label: "Sponsored quests" },
  { key: "moderation:ad_creative_text", label: "Ad text" },
  { key: "vision:ad_creative_image", label: "Ad images" },
  { key: "kyc:document_analysis", label: "KYC documents" },
  { key: "kyc:name_match", label: "KYC name match" },
];

function CircuitBadge({ info }: { info: CircuitInfo | undefined }) {
  if (!info) return null;
  const color =
    info.status === "closed"
      ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
      : info.status === "half-open"
        ? "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300"
        : "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${color}`}>{info.status}</span>;
}

function DetailsModal({ row, onClose }: { row: AiCallLogRow; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-4 dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold text-neutral-900 dark:text-neutral-50">Call details</h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200">✕</button>
        </div>
        <dl className="space-y-2 text-xs">
          {[
            ["Feature", row.feature],
            ["Provider", row.provider],
            ["Model", row.model],
            ["Success", row.success ? "Yes" : "No"],
            ["Confidence", row.confidence !== null ? `${Math.round(row.confidence * 100)}%` : "n/a"],
            ["Latency", `${row.latency_ms} ms`],
            ["Input tokens", row.input_tokens ?? "n/a"],
            ["Output tokens", row.output_tokens ?? "n/a"],
            ["Timestamp", new Date(row.created_at).toLocaleString()],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4">
              <dt className="font-semibold text-neutral-500">{label}</dt>
              <dd className="text-right text-neutral-800 dark:text-neutral-200">{String(value)}</dd>
            </div>
          ))}
          {row.result_preview && (
            <div>
              <dt className="font-semibold text-neutral-500">Result preview</dt>
              <dd className="mt-1 whitespace-pre-wrap rounded-lg bg-neutral-100 p-2 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">{row.result_preview}</dd>
            </div>
          )}
          {row.error_message && (
            <div>
              <dt className="font-semibold text-red-500">Error</dt>
              <dd className="mt-1 whitespace-pre-wrap rounded-lg bg-red-50 p-2 text-red-700 dark:bg-red-950 dark:text-red-300">{row.error_message}</dd>
            </div>
          )}
          {row.metadata && (
            <div>
              <dt className="font-semibold text-neutral-500">Pipeline metadata</dt>
              <dd className="mt-1 overflow-x-auto rounded-lg bg-neutral-100 p-2 font-mono text-[11px] text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                <pre>{JSON.stringify(row.metadata, null, 2)}</pre>
              </dd>
            </div>
          )}
        </dl>
      </div>
    </div>
  );
}

function AiApprovedCampaignsPanel() {
  interface Campaign {
    id: string;
    name: string;
    advertiser_name: string | null;
    ai_confidence: string | null;
    moderation_mode: string | null;
    moderated_at: string | null;
  }
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/ads/campaigns?moderationStatus=approved", { credentials: "include" });
    const json = await res.json();
    if (json.success) {
      setCampaigns((json.data.campaigns as Campaign[]).filter((c) => c.moderation_mode === "ai"));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function revert(id: string) {
    setBusyId(id);
    try {
      const reason = window.prompt("Reason for reverting to manual review (optional):") ?? undefined;
      await fetch(`/api/admin/ads/campaigns/${id}/revert-to-manual`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  if (campaigns.length === 0) return <p className="text-sm text-neutral-400">No AI auto-approved campaigns to review.</p>;

  return (
    <div className="space-y-2">
      {campaigns.slice(0, 20).map((c) => (
        <div key={c.id} className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 p-2.5 text-sm dark:border-neutral-800">
          <div>
            <p className="font-semibold text-neutral-900 dark:text-neutral-100">{c.name}</p>
            <p className="text-xs text-neutral-500">
              {c.advertiser_name} · AI confidence {c.ai_confidence ? `${Math.round(Number(c.ai_confidence) * 100)}%` : "n/a"}
            </p>
          </div>
          <button
            disabled={busyId === c.id}
            onClick={() => revert(c.id)}
            className="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
          >
            Revert to manual review
          </button>
        </div>
      ))}
    </div>
  );
}

export default function AiMonitoringPage() {
  const [data, setData] = useState<MonitoringData | null>(null);
  const [feature, setFeature] = useState("");
  const [detailsRow, setDetailsRow] = useState<AiCallLogRow | null>(null);

  const load = useCallback(async () => {
    const params = feature ? `?feature=${encodeURIComponent(feature)}` : "";
    const res = await fetch(`/api/admin/ai-monitoring${params}`, { credentials: "include" });
    const json = await res.json();
    if (json.success) setData(json.data);
  }, [feature]);

  useEffect(() => {
    load();
  }, [load]);

  if (!data) return <div className="h-40 animate-pulse rounded-xl bg-neutral-100 p-6 dark:bg-neutral-800" />;

  const totalPending = data.pendingEscalations.reports + data.pendingEscalations.adImages + data.pendingEscalations.kyc;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-50">AI Monitoring</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Every AI moderation call across the platform — provider fallback/escalation chain, confidence, token usage, and
          pending human-review escalations.
        </p>
      </div>

      {/* Circuit breakers */}
      <div className="flex flex-wrap gap-3">
        {(["deepseek", "gemini", "groq"] as const).map((p) => (
          <div key={p} className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900">
            <span className="text-sm font-semibold capitalize text-neutral-800 dark:text-neutral-200">{p}</span>
            <CircuitBadge info={data.circuits[p]} />
          </div>
        ))}
      </div>

      {/* Pending escalations */}
      {totalPending > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950">
          <h2 className="mb-2 text-sm font-bold text-amber-800 dark:text-amber-300">Pending human review</h2>
          <div className="flex flex-wrap gap-3 text-sm">
            {data.pendingEscalations.adImages > 0 && (
              <Link href="/gate44/ads/moderation-queue" className="rounded-lg bg-white px-3 py-1.5 font-semibold text-amber-800 hover:underline dark:bg-neutral-900 dark:text-amber-300">
                {data.pendingEscalations.adImages} ad image escalation{data.pendingEscalations.adImages === 1 ? "" : "s"} →
              </Link>
            )}
            {data.pendingEscalations.reports > 0 && (
              <Link href="/watch56" className="rounded-lg bg-white px-3 py-1.5 font-semibold text-amber-800 hover:underline dark:bg-neutral-900 dark:text-amber-300">
                {data.pendingEscalations.reports} report(s) in the manual queue →
              </Link>
            )}
            {data.pendingEscalations.kyc > 0 && (
              <Link href="/gate44/kyc" className="rounded-lg bg-white px-3 py-1.5 font-semibold text-amber-800 hover:underline dark:bg-neutral-900 dark:text-amber-300">
                {data.pendingEscalations.kyc} KYC AI escalation{data.pendingEscalations.kyc === 1 ? "" : "s"} →
              </Link>
            )}
          </div>
        </div>
      )}

      {/* Usage / token stats */}
      <div>
        <h2 className="mb-2 text-sm font-bold text-neutral-900 dark:text-neutral-100">Usage &amp; token estimates (48h window)</h2>
        <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="bg-neutral-50 text-neutral-500 dark:bg-neutral-900">
              <tr>
                <th className="px-3 py-2">Feature</th>
                <th className="px-3 py-2">Provider</th>
                <th className="px-3 py-2 text-right">Calls</th>
                <th className="px-3 py-2 text-right">Success</th>
                <th className="px-3 py-2 text-right">Avg latency</th>
                <th className="px-3 py-2 text-right">Input tokens</th>
                <th className="px-3 py-2 text-right">Output tokens</th>
              </tr>
            </thead>
            <tbody>
              {data.usageStats.map((s) => (
                <tr key={`${s.feature}:${s.provider}`} className="border-t border-neutral-100 dark:border-neutral-800">
                  <td className="px-3 py-2">{s.feature}</td>
                  <td className="px-3 py-2 capitalize">{s.provider}</td>
                  <td className="px-3 py-2 text-right">{s.callCount}</td>
                  <td className="px-3 py-2 text-right">{s.callCount ? Math.round((s.successCount / s.callCount) * 100) : 0}%</td>
                  <td className="px-3 py-2 text-right">{s.avgLatencyMs} ms</td>
                  <td className="px-3 py-2 text-right">{s.totalInputTokens.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right">{s.totalOutputTokens.toLocaleString()}</td>
                </tr>
              ))}
              {data.usageStats.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-4 text-center text-neutral-400">No AI calls in the retained window yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-[11px] text-neutral-400">
          Token counts reflect what each provider&apos;s API reports (when available) — treat as an estimate, not exact billing.
        </p>
      </div>

      {/* AI auto-approved ads — manual reversal */}
      <div>
        <h2 className="mb-2 text-sm font-bold text-neutral-900 dark:text-neutral-100">AI-approved ad campaigns</h2>
        <AiApprovedCampaignsPanel />
      </div>

      {/* Call log */}
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">Recent AI calls</h2>
          <select
            value={feature}
            onChange={(e) => setFeature(e.target.value)}
            className="rounded-lg border border-neutral-300 bg-neutral-50 px-2 py-1 text-xs dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
          >
            {FEATURE_FILTERS.map((f) => (
              <option key={f.key} value={f.key}>{f.label}</option>
            ))}
          </select>
        </div>
        <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="bg-neutral-50 text-neutral-500 dark:bg-neutral-900">
              <tr>
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">Feature</th>
                <th className="px-3 py-2">Provider / Model</th>
                <th className="px-3 py-2">Confidence</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {data.calls.map((row) => (
                <tr key={row.id} className="border-t border-neutral-100 dark:border-neutral-800">
                  <td className="px-3 py-2 whitespace-nowrap text-neutral-500">{new Date(row.created_at).toLocaleTimeString()}</td>
                  <td className="px-3 py-2">{row.feature}</td>
                  <td className="px-3 py-2 capitalize">{row.provider} / {row.model}</td>
                  <td className="px-3 py-2">{row.confidence !== null ? `${Math.round(row.confidence * 100)}%` : "—"}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${row.success ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" : "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300"}`}>
                      {row.success ? "OK" : "Failed"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => setDetailsRow(row)} className="text-blue-600 hover:underline dark:text-blue-400">Details</button>
                  </td>
                </tr>
              ))}
              {data.calls.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-neutral-400">No calls logged yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {detailsRow && <DetailsModal row={detailsRow} onClose={() => setDetailsRow(null)} />}
    </div>
  );
}
