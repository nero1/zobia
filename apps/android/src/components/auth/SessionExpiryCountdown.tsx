/**
 * apps/android/src/components/auth/SessionExpiryCountdown.tsx
 *
 * Mirrors apps/web/components/auth/SessionExpiryCountdown.tsx — warns the
 * user 30 seconds before their access token expires, while the app is
 * actually foregrounded, and lets them extend the session with one tap.
 *
 * Driven by lib/auth/sessionExpiryBus.ts, which is kept in sync with the
 * token actually cached/stored (see store.ts and lib/api/client.ts). "Screen
 * is on" is interpreted as the app being in the foreground
 * (document.visibilityState === 'visible' inside the WebView), matching the
 * web/PWA behaviour.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { onSessionExpiryChange } from '@/lib/auth/sessionExpiryBus';
import { refreshAccessToken } from '@/lib/api/client';

const WARNING_WINDOW_MS = 30_000;

export function SessionExpiryCountdown() {
  const { t } = useTranslation();
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [extending, setExtending] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => onSessionExpiryChange(setExpiresAt), []);

  const tick = useCallback(() => {
    setExpiresAt((current) => {
      if (current == null) {
        setRemainingMs(null);
        return current;
      }
      const remaining = current - Date.now();
      setRemainingMs(remaining > 0 ? remaining : null);
      return current;
    });
  }, []);

  useEffect(() => {
    function startOrStopTimer() {
      const visible = document.visibilityState === 'visible';
      if (visible && expiresAt != null && !intervalRef.current) {
        tick();
        intervalRef.current = setInterval(tick, 1000);
      } else if ((!visible || expiresAt == null) && intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
        if (expiresAt == null) setRemainingMs(null);
      }
    }

    startOrStopTimer();
    document.addEventListener('visibilitychange', startOrStopTimer);
    return () => {
      document.removeEventListener('visibilitychange', startOrStopTimer);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [expiresAt, tick]);

  const extendSession = useCallback(async () => {
    setExtending(true);
    try {
      // Updates the shared expiry bus itself on success — nothing else to do here.
      await refreshAccessToken();
    } finally {
      setExtending(false);
    }
  }, []);

  const visible = remainingMs != null && remainingMs > 0 && remainingMs <= WARNING_WINDOW_MS;
  if (!visible) return null;

  const seconds = Math.max(1, Math.ceil((remainingMs as number) / 1000));

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="session-expiry-countdown-title"
      aria-describedby="session-expiry-countdown-body"
    >
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl dark:bg-neutral-900">
        <h2
          id="session-expiry-countdown-title"
          className="text-lg font-semibold text-neutral-900 dark:text-neutral-100"
        >
          {t('auth.sessionExpiryCountdown.title')}
        </h2>
        <p
          id="session-expiry-countdown-body"
          className="mt-2 text-sm text-neutral-600 dark:text-neutral-300"
        >
          <Trans
            i18nKey="auth.sessionExpiryCountdown.body"
            values={{ seconds }}
            components={{ bold: <strong /> }}
          />
        </p>
        <button
          type="button"
          onClick={extendSession}
          disabled={extending}
          autoFocus
          className="mt-5 w-full rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-700 disabled:opacity-60"
        >
          {extending
            ? t('auth.sessionExpiryCountdown.extending')
            : t('auth.sessionExpiryCountdown.dontLogMeOut')}
        </button>
      </div>
    </div>
  );
}
