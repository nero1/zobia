import { createContext, useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { FloatingCurrencyNotification, type FloatingItem } from '@/components/ui/FloatingCurrencyNotification';
import { ConfettiOverlay } from '@/components/ui/ConfettiOverlay';
import { apiClient } from '@/lib/api/client';

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
  const [config, setConfig] = useState<FloatingNotifConfig>(DEFAULT_CONFIG);
  const [notifications, setNotifications] = useState<FloatingItem[]>([]);
  const [showConfetti, setShowConfetti] = useState(false);
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
