/**
 * apps/android/src/lib/offline/useNetworkStatus.ts
 *
 * Network status hook using @capacitor/network instead of
 * @react-native-community/netinfo.
 * Falls back to navigator.onLine as secondary indicator.
 */

import { useEffect, useState } from 'react';
import { Network } from '@capacitor/network';

export function useNetworkStatus(): { isOnline: boolean } {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    // Initial check
    Network.getStatus().then((status) => {
      setIsOnline(status.connected);
    });

    // Subscribe to changes
    let handle: { remove: () => void } | null = null;
    Network.addListener('networkStatusChange', (status) => {
      setIsOnline(status.connected);
    }).then((h) => { handle = h; });

    // navigator.onLine fallback
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      handle?.remove();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return { isOnline };
}
