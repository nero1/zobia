/**
 * Zobia Social — Onboarding Step 4: First Contact (PRD §4)
 *
 * Prompts the user to:
 *  1. Invite contacts from their phonebook (only those already on Zobia are surfaced)
 *  2. Explore a curated "First Room" tailored to quiz responses
 *  3. Accept the New Member Quest (5-step guided mission)
 *
 * Navigates to /(tabs) when "Get Started" is tapped.
 */

import React, { useEffect, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as Contacts from 'expo-contacts';

import { Screen } from '@/components/ui/Screen';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { useTheme } from '@/lib/theme';
import { colors } from '@/lib/theme/colors';
import { apiClient } from '@/lib/api/client';
import { useCurrency } from '@/lib/hooks/useCurrency';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ZobiaContact {
  userId: string;
  username: string;
  displayName: string;
  avatarEmoji: string;
}

interface SuggestedRoom {
  id: string;
  title: string;
  type: string;
  participantCount: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function FirstContactScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const currency = useCurrency();

  const [loading, setLoading] = useState(false);
  const [zobiaContacts, setZobiaContacts] = useState<ZobiaContact[]>([]);
  const [contactsLoaded, setContactsLoaded] = useState(false);
  const [suggestedRoom, setSuggestedRoom] = useState<SuggestedRoom | null>(null);
  const [invitedIds, setInvitedIds] = useState<Set<string>>(new Set());
  const [questAccepted, setQuestAccepted] = useState(false);

  const textColor = isDark ? colors.neutral[50] : colors.neutral[900];
  const subTextColor = isDark ? colors.neutral[400] : colors.neutral[500];
  const cardBg = isDark ? colors.neutral[900] : '#fff';
  const borderColor = isDark ? colors.neutral[800] : colors.neutral[200];

  // Fetch suggested first room
  useEffect(() => {
    apiClient
      .get<{ data?: { rooms?: SuggestedRoom[] } }>('/rooms?type=free_open&limit=1')
      .then((res) => {
        const rooms = res.data?.data?.rooms ?? [];
        if (rooms[0]) setSuggestedRoom(rooms[0]);
      })
      .catch(() => {});
  }, []);

  // Load contacts from phonebook and match against Zobia users
  async function loadContacts() {
    setLoading(true);
    try {
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== 'granted') return;

      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.PhoneNumbers],
      });

      const phoneNumbers = data
        .flatMap((c) => c.phoneNumbers ?? [])
        .map((p) => p.number?.replace(/\s+/g, '') ?? '')
        .filter(Boolean);

      if (phoneNumbers.length === 0) return;

      const res = await apiClient.post<{ data?: { contacts?: ZobiaContact[] } }>(
        '/users/contact-match',
        { phoneNumbers: phoneNumbers.slice(0, 200) }
      );
      setZobiaContacts(res.data?.data?.contacts ?? []);
    } catch {
      // Non-fatal
    } finally {
      setLoading(false);
      setContactsLoaded(true);
    }
  }

  async function handleInvite(userId: string) {
    if (invitedIds.has(userId)) return;
    try {
      await apiClient.post('/friends/request', { targetUserId: userId });
      setInvitedIds((prev) => new Set([...prev, userId]));
    } catch {
      // Non-fatal
    }
  }

  async function handleAcceptQuest() {
    try {
      await apiClient.get('/quests/new-member');
      setQuestAccepted(true);
    } catch {
      setQuestAccepted(true);
    }
  }

  function handleGetStarted() {
    router.replace('/(tabs)');
  }

  return (
    <Screen>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={[styles.emoji]}>👋</Text>
          <Text style={[styles.title, { color: textColor }]}>
            {t('onboarding.firstContact.title', 'Meet Your Crew')}
          </Text>
          <Text style={[styles.subtitle, { color: subTextColor }]}>
            {t(
              'onboarding.firstContact.subtitle',
              'Connect with people you already know on Zobia.'
            )}
          </Text>
        </View>

        {/* Contacts section */}
        <View style={[styles.card, { backgroundColor: cardBg, borderColor }]}>
          <Text style={[styles.cardTitle, { color: textColor }]}>
            📱 {t('onboarding.firstContact.phonebook', 'People you know')}
          </Text>

          {!contactsLoaded ? (
            <Pressable onPress={loadContacts} style={styles.findButton}>
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.findButtonText}>
                  {t('onboarding.firstContact.findContacts', 'Find contacts on Zobia')}
                </Text>
              )}
            </Pressable>
          ) : zobiaContacts.length === 0 ? (
            <Text style={[styles.emptyText, { color: subTextColor }]}>
              {t('onboarding.firstContact.noContacts', 'None of your contacts are on Zobia yet — invite them later!')}
            </Text>
          ) : (
            <FlatList
              data={zobiaContacts.slice(0, 5)}
              keyExtractor={(c) => c.userId}
              scrollEnabled={false}
              renderItem={({ item }) => (
                <View style={styles.contactRow}>
                  <Avatar emoji={item.avatarEmoji} size="sm" />
                  <View style={styles.contactInfo}>
                    <Text style={[styles.contactName, { color: textColor }]}>{item.displayName}</Text>
                    <Text style={[styles.contactUsername, { color: subTextColor }]}>@{item.username}</Text>
                  </View>
                  <Pressable
                    onPress={() => void handleInvite(item.userId)}
                    style={[
                      styles.inviteBtn,
                      invitedIds.has(item.userId) && styles.inviteBtnDone,
                    ]}
                  >
                    <Text style={styles.inviteBtnText}>
                      {invitedIds.has(item.userId) ? '✓' : t('onboarding.firstContact.add', 'Add')}
                    </Text>
                  </Pressable>
                </View>
              )}
            />
          )}
        </View>

        {/* Suggested room */}
        {suggestedRoom && (
          <View style={[styles.card, { backgroundColor: cardBg, borderColor }]}>
            <Text style={[styles.cardTitle, { color: textColor }]}>
              🚪 {t('onboarding.firstContact.firstRoom', 'Your first room')}
            </Text>
            <Text style={[styles.roomTitle, { color: textColor }]}>{suggestedRoom.title}</Text>
            <Text style={[styles.roomMeta, { color: subTextColor }]}>
              {suggestedRoom.participantCount} active now
            </Text>
          </View>
        )}

        {/* New Member Quest */}
        <View style={[styles.card, { backgroundColor: cardBg, borderColor }]}>
          <Text style={[styles.cardTitle, { color: textColor }]}>
            🎯 {t('onboarding.firstContact.quest', 'New Member Quest')}
          </Text>
          <Text style={[styles.questDesc, { color: subTextColor }]}>
            {t(
              'onboarding.firstContact.questDesc',
              `Complete 5 missions to earn 1,000 ${currency.softPlural} + 2,000 XP. You can complete most right now!`
            )}
          </Text>
          {!questAccepted ? (
            <Pressable onPress={() => void handleAcceptQuest()} style={styles.questBtn}>
              <Text style={styles.questBtnText}>
                {t('onboarding.firstContact.acceptQuest', 'Accept Quest')}
              </Text>
            </Pressable>
          ) : (
            <View style={styles.questAccepted}>
              <Text style={styles.questAcceptedText}>✓ {t('onboarding.firstContact.questAccepted', 'Quest accepted! Find it in your Quests tab.')}</Text>
            </View>
          )}
        </View>

        {/* CTA */}
        <View style={styles.cta}>
          <Button
            label={t('onboarding.firstContact.cta', "Let's go →")}
            onPress={handleGetStarted}
            variant="primary"
          />
        </View>
      </View>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 32,
    paddingBottom: 24,
    gap: 16,
  },
  header: {
    alignItems: 'center',
    marginBottom: 8,
  },
  emoji: {
    fontSize: 48,
    marginBottom: 8,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  findButton: {
    backgroundColor: colors.brand.blue,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  findButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  emptyText: {
    fontSize: 13,
    lineHeight: 20,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 4,
  },
  contactInfo: {
    flex: 1,
  },
  contactName: {
    fontSize: 14,
    fontWeight: '600',
  },
  contactUsername: {
    fontSize: 12,
  },
  inviteBtn: {
    backgroundColor: colors.brand.blue,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  inviteBtnDone: {
    backgroundColor: colors.semantic.success,
  },
  inviteBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  roomTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  roomMeta: {
    fontSize: 12,
  },
  questDesc: {
    fontSize: 13,
    lineHeight: 20,
  },
  questBtn: {
    backgroundColor: colors.brand.blue,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  questBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  questAccepted: {
    backgroundColor: 'rgba(20,184,166,0.12)',
    borderRadius: 10,
    padding: 10,
    alignItems: 'center',
  },
  questAcceptedText: {
    color: colors.semantic.success,
    fontWeight: '600',
    fontSize: 13,
  },
  cta: {
    marginTop: 8,
  },
});
