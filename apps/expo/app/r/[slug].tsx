/**
 * app/r/[slug].tsx
 *
 * Expo universal-link landing for public rooms (/r/<slug>). Resolves the slug
 * (or legacy UUID) to the internal room id and forwards to the in-app room.
 */

import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SlugRedirect } from '@/components/deeplink/SlugRedirect';

export default function PublicRoomLink() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { t } = useTranslation();

  return (
    <SlugRedirect
      type="room"
      identifier={slug ?? ''}
      toInternalPath={(id) => `/rooms/${id}`}
      notFoundLabel={t('deeplink.roomNotFound', 'This room is unavailable.')}
    />
  );
}
export { ErrorBoundary } from '@/components/ui/ScreenErrorBoundary';
