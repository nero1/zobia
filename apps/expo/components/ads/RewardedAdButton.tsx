"use client";

import React, { useState, useEffect } from "react";
import { TouchableOpacity, Text, ActivityIndicator, Alert } from "react-native";
import { loadRewardedAd, showRewardedAd, isRewardedAdLoaded } from "@/lib/ads/admob";
import { storage } from "@/lib/offline/store";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AD_DAILY_CAP = 5;
const AD_WATCHED_KEY = "ads_watched_today";
const AD_DATE_KEY = "ads_last_reset_date";
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "";

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
  const [loading, setLoading] = useState(false);
  const [adReady, setAdReady] = useState(false);
  const [adsWatched, setAdsWatched] = useState(0);

  useEffect(() => {
    // Reset daily counter if date has changed
    const today = new Date().toDateString();
    const lastReset = storage.getString(AD_DATE_KEY);
    if (lastReset !== today) {
      storage.set(AD_DATE_KEY, today);
      storage.set(AD_WATCHED_KEY, 0);
    }

    const watched = storage.getNumber(AD_WATCHED_KEY) ?? 0;
    setAdsWatched(watched);

    // Pre-load ad if quota not exhausted
    if (watched < AD_DAILY_CAP) {
      void preloadAd();
    }
  }, []);

  async function preloadAd() {
    try {
      await loadRewardedAd();
      setAdReady(true);
    } catch {
      setAdReady(false);
    }
  }

  async function handleWatchAd() {
    if (adsWatched >= AD_DAILY_CAP) {
      Alert.alert("Daily limit reached", "You've watched the maximum ads for today. Come back tomorrow!");
      return;
    }

    setLoading(true);
    try {
      const result = await showRewardedAd();

      if (result.rewarded) {
        // Credit coins server-side
        const token = storage.getString("authToken");
        const response = await fetch(`${API_BASE_URL}/api/economy/rewards/ad-reward`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });

        if (response.ok) {
          const json = await response.json() as { data?: { coinsAwarded?: number } };
          const coinsAwarded = json?.data?.coinsAwarded ?? 10;
          const newWatched = adsWatched + 1;
          storage.set(AD_WATCHED_KEY, newWatched);
          setAdsWatched(newWatched);
          onRewarded(coinsAwarded);

          // Pre-load next ad
          if (newWatched < AD_DAILY_CAP) {
            void preloadAd();
          }
        }
      }
    } catch (err) {
      Alert.alert("Error", "Could not show ad. Please try again.");
    } finally {
      setLoading(false);
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
    >
      {loading ? (
        <ActivityIndicator size="small" color="white" />
      ) : (
        <Text className={`text-sm font-semibold ${isDisabled ? "text-gray-400" : "text-white"}`}>
          {adsWatched >= AD_DAILY_CAP
            ? "Ad limit reached for today"
            : `Watch Ad for Coins (${remaining} left)`}
        </Text>
      )}
    </TouchableOpacity>
  );
}

export default RewardedAdButton;
