/**
 * app/messages/group/create.tsx
 *
 * Create Group Chat screen.
 *
 * Features:
 *  - Enter group name
 *  - Pick members from friends list (searchable)
 *  - Pick a tag: Study Group / Crew / Business
 *  - Submit to POST /api/messages/group
 *  - Navigates to /messages/group/[groupId] on success
 */

import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
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
import { useTheme } from '@/lib/theme';
import { colors } from '@/lib/theme/colors';
import { apiClient } from '@/lib/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type GroupTag = 'Personal' | 'General' | 'Study Group' | 'Crew' | 'Business' | 'Other';

interface Friend {
  userId: string;
  displayName: string;
  avatarEmoji: string;
  username: string;
}

interface CreateGroupResponse {
  group: { id: string; name: string };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TAG_OPTIONS: { key: GroupTag; label: string; emoji: string }[] = [
  { key: 'Personal', label: 'Personal', emoji: '👤' },
  { key: 'General', label: 'General', emoji: '💬' },
  { key: 'Study Group', label: 'Study Group', emoji: '📚' },
  { key: 'Crew', label: 'Crew', emoji: '🤝' },
  { key: 'Business', label: 'Business', emoji: '💼' },
  { key: 'Other', label: 'Other', emoji: '🔖' },
];

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchFriends(): Promise<Friend[]> {
  const { data } = await apiClient.get('/friends');
  return data.friends ?? [];
}

async function createGroup(payload: {
  name: string;
  tag: GroupTag;
  memberUserIds: string[];
}): Promise<CreateGroupResponse> {
  const { data } = await apiClient.post('/messages/group', payload);
  return data;
}

// ---------------------------------------------------------------------------
// Member row
// ---------------------------------------------------------------------------

interface MemberRowProps {
  friend: Friend;
  selected: boolean;
  onToggle: (id: string) => void;
}

function MemberRow({ friend, selected, onToggle }: MemberRowProps) {
  const { colors: themeColors } = useTheme();
  return (
    <Pressable
      style={({ pressed }) => [
        styles.memberRow,
        { borderBottomColor: themeColors.border },
        pressed && { opacity: 0.7 },
      ]}
      onPress={() => onToggle(friend.userId)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${selected ? 'Remove' : 'Add'} ${friend.displayName}`}
    >
      <View style={styles.memberAvatar}>
        <Text style={styles.memberAvatarEmoji}>{friend.avatarEmoji || '👤'}</Text>
      </View>
      <View style={styles.memberInfo}>
        <Text style={[styles.memberName, { color: themeColors.text }]}>{friend.displayName}</Text>
        <Text style={[styles.memberUsername, { color: themeColors.textMuted }]}>
          @{friend.username}
        </Text>
      </View>
      <View
        style={[
          styles.checkbox,
          selected
            ? { backgroundColor: colors.brand.blue, borderColor: colors.brand.blue }
            : { borderColor: colors.neutral[300] },
        ]}
      >
        {selected && <Text style={styles.checkmark}>✓</Text>}
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function CreateGroupScreen() {
  const router = useRouter();
  const { colors: themeColors, isDark } = useTheme();

  const [groupName, setGroupName] = useState('');
  const [selectedTag, setSelectedTag] = useState<GroupTag>('Crew');
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  const { data: friends = [], isLoading: loadingFriends } = useQuery({
    queryKey: ['friends-list'],
    queryFn: fetchFriends,
    staleTime: 60_000,
  });

  const filteredFriends = friends.filter(
    (f: Friend) =>
      search === '' ||
      f.displayName.toLowerCase().includes(search.toLowerCase()) ||
      f.username.toLowerCase().includes(search.toLowerCase()),
  );

  const toggleMember = useCallback((userId: string) => {
    setSelectedMembers((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  }, []);

  const createMutation = useMutation({
    mutationFn: createGroup,
    onSuccess: (result) => {
      router.replace(`/messages/group/${result.group.id}` as never);
    },
  });

  const handleSubmit = useCallback(() => {
    if (!groupName.trim()) return;
    createMutation.mutate({
      name: groupName.trim(),
      tag: selectedTag,
      memberUserIds: Array.from(selectedMembers),
    });
  }, [groupName, selectedTag, selectedMembers, createMutation]);

  const canSubmit = groupName.trim().length > 0 && !createMutation.isPending;

  return (
    <Screen scrollable contentStyle={styles.content}>
      {/* Group name */}
      <Text style={[styles.sectionLabel, { color: themeColors.textMuted }]}>GROUP NAME</Text>
      <TextInput
        style={[
          styles.nameInput,
          {
            backgroundColor: isDark ? colors.neutral[800] : colors.neutral[100],
            color: themeColors.text,
            borderColor: themeColors.border,
          },
        ]}
        placeholder="Enter group name…"
        placeholderTextColor={themeColors.textMuted}
        value={groupName}
        onChangeText={setGroupName}
        maxLength={60}
        returnKeyType="done"
        accessibilityLabel="Group name"
      />

      {/* Tag picker */}
      <Text style={[styles.sectionLabel, { color: themeColors.textMuted }]}>GROUP TYPE</Text>
      <View style={styles.tagRow}>
        {TAG_OPTIONS.map((opt) => (
          <Pressable
            key={opt.key}
            style={[
              styles.tagPill,
              { borderColor: colors.neutral[300] },
              selectedTag === opt.key && {
                backgroundColor: colors.brand.blue,
                borderColor: colors.brand.blue,
              },
            ]}
            onPress={() => setSelectedTag(opt.key)}
            accessibilityRole="radio"
            accessibilityState={{ selected: selectedTag === opt.key }}
          >
            <Text style={styles.tagEmoji}>{opt.emoji}</Text>
            <Text
              style={[
                styles.tagLabel,
                { color: selectedTag === opt.key ? colors.neutral[0] : themeColors.text },
              ]}
            >
              {opt.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Member search */}
      <Text style={[styles.sectionLabel, { color: themeColors.textMuted }]}>
        ADD MEMBERS ({selectedMembers.size} selected)
      </Text>
      <TextInput
        style={[
          styles.searchInput,
          {
            backgroundColor: isDark ? colors.neutral[800] : colors.neutral[100],
            color: themeColors.text,
            borderColor: themeColors.border,
          },
        ]}
        placeholder="Search friends…"
        placeholderTextColor={themeColors.textMuted}
        value={search}
        onChangeText={setSearch}
        returnKeyType="search"
        accessibilityLabel="Search friends"
      />

      {/* Friend list */}
      {loadingFriends ? (
        <View style={styles.loadingState}>
          <ActivityIndicator color={colors.brand.blue} />
        </View>
      ) : filteredFriends.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={[styles.emptyText, { color: themeColors.textMuted }]}>
            {search ? 'No friends match your search.' : 'No friends yet.'}
          </Text>
        </View>
      ) : (
        <View style={[styles.friendList, { borderColor: themeColors.border }]}>
          {filteredFriends.map((friend: Friend) => (
            <MemberRow
              key={friend.userId}
              friend={friend}
              selected={selectedMembers.has(friend.userId)}
              onToggle={toggleMember}
            />
          ))}
        </View>
      )}

      {/* Error */}
      {createMutation.isError && (
        <Text style={styles.errorText}>Failed to create group. Please try again.</Text>
      )}

      {/* Submit */}
      <Pressable
        style={[
          styles.submitBtn,
          { backgroundColor: canSubmit ? colors.brand.blue : colors.neutral[300] },
        ]}
        onPress={handleSubmit}
        disabled={!canSubmit}
        accessibilityRole="button"
        accessibilityLabel="Create group"
      >
        {createMutation.isPending ? (
          <ActivityIndicator color={colors.neutral[0]} />
        ) : (
          <Text style={styles.submitBtnText}>Create Group</Text>
        )}
      </Pressable>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  content: { padding: 16, gap: 8, paddingBottom: 48 },

  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginTop: 12,
    marginBottom: 6,
  },

  nameInput: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    minHeight: 48,
  },

  tagRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  tagPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 6,
    minHeight: 44,
  },
  tagEmoji: { fontSize: 16 },
  tagLabel: { fontSize: 14, fontWeight: '600' },

  searchInput: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    minHeight: 44,
  },

  friendList: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 60,
  },
  memberAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.neutral[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberAvatarEmoji: { fontSize: 22 },
  memberInfo: { flex: 1 },
  memberName: { fontSize: 15, fontWeight: '600' },
  memberUsername: { fontSize: 12, marginTop: 1 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  checkmark: { fontSize: 13, color: colors.neutral[0], fontWeight: '800' },

  loadingState: { paddingVertical: 32, alignItems: 'center' },
  emptyState: { paddingVertical: 24, alignItems: 'center' },
  emptyText: { fontSize: 14, textAlign: 'center' },

  errorText: { fontSize: 13, color: colors.semantic.error, textAlign: 'center', marginTop: 8 },

  submitBtn: {
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    marginTop: 16,
  },
  submitBtnText: { color: colors.neutral[0], fontSize: 16, fontWeight: '700' },
});
