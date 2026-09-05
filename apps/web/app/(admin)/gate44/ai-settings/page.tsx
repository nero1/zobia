"use client";

/**
 * app/(admin)/gate44/ai-settings/page.tsx
 *
 * AI Settings admin page.
 *
 * Shows live status for every configured AI provider (DeepSeek → Gemini →
 * Groq fallback chain — see lib/ai/config.ts AI_PROVIDERS):
 *   - Active key source (env var vs. admin override) with masked preview
 *   - Selected model (admin can switch between supported models per provider)
 *   - Circuit breaker state
 *   - Live connection test button
 *   - Per-provider API key override form (save / clear)
 * Plus a 48-hour rotating log of recent AI calls (lib/ai/monitoring.ts) for
 * monitoring — output preview, confidence, latency, success/failure.
 */

import { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ProviderId = "deepseek" | "gemini" | "groq";

const PROVIDER_LABELS: Record<ProviderId, string> = {
  deepseek: "DeepSeek (Level 1)",
  gemini: "Gemini (Level 2)",
  groq: "Groq (Level 3)",
};

interface CircuitInfo {
  status: "closed" | "open" | "half-open";
  failures: number;
  openedAt: number | null;
}

interface SupportedModel {
  id: string;
  label: string;
}

interface ProviderInfo {
  keySource: "env" | "override";
  keyMasked: string | null;
  selectedModel: string;
  supportedModels: SupportedModel[];
  circuit: CircuitInfo;
}

interface TestResult {
  success: boolean;
  latencyMs?: number;
  model?: string;
  error?: string;
}

interface ProviderState {
  info: ProviderInfo | null;
  keyDraft: string;
  saving: boolean;
  savingModel: boolean;
  testing: boolean;
  testResult: TestResult | null;
}

interface Toast {
  msg: string;
  type: "success" | "error";
}

interface AiCallRow {
  id: string;
  provider: string;
  model: string;
  feature: string;
  success: boolean;
  confidence: number | null;
  latency_ms: number;
  result_preview: string | null;
  error_message: string | null;
  created_at: string;
}

const EMPTY_PROVIDER_STATE: ProviderState = { info: null, keyDraft: "", saving: false, savingModel: false, testing: false, testResult: null };

// ---------------------------------------------------------------------------
// CircuitBadge
// ---------------------------------------------------------------------------

function CircuitBadge({ circuit }: { circuit: CircuitInfo }) {
  const map = {
    closed: { dot: "bg-teal-500", text: "text-teal-700 dark:text-teal-400", label: "Circuit Closed" },
    "half-open": { dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-400", label: "Circuit Half-Open" },
    open: { dot: "bg-red-500", text: "text-red-700 dark:text-red-400", label: "Circuit Open" },
  };
  const style = map[circuit.status];
  const failureLabel = circuit.failures === 1 ? "1 failure" : `${circuit.failures} failures`;
  const openedAgo =
    circuit.openedAt
      ? `opened ${Math.round((Date.now() - circuit.openedAt) / 1000)}s ago`
      : null;

  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block h-2 w-2 rounded-full ${style.dot}`} />
      <span className={`text-xs font-semibold ${style.text}`}>{style.label}</span>
      {circuit.failures > 0 && (
        <span className="text-xs text-neutral-500 dark:text-neutral-400">
          ({failureLabel}{openedAgo ? `, ${openedAgo}` : ""})
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// ProviderCard
// ---------------------------------------------------------------------------

function ProviderCard({
  title,
  provider,
  state,
  onKeyDraftChange,
  onSaveKey,
  onClearOverride,
  onTest,
  onModelChange,
}: {
  title: string;
  provider: ProviderId;
  state: ProviderState;
  onKeyDraftChange: (v: string) => void;
  onSaveKey: () => void;
  onClearOverride: () => void;
  onTest: () => void;
  onModelChange: (model: string) => void;
}) {
  const info = state.info;

  const keySourceLabel =
    info?.keySource === "override"
      ? `Override active${info.keyMasked ? ` (ends ${info.keyMasked})` : ""}`
      : "Using environment variable";

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="mb-4 text-base font-semibold text-neutral-900 dark:text-neutral-50">{title}</h2>

      {info?.circuit && (
        <div className="mb-3">
          <CircuitBadge circuit={info.circuit} />
        </div>
      )}

      <div className="mb-4 text-sm text-neutral-600 dark:text-neutral-400">
        <span className="font-medium text-neutral-800 dark:text-neutral-200">Key source: </span>
        {info ? keySourceLabel : "—"}
      </div>

      {/* Model selection */}
      {info && (
        <div className="mb-4">
          <label className="mb-1 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">Model</label>
          <select
            value={info.selectedModel}
            disabled={state.savingModel}
            onChange={(e) => onModelChange(e.target.value)}
            className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-900 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50"
          >
            {info.supportedModels.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>
      )}

      {/* Key override input */}
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="password"
          placeholder="Override API key (blank = use env var)"
          value={state.keyDraft}
          onChange={(e) => onKeyDraftChange(e.target.value)}
          className="flex-1 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-900 placeholder-neutral-400 focus:border-teal-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50 dark:placeholder-neutral-500"
          autoComplete="off"
        />
        <div className="flex gap-2">
          <button
            onClick={onSaveKey}
            disabled={state.saving || !state.keyDraft}
            className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {state.saving ? "Saving…" : "Save Key"}
          </button>
          {info?.keySource === "override" && (
            <button
              onClick={onClearOverride}
              disabled={state.saving}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              Clear Override
            </button>
          )}
        </div>
      </div>

      {/* Test connection */}
      <div className="mt-4 flex flex-col gap-2">
        <button
          onClick={onTest}
          disabled={state.testing}
          className="w-fit rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
        >
          {state.testing ? "Testing…" : "Test Connection"}
        </button>
        {state.testResult && (
          <div
            className={`rounded-lg px-3 py-2 text-sm ${
              state.testResult.success
                ? "bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300"
                : "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300"
            }`}
          >
            {state.testResult.success
              ? `Connected — ${state.testResult.latencyMs}ms${state.testResult.model ? ` (${state.testResult.model})` : ""}`
              : `Connection failed: ${state.testResult.error ?? "Unknown error"}`}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recent AI Calls monitoring panel
// ---------------------------------------------------------------------------

function RecentCallsPanel() {
  const [calls, setCalls] = useState<AiCallRow[] | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/ai-settings/calls?limit=100", { credentials: "include" });
    const json = await res.json().catch(() => null);
    if (json?.success) setCalls(json.data.calls);
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-50">Recent AI Calls (48h rotating log)</h2>
        <button onClick={() => void load()} className="text-xs font-semibold text-teal-600 hover:underline">Refresh</button>
      </div>
      {!calls ? (
        <div className="h-24 animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-800" />
      ) : calls.length === 0 ? (
        <p className="text-sm text-neutral-400">No AI calls logged yet.</p>
      ) : (
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full min-w-[600px] text-left text-xs">
            <thead className="sticky top-0 bg-white dark:bg-neutral-900">
              <tr className="text-neutral-500">
                <th className="py-1.5 pr-2">Time</th>
                <th className="py-1.5 pr-2">Feature</th>
                <th className="py-1.5 pr-2">Provider/Model</th>
                <th className="py-1.5 pr-2">Confidence</th>
                <th className="py-1.5 pr-2">Latency</th>
                <th className="py-1.5">Result</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((c) => (
                <tr key={c.id} className="border-t border-neutral-100 dark:border-neutral-800">
                  <td className="py-1.5 pr-2 text-neutral-500">{new Date(c.created_at).toLocaleTimeString()}</td>
                  <td className="py-1.5 pr-2">{c.feature}</td>
                  <td className="py-1.5 pr-2">{c.provider}/{c.model}</td>
                  <td className="py-1.5 pr-2 tabular-nums">{c.confidence != null ? `${Math.round(c.confidence * 100)}%` : "—"}</td>
                  <td className="py-1.5 pr-2 tabular-nums">{c.latency_ms}ms</td>
                  <td className={`py-1.5 ${c.success ? "text-teal-600" : "text-red-600"}`}>
                    {c.success ? (c.result_preview ?? "OK") : (c.error_message ?? "Failed")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AiSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<Toast | null>(null);
  const [providerOrder, setProviderOrder] = useState("deepseek,gemini,groq");
  const [savingOrder, setSavingOrder] = useState(false);

  const [providers, setProviders] = useState<Record<ProviderId, ProviderState>>({
    deepseek: { ...EMPTY_PROVIDER_STATE },
    gemini: { ...EMPTY_PROVIDER_STATE },
    groq: { ...EMPTY_PROVIDER_STATE },
  });

  const showToast = useCallback((msg: string, type: "success" | "error") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/ai-settings", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      const json = await res.json();
      const data = json.data as Record<ProviderId, ProviderInfo> & { providerOrder: string };
      setProviders((prev) => ({
        deepseek: { ...prev.deepseek, info: data.deepseek },
        gemini: { ...prev.gemini, info: data.gemini },
        groq: { ...prev.groq, info: data.groq },
      }));
      setProviderOrder(data.providerOrder);
    } catch {
      showToast("Failed to load AI settings.", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const handleSaveKey = useCallback(
    async (provider: ProviderId, apiKey: string) => {
      setProviders((prev) => ({ ...prev, [provider]: { ...prev[provider], saving: true } }));
      try {
        const res = await fetch("/api/admin/ai-settings", {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider, apiKey }),
        });
        if (!res.ok) throw new Error("Save failed");
        showToast("API key saved.", "success");
        setProviders((prev) => ({ ...prev, [provider]: { ...prev[provider], keyDraft: "" } }));
        await loadSettings();
      } catch {
        showToast("Failed to save key.", "error");
      } finally {
        setProviders((prev) => ({ ...prev, [provider]: { ...prev[provider], saving: false } }));
      }
    },
    [loadSettings, showToast]
  );

  const handleModelChange = useCallback(
    async (provider: ProviderId, model: string) => {
      setProviders((prev) => ({ ...prev, [provider]: { ...prev[provider], savingModel: true } }));
      try {
        const res = await fetch(`/api/admin/config/ai_${provider}_model`, {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: model }),
        });
        if (!res.ok) throw new Error("Save failed");
        showToast(`${PROVIDER_LABELS[provider]} model updated.`, "success");
        await loadSettings();
      } catch {
        showToast("Failed to update model.", "error");
      } finally {
        setProviders((prev) => ({ ...prev, [provider]: { ...prev[provider], savingModel: false } }));
      }
    },
    [loadSettings, showToast]
  );

  const handleSaveOrder = useCallback(async () => {
    setSavingOrder(true);
    try {
      const res = await fetch("/api/admin/config/ai_provider_order", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: providerOrder }),
      });
      if (!res.ok) throw new Error("Save failed");
      showToast("Fallback order saved.", "success");
    } catch {
      showToast("Failed to save fallback order.", "error");
    } finally {
      setSavingOrder(false);
    }
  }, [providerOrder, showToast]);

  const handleTest = useCallback(
    async (provider: ProviderId, keyDraft: string) => {
      setProviders((prev) => ({ ...prev, [provider]: { ...prev[provider], testing: true, testResult: null } }));
      try {
        const res = await fetch("/api/admin/ai-settings/test", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider,
            ...(keyDraft ? { apiKey: keyDraft } : {}),
          }),
        });
        const json = await res.json();
        setProviders((prev) => ({ ...prev, [provider]: { ...prev[provider], testResult: { ...json.data, success: json.success } as TestResult } }));
      } catch {
        setProviders((prev) => ({ ...prev, [provider]: { ...prev[provider], testResult: { success: false, error: "Request failed" } } }));
      } finally {
        setProviders((prev) => ({ ...prev, [provider]: { ...prev[provider], testing: false } }));
      }
    },
    []
  );

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      {toast && (
        <div
          className={`fixed right-6 top-6 z-50 rounded-xl px-5 py-3 text-sm font-semibold shadow-lg ${
            toast.type === "success"
              ? "bg-teal-600 text-white"
              : "bg-red-600 text-white"
          }`}
        >
          {toast.msg}
        </div>
      )}

      <div>
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">AI Settings</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Manage the fallback chain, models, and API keys for every AI provider, and monitor recent calls.
        </p>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-64 animate-pulse rounded-xl bg-neutral-200 dark:bg-neutral-800"
            />
          ))}
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
            <h2 className="mb-2 text-base font-semibold text-neutral-900 dark:text-neutral-50">Fallback Order</h2>
            <p className="mb-3 text-sm text-neutral-500">
              Comma-separated provider IDs, tried in order. A provider is skipped while its circuit is open.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={providerOrder}
                onChange={(e) => setProviderOrder(e.target.value)}
                placeholder="deepseek,gemini,groq"
                className="flex-1 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50"
              />
              <button
                onClick={handleSaveOrder}
                disabled={savingOrder}
                className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
              >
                {savingOrder ? "Saving…" : "Save Order"}
              </button>
            </div>
          </div>

          {(Object.keys(PROVIDER_LABELS) as ProviderId[]).map((id) => (
            <ProviderCard
              key={id}
              title={PROVIDER_LABELS[id]}
              provider={id}
              state={providers[id]}
              onKeyDraftChange={(v) => setProviders((prev) => ({ ...prev, [id]: { ...prev[id], keyDraft: v } }))}
              onSaveKey={() => handleSaveKey(id, providers[id].keyDraft)}
              onClearOverride={() => handleSaveKey(id, "")}
              onTest={() => handleTest(id, providers[id].keyDraft)}
              onModelChange={(model) => handleModelChange(id, model)}
            />
          ))}

          <RecentCallsPanel />
        </>
      )}
    </div>
  );
}
