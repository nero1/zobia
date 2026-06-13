/**
 * app/rooms/create.tsx
 *
 * Room creation screen.
 *
 * Features:
 *  - Room type selector (6 types with descriptions)
 *    - Classroom type uses teal #0D9488 (NOT blue/purple)
 *  - Name, description, category, city fields
 *  - Pricing section for VIP / Drop / ClassRoom rooms
 *  - ClassRoom: curriculum builder (add/remove modules)
 *  - Preview card before publishing
 */

import React, { useState } from 'react';
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
import { useMutation } from '@tanstack/react-query';
import { Screen } from '@/components/ui/Screen';
import { Button } from '@/components/ui/Button';
import { useTheme } from '@/lib/theme';
import { colors } from '@/lib/theme/colors';
import { useCurrency } from '@/lib/hooks/useCurrency';
import { apiClient } from '@/lib/api/client';
import { useCurrency } from '@/lib/hooks/useCurrency';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEAL = '#0D9488';

type RoomType = 'free_open' | 'vip' | 'drop' | 'tipping' | 'classroom' | 'guild';

interface RoomTypeOption {
  type: RoomType;
  label: string;
  emoji: string;
  description: string;
  color: string;
  hasPricing: boolean;
  hasCurriculum: boolean;
}

const ROOM_TYPES: RoomTypeOption[] = [
  {
    type: 'free_open',
    label: 'Free & Open',
    emoji: '🌐',
    description: 'Open to everyone. Free to join.',
    color: colors.brand.blue,
    hasPricing: false,
    hasCurriculum: false,
  },
  {
    type: 'vip',
    label: 'VIP',
    emoji: '👑',
    description: 'Subscribers only. Set a monthly coin price.',
    color: colors.brand.gold,
    hasPricing: true,
    hasCurriculum: false,
  },
  {
    type: 'drop',
    label: 'Drop',
    emoji: '⚡',
    description: 'Limited-time event room with entry fee.',
    color: colors.semantic.warning,
    hasPricing: true,
    hasCurriculum: false,
  },
  {
    type: 'tipping',
    label: 'Tipping',
    emoji: '🎙️',
    description: 'Live room where viewers tip the creator.',
    color: colors.brand.green,
    hasPricing: false,
    hasCurriculum: false,
  },
  {
    type: 'classroom',
    label: 'ClassRoom',
    emoji: '📚',
    description: 'Structured learning room with curriculum.',
    color: TEAL,
    hasPricing: true,
    hasCurriculum: true,
  },
  {
    type: 'guild',
    label: 'Guild',
    emoji: '🤝',
    description: 'Private guild room for guild members only.',
    color: colors.brand.green,
    hasPricing: false,
    hasCurriculum: false,
  },
];

const CATEGORIES = [
  'Tech', 'Music', 'Gaming', 'Sports', 'Arts', 'Business', 'Health', 'Education', 'Faith', 'Other',
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Module {
  id: string;
  title: string;
}

interface CreateRoomPayload {
  name: string;
  description?: string;
  type: RoomType;
  category: string;
  city?: string;
  subscriptionPriceNgn?: number;
  entryFeeNgn?: number;
  dropDurationMinutes?: number;
  enrolmentFeeNgn?: number;
  curriculum?: Array<{ title: string; order: number }>;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function createRoom(payload: CreateRoomPayload) {
  const { data } = await apiClient.post('/rooms', payload);
  return data;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface RoomTypeCardProps {
  option: RoomTypeOption;
  selected: boolean;
  onSelect: () => void;
}

function RoomTypeCard({ option, selected, onSelect }: RoomTypeCardProps) {
  const currency = useCurrency();
  return (
    <Pressable
      onPress={onSelect}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={[
        styles.typeCard,
        selected && { borderColor: option.color, borderWidth: 2 },
      ]}
    >
      <Text style={styles.typeEmoji}>{option.emoji}</Text>
      <View style={styles.typeBody}>
        <Text style={[styles.typeLabel, selected && { color: option.color }]}>
          {option.label}
        </Text>
        <Text style={styles.typeDesc}>{option.description.replace(/\bcoin\b/gi, currency.softSingular.toLowerCase())}</Text>
      </View>
      {selected && (
        <View style={[styles.typeCheck, { backgroundColor: option.color }]}>
          <Text style={styles.typeCheckText}>✓</Text>
        </View>
      )}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Curriculum builder
// ---------------------------------------------------------------------------

interface CurriculumBuilderProps {
  modules: Module[];
  onChange: (modules: Module[]) => void;
}

function CurriculumBuilder({ modules, onChange }: CurriculumBuilderProps) {
  const [draft, setDraft] = useState('');
  const { colors: themeColors } = useTheme();

  const addModule = () => {
    const title = draft.trim();
    if (!title) return;
    onChange([...modules, { id: Date.now().toString(), title }]);
    setDraft('');
  };

  const removeModule = (id: string) => {
    onChange(modules.filter((m) => m.id !== id));
  };

  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: themeColors.text }]}>
        Curriculum Modules
      </Text>
      {modules.map((m, idx) => (
        <View key={m.id} style={styles.moduleRow}>
          <Text style={[styles.moduleIndex, { color: TEAL }]}>{idx + 1}.</Text>
          <Text style={[styles.moduleTitle, { color: themeColors.text }]} numberOfLines={1}>
            {m.title}
          </Text>
          <Pressable
            onPress={() => removeModule(m.id)}
            style={styles.removeBtn}
            accessibilityLabel={`Remove module ${m.title}`}
          >
            <Text style={styles.removeBtnText}>✕</Text>
          </Pressable>
        </View>
      ))}
      <View style={styles.moduleInput}>
        <TextInput
          style={[
            styles.moduleInputField,
            { backgroundColor: themeColors.surface, color: themeColors.text },
          ]}
          placeholder="Module title…"
          placeholderTextColor={themeColors.textMuted}
          value={draft}
          onChangeText={setDraft}
          returnKeyType="done"
          onSubmitEditing={addModule}
        />
        <Pressable
          onPress={addModule}
          style={[styles.addModuleBtn, { backgroundColor: TEAL }]}
          accessibilityLabel="Add module"
        >
          <Text style={styles.addModuleBtnText}>+ Add</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Preview card
// ---------------------------------------------------------------------------

interface PreviewCardProps {
  name: string;
  description: string;
  roomType: RoomType;
  city: string;
  category: string;
  priceCoin: number | null;
}

function PreviewCard({ name, description, roomType, city, category, priceCoin }: PreviewCardProps) {
  const opt = ROOM_TYPES.find((r) => r.type === roomType)!;
  const currency = useCurrency();;

  return (
    <View style={[styles.previewCard, { borderColor: opt.color }]}>
      <Text style={styles.previewTitle}>Preview</Text>
      <View style={styles.previewHeader}>
        <Text style={styles.previewEmoji}>{opt.emoji}</Text>
        <View style={styles.previewMeta}>
          <Text style={styles.previewName} numberOfLines={1}>
            {name || 'Room Name'}
          </Text>
          <View style={[styles.typeBadge, { backgroundColor: opt.color }]}>
            <Text style={styles.typeBadgeText}>{opt.label}</Text>
          </View>
        </View>
      </View>
      <Text style={styles.previewDesc} numberOfLines={2}>
        {description || 'Room description will appear here.'}
      </Text>
      <View style={styles.previewFooter}>
        {city ? <Text style={styles.previewFooterText}>📍 {city}</Text> : null}
        {category ? <Text style={styles.previewFooterText}>#{category}</Text> : null}
        {priceCoin ? (
          <Text style={styles.previewFooterText}>🪙 {priceCoin} {currency.softPlural.toLowerCase()}</Text>
        ) : null}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

/**
 * CreateRoomScreen — lets users create any of the 6 room types.
 */
export default function CreateRoomScreen() {
  const router = useRouter();
  const { colors: themeColors, isDark } = useTheme();
  const currency = useCurrency();

  const [selectedType, setSelectedType] = useState<RoomType>('free_open');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [city, setCity] = useState('');
  const [priceCoin, setPriceCoin] = useState('');
  const [modules, setModules] = useState<Module[]>([]);
  const [showPreview, setShowPreview] = useState(false);

  const selectedOption = ROOM_TYPES.find((r) => r.type === selectedType)!;

  const createMutation = useMutation({
    mutationFn: createRoom,
    onSuccess: (data) => {
      router.replace(`/rooms/${data.room.id}`);
    },
    onError: () => {
      Alert.alert('Error', 'Could not create room. Please try again.');
    },
  });

  const handleCreate = () => {
    if (!name.trim()) {
      Alert.alert('Validation', 'Room name is required.');
      return;
    }
    const payload: CreateRoomPayload = {
      name: name.trim(),
      description: description.trim() || undefined,
      type: selectedType,
      category: category || 'Other',
      city: city.trim() || undefined,
    };
    if (selectedType === 'vip' && priceCoin) {
      payload.subscriptionPriceNgn = Number(priceCoin);
    } else if (selectedType === 'drop') {
      if (priceCoin) payload.entryFeeNgn = Number(priceCoin);
      payload.dropDurationMinutes = 120;
    } else if (selectedType === 'classroom') {
      payload.enrolmentFeeNgn = priceCoin ? Number(priceCoin) : 0;
      payload.curriculum = modules.map((m, i) => ({ title: m.title, order: i }));
    }
    createMutation.mutate(payload);
  };

  const fieldStyle = {
    backgroundColor: isDark ? colors.neutral[800] : colors.neutral[100],
    color: themeColors.text,
  };

  return (
    <Screen scrollable contentStyle={styles.content}>
      <Text style={[styles.heading, { color: themeColors.text }]}>Create a Room</Text>

      {/* Room type selector */}
      <Text style={[styles.sectionTitle, { color: themeColors.text }]}>Room Type</Text>
      <View style={styles.typeGrid}>
        {ROOM_TYPES.map((opt) => (
          <RoomTypeCard
            key={opt.type}
            option={opt}
            selected={selectedType === opt.type}
            onSelect={() => setSelectedType(opt.type)}
          />
        ))}
      </View>

      {/* Basic info */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: themeColors.text }]}>Room Details</Text>

        <TextInput
          style={[styles.field, fieldStyle]}
          placeholder="Room name *"
          placeholderTextColor={themeColors.textMuted}
          value={name}
          onChangeText={setName}
          maxLength={60}
        />

        <TextInput
          style={[styles.field, styles.fieldMulti, fieldStyle]}
          placeholder="Description (optional)"
          placeholderTextColor={themeColors.textMuted}
          value={description}
          onChangeText={setDescription}
          maxLength={300}
          multiline
          numberOfLines={3}
        />

        {/* Category pills */}
        <Text style={[styles.fieldLabel, { color: themeColors.textMuted }]}>Category</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryScroll}>
          {CATEGORIES.map((cat) => (
            <Pressable
              key={cat}
              onPress={() => setCategory(cat === category ? '' : cat)}
              style={[
                styles.categoryPill,
                cat === category && { backgroundColor: colors.brand.blue },
              ]}
              accessibilityRole="radio"
              accessibilityState={{ selected: cat === category }}
            >
              <Text
                style={[
                  styles.categoryPillText,
                  cat === category && { color: colors.neutral[0] },
                ]}
              >
                {cat}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        <TextInput
          style={[styles.field, fieldStyle]}
          placeholder="City (optional)"
          placeholderTextColor={themeColors.textMuted}
          value={city}
          onChangeText={setCity}
          maxLength={60}
        />
      </View>

      {/* Pricing */}
      {selectedOption.hasPricing && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: themeColors.text }]}>Pricing</Text>
          <TextInput
            style={[styles.field, fieldStyle]}
            placeholder={`Entry fee in ${currency.softPlural} (e.g. 50)`}
            placeholderTextColor={themeColors.textMuted}
            value={priceCoin}
            onChangeText={setPriceCoin}
            keyboardType="numeric"
            maxLength={6}
          />
        </View>
      )}

      {/* Curriculum */}
      {selectedOption.hasCurriculum && (
        <CurriculumBuilder modules={modules} onChange={setModules} />
      )}

      {/* Preview toggle */}
      <Pressable
        onPress={() => setShowPreview((v) => !v)}
        style={styles.previewToggle}
        accessibilityRole="button"
      >
        <Text style={[styles.previewToggleText, { color: colors.brand.blue }]}>
          {showPreview ? 'Hide Preview ▲' : 'Preview Card ▼'}
        </Text>
      </Pressable>

      {showPreview && (
        <PreviewCard
          name={name}
          description={description}
          roomType={selectedType}
          city={city}
          category={category}
          priceCoin={priceCoin ? Number(priceCoin) : null}
        />
      )}

      {/* Submit */}
      <Button
        label="Create Room"
        onPress={handleCreate}
        loading={createMutation.isPending}
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
  heading: { fontSize: 24, fontWeight: '800', marginBottom: 16 },
  sectionTitle: { fontSize: 14, fontWeight: '700', marginBottom: 10, marginTop: 8 },

  typeGrid: { gap: 8, marginBottom: 4 },
  typeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.neutral[50],
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.neutral[200],
    padding: 12,
    gap: 12,
    minHeight: 64,
  },
  typeEmoji: { fontSize: 24, width: 32, textAlign: 'center' },
  typeBody: { flex: 1 },
  typeLabel: { fontSize: 15, fontWeight: '700', color: colors.neutral[900] },
  typeDesc: { fontSize: 12, color: colors.neutral[500], marginTop: 2 },
  typeCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeCheckText: { color: colors.neutral[0], fontSize: 13, fontWeight: '800' },
  typeBadge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, alignSelf: 'flex-start', marginTop: 4 },
  typeBadgeText: { color: colors.neutral[0], fontSize: 10, fontWeight: '700' },

  section: { gap: 10, marginTop: 8 },

  field: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    minHeight: 44,
  },
  fieldMulti: { minHeight: 88, textAlignVertical: 'top' },
  fieldLabel: { fontSize: 12, fontWeight: '600', marginBottom: -4 },

  categoryScroll: { marginVertical: 4 },
  categoryPill: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.neutral[300],
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 8,
    backgroundColor: colors.neutral[50],
    minHeight: 44,
    justifyContent: 'center',
  },
  categoryPillText: { fontSize: 13, fontWeight: '600', color: colors.neutral[700] },

  moduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.neutral[200],
  },
  moduleIndex: { fontSize: 13, fontWeight: '700', width: 20 },
  moduleTitle: { flex: 1, fontSize: 14 },
  removeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.semantic.error + '22',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeBtnText: { color: colors.semantic.error, fontSize: 14, fontWeight: '700' },
  moduleInput: { flexDirection: 'row', gap: 8, marginTop: 4 },
  moduleInputField: {
    flex: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    minHeight: 44,
  },
  addModuleBtn: {
    borderRadius: 10,
    paddingHorizontal: 14,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addModuleBtnText: { color: colors.neutral[0], fontSize: 14, fontWeight: '700' },

  previewToggle: { paddingVertical: 12, alignItems: 'center' },
  previewToggleText: { fontSize: 14, fontWeight: '600' },
  previewCard: {
    borderRadius: 14,
    borderWidth: 2,
    padding: 16,
    gap: 8,
    marginBottom: 8,
    backgroundColor: colors.neutral[50],
  },
  previewTitle: { fontSize: 11, fontWeight: '700', color: colors.neutral[400], textTransform: 'uppercase', letterSpacing: 1 },
  previewHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  previewEmoji: { fontSize: 32 },
  previewMeta: { flex: 1 },
  previewName: { fontSize: 18, fontWeight: '800', color: colors.neutral[900] },
  previewDesc: { fontSize: 13, color: colors.neutral[600] },
  previewFooter: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  previewFooterText: { fontSize: 12, color: colors.neutral[500] },

  submitBtn: { marginTop: 16, marginBottom: 32 },
});
