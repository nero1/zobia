/**
 * app/u/[username].tsx
 *
 * Expo universal-link landing for public profiles (/u/<username>). Resolves the
 * username to the internal user id and forwards to the in-app profile screen.
 */

import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SlugRedirect } from '@/components/deeplink/SlugRedirect';

export default function PublicProfileLink() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const { t } = useTranslation();

  return (
    <SlugRedirect
      type="profile"
      identifier={username ?? ''}
      toInternalPath={(id) => `/profile/${id}`}
      notFoundLabel={t('deeplink.profileNotFound', 'This profile is unavailable.')}
    />
  );
}
