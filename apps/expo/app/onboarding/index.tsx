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
  Platform,
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
import { apiClient } from '@/lib/api/client';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AVATAR_OPTIONS = [
  '🦁', '🐯', '🦊', '🐺', '🦝', '🐻', '🐼', '🦓',
  '🦅', '🦜', '🐬', '🦋', '🌟', '🔥', '⚡', '🌊',
  '🍀', '🌙', '☀️', '🎯', '🎸', '🎨', '🚀', '💎',
];

// ---------------------------------------------------------------------------
// Contacts helpers (expo-contacts — optional peer dep)
// ---------------------------------------------------------------------------

type ContactsModule = typeof import('expo-contacts');

/** Lazily require expo-contacts so the app still works without it. */
function getContacts(): ContactsModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('expo-contacts') as ContactsModule;
  } catch {
    return null;
  }
}

async function requestAndFetchContacts(): Promise<string[]> {
  const Contacts = getContacts();
  if (!Contacts) return [];

  const { status } = await Contacts.requestPermissionsAsync();
  if (status !== 'granted') throw new Error('permission_denied');

  const { data } = await Contacts.getContactsAsync({
    fields: [Contacts.Fields.PhoneNumbers],
  });

  const numbers: string[] = [];
  for (const contact of data) {
    for (const phone of contact.phoneNumbers ?? []) {
      if (phone.number) numbers.push(phone.number.replace(/\s+/g, ''));
    }
  }
  return numbers;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const DOB_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateUsername(value: string): string | undefined {
  if (!value.trim()) return 'Username is required';
  if (!USERNAME_RE.test(value))
    return 'Username must be 3–20 characters: letters, numbers, underscores only';
  return undefined;
}

const MINIMUM_AGE = 18;

function calculateAge(dob: string): number {
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

function validateDateOfBirth(value: string): string | undefined {
  if (!value.trim()) return 'Date of birth is required';
  if (!DOB_RE.test(value.trim())) return 'Please use YYYY-MM-DD format';
  const age = calculateAge(value.trim());
  if (age < MINIMUM_AGE) return `You must be at least ${MINIMUM_AGE} years old to join`;
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
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [dobError, setDobError] = useState<string | undefined>();

  // Contacts
  const [contactsStatus, setContactsStatus] = useState<'idle' | 'loading' | 'done' | 'denied' | 'unavailable'>('idle');

  const textColor = isDark ? colors.neutral[100] : colors.neutral[900];
  const subtitleColor = isDark ? colors.neutral[400] : colors.neutral[500];

  async function handleFindFriends() {
    if (!getContacts()) {
      setContactsStatus('unavailable');
      return;
    }
    setContactsStatus('loading');
    try {
      const numbers = await requestAndFetchContacts();
      if (numbers.length > 0) {
        // Fire-and-forget — we just want to notify the server
        apiClient
          .post('/api/friends/contacts-check', { phoneNumbers: numbers })
          .catch(() => {});
      }
      setContactsStatus('done');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '';
      if (msg === 'permission_denied') {
        setContactsStatus('denied');
      } else {
        setContactsStatus('unavailable');
      }
    }
  }

  function handleNext() {
    const usernameErr = validateUsername(username);
    if (usernameErr) {
      setUsernameError(usernameErr);
      return;
    }
    if (!city.trim()) {
      Alert.alert('City required', 'Please enter your city to continue.');
      return;
    }
    const dobErr = validateDateOfBirth(dateOfBirth);
    if (dobErr) {
      setDobError(dobErr);
      if (dobErr === 'Date of birth is required') {
        Alert.alert('Date of birth is required', 'Please enter your date of birth to continue.');
      } else {
        Alert.alert('Invalid date format', 'Please use YYYY-MM-DD format');
      }
      return;
    }
    // Navigate to step 2, passing profile data via query params.
    router.push({
      pathname: '/onboarding/vibe-quiz',
      params: {
        username: username.trim(),
        emoji: selectedEmoji,
        city: city.trim(),
        dateOfBirth: dateOfBirth.trim(),
      },
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

      {/* Date of Birth input */}
      <View style={styles.section}>
        <Input
          label="Date of Birth"
          placeholder="YYYY-MM-DD"
          value={dateOfBirth}
          onChangeText={(v) => {
            setDateOfBirth(v);
            if (dobError) setDobError(undefined);
          }}
          error={dobError}
          keyboardType="numeric"
          maxLength={10}
          autoCorrect={false}
          accessibilityLabel="Date of birth in YYYY-MM-DD format"
        />
      </View>

      {/* Find Friends from Contacts (Step 4 / additional) */}
      <View style={styles.section}>
        <Text style={[styles.sectionLabel, { color: textColor }]}>
          Find friends on Zobia
        </Text>
        <Text style={[styles.subtitle, { color: subtitleColor }]}>
          We'll check which of your contacts are already on Zobia — no data is stored.
        </Text>

        {Platform.OS === 'web' ? null : contactsStatus === 'idle' ? (
          <Button
            label="Find Friends from Contacts"
            variant="secondary"
            onPress={() => void handleFindFriends()}
          />
        ) : contactsStatus === 'loading' ? (
          <Button label="Checking contacts…" variant="secondary" onPress={() => {}} loading />
        ) : contactsStatus === 'done' ? (
          <View style={styles.contactsDone}>
            <Text style={{ color: colors.semantic.success, fontWeight: '600' }}>
              ✓ Contacts imported! You can add friends from their profiles.
            </Text>
          </View>
        ) : contactsStatus === 'denied' ? (
          <Text style={[styles.subtitle, { color: subtitleColor }]}>
            You can add friends manually from their profiles.
          </Text>
        ) : (
          <Text style={[styles.subtitle, { color: subtitleColor }]}>
            Contacts access is not available on this device. You can add friends manually from their profiles.
          </Text>
        )}
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
  contactsDone: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: `${colors.semantic.success}14`,
  },
});
