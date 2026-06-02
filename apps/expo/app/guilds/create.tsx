/**
 * app/guilds/create.tsx
 *
 * Create guild screen.
 *
 * Features:
 *  - Name field with availability check
 *  - Crest emoji picker
 *  - Description (max 150 chars), city, recruitment type
 *  - Preview card
 *  - Shows 500 Coin cost with balance check
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Screen } from '@/components/ui/Screen';
import { Button } from '@/components/ui/Button';
import { useTheme } from '@/lib/theme';
import { colors } from '@/lib/theme/colors';
import { apiClient } from '@/lib/api/client';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GUILD_COST = 500;

const CREST_EMOJIS = [
  '🦁', '🐉', '🦅', '🐺', '🦊', '🐯', '🦋', '🌊',
  '⚔️', '🛡️', '👑', '🏆', '🌟', '🔥', '⚡', '🌙',
  '🦄', '🐉', '🧙', '🗡️', '🏰', '🌈', '🎯', '💎',
];

type RecruitmentType = 'open' | 'invite_only' | 'application';

interface RecruitmentOption {
  type: RecruitmentType;
  label: string;
  description: string;
}

const RECRUITMENT_OPTIONS: RecruitmentOption[] = [
  { type: 'open', label: 'Open', description: 'Anyone can join instantly' },
  { type: 'invite_only', label: 'Invite Only', description: 'Members must be invited by an officer' },
  { type: 'application', label: 'Application', description: 'Members apply and are reviewed' },
];

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function checkNameAvailability(name: string): Promise<{ available: boolean }> {
  const { data } = await apiClient.get('/guilds/check-name', { params: { name } });
  return data;
}

async function fetchWalletBalance(): Promise<{ coins: number }> {
  const { data } = await apiClient.get('/economy/wallet');
  return { coins: data.coinBalance ?? 0 };
}

async function createGuild(payload: {
  name: string;
  crestEmoji: string;
  description: string;
  city: string;
  recruitmentType: RecruitmentType;
}): Promise<{ guild: { id: string } }> {
  const { data } = await apiClient.post('/guilds', payload);
  return data;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface EmojiPickerProps {
  selected: string;
  onSelect: (emoji: string) => void;
}

function EmojiPicker({ selected, onSelect }: EmojiPickerProps) {
  return (
    <View style={styles.emojiGrid}>
      {CREST_EMOJIS.map((emoji) => (
        <Pressable
          key={emoji}
          onPress={() => onSelect(emoji)}
          style={[
            styles.emojiCell,
            emoji === selected && styles.emojiCellSelected,
          ]}
          accessibilityRole="radio"
          accessibilityState={{ selected: emoji === selected }}
          accessibilityLabel={`Select ${emoji} as crest`}
        >
          <Text style={styles.emojiCellText}>{emoji}</Text>
        </Pressable>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

/**
 * CreateGuildScreen — guild creation with emoji picker and 500-coin cost check.
 */
export default function CreateGuildScreen() {
  const router = useRouter();
  const { colors: themeColors, isDark } = useTheme();

  const [name, setName] = useState('');
  const [crest, setCrest] = useState('🦁');
  const [description, setDescription] = useState('');
  const [city, setCity] = useState('');
  const [recruitment, setRecruitment] = useState<RecruitmentType>('open');
  const [nameStatus, setNameStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const [showPreview, setShowPreview] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Wallet balance
  const { data: wallet } = useQuery({
    queryKey: ['wallet-balance'],
    queryFn: fetchWalletBalance,
  });

  const canAfford = (wallet?.coins ?? 0) >= GUILD_COST;

  // Name availability debounce
  useEffect(() => {
    if (name.trim().length < 3) {
      setNameStatus('idle');
      return;
    }
    setNameStatus('checking');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const result = await checkNameAvailability(name.trim());
        setNameStatus(result.available ? 'available' : 'taken');
      } catch {
        setNameStatus('idle');
      }
    }, 600);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [name]);

  const createMutation = useMutation({
    mutationFn: createGuild,
    onSuccess: (data) => {
      router.replace(`/guilds/${data.guild.id}`);
    },
    onError: () => Alert.alert('Error', 'Could not create guild. Please try again.'),
  });

  const handleCreate = () => {
    if (!name.trim()) {
      Alert.alert('Validation', 'Guild name is required.');
      return;
    }
    if (nameStatus === 'taken') {
      Alert.alert('Name Taken', 'Please choose a different guild name.');
      return;
    }
    if (!canAfford) {
      Alert.alert(
        'Insufficient Coins',
        `You need ${GUILD_COST} coins to create a guild. You currently have ${wallet?.coins ?? 0} coins.`,
      );
      return;
    }
    createMutation.mutate({
      name: name.trim(),
      crestEmoji: crest,
      description: description.trim(),
      city: city.trim(),
      recruitmentType: recruitment,
    });
  };

  const fieldStyle = {
    backgroundColor: isDark ? colors.neutral[800] : colors.neutral[100],
    color: themeColors.text,
  };

  const nameStatusColor =
    nameStatus === 'available'
      ? colors.semantic.success
      : nameStatus === 'taken'
      ? colors.semantic.error
      : colors.neutral[400];

  const nameStatusLabel =
    nameStatus === 'available'
      ? '✓ Available'
      : nameStatus === 'taken'
      ? '✕ Name taken'
      : nameStatus === 'checking'
      ? 'Checking…'
      : '';

  return (
    <Screen scrollable contentStyle={styles.content}>
      <Text style={[styles.heading, { color: themeColors.text }]}>Create a Guild</Text>

      {/* Cost notice */}
      <View
        style={[
          styles.costBanner,
          { backgroundColor: canAfford ? `${colors.brand.gold}18` : `${colors.semantic.error}18` },
        ]}
      >
        <Text style={styles.costBannerText}>
          🪙 Creating a guild costs {GUILD_COST} coins.
        </Text>
        <Text
          style={[
            styles.balanceText,
            { color: canAfford ? colors.brand.goldDark : colors.semantic.error },
          ]}
        >
          Your balance: {wallet?.coins?.toLocaleString() ?? '…'} coins
          {canAfford ? ' ✓' : ' — insufficient'}
        </Text>
      </View>

      {/* Crest picker */}
      <Text style={[styles.sectionTitle, { color: themeColors.text }]}>Guild Crest</Text>
      <View style={[styles.crestPreviewRow]}>
        <View style={styles.crestPreviewCircle}>
          <Text style={styles.crestPreviewEmoji}>{crest}</Text>
        </View>
        <Text style={[styles.crestHint, { color: themeColors.textMuted }]}>
          Pick an emoji to represent your guild
        </Text>
      </View>
      <EmojiPicker selected={crest} onSelect={setCrest} />

      {/* Name */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: themeColors.text }]}>Guild Name</Text>
        <View>
          <TextInput
            style={[styles.field, fieldStyle, nameStatus === 'taken' && styles.fieldError]}
            placeholder="Guild name (min 3 characters)"
            placeholderTextColor={themeColors.textMuted}
            value={name}
            onChangeText={setName}
            maxLength={40}
            autoCapitalize="words"
          />
          {nameStatusLabel !== '' && (
            <Text style={[styles.nameStatus, { color: nameStatusColor }]}>
              {nameStatusLabel}
            </Text>
          )}
        </View>

        <TextInput
          style={[styles.field, styles.fieldMulti, fieldStyle]}
          placeholder="Description (max 150 characters)"
          placeholderTextColor={themeColors.textMuted}
          value={description}
          onChangeText={setDescription}
          maxLength={150}
          multiline
          numberOfLines={3}
        />
        <Text style={[styles.charCount, { color: themeColors.textMuted }]}>
          {description.length}/150
        </Text>

        <TextInput
          style={[styles.field, fieldStyle]}
          placeholder="City (optional)"
          placeholderTextColor={themeColors.textMuted}
          value={city}
          onChangeText={setCity}
          maxLength={60}
        />
      </View>

      {/* Recruitment type */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: themeColors.text }]}>Recruitment</Text>
        {RECRUITMENT_OPTIONS.map((opt) => (
          <Pressable
            key={opt.type}
            onPress={() => setRecruitment(opt.type)}
            style={[
              styles.recruitCard,
              { borderColor: recruitment === opt.type ? colors.brand.blue : themeColors.border },
            ]}
            accessibilityRole="radio"
            accessibilityState={{ selected: recruitment === opt.type }}
          >
            <View
              style={[
                styles.recruitRadio,
                recruitment === opt.type && { backgroundColor: colors.brand.blue, borderColor: colors.brand.blue },
              ]}
            />
            <View style={styles.recruitBody}>
              <Text style={[styles.recruitLabel, { color: themeColors.text }]}>{opt.label}</Text>
              <Text style={[styles.recruitDesc, { color: themeColors.textMuted }]}>{opt.description}</Text>
            </View>
          </Pressable>
        ))}
      </View>

      {/* Preview toggle */}
      <Pressable
        onPress={() => setShowPreview((v) => !v)}
        style={styles.previewToggle}
        accessibilityRole="button"
      >
        <Text style={[styles.previewToggleText, { color: colors.brand.blue }]}>
          {showPreview ? 'Hide Preview ▲' : 'Show Preview ▼'}
        </Text>
      </Pressable>

      {showPreview && (
        <View style={[styles.previewCard, { borderColor: colors.brand.blue }]}>
          <Text style={styles.crestPreviewEmoji}>{crest}</Text>
          <Text style={[styles.previewName, { color: themeColors.text }]}>{name || 'Guild Name'}</Text>
          {description ? (
            <Text style={[styles.previewDesc, { color: themeColors.textMuted }]}>{description}</Text>
          ) : null}
          {city ? (
            <Text style={[styles.previewCity, { color: themeColors.textMuted }]}>📍 {city}</Text>
          ) : null}
        </View>
      )}

      {/* Create button */}
      <Button
        label={`Create Guild — 500 Coins`}
        onPress={handleCreate}
        loading={createMutation.isPending}
        disabled={!canAfford || nameStatus === 'taken'}
        style={styles.submitBtn}
      />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  content: { padding: 16, gap: 4 },
  heading: { fontSize: 24, fontWeight: '800', marginBottom: 8 },
  sectionTitle: { fontSize: 14, fontWeight: '700', marginBottom: 10, marginTop: 8 },

  costBanner: {
    borderRadius: 10,
    padding: 12,
    gap: 4,
    marginBottom: 8,
  },
  costBannerText: { fontSize: 14, fontWeight: '600', color: colors.brand.goldDark },
  balanceText: { fontSize: 13, fontWeight: '600' },

  crestPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 12,
  },
  crestPreviewCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.neutral[100],
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.brand.blue,
  },
  crestPreviewEmoji: { fontSize: 36, textAlign: 'center' },
  crestHint: { flex: 1, fontSize: 13 },

  emojiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  emojiCell: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: colors.neutral[100],
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  emojiCellSelected: {
    borderColor: colors.brand.blue,
    backgroundColor: `${colors.brand.blue}18`,
  },
  emojiCellText: { fontSize: 24 },

  section: { gap: 10, marginTop: 8 },

  field: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    minHeight: 44,
  },
  fieldMulti: { minHeight: 88, textAlignVertical: 'top' },
  fieldError: { borderWidth: 1.5, borderColor: colors.semantic.error },

  nameStatus: { fontSize: 12, fontWeight: '600', marginTop: 4, paddingLeft: 4 },
  charCount: { fontSize: 11, textAlign: 'right', marginTop: -4 },

  recruitCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1.5,
    padding: 12,
    gap: 12,
    minHeight: 56,
  },
  recruitRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.neutral[400],
  },
  recruitBody: { flex: 1 },
  recruitLabel: { fontSize: 14, fontWeight: '700' },
  recruitDesc: { fontSize: 12, marginTop: 2 },

  previewToggle: { paddingVertical: 12, alignItems: 'center' },
  previewToggleText: { fontSize: 14, fontWeight: '600' },
  previewCard: {
    borderRadius: 14,
    borderWidth: 2,
    padding: 20,
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
    backgroundColor: colors.neutral[50],
  },
  previewName: { fontSize: 20, fontWeight: '800' },
  previewDesc: { fontSize: 13, textAlign: 'center' },
  previewCity: { fontSize: 12 },

  submitBtn: { marginTop: 16, marginBottom: 32 },
});
