/**
 * apps/android/src/components/admin/AdminUI.tsx
 *
 * Shared building blocks for the Android admin section — reused across every
 * apps/android/src/routes/admin/*.tsx page instead of re-implementing the same
 * stat card / empty state / confirm dialog markup 30+ times. Mirrors the visual
 * language of apps/web/app/(admin)/admin/page.tsx's StatCard etc., adapted to
 * the mobile card-list conventions already used throughout apps/android
 * (see routes/events.tsx, routes/rooms/index.tsx).
 */

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

const STAT_COLOR_MAP: Record<string, string> = {
  blue: 'border-blue-200 bg-blue-50',
  green: 'border-teal-200 bg-teal-50',
  gold: 'border-amber-200 bg-amber-50',
  red: 'border-danger-200 bg-danger-50',
  neutral: 'border-neutral-200 bg-white',
};

export function AdminStatCard({
  label,
  value,
  sub,
  color = 'neutral',
}: {
  label: string;
  value: string;
  sub?: string;
  color?: 'blue' | 'green' | 'gold' | 'red' | 'neutral';
}) {
  return (
    <div className={`rounded-xl border p-4 shadow-card ${STAT_COLOR_MAP[color]}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">{label}</p>
      <p className="mt-1.5 text-xl font-bold text-neutral-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-neutral-500">{sub}</p>}
    </div>
  );
}

export function AdminStatSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-neutral-200 bg-white p-4">
      <div className="h-2.5 w-16 rounded bg-neutral-200" />
      <div className="mt-2.5 h-5 w-12 rounded bg-neutral-200" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------

export function AdminSectionHeader({ children }: { children: ReactNode }) {
  return <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">{children}</h2>;
}

// ---------------------------------------------------------------------------
// Badge (status pill)
// ---------------------------------------------------------------------------

const BADGE_COLOR_MAP: Record<string, string> = {
  neutral: 'bg-neutral-100 text-neutral-600',
  blue: 'bg-blue-100 text-blue-700',
  teal: 'bg-teal-100 text-teal-700',
  gold: 'bg-amber-100 text-amber-700',
  red: 'bg-danger-100 text-danger-700',
  green: 'bg-success-100 text-success-700',
};

export function AdminBadge({ label, color = 'neutral' }: { label: string; color?: keyof typeof BADGE_COLOR_MAP }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${BADGE_COLOR_MAP[color]}`}>{label}</span>;
}

// ---------------------------------------------------------------------------
// Card list row wrapper
// ---------------------------------------------------------------------------

export function AdminCard({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`w-full rounded-xl border border-neutral-200 bg-white p-4 text-left shadow-card ${onClick ? 'active:bg-neutral-50' : ''}`}
    >
      {children}
    </Comp>
  );
}

export function AdminCardSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-neutral-200 bg-white p-4">
      <div className="h-4 w-1/2 rounded bg-neutral-200" />
      <div className="mt-2 h-3 w-full rounded bg-neutral-100" />
      <div className="mt-1 h-3 w-2/3 rounded bg-neutral-100" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty / error states
// ---------------------------------------------------------------------------

export function AdminEmptyState({ icon = '📭', title, hint }: { icon?: string; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center py-16 text-center">
      <span className="text-4xl">{icon}</span>
      <h3 className="mt-3 text-base font-semibold text-neutral-900">{title}</h3>
      {hint && <p className="mt-1 text-sm text-neutral-500">{hint}</p>}
    </div>
  );
}

export function AdminErrorState({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16">
      <p className="text-sm text-neutral-500">{t('error.generic')}</p>
      <button onClick={onRetry} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white">
        {t('android.error.retry')}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirm dialog — mirrors routes/games/saved.tsx's centered modal pattern
// ---------------------------------------------------------------------------

export function AdminConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel,
  danger,
  pending,
  onConfirm,
  onCancel,
  children,
}: {
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl flex flex-col gap-4">
        <div>
          <p className="text-base font-bold text-neutral-900">{title}</p>
          {description && <p className="mt-1 text-sm text-neutral-500">{description}</p>}
        </div>
        {children}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="flex-1 rounded-xl border border-neutral-200 py-2.5 text-sm font-semibold text-neutral-700 disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className={`flex-1 rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-60 ${danger ? 'bg-danger-600' : 'bg-primary-600'}`}
          >
            {pending ? '…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toggle switch — used by Config / Feature Flags / AI Settings pages
// ---------------------------------------------------------------------------

export function AdminToggle({ checked, onChange, disabled }: { checked: boolean; onChange: (next: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60 ${checked ? 'bg-primary-600' : 'bg-neutral-300'}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[22px]' : 'translate-x-0.5'}`}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Segmented tab bar — used by Forum / Business admin pages for sub-views
// ---------------------------------------------------------------------------

export function AdminTabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: T; label: string }[];
  active: T;
  onChange: (key: T) => void;
}) {
  return (
    <div className="mb-4 flex gap-1.5 overflow-x-auto pb-0.5">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onChange(tab.key)}
          className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
            active === tab.key ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-600'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Text field / textarea — used by Config / Announcements / broadcast forms
// ---------------------------------------------------------------------------

export function AdminField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-neutral-600">{label}</span>
      {children}
    </label>
  );
}

export const adminInputClass =
  'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500';

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export function fmtNumber(n: number): string {
  return n.toLocaleString('en-NG');
}

export function fmtCurrency(n: number, currency = 'NGN'): string {
  return `${currency} ${n.toLocaleString('en-NG')}`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
