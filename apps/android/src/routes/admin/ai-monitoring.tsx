/**
 * apps/android/src/routes/admin/ai-monitoring.tsx
 *
 * Centralized Admin AI Monitoring panel — mirrors
 * apps/web/app/(admin)/gate44/ai-monitoring/page.tsx: the rotating 48h AI
 * call log across every AI-backed feature, aggregate usage/token stats,
 * live circuit-breaker state, and pending human-review escalation counts
 * with links to their queues.
 *
 * GET /api/admin/ai-monitoring?feature=
 */

import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { AdminCard, AdminErrorState, AdminStatCard, AdminStatSkeleton, AdminBadge } from '@/components/admin/AdminUI';

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
  status: 'closed' | 'open' | 'half-open';
  failures: number;
}

interface MonitoringData {
  calls: AiCallLogRow[];
  usageStats: UsageStat[];
  circuits: Record<string, CircuitInfo>;
  pendingEscalations: { reports: number; adImages: number; kyc: number };
}

async function fetchMonitoring(): Promise<MonitoringData> {
  const { data } = await apiClient.get<MonitoringData>('/admin/ai-monitoring');
  return data;
}

function circuitColor(status: CircuitInfo['status']): 'green' | 'gold' | 'red' {
  if (status === 'closed') return 'green';
  if (status === 'half-open') return 'gold';
  return 'red';
}

function AiMonitoringPage() {
  const { t } = useTranslation();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data, status, refetch } = useQuery({ queryKey: ['admin', 'ai-monitoring'], queryFn: fetchMonitoring });

  return (
    <div className="px-4 py-5">
      <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">{t('admin.aiMonitoring', 'AI Monitoring')}</h1>
      <p className="mb-4 mt-1 text-xs text-neutral-500 dark:text-neutral-400">
        {t('admin.aiMonitoring.subtitle', 'AI calls across the platform: provider chain, confidence, tokens, and pending human review.')}
      </p>

      {status === 'error' && <AdminErrorState onRetry={() => refetch()} />}
      {status === 'pending' && (
        <div className="grid grid-cols-3 gap-2">{[0, 1, 2].map((i) => <AdminStatSkeleton key={i} />)}</div>
      )}

      {status === 'success' && (
        <div className="space-y-5">
          <div className="grid grid-cols-3 gap-2">
            {(['deepseek', 'gemini', 'groq'] as const).map((p) => (
              <div key={p} className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-3">
                <p className="text-xs font-semibold capitalize text-neutral-700 dark:text-neutral-300">{p}</p>
                <AdminBadge label={data.circuits[p]?.status ?? 'closed'} color={circuitColor(data.circuits[p]?.status ?? 'closed')} />
              </div>
            ))}
          </div>

          {(data.pendingEscalations.adImages > 0 || data.pendingEscalations.reports > 0 || data.pendingEscalations.kyc > 0) && (
            <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950 p-3">
              <p className="mb-2 text-xs font-bold text-amber-800 dark:text-amber-300">{t('admin.aiMonitoring.pendingReview', 'Pending human review')}</p>
              <div className="flex flex-col gap-1.5 text-sm">
                {data.pendingEscalations.adImages > 0 && (
                  <Link to="/admin/ads-moderation-queue" className="font-semibold text-amber-800 dark:text-amber-300 underline">
                    {t('admin.aiMonitoring.adEscalations', '{{count}} ad image escalation(s)', { count: data.pendingEscalations.adImages })}
                  </Link>
                )}
                {data.pendingEscalations.reports > 0 && (
                  <Link to="/watch56" className="font-semibold text-amber-800 dark:text-amber-300 underline">
                    {t('admin.aiMonitoring.reportEscalations', '{{count}} report(s) in the manual queue', { count: data.pendingEscalations.reports })}
                  </Link>
                )}
                {data.pendingEscalations.kyc > 0 && (
                  <Link to="/admin/kyc" className="font-semibold text-amber-800 dark:text-amber-300 underline">
                    {t('admin.aiMonitoring.kycEscalations', '{{count}} KYC AI escalation(s)', { count: data.pendingEscalations.kyc })}
                  </Link>
                )}
              </div>
            </div>
          )}

          <div>
            <p className="mb-2 text-sm font-bold text-neutral-900 dark:text-neutral-100">{t('admin.aiMonitoring.usage', 'Usage & token estimates')}</p>
            <div className="grid grid-cols-2 gap-2">
              {data.usageStats.slice(0, 6).map((s) => (
                <AdminStatCard
                  key={`${s.feature}:${s.provider}`}
                  label={`${s.feature} · ${s.provider}`}
                  value={String(s.callCount)}
                  sub={`${s.avgLatencyMs}ms avg · ${s.totalInputTokens + s.totalOutputTokens} tok`}
                />
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-bold text-neutral-900 dark:text-neutral-100">{t('admin.aiMonitoring.recentCalls', 'Recent calls')}</p>
            <div className="space-y-2">
              {data.calls.length === 0 && (
                <p className="text-sm text-neutral-400">{t('admin.aiMonitoring.noCalls', 'No calls logged yet.')}</p>
              )}
              {data.calls.map((row) => (
                <AdminCard key={row.id} onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{row.feature}</p>
                      <p className="text-xs text-neutral-500 dark:text-neutral-400 capitalize">{row.provider} / {row.model}</p>
                    </div>
                    <AdminBadge label={row.success ? 'OK' : 'Failed'} color={row.success ? 'green' : 'red'} />
                  </div>
                  {expandedId === row.id && (
                    <div className="mt-2 space-y-1 border-t border-neutral-100 dark:border-neutral-700 pt-2 text-xs text-neutral-600 dark:text-neutral-400">
                      <p>{t('admin.aiMonitoring.confidence', 'Confidence')}: {row.confidence !== null ? `${Math.round(row.confidence * 100)}%` : 'n/a'}</p>
                      <p>{t('admin.aiMonitoring.latency', 'Latency')}: {row.latency_ms}ms</p>
                      <p>{t('admin.aiMonitoring.tokens', 'Tokens')}: {row.input_tokens ?? 0} in / {row.output_tokens ?? 0} out</p>
                      {row.result_preview && <p className="whitespace-pre-wrap">{row.result_preview}</p>}
                      {row.error_message && <p className="text-danger-600 dark:text-danger-400">{row.error_message}</p>}
                    </div>
                  )}
                </AdminCard>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/admin/ai-monitoring')({
  component: AiMonitoringPage,
});
