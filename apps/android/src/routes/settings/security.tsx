/**
 * apps/android/src/routes/settings/security.tsx
 *
 * Security settings — BUG-CAP-06 / BUG-CAP-07 fix: Active Sessions (view +
 * revoke other signed-in devices), PIN, and 2FA management didn't exist on
 * Android at all, forcing mobile-only users into a browser for basic account
 * security. Reuses the same endpoints as web's settings page:
 *   - GET/DELETE /api/auth/sessions/:sid    (new — see app/api/auth/sessions)
 *   - GET /api/auth/pin/status, POST /api/auth/pin/setup, /remove
 *   - POST /api/auth/2fa/setup, /api/auth/2fa/disable
 *
 * 2FA setup shows the manual entry key (secret) rather than a scannable QR —
 * unlike web (which uses the `qrcode.react` package), Android doesn't carry a
 * QR-rendering dependency, and every authenticator app supports manual key
 * entry as a standard fallback, so this stays a fully working flow without
 * adding a new native dependency.
 */

import { useEffect, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';

// ---------------------------------------------------------------------------
// Active Sessions
// ---------------------------------------------------------------------------

interface SessionItem {
  sid: string;
  createdAt: string;
  ip: string | null;
  ua: string | null;
  isCurrent: boolean;
}

function describeDevice(ua: string | null): string {
  if (!ua) return 'Unknown device';
  if (/Android/i.test(ua)) return /Zobia/i.test(ua) ? 'Zobia Android app' : 'Android browser';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS browser';
  return 'Browser';
}

function ActiveSessions() {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<SessionItem[] | null>(null);
  const [revokingSid, setRevokingSid] = useState<string | null>(null);

  const load = () => {
    apiClient
      .get<{ sessions: SessionItem[] }>('/auth/sessions')
      .then(({ data }) => setSessions(data.sessions))
      .catch(() => setSessions([]));
  };

  useEffect(load, []);

  async function handleRevoke(sid: string) {
    setRevokingSid(sid);
    try {
      await apiClient.delete(`/auth/sessions/${encodeURIComponent(sid)}`);
      setSessions((prev) => (prev ?? []).filter((s) => s.sid !== sid));
    } catch {
      // non-fatal — leave the list as-is, user can retry
    } finally {
      setRevokingSid(null);
    }
  }

  return (
    <div className="rounded-xl bg-white p-4 shadow-card">
      <h2 className="mb-1 text-sm font-semibold text-neutral-700">{t('settings.sessions.title', 'Active Sessions')}</h2>
      <p className="mb-3 text-xs text-neutral-500">
        {t('settings.sessions.description', 'Devices currently signed into your account. Lost a device? Sign it out here.')}
      </p>
      {sessions === null ? (
        <p className="text-sm text-neutral-400">{t('action.loading', 'Loading…')}</p>
      ) : sessions.length === 0 ? (
        <p className="text-sm text-neutral-400">{t('settings.sessions.empty', 'No active sessions found.')}</p>
      ) : (
        <ul className="divide-y divide-neutral-100">
          {sessions.map((s) => (
            <li key={s.sid} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-neutral-900">
                  {describeDevice(s.ua)}
                  {s.isCurrent && (
                    <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                      {t('settings.sessions.current', 'This device')}
                    </span>
                  )}
                </p>
                <p className="truncate text-xs text-neutral-500">{new Date(s.createdAt).toLocaleDateString()}</p>
              </div>
              {!s.isCurrent && (
                <button
                  onClick={() => void handleRevoke(s.sid)}
                  disabled={revokingSid === s.sid}
                  className="flex-shrink-0 rounded-lg border border-danger-300 px-3 py-1.5 text-xs font-semibold text-danger-600 disabled:opacity-40"
                >
                  {revokingSid === s.sid ? t('settings.sessions.revoking', 'Signing out…') : t('settings.sessions.revoke', 'Sign out')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PIN
// ---------------------------------------------------------------------------

function PinSection() {
  const { t } = useTranslation();
  const [hasPin, setHasPin] = useState(false);
  const [mode, setMode] = useState<'idle' | 'set' | 'remove'>('idle');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [currentPin, setCurrentPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiClient
      .get<{ hasPinSet: boolean }>('/auth/pin/status')
      .then(({ data }) => setHasPin(data.hasPinSet))
      .catch(() => {});
  }, []);

  function reset() {
    setMode('idle');
    setPin('');
    setConfirmPin('');
    setCurrentPin('');
    setError(null);
  }

  async function handleSet() {
    if (pin.length !== 4 || !/^\d{4}$/.test(pin)) { setError(t('settings.pin.invalid', 'PIN must be exactly 4 digits')); return; }
    if (pin !== confirmPin) { setError(t('settings.pin.mismatch', 'PINs do not match')); return; }
    setSaving(true);
    setError(null);
    try {
      await apiClient.post('/auth/pin/setup', { pin, confirmPin });
      setHasPin(true);
      reset();
    } catch {
      setError(t('error.generic', 'Something went wrong. Please try again.'));
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    if (currentPin.length !== 4) { setError(t('settings.pin.invalid', 'PIN must be exactly 4 digits')); return; }
    setSaving(true);
    setError(null);
    try {
      await apiClient.post('/auth/pin/remove', { currentPin });
      setHasPin(false);
      reset();
    } catch {
      setError(t('error.generic', 'Something went wrong. Please try again.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl bg-white p-4 shadow-card">
      <h2 className="mb-1 text-sm font-semibold text-neutral-700">{t('settings.pin.title', 'Security PIN')}</h2>
      <p className="mb-3 text-xs text-neutral-500">
        {t('settings.pin.description', 'A 4-digit PIN adds an extra layer of protection to payments and payout requests.')}
      </p>

      {mode === 'idle' && (
        <div className="flex gap-2">
          <button onClick={() => setMode('set')} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold">
            {hasPin ? t('settings.pin.change', 'Change PIN') : t('settings.pin.set', 'Set PIN')}
          </button>
          {hasPin && (
            <button onClick={() => setMode('remove')} className="rounded-lg border border-danger-300 px-3 py-1.5 text-xs font-semibold text-danger-600">
              {t('settings.pin.remove', 'Remove PIN')}
            </button>
          )}
        </div>
      )}

      {mode === 'set' && (
        <div className="space-y-2">
          <input type="password" inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} placeholder={t('settings.pin.newPlaceholder', 'New 4-digit PIN')} className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
          <input type="password" inputMode="numeric" maxLength={4} value={confirmPin} onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))} placeholder={t('settings.pin.confirmPlaceholder', 'Confirm PIN')} className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
          {error && <p className="text-xs text-danger-600">{error}</p>}
          <div className="flex gap-2">
            <button onClick={() => void handleSet()} disabled={saving} className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
              {saving ? t('action.saving', 'Saving…') : t('action.save', 'Save')}
            </button>
            <button onClick={reset} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold">{t('action.cancel', 'Cancel')}</button>
          </div>
        </div>
      )}

      {mode === 'remove' && (
        <div className="space-y-2">
          <input type="password" inputMode="numeric" maxLength={4} value={currentPin} onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ''))} placeholder={t('settings.pin.currentPlaceholder', 'Enter current PIN')} className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
          {error && <p className="text-xs text-danger-600">{error}</p>}
          <div className="flex gap-2">
            <button onClick={() => void handleRemove()} disabled={saving} className="rounded-lg bg-danger-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
              {saving ? t('settings.pin.removing', 'Removing…') : t('settings.pin.remove', 'Remove PIN')}
            </button>
            <button onClick={reset} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold">{t('action.cancel', 'Cancel')}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2FA
// ---------------------------------------------------------------------------

function TwoFactorSection() {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(false);
  const [mode, setMode] = useState<'idle' | 'setup' | 'disable'>('idle');
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiClient
      .get<{ user?: { totp_enabled?: boolean } }>('/users/me')
      .then(({ data }) => setEnabled(Boolean(data.user?.totp_enabled)))
      .catch(() => {});
  }, []);

  function reset() {
    setMode('idle');
    setSecret(null);
    setCode('');
    setError(null);
  }

  async function handleOpenSetup() {
    reset();
    setMode('setup');
    try {
      const { data } = await apiClient.get<{ secret: string }>('/auth/2fa/setup');
      setSecret(data.secret);
    } catch {
      setError(t('error.generic', 'Something went wrong. Please try again.'));
    }
  }

  async function handleConfirmSetup() {
    if (code.length !== 6) return;
    setSaving(true);
    setError(null);
    try {
      await apiClient.post('/auth/2fa/setup', { code });
      setEnabled(true);
      reset();
    } catch {
      setError(t('settings.twoFa.invalidCode', 'Invalid code — please try again.'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDisable() {
    if (code.length !== 6) return;
    setSaving(true);
    setError(null);
    try {
      await apiClient.post('/auth/2fa/disable', { code });
      setEnabled(false);
      reset();
    } catch {
      setError(t('settings.twoFa.invalidCode', 'Invalid code — please try again.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl bg-white p-4 shadow-card">
      <h2 className="mb-1 text-sm font-semibold text-neutral-700">{t('settings.twoFa.title', 'Two-Factor Authentication')}</h2>
      <p className="mb-3 text-xs text-neutral-500">
        {enabled
          ? t('settings.twoFa.enabledDesc', 'Two-factor authentication is currently enabled.')
          : t('settings.twoFa.disabledDesc', 'Add an extra layer of security to your account.')}
      </p>

      {mode === 'idle' && (
        <button
          onClick={() => (enabled ? setMode('disable') : void handleOpenSetup())}
          className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${enabled ? 'border-danger-300 text-danger-600' : 'border-neutral-300'}`}
        >
          {enabled ? t('settings.twoFa.disable', 'Disable 2FA') : t('settings.twoFa.enable', 'Enable 2FA')}
        </button>
      )}

      {mode === 'setup' && (
        <div className="space-y-2">
          <p className="text-xs text-neutral-600">
            {t('settings.twoFa.manualKeyHint', 'Add this key manually in your authenticator app (Google Authenticator, Authy, etc.):')}
          </p>
          {secret ? (
            <p className="select-all rounded-lg bg-neutral-100 px-3 py-2 text-center font-mono text-sm tracking-wider">{secret}</p>
          ) : (
            <p className="text-xs text-neutral-400">{t('action.loading', 'Loading…')}</p>
          )}
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder={t('settings.twoFa.codePlaceholder', '6-digit code')}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-center font-mono text-sm tracking-widest"
          />
          {error && <p className="text-xs text-danger-600">{error}</p>}
          <div className="flex gap-2">
            <button onClick={() => void handleConfirmSetup()} disabled={code.length !== 6 || saving} className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
              {saving ? t('action.saving', 'Saving…') : t('settings.twoFa.confirm', 'Confirm')}
            </button>
            <button onClick={reset} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold">{t('action.cancel', 'Cancel')}</button>
          </div>
        </div>
      )}

      {mode === 'disable' && (
        <div className="space-y-2">
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder={t('settings.twoFa.codePlaceholder', '6-digit code')}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-center font-mono text-sm tracking-widest"
          />
          {error && <p className="text-xs text-danger-600">{error}</p>}
          <div className="flex gap-2">
            <button onClick={() => void handleDisable()} disabled={code.length !== 6 || saving} className="rounded-lg bg-danger-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
              {saving ? t('settings.twoFa.disabling', 'Disabling…') : t('settings.twoFa.disable', 'Disable 2FA')}
            </button>
            <button onClick={reset} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold">{t('action.cancel', 'Cancel')}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function SecurityPage() {
  return (
    <div className="h-full overflow-y-auto bg-neutral-50 px-4 py-4 space-y-3">
      <ActiveSessions />
      <PinSection />
      <TwoFactorSection />
    </div>
  );
}

export const Route = createFileRoute('/settings/security')({
  component: SecurityPage,
});
