/**
 * apps/android/src/components/ui/OfflineBanner.tsx
 *
 * Banner shown when the device is offline. Renders as a normal flex child
 * between TopBar and `main` in __root.tsx's AppShell column — not `fixed`,
 * so it never needs a hardcoded top offset that could drift out of sync
 * with TopBar's real (safe-area-dependent) height.
 */

import { useTranslation } from 'react-i18next';
import { useNetworkStatus } from '@/lib/offline/useNetworkStatus';

export function OfflineBanner() {
  const { t } = useTranslation();
  const { isOnline } = useNetworkStatus();

  if (isOnline) return null;

  return (
    <div className="relative z-40 flex-none bg-red-500 text-white text-center py-2 px-4 text-sm font-medium">
      {t('android.offline.banner')}
    </div>
  );
}
