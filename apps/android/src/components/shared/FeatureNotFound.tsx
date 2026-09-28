/**
 * apps/android/src/components/shared/FeatureNotFound.tsx
 *
 * Generic "not found" body shown in place of a screen whose feature flag is
 * off and the current user has no staff exception — mirrors the web app's
 * app/(app)/layout.tsx 404 gate and components/system/NotFoundBody.tsx.
 * Deliberately generic: no wording here should hint that a feature exists
 * and is disabled.
 */

import { useTranslation } from 'react-i18next';
import { Icon } from '@/components/ui/Icon';

export function FeatureNotFound() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <Icon emoji="🔍" size={36} />
      <p className="text-sm text-neutral-500 dark:text-neutral-400">{t('common.notFound')}</p>
    </div>
  );
}
