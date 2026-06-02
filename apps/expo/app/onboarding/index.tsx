/**
 * Zobia Social — Onboarding Step 1.
 *
 * Collects:
 *  1. Username (validated: 3–20 chars, alphanumeric + underscore)
 *  2. Avatar emoji (picker from a curated list)
 *  3. City (free-text)
 *
 * On completion navigates to the Vibe Quiz (step 2).
 */

import React, { useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Screen } from '@/components/ui/Screen';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useTheme } from '@/lib/theme';
import { colors } from '@/lib/theme/colors';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AVATAR_OPTIONS = [
  '🦁', '🐯', '🦊', '🐺', '🦝', '🐻', '🐼', '🦓',
  '🦅', '🦜', '🐬', '🦋', '🌟', '🔥', '⚡', '🌊',
  '🍀', '🌙', '☀️', '🎯', '🎸', '🎨', '🚀', '💎',
];

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

function validateUsername(value: string): string | undefined {
  if (!value.trim()) return 'Username is required';
  if (!USERNAME_RE.test(value))
    return 'Username must be 3–20 characters: letters, numbers, underscores only';
  return undefined;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * OnboardingStep1 — username, avatar emoji, city.
 */
export default function OnboardingStep1() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const router = useRouter();

  const [username, setUsername] = useState('');
  const [usernameError, setUsernameError] = useState<string | undefined>();
  const [selectedEmoji, setSelectedEmoji] = useState(AVATAR_OPTIONS[0]);
  const [city, setCity] = useState('');

  const textColor = isDark ? colors.neutral[100] : colors.neutral[900];
  const subtitleColor = isDark ? colors.neutral[400] : colors.neutral[500];

  function handleNext() {
    const err = validateUsername(username);
    if (err) {
      setUsernameError(err);
      return;
    }
    if (!city.trim()) {
      Alert.alert('City required', 'Please enter your city to continue.');
      return;
    }
    // Navigate to step 2, passing profile data via query params.
    router.push({
      pathname: '/onboarding/vibe-quiz',
      params: { username: username.trim(), emoji: selectedEmoji, city: city.trim() },
    });
  }

  return (
    <Screen scrollable contentStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.stepBadge, { color: colors.brand.blue }]}>Step 1 of 3</Text>
        <Text style={[styles.title, { color: textColor }]}>
          {t('onboarding.step1Title')}
        </Text>
        <Text style={[styles.subtitle, { color: subtitleColor }]}>
          {t('onboarding.step1Subtitle')}
        </Text>
      </View>

      {/* Username input */}
      <View style={styles.section}>
        <Input
          label={t('onboarding.usernameLabel')}
          placeholder={t('onboarding.usernamePlaceholder')}
          value={username}
          onChangeText={(v) => {
            setUsername(v);
            if (usernameError) setUsernameError(undefined);
          }}
          error={usernameError}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={20}
        />
      </View>

      {/* Avatar emoji picker */}
      <View style={styles.section}>
        <Text style={[styles.sectionLabel, { color: textColor }]}>
          {t('onboarding.avatarLabel')}
        </Text>
        <FlatList
          data={AVATAR_OPTIONS}
          keyExtractor={(item) => item}
          numColumns={6}
          scrollEnabled={false}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => setSelectedEmoji(item)}
              style={[
                styles.emojiCell,
                selectedEmoji === item && {
                  backgroundColor: colors.brand.blue + '22',
                  borderColor: colors.brand.blue,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Select avatar ${item}`}
              accessibilityState={{ selected: selectedEmoji === item }}
            >
              <Text style={styles.emoji}>{item}</Text>
            </Pressable>
          )}
          contentContainerStyle={styles.emojiGrid}
        />
      </View>

      {/* City input */}
      <View style={styles.section}>
        <Input
          label={t('onboarding.cityLabel')}
          placeholder={t('onboarding.cityPlaceholder')}
          value={city}
          onChangeText={setCity}
          autoCorrect={false}
        />
      </View>

      {/* CTA */}
      <Button
        label={t('common.next')}
        size="lg"
        onPress={handleNext}
        style={styles.cta}
      />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 32,
    gap: 24,
  },
  header: {
    gap: 6,
  },
  stepBadge: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
  },
  section: {
    gap: 8,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  emojiGrid: {
    gap: 8,
  },
  emojiCell: {
    flex: 1,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: 'transparent',
    margin: 3,
    minHeight: 44,
    minWidth: 44,
  },
  emoji: {
    fontSize: 24,
  },
  cta: {
    marginTop: 8,
  },
});
