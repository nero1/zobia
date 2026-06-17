import { createContext, useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { FloatingCurrencyNotification, type FloatingItem } from '@/components/ui/FloatingCurrencyNotification';
import { ConfettiOverlay } from '@/components/ui/ConfettiOverlay';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/hooks';
import { useRealtimeChannel } from '@/lib/realtime/useRealtimeChannel';

// ---------------------------------------------------------------------------
// Config
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
// Context
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
  /** Increments whenever quest progress or deck completion events arrive via realtime. */
  questUpdateKey: number;
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
  questUpdateKey: 0,
});

// ---------------------------------------------------------------------------
// Color schemes
// ---------------------------------------------------------------------------

const XP_COLORS    = { backgroundColor: '#10b981', textColor: '#ffffff' };
const CREDIT_COLORS = { backgroundColor: '#f59e0b', textColor: '#1a1a1a' };
const STAR_COLORS   = { backgroundColor: '#8b5cf6', textColor: '#ffffff' };
const REFERRAL_COLORS = { backgroundColor: '#3b82f6', textColor: '#ffffff' };
const QUEST_COLORS  = { backgroundColor: '#ef4444', textColor: '#ffffff' };
const GIFT_COLORS   = { backgroundColor: '#ec4899', textColor: '#ffffff' };

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface Props {
  children: React.ReactNode;
}

export function FloatingNotificationProvider({ children }: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [config, setConfig] = useState<FloatingNotifConfig>(DEFAULT_CONFIG);
  const [notifications, setNotifications] = useState<FloatingItem[]>([]);
  const [showConfetti, setShowConfetti] = useState(false);
  const [questUpdateKey, setQuestUpdateKey] = useState(0);
  const configRef = useRef(config);
  configRef.current = config;

  // Fetch config on mount
  useEffect(() => {
    apiClient
      .get<{ data: { floatingNotifications: FloatingNotifConfig } }>('/config/rewards-ui')
      .then((res) => {
        if (res.data?.data?.floatingNotifications) {
          setConfig(res.data.data.floatingNotifications);
        }
      })
      .catch(() => {});
  }, []);

  // ---------------------------------------------------------------------------
  // Core notification helpers (defined before the realtime handler)
  // ---------------------------------------------------------------------------

  const addNotification = useCallback((item: Omit<FloatingItem, 'id'>) => {
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

  // ---------------------------------------------------------------------------
  // Realtime: subscribe to user's personal channel for server-pushed events
  // ---------------------------------------------------------------------------

  const realtimeChannel = user?.id ? `user:${user.id}` : null;

  const handleRealtimeEvent = useCallback((event: string, data: unknown) => {
    if (event !== 'reward_earned') return;
    if (!configRef.current.enabled) return;

    const payload = data as {
      type: string;
      amount?: number;
      xpAmount?: number;
      coinAmount?: number;
    };

    switch (payload.type) {
      case 'referral':
        addNotification({
          label: t('floatingNotif.referralJoined', '+1 Referral'),
          ...REFERRAL_COLORS,
        });
        break;

      case 'xp':
        if ((payload.amount ?? 0) > 0) {
          addNotification({
            label: t('floatingNotif.xpEarned', { amount: payload.amount }),
            ...XP_COLORS,
          });
          maybeConfetti(payload.amount ?? 0, configRef.current.xpThreshold);
        }
        break;

      case 'credits':
        if ((payload.amount ?? 0) > 0) {
          addNotification({
            label: t('floatingNotif.creditsEarned', { amount: payload.amount, currency: 'Credits' }),
            ...CREDIT_COLORS,
          });
          maybeConfetti(payload.amount ?? 0, configRef.current.creditsThreshold);
        }
        break;

      case 'stars':
        if ((payload.amount ?? 0) > 0) {
          addNotification({
            label: t('floatingNotif.starsEarned', { amount: payload.amount, currency: 'Stars' }),
            ...STAR_COLORS,
          });
          maybeConfetti(payload.amount ?? 0, configRef.current.starsThreshold);
        }
        break;

      case 'quest_complete':
        if ((payload.xpAmount ?? 0) > 0) {
          addNotification({
            label: t('floatingNotif.xpEarned', { amount: payload.xpAmount }),
            ...XP_COLORS,
          });
          maybeConfetti(payload.xpAmount ?? 0, configRef.current.xpThreshold);
        }
        if ((payload.coinAmount ?? 0) > 0) {
          setTimeout(() => {
            addNotification({
              label: t('floatingNotif.creditsEarned', { amount: payload.coinAmount, currency: 'Credits' }),
              ...CREDIT_COLORS,
            });
          }, 400);
        }
        setQuestUpdateKey((k) => k + 1);
        break;

      case 'deck_complete':
        setShowConfetti(true);
        addNotification({
          label: t('floatingNotif.questsComplete', 'Daily Quests Complete! 🎉'),
          ...QUEST_COLORS,
        });
        if ((payload.xpAmount ?? 0) > 0) {
          setTimeout(() => {
            addNotification({
              label: t('floatingNotif.xpEarned', { amount: payload.xpAmount }),
              ...XP_COLORS,
            });
          }, 400);
        }
        setQuestUpdateKey((k) => k + 1);
        break;

      case 'gift':
        if ((payload.amount ?? 1) > 0) {
          addNotification({
            label: t('floatingNotif.giftReceived', { amount: payload.amount ?? 1 }),
            ...GIFT_COLORS,
          });
        }
        break;
    }
  }, [t, addNotification, maybeConfetti]);

  useRealtimeChannel(realtimeChannel, handleRealtimeEvent);

  // ---------------------------------------------------------------------------
  // Public fire functions
  // ---------------------------------------------------------------------------

  const fireXP = useCallback((amount: number) => {
    if (!configRef.current.enabled || amount <= 0) return;
    addNotification({
      label: t('floatingNotif.xpEarned', { amount }),
      ...XP_COLORS,
    });
    maybeConfetti(amount, configRef.current.xpThreshold);
  }, [t, addNotification, maybeConfetti]);

  const fireCredits = useCallback((amount: number, currencyName = 'Credits') => {
    if (!configRef.current.enabled || amount <= 0) return;
    addNotification({
      label: t('floatingNotif.creditsEarned', { amount, currency: currencyName }),
      ...CREDIT_COLORS,
    });
    maybeConfetti(amount, configRef.current.creditsThreshold);
  }, [t, addNotification, maybeConfetti]);

  const fireStars = useCallback((amount: number, currencyName = 'Stars') => {
    if (!configRef.current.enabled || amount <= 0) return;
    addNotification({
      label: t('floatingNotif.starsEarned', { amount, currency: currencyName }),
      ...STAR_COLORS,
    });
    maybeConfetti(amount, configRef.current.starsThreshold);
  }, [t, addNotification, maybeConfetti]);

  const fireReferral = useCallback(() => {
    if (!configRef.current.enabled) return;
    addNotification({
      label: t('floatingNotif.referralJoined', '+1 Referral'),
      ...REFERRAL_COLORS,
    });
  }, [t, addNotification]);

  const fireGift = useCallback((amount = 1) => {
    if (!configRef.current.enabled || amount <= 0) return;
    addNotification({
      label: t('floatingNotif.giftReceived', { amount }),
      ...GIFT_COLORS,
    });
  }, [t, addNotification]);

  const fireDeckComplete = useCallback((xpReward: number, coinReward: number, coinName = 'Credits') => {
    if (!configRef.current.enabled) return;
    setShowConfetti(true);
    addNotification({
      label: t('floatingNotif.questsComplete', 'Daily Quests Complete! 🎉'),
      ...QUEST_COLORS,
    });
    setTimeout(() => {
      if (xpReward > 0) {
        addNotification({
          label: t('floatingNotif.xpEarned', { amount: xpReward }),
          ...XP_COLORS,
        });
      }
    }, 400);
    setTimeout(() => {
      if (coinReward > 0) {
        addNotification({
          label: t('floatingNotif.creditsEarned', { amount: coinReward, currency: coinName }),
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

  return (
    <FloatingNotificationContext.Provider
      value={{
        fireXP,
        fireCredits,
        fireStars,
        fireReferral,
        fireGift,
        fireDeckComplete,
        fireConfetti,
        isEnabled: config.enabled,
        questUpdateKey,
      }}
    >
      {children}
      {notifications.map((item, index) => (
        <FloatingCurrencyNotification
          key={item.id}
          item={item}
          index={index}
          onDone={removeNotification}
        />
      ))}
      {showConfetti && (
        <ConfettiOverlay onDone={() => setShowConfetti(false)} />
      )}
    </FloatingNotificationContext.Provider>
  );
}
