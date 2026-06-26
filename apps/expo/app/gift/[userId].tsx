/**
 * app/gift/[userId].tsx
 *
 * Deep-link target for zobia://gift/:userId
 * Redirects to the gift-send screen with the recipientId pre-filled.
 */

import { useEffect } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";

export default function GiftDeepLinkScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const router = useRouter();

  useEffect(() => {
    if (userId) {
      router.replace({ pathname: "/economy/gift-send", params: { recipientId: userId } });
    } else {
      router.replace("/");
    }
  }, [userId, router]);

  return null;
}
export { ErrorBoundary } from '@/components/ui/ScreenErrorBoundary';
