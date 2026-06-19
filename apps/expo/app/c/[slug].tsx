/**
 * app/c/[slug].tsx
 *
 * Expo universal-link landing for public courses / classrooms (/c/<slug>).
 * Resolves the slug to the internal room id and forwards to the classroom.
 */

import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SlugRedirect } from '@/components/deeplink/SlugRedirect';

export default function PublicCourseLink() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { t } = useTranslation();

  return (
    <SlugRedirect
      type="course"
      identifier={slug ?? ''}
      toInternalPath={(id) => `/classroom/${id}`}
      notFoundLabel={t('deeplink.courseNotFound', 'This class is unavailable.')}
    />
  );
}
