/**
 * apps/android/src/routes/admin/ai-settings.tsx
 *
 * AI Settings — mirrors apps/web/app/(admin)/admin/ai-settings/page.tsx:
 * live status for DeepSeek (primary) and Gemini (fallback), an API key
 * override form per provider, and a live "Test Connection" button.
 *
 * GET  /api/admin/ai-settings          → { deepseek, gemini }
 * PUT  /api/admin/ai-settings          { provider, apiKey } → { provider, keySource }
 *   (apiKey: '' clears the override and falls back to the env var)
 * POST /api/admin/ai-settings/test     { provider, apiKey? } → always HTTP 200;
 *   response data has no `success` field — this page infers success from the
 *   presence of `model` / absence of `error` (the web reference reads a
 *   `.success` field that the endpoint never actually returns).
 */

import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { AdminToast, AdminErrorState, adminInputClass } from '@/components/admin/AdminUI';

type Provider = 'deepseek' | 'gemini';
type CircuitStatus = 'closed' | 'open' | 'half-open';

interface CircuitInfo {
  status: CircuitStatus;
  failures: number;
  openedAt: number | null;
}

interface ProviderInfo {
  keySource: 'env' | 'override';
  keyMasked: string | null;
  circuit?: CircuitInfo;
}

interface AiSettingsData {
  deepseek: ProviderInfo;
  gemini: ProviderInfo;
}

interface TestResultData {
  provider: Provider;
  latencyMs: number;
  model?: string;
  error?: string;
}

async function fetchAiSettings(): Promise<AiSettingsData> {
  const { data } = await apiClient.get<AiSettingsData>('/admin/ai-settings');
  return data;
}

function CircuitBadge({ circuit }: { circuit: CircuitInfo }) {
  const { t } = useTranslation();
  const map: Record<CircuitStatus, { dot: string; text: string; labelKey: string; labelDefault: string }> = {
    closed: { dot: 'bg-teal-500', text: 'text-teal-700', labelKey: 'admin.aiSettings.circuit.closed', labelDefault: 'Circuit Closed' },
    'half-open': { dot: 'bg-amber-500', text: 'text-amber-700', labelKey: 'admin.aiSettings.circuit.halfOpen', labelDefault: 'Circuit Half-Open' },
    open: { dot: 'bg-danger-500', text: 'text-danger-700', labelKey: 'admin.aiSettings.circuit.open', labelDefault: 'Circuit Open' },
  };
  const style = map[circuit.status];
  const openedAgo = circuit.openedAt ? Math.round((Date.now() - circuit.openedAt) / 1000) : null;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className={`inline-block h-2 w-2 rounded-full ${style.dot}`} />
      <span className={`text-xs font-semibold ${style.text}`}>{t(style.labelKey, style.labelDefault)}</span>
      {circuit.failures > 0 && (
        <span className="text-xs text-neutral-500">
          ({t('admin.aiSettings.circuit.failures', '{{count}} failure', { count: circuit.failures })}
          {openedAgo !== null ? `, ${openedAgo}s ago` : ''})
        </span>
      )}
    </span>
  );
}

function ProviderCard({
  titleKey,
  titleDefault,
  provider,
  info,
  onSaveKey,
  onClearOverride,
  onTest,
  saving,
  testing,
  testResult,
}: {
  titleKey: string;
  titleDefault: string;
  provider: Provider;
  info: ProviderInfo | undefined;
  onSaveKey: (key: string) => void;
  onClearOverride: () => void;
  onTest: (key: string) => void;
  saving: boolean;
  testing: boolean;
  testResult: TestResultData | null;
}) {
  const { t } = useTranslation();
  const [keyDraft, setKeyDraft] = useState('');

  const testSucceeded = testResult ? !testResult.error : false;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-card">
      <h2 className="mb-3 text-sm font-bold text-neutral-900">{t(titleKey, titleDefault)}</h2>

      {info?.circuit && <div className="mb-3"><CircuitBadge circuit={info.circuit} /></div>}

      <div className="mb-3 text-xs text-neutral-600">
        <span className="font-medium text-neutral-800">{t('admin.aiSettings.keySourceLabel', 'Key source')}: </span>
        {info
          ? info.keySource === 'override'
            ? t('admin.aiSettings.keySource.override', 'Override active (ends {{masked}})', { masked: info.keyMasked ?? '' })
            : t('admin.aiSettings.keySource.env', 'Using environment variable')
          : '—'}
      </div>

      <div className="mb-3 flex flex-col gap-2">
        <input
          type="password"
          autoComplete="off"
          value={keyDraft}
          onChange={(e) => setKeyDraft(e.target.value)}
          placeholder={t('admin.aiSettings.keyPlaceholder', 'Override API key (blank = use env var)')}
          className={adminInputClass}
        />
        <div className="flex gap-2">
          <button
            type="button"
            disabled={saving || !keyDraft}
            onClick={() => { onSaveKey(keyDraft); setKeyDraft(''); }}
            className="flex-1 rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            {saving ? '…' : t('admin.aiSettings.saveKey', 'Save Key')}
          </button>
          {info?.keySource === 'override' && (
            <button
              type="button"
              disabled={saving}
              onClick={onClearOverride}
              className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-xs font-semibold text-neutral-700 disabled:opacity-50"
            >
              {t('admin.aiSettings.clearOverride', 'Clear Override')}
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          disabled={testing}
          onClick={() => onTest(keyDraft)}
          className="w-fit rounded-lg border border-neutral-300 px-3 py-2 text-xs font-semibold text-neutral-700 disabled:opacity-50"
        >
          {testing ? t('admin.aiSettings.testing', 'Testing…') : t('admin.aiSettings.testConnection', 'Test Connection')}
        </button>
        {testResult && (
          <div className={`rounded-lg px-3 py-2 text-xs ${testSucceeded ? 'bg-success-50 text-success-700' : 'bg-danger-50 text-danger-700'}`}>
            {testSucceeded
              ? t('admin.aiSettings.testSuccess', 'Connected — {{latencyMs}}ms ({{model}})', { latencyMs: testResult.latencyMs, model: testResult.model ?? '' })
              : t('admin.aiSettings.testFailed', 'Connection failed: {{error}}', { error: testResult.error ?? 'Unknown error' })}
          </div>
        )}
      </div>
    </div>
  );
}

function AdminAiSettingsPage() {
  const { t } = useTranslation();
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [testResults, setTestResults] = useState<Record<Provider, TestResultData | null>>({ deepseek: null, gemini: null });

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const { data, status, refetch } = useQuery({ queryKey: ['admin', 'ai-settings'], queryFn: fetchAiSettings });

  const saveKeyMutation = useMutation({
    mutationFn: ({ provider, apiKey }: { provider: Provider; apiKey: string }) => apiClient.put('/admin/ai-settings', { provider, apiKey }),
    onSuccess: (_res, { apiKey }) => {
      showToast(apiKey ? t('admin.aiSettings.saveSuccess', 'API key saved.') : t('admin.aiSettings.clearSuccess', 'Override cleared.'));
      refetch();
    },
    onError: () => showToast(t('admin.aiSettings.saveError', 'Failed to save key.'), 'error'),
  });

  const testMutation = useMutation({
    mutationFn: async ({ provider, apiKey }: { provider: Provider; apiKey: string }) => {
      const { data } = await apiClient.post<TestResultData>('/admin/ai-settings/test', apiKey ? { provider, apiKey } : { provider });
      return data;
    },
    onMutate: ({ provider }) => setTestResults((prev) => ({ ...prev, [provider]: null })),
    onSuccess: (result, { provider }) => setTestResults((prev) => ({ ...prev, [provider]: result })),
    onError: (_err, { provider }) => setTestResults((prev) => ({ ...prev, [provider]: { provider, latencyMs: 0, error: t('admin.aiSettings.requestFailed', 'Request failed') } })),
  });

  return (
    <div className="px-4 py-5">
      <h1 className="text-xl font-bold text-neutral-900">{t('admin.aiSettings', 'AI Settings')}</h1>
      <p className="mb-4 mt-1 text-xs text-neutral-500">{t('admin.aiSettings.subtitle', 'Manage API keys and connection status for AI providers.')}</p>

      {toast && <AdminToast message={toast.msg} type={toast.type} />}

      {status === 'error' && <AdminErrorState onRetry={() => refetch()} />}

      {status === 'pending' && (
        <div className="space-y-3">
          {[0, 1].map((i) => <div key={i} className="h-56 animate-pulse rounded-xl bg-neutral-200" />)}
        </div>
      )}

      {status === 'success' && (
        <div className="space-y-3">
          <ProviderCard
            titleKey="admin.aiSettings.deepseek"
            titleDefault="DeepSeek (Primary)"
            provider="deepseek"
            info={data.deepseek}
            saving={saveKeyMutation.isPending && saveKeyMutation.variables?.provider === 'deepseek'}
            testing={testMutation.isPending && testMutation.variables?.provider === 'deepseek'}
            testResult={testResults.deepseek}
            onSaveKey={(key) => saveKeyMutation.mutate({ provider: 'deepseek', apiKey: key })}
            onClearOverride={() => saveKeyMutation.mutate({ provider: 'deepseek', apiKey: '' })}
            onTest={(key) => testMutation.mutate({ provider: 'deepseek', apiKey: key })}
          />
          <ProviderCard
            titleKey="admin.aiSettings.gemini"
            titleDefault="Gemini (Fallback)"
            provider="gemini"
            info={data.gemini}
            saving={saveKeyMutation.isPending && saveKeyMutation.variables?.provider === 'gemini'}
            testing={testMutation.isPending && testMutation.variables?.provider === 'gemini'}
            testResult={testResults.gemini}
            onSaveKey={(key) => saveKeyMutation.mutate({ provider: 'gemini', apiKey: key })}
            onClearOverride={() => saveKeyMutation.mutate({ provider: 'gemini', apiKey: '' })}
            onTest={(key) => testMutation.mutate({ provider: 'gemini', apiKey: key })}
          />
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/admin/ai-settings')({
  component: AdminAiSettingsPage,
});
