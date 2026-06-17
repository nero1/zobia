"use client";

import { createContext, useState, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { FloatingCurrencyNotification, type FloatingItem } from "@/components/ui/FloatingCurrencyNotification";
import { ConfettiCanvas } from "@/components/ui/ConfettiCanvas";
import { useRealtimeChannel } from "@/lib/realtime/useRealtimeChannel";

// ---------------------------------------------------------------------------
// Config type (from GET /api/config/rewards-ui)
// ---------------------------------------------------------------------------

interface FloatingNotifConfig {
  enabled: boolean;
  xpThreshold: number;
  creditsThreshold: number;
  starsThreshold: number;
}

const DEFAULT_CONFIG: FloatingNotifConfig = {
  enabled: true,
  xpThreshold: 100,
  creditsThreshold: 50,
  starsThreshold: 10,
};

// ---------------------------------------------------------------------------
// Context value
// ---------------------------------------------------------------------------

export interface FloatingNotificationContextValue {
  fireXP: (amount: number) => void;
  fireCredits: (amount: number, currencyName?: string) => void;
  fireStars: (amount: number, currencyName?: string) => void;
  fireReferral: () => void;
  fireGift: (amount?: number) => void;
  fireDeckComplete: (xpReward: number, coinReward: number, coinName?: string) => void;
  fireConfetti: () => void;
  isEnabled: boolean;
}

export const FloatingNotificationContext = createContext<FloatingNotificationContextValue>({
  fireXP: () => {},
  fireCredits: () => {},
  fireStars: () => {},
  fireReferral: () => {},
  fireGift: () => {},
  fireDeckComplete: () => {},
  fireConfetti: () => {},
  isEnabled: false,
});

// ---------------------------------------------------------------------------
// Color schemes per currency type
// ---------------------------------------------------------------------------

const XP_COLORS    = { colorClass: "bg-emerald-500/90", textClass: "text-white" };
const CREDIT_COLORS = { colorClass: "bg-amber-400/90",  textClass: "text-neutral-900" };
const STAR_COLORS   = { colorClass: "bg-violet-500/90", textClass: "text-white" };
const REFERRAL_COLORS = { colorClass: "bg-blue-500/90", textClass: "text-white" };
const QUEST_COLORS  = { colorClass: "bg-rose-500/90",   textClass: "text-white" };
const GIFT_COLORS   = { colorClass: "bg-pink-500/90",   textClass: "text-white" };

// ---------------------------------------------------------------------------
// Helper: read userId from the access-token cookie (client-side, no verify)
// ---------------------------------------------------------------------------

function getUserIdFromCookie(): string | null {
  try {
    const cookieStr = document.cookie;
    const match = cookieStr.match(/zobia_at=([^;]+)/);
    if (!match) return null;
    const parts = match[1].split(".");
    if (parts.length < 2) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface Props {
  children: React.ReactNode;
}

export function FloatingNotificationProvider({ children }: Props) {
  const { t } = useTranslation();
  const [config, setConfig] = useState<FloatingNotifConfig>(DEFAULT_CONFIG);
  const [notifications, setNotifications] = useState<FloatingItem[]>([]);
  const [showConfetti, setShowConfetti] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const configRef = useRef(config);
  configRef.current = config;

  // Get userId on mount (client-side)
  useEffect(() => {
    setUserId(getUserIdFromCookie());
  }, []);

  // Fetch config from server
  useEffect(() => {
    fetch("/api/config/rewards-ui")
      .then((r) => r.json())
      .then((body) => {
        if (body?.data?.floatingNotifications) {
          setConfig(body.data.floatingNotifications);
        }
      })
      .catch(() => {});
  }, []);

  // Realtime: subscribe to user's personal channel for server-pushed reward events
  const realtimeChannel = userId ? `user:${userId}` : null;

  const handleRealtimeEvent = useCallback((event: string, data: unknown) => {
    if (event !== "reward_earned") return;
    const payload = data as { type: string; amount: number };
    if (!configRef.current.enabled) return;

    if (payload.type === "referral") {
      setNotifications((prev) => [
        ...prev.slice(-4), // max 5 concurrent
        {
          id: `${Date.now()}-referral`,
          label: t("floatingNotif.referralJoined", "+1 Referral"),
          ...REFERRAL_COLORS,
        },
      ]);
    }
  }, [t]);

  useRealtimeChannel(realtimeChannel, handleRealtimeEvent);

  // ---------------------------------------------------------------------------
  // Public fire functions
  // ---------------------------------------------------------------------------

  const addNotification = useCallback((item: Omit<FloatingItem, "id">) => {
    setNotifications((prev) => [
      ...prev.slice(-4),
      { ...item, id: `${Date.now()}-${Math.random().toString(36).slice(2)}` },
    ]);
  }, []);

  const maybeConfetti = useCallback((amount: number, threshold: number) => {
    if (amount >= threshold) {
      setShowConfetti(true);
    }
  }, []);

  const fireXP = useCallback((amount: number) => {
    if (!configRef.current.enabled || amount <= 0) return;
    addNotification({
      label: t("floatingNotif.xpEarned", { amount }),
      ...XP_COLORS,
    });
    maybeConfetti(amount, configRef.current.xpThreshold);
  }, [t, addNotification, maybeConfetti]);

  const fireCredits = useCallback((amount: number, currencyName = "Credits") => {
    if (!configRef.current.enabled || amount <= 0) return;
    addNotification({
      label: t("floatingNotif.creditsEarned", { amount, currency: currencyName }),
      ...CREDIT_COLORS,
    });
    maybeConfetti(amount, configRef.current.creditsThreshold);
  }, [t, addNotification, maybeConfetti]);

  const fireStars = useCallback((amount: number, currencyName = "Stars") => {
    if (!configRef.current.enabled || amount <= 0) return;
    addNotification({
      label: t("floatingNotif.starsEarned", { amount, currency: currencyName }),
      ...STAR_COLORS,
    });
    maybeConfetti(amount, configRef.current.starsThreshold);
  }, [t, addNotification, maybeConfetti]);

  const fireReferral = useCallback(() => {
    if (!configRef.current.enabled) return;
    addNotification({
      label: t("floatingNotif.referralJoined", "+1 Referral"),
      ...REFERRAL_COLORS,
    });
  }, [t, addNotification]);

  const fireGift = useCallback((amount = 1) => {
    if (!configRef.current.enabled || amount <= 0) return;
    addNotification({
      label: t("floatingNotif.giftReceived", { amount }),
      ...GIFT_COLORS,
    });
  }, [t, addNotification]);

  const fireDeckComplete = useCallback((xpReward: number, coinReward: number, coinName = "Credits") => {
    if (!configRef.current.enabled) return;
    // Show confetti for deck completion always
    setShowConfetti(true);
    // Show "Quests Complete!" banner first
    addNotification({
      label: t("floatingNotif.questsComplete", "Daily Quests Complete! 🎉"),
      ...QUEST_COLORS,
    });
    // Then after a short delay, show the individual rewards
    setTimeout(() => {
      if (xpReward > 0) {
        addNotification({
          label: t("floatingNotif.xpEarned", { amount: xpReward }),
          ...XP_COLORS,
        });
      }
    }, 400);
    setTimeout(() => {
      if (coinReward > 0) {
        addNotification({
          label: t("floatingNotif.creditsEarned", { amount: coinReward, currency: coinName }),
          ...CREDIT_COLORS,
        });
      }
    }, 800);
  }, [t, addNotification]);

  const fireConfetti = useCallback(() => {
    setShowConfetti(true);
  }, []);

  const removeNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const contextValue: FloatingNotificationContextValue = {
    fireXP,
    fireCredits,
    fireStars,
    fireReferral,
    fireGift,
    fireDeckComplete,
    fireConfetti,
    isEnabled: config.enabled,
  };

  return (
    <FloatingNotificationContext.Provider value={contextValue}>
      {children}
      {/* Render active floating notifications */}
      {notifications.map((item, index) => (
        <FloatingCurrencyNotification
          key={item.id}
          item={item}
          index={index}
          onDone={removeNotification}
        />
      ))}
      {/* Confetti overlay */}
      {showConfetti && (
        <ConfettiCanvas onDone={() => setShowConfetti(false)} />
      )}
    </FloatingNotificationContext.Provider>
  );
}
