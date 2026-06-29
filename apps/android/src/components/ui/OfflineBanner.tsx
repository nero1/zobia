/**
 * apps/android/src/components/ui/OfflineBanner.tsx
 *
 * Fixed banner shown when the device is offline.
 * Shows cached data message, slides in/out below TopBar.
 */

import { useTranslation } from 'react-i18next';
import { useNetworkStatus } from '@/lib/offline/useNetworkStatus';

export function OfflineBanner() {
  const { t } = useTranslation();
  const { isOnline } = useNetworkStatus();

  if (isOnline) return null;

  return (
    <div
      className="fixed left-0 right-0 z-40 bg-red-500 text-white text-center py-2 px-4 text-sm font-medium"
      style={{ top: '56px' }}
    >
      {t('android.offline.banner')}
    </div>
  );
}
