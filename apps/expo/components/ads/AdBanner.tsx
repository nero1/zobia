/**
 * components/ads/AdBanner.tsx
 *
 * Banner ad for the games feature on mobile. Renders an AdMob banner when ads
 * are enabled by the admin (feature flag, fetched from /api/config/games) and
 * the native ad module is available; otherwise renders nothing. Mirrors the web
 * <AdSlot> gating so placements behave consistently across platforms.
 */

import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { BannerAd, BannerAdSize, BANNER_AD_UNIT_ID } from '@/lib/ads/admob';

export function AdBanner({ placement }: { placement: string }) {
  const [failed, setFailed] = useState(false);

  const { data } = useQuery({
    queryKey: ['games', 'config'],
    queryFn: async () => {
      const res = await apiClient.get('/config/games');
      return res.data.data as { adsEnabled: boolean };
    },
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    setFailed(false);
  }, [placement]);

  if (!data?.adsEnabled || failed || !BannerAd) return null;

  return (
    <View style={{ alignItems: 'center', paddingVertical: 8 }}>
      <BannerAd
        unitId={BANNER_AD_UNIT_ID}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        onAdFailedToLoad={() => setFailed(true)}
      />
    </View>
  );
}
