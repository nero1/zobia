/**
 * apps/android/src/routes/admin/alerts.tsx
 *
 * System Alerts — mirrors apps/web/app/(admin)/admin/alerts/page.tsx.
 * GET /api/admin/alerts?include_resolved=, POST /api/admin/alerts/:alertId/resolve { note? }.
 */

import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { AdminCardSkeleton, AdminEmptyState, AdminToast, AdminBadge, timeAgo } from '@/components/admin/AdminUI';

type Severity = 'info' | 'warning' | 'critical';

interface Alert {
  id: string;
  type: string;
  severity: Severity;
  message: string;
  resolved: boolean;
  resolvedAt: string | null;
  createdAt: string;
}

const SEVERITY_COLOR: Record<Severity, 'blue' | 'gold' | 'red'> = { info: 'blue', warning: 'gold', critical: 'red' };

async function fetchAlerts(includeResolved: boolean): Promise<Alert[]> {
  const { data } = await apiClient.get<{ alerts: Alert[] }>(`/admin/alerts?include_resolved=${includeResolved}`);
  return data?.alerts ?? [];
}

function AdminAlertsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [showResolved, setShowResolved] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const { data, status } = useQuery({ queryKey: ['admin', 'alerts', showResolved], queryFn: () => fetchAlerts(showResolved) });

  const resolve = useMutation({
    mutationFn: (alertId: string) => apiClient.post(`/admin/alerts/${alertId}/resolve`, {}),
    onSuccess: () => {
      setToast(t('admin.alerts.resolved', 'Alert resolved'));
      setTimeout(() => setToast(null), 3000);
      qc.invalidateQueries({ queryKey: ['admin', 'alerts'] });
    },
    onError: () => {
      setToast(t('admin.moderation.actionFailed', 'Action failed'));
      setTimeout(() => setToast(null), 3000);
    },
  });

  return (
    <div className="px-4 py-5">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-neutral-900">{t('admin.nav.alerts', 'Alerts')}</h1>
        <button
          onClick={() => setShowResolved((v) => !v)}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold ${showResolved ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-600'}`}
        >
          {t('admin.alerts.showResolved', 'Show Resolved')}
        </button>
      </div>
      {toast && <AdminToast message={toast} />}

      <div className="space-y-2.5">
        {status === 'pending' && Array.from({ length: 3 }).map((_, i) => <AdminCardSkeleton key={i} />)}
        {status === 'success' && (data?.length ?? 0) === 0 && <AdminEmptyState icon="✅" title={t('admin.alerts.empty', 'No active alerts')} />}
        {status === 'success' &&
          data?.map((alert) => (
            <div key={alert.id} className="rounded-xl border border-neutral-200 bg-white p-4 shadow-card">
              <div className="mb-1.5 flex items-center gap-1.5 text-xs">
                <AdminBadge label={alert.severity} color={SEVERITY_COLOR[alert.severity]} />
                <AdminBadge label={alert.type.replace(/_/g, ' ')} />
                {alert.resolved && <AdminBadge label={t('admin.alerts.resolved', 'Resolved')} color="green" />}
                <span className="ml-auto text-neutral-400">{timeAgo(alert.createdAt)}</span>
              </div>
              <p className="mb-2.5 text-sm text-neutral-800">{alert.message}</p>
              {!alert.resolved && (
                <button onClick={() => resolve.mutate(alert.id)} disabled={resolve.isPending} className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">
                  {t('admin.alerts.resolve', 'Resolve')}
                </button>
              )}
            </div>
          ))}
      </div>
    </div>
  );
}

export const Route = createFileRoute('/admin/alerts')({
  component: AdminAlertsPage,
});
