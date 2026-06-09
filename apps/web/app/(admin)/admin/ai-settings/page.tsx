"use client";

/**
 * app/(admin)/admin/ai-settings/page.tsx
 *
 * AI Settings admin page.
 *
 * Shows live status for DeepSeek and Gemini AI providers:
 *   - Active key source (env var vs. admin override) with masked preview
 *   - DeepSeek circuit breaker state
 *   - Live connection test button
 *   - Per-provider API key override form (save / clear)
 */

import { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CircuitInfo {
  status: "closed" | "open" | "half-open";
  failures: number;
  openedAt: number | null;
}

interface ProviderInfo {
  keySource: "env" | "override";
  keyMasked: string | null;
  circuit?: CircuitInfo;
}

interface AiSettingsData {
  deepseek: ProviderInfo;
  gemini: ProviderInfo;
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
  testing: boolean;
  testResult: TestResult | null;
}

interface Toast {
  msg: string;
  type: "success" | "error";
}

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
}: {
  title: string;
  provider: "deepseek" | "gemini";
  state: ProviderState;
  onKeyDraftChange: (v: string) => void;
  onSaveKey: () => void;
  onClearOverride: () => void;
  onTest: () => void;
}) {
  const info = state.info;

  const keySourceLabel =
    info?.keySource === "override"
      ? `Override active${info.keyMasked ? ` (ends ${info.keyMasked})` : ""}`
      : "Using environment variable";

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="mb-4 text-base font-semibold text-neutral-900 dark:text-neutral-50">{title}</h2>

      {/* Circuit status (DeepSeek only) */}
      {info?.circuit && (
        <div className="mb-3">
          <CircuitBadge circuit={info.circuit} />
        </div>
      )}

      {/* Key source */}
      <div className="mb-4 text-sm text-neutral-600 dark:text-neutral-400">
        <span className="font-medium text-neutral-800 dark:text-neutral-200">Key source: </span>
        {info ? keySourceLabel : "—"}
      </div>

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
// Page
// ---------------------------------------------------------------------------

export default function AiSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<Toast | null>(null);

  const [deepseek, setDeepseek] = useState<ProviderState>({
    info: null,
    keyDraft: "",
    saving: false,
    testing: false,
    testResult: null,
  });
  const [gemini, setGemini] = useState<ProviderState>({
    info: null,
    keyDraft: "",
    saving: false,
    testing: false,
    testResult: null,
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
      const data: AiSettingsData = json.data;
      setDeepseek((prev) => ({ ...prev, info: data.deepseek }));
      setGemini((prev) => ({ ...prev, info: data.gemini }));
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
    async (provider: "deepseek" | "gemini", apiKey: string) => {
      const setState = provider === "deepseek" ? setDeepseek : setGemini;
      setState((prev) => ({ ...prev, saving: true }));
      try {
        const res = await fetch("/api/admin/ai-settings", {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider, apiKey }),
        });
        if (!res.ok) throw new Error("Save failed");
        showToast("API key saved.", "success");
        setState((prev) => ({ ...prev, keyDraft: "" }));
        await loadSettings();
      } catch {
        showToast("Failed to save key.", "error");
      } finally {
        setState((prev) => ({ ...prev, saving: false }));
      }
    },
    [loadSettings, showToast]
  );

  const handleTest = useCallback(
    async (provider: "deepseek" | "gemini", keyDraft: string) => {
      const setState = provider === "deepseek" ? setDeepseek : setGemini;
      setState((prev) => ({ ...prev, testing: true, testResult: null }));
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
        setState((prev) => ({ ...prev, testResult: json.data as TestResult }));
      } catch {
        setState((prev) => ({
          ...prev,
          testResult: { success: false, error: "Request failed" },
        }));
      } finally {
        setState((prev) => ({ ...prev, testing: false }));
      }
    },
    []
  );

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      {/* Toast */}
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
          Manage API keys and connection status for AI providers.
        </p>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="h-48 animate-pulse rounded-xl bg-neutral-200 dark:bg-neutral-800"
            />
          ))}
        </div>
      ) : (
        <>
          <ProviderCard
            title="DeepSeek (Primary)"
            provider="deepseek"
            state={deepseek}
            onKeyDraftChange={(v) => setDeepseek((prev) => ({ ...prev, keyDraft: v }))}
            onSaveKey={() => handleSaveKey("deepseek", deepseek.keyDraft)}
            onClearOverride={() => handleSaveKey("deepseek", "")}
            onTest={() => handleTest("deepseek", deepseek.keyDraft)}
          />
          <ProviderCard
            title="Gemini (Fallback)"
            provider="gemini"
            state={gemini}
            onKeyDraftChange={(v) => setGemini((prev) => ({ ...prev, keyDraft: v }))}
            onSaveKey={() => handleSaveKey("gemini", gemini.keyDraft)}
            onClearOverride={() => handleSaveKey("gemini", "")}
            onTest={() => handleTest("gemini", gemini.keyDraft)}
          />
        </>
      )}
    </div>
  );
}
