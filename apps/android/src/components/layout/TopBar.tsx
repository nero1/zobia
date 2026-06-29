/**
 * apps/android/src/components/layout/TopBar.tsx
 *
 * Fixed top navigation bar. Shows back button on sub-pages.
 * Height: 56px (h-14), sticky top-0, z-50.
 */

import { useTranslation } from 'react-i18next';
import { useRouter } from '@tanstack/react-router';

interface TopBarProps {
  title: string;
  rightActions?: React.ReactNode;
  showBack?: boolean;
}

export function TopBar({ title, rightActions, showBack }: TopBarProps) {
  const { t } = useTranslation();
  const router = useRouter();

  return (
    <header className="fixed top-0 left-0 right-0 h-14 bg-white border-b border-neutral-200 z-50 flex items-center px-4">
      {showBack && (
        <button
          onClick={() => router.history.back()}
          className="mr-3 p-1 text-neutral-700 hover:text-primary-600 transition-colors"
          aria-label={t('action.back')}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      )}
      <h1 className="flex-1 text-lg font-semibold text-neutral-900 truncate">
        {title}
      </h1>
      {rightActions && (
        <div className="flex items-center gap-2">
          {rightActions}
        </div>
      )}
    </header>
  );
}
