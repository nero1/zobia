/**
 * app/guilds/index.tsx
 *
 * Deep-link target for zobia://guilds
 * Redirects to the guild-discovery screen.
 */

import { useEffect } from "react";
import { useRouter } from "expo-router";

export default function GuildsIndexScreen() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/guild-discovery");
  }, [router]);
  return null;
}
export { ErrorBoundary } from '@/components/ui/ScreenErrorBoundary';
