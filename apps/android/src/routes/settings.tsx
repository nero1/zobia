/**
 * apps/android/src/routes/settings.tsx
 *
 * Settings screen: language, logout, app version.
 */

import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth/store';
import { LOCALE_LABELS, SUPPORTED_LOCALES, type SupportedLocale } from '@zobia/shared/i18n';
import i18n from '@/lib/i18n';

const APP_VERSION = '1.0.0';

function SettingsPage() {
  const { t } = useTranslation();
  const { user, clearAuth } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const handleLogout = async () => {
    await clearAuth();
    qc.clear();
    navigate({ to: '/auth/login', replace: true });
  };

  const handleLanguageChange = async (lng: string) => {
    await i18n.changeLanguage(lng);
  };

  return (
    <div className="h-full overflow-y-auto bg-neutral-50">
      {/* Current user */}
      {user && (
        <div className="bg-white px-6 py-4 mb-3 flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-primary-100 flex items-center justify-center text-2xl">
            👤
          </div>
          <div>
            <p className="font-semibold text-neutral-900">{user.username}</p>
            <p className="text-sm text-neutral-500">{user.email}</p>
          </div>
        </div>
      )}

      {/* Wallet & Stats */}
      <div className="bg-white px-6 py-2 mb-3">
        <Link to="/wallet" className="flex items-center justify-between py-2.5 border-b border-neutral-100">
          <span className="text-sm text-neutral-700">🪙 {t('wallet.title')}</span>
          <span className="text-neutral-400">→</span>
        </Link>
        <Link to="/stats" className="flex items-center justify-between py-2.5">
          <span className="text-sm text-neutral-700">📊 {t('profile.actions.stats')}</span>
          <span className="text-neutral-400">→</span>
        </Link>
      </div>

      {/* Language */}
      <div className="bg-white px-6 py-4 mb-3">
        <h3 className="text-sm font-semibold text-neutral-700 mb-3">{t('android.settings.language')}</h3>
        <div className="space-y-2">
          {SUPPORTED_LOCALES.map((locale) => (
            <button
              key={locale}
              onClick={() => handleLanguageChange(locale)}
              className={`w-full flex items-center justify-between py-2 px-3 rounded-lg ${
                i18n.language === locale
                  ? 'bg-primary-50 text-primary-600'
                  : 'text-neutral-700 hover:bg-neutral-50'
              }`}
            >
              <span className="text-sm">{LOCALE_LABELS[locale as SupportedLocale]}</span>
              {i18n.language === locale && (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* App version */}
      <div className="bg-white px-6 py-4 mb-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-neutral-700">{t('android.settings.version')}</span>
          <span className="text-sm text-neutral-400">{APP_VERSION}</span>
        </div>
      </div>

      {/* Logout */}
      <div className="px-6 py-4">
        <button
          onClick={handleLogout}
          className="w-full py-3 border border-danger-300 text-danger-600 font-semibold rounded-lg"
        >
          {t('android.settings.logout')}
        </button>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
});
