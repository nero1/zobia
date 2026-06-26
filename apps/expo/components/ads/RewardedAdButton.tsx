import React, { useState, useEffect, useRef } from "react";
import { TouchableOpacity, Text, ActivityIndicator, Alert } from "react-native";
import { loadRewardedAd, showRewardedAd } from "@/lib/ads/admob";
import { storage } from "@/lib/offline/store";
import { useCurrency } from "@/lib/hooks/useCurrency";
import { apiClient } from "@/lib/api/client";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AD_DAILY_CAP = 5;
const AD_WATCHED_KEY = "ads_watched_today";
const AD_DATE_KEY = "ads_last_reset_date";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface RewardedAdButtonProps {
  onRewarded: (coins: number) => void;
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RewardedAdButton({ onRewarded, disabled }: RewardedAdButtonProps) {
  const currency = useCurrency();
  const [loading, setLoading] = useState(false);
  const [adsWatched, setAdsWatched] = useState(0);
  const pendingRef = useRef(false);

  useEffect(() => {
    try {
      // BUG-044 FIX: use ISO date (YYYY-MM-DD) instead of toDateString()
      // which is locale/timezone-dependent and differs across devices.
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const lastReset = storage.getString(AD_DATE_KEY);
      if (lastReset !== today) {
        storage.set(AD_DATE_KEY, today);
        storage.set(AD_WATCHED_KEY, 0);
      }
      const watched = storage.getNumber(AD_WATCHED_KEY) ?? 0;
      setAdsWatched(watched);
      if (watched < AD_DAILY_CAP) {
        void preloadAd();
      }
    } catch {
      // MMKV not yet initialised — daily cap defaults to 0, ad will still load
    }
  }, []);

  async function preloadAd() {
    try {
      await loadRewardedAd();
    } catch {
    }
  }

  async function handleWatchAd() {
    if (adsWatched >= AD_DAILY_CAP) {
      Alert.alert("Daily limit reached", "You've watched the maximum ads for today. Come back tomorrow!");
      return;
    }

    if (pendingRef.current) return;
    pendingRef.current = true;

    setLoading(true);
    try {
      const result = await showRewardedAd();

      if (result.rewarded) {
        // Credit coins server-side — retry up to 3 times so a transient network
        // hiccup doesn't silently drop the user's earned reward (BUG-PAY-01 FIX).
        const MAX_RETRIES = 3;
        let coinsAwarded = 10;
        let credited = false;
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          try {
            const response = await apiClient.post<{ data?: { coinsAwarded?: number } }>('/economy/rewards/ad-reward');
            coinsAwarded = response.data?.data?.coinsAwarded ?? 10;
            credited = true;
            break;
          } catch (retryErr) {
            if (attempt < MAX_RETRIES - 1) {
              await new Promise((res) => setTimeout(res, 1000 * Math.pow(2, attempt)));
            }
          }
        }
        if (!credited) {
          Alert.alert("Reward Error", "We couldn't credit your reward. Please contact support.");
          return;
        }
        const newWatched = adsWatched + 1;
        storage.set(AD_WATCHED_KEY, newWatched);
        setAdsWatched(newWatched);
        onRewarded(coinsAwarded);

        // Pre-load next ad
        if (newWatched < AD_DAILY_CAP) {
          void preloadAd();
        }
      }
    } catch {
      Alert.alert("Error", "Could not show ad. Please try again.");
    } finally {
      setLoading(false);
      pendingRef.current = false;
    }
  }

  const isDisabled = disabled || loading || adsWatched >= AD_DAILY_CAP;
  const remaining = AD_DAILY_CAP - adsWatched;

  return (
    <TouchableOpacity
      className={`flex-row items-center justify-center px-4 py-3 rounded-xl ${
        isDisabled ? "bg-gray-200" : "bg-blue-600"
      }`}
      onPress={handleWatchAd}
      disabled={isDisabled}
      accessibilityHint={adsWatched >= AD_DAILY_CAP ? undefined : `Watch a short ad to earn ${currency.softPlural}`}
    >
      {loading ? (
        <ActivityIndicator size="small" color="white" />
      ) : (
        <Text className={`text-sm font-semibold ${isDisabled ? "text-gray-400" : "text-white"}`}>
          {adsWatched >= AD_DAILY_CAP
            ? "Ad limit reached for today"
            : `Watch Ad for ${currency.softPlural} (${remaining} left)`}
        </Text>
      )}
    </TouchableOpacity>
  );
}

export default RewardedAdButton;
