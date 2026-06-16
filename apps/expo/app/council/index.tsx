/**
 * app/council/index.tsx
 *
 * Platform Council screen.
 *
 * Features:
 *  - Top 50 by Legacy Score (/api/council)
 *  - Council badge for members + privileges
 *  - Feature Ideas list with vote counts (/api/council/ideas)
 *  - "Top idea of the month" highlighted
 *  - "Submit Idea" modal
 *  - Vote on ideas (upvote)
 */

import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Screen } from '@/components/ui/Screen';
import { useTheme } from '@/lib/theme';
import { colors } from '@/lib/theme/colors';
import { apiClient } from '@/lib/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CouncilMember {
  userId: string;
  username: string;
  displayName: string;
  avatarEmoji: string;
  legacyScore: number;
  rank: number;
  isCurrentUser: boolean;
}

interface CouncilData {
  members: CouncilMember[];
  isCouncilMember: boolean;
  currentUserRank: number | null;
}

interface Idea {
  id: string;
  title: string;
  body: string;
  voteCount: number;
  userVoted: boolean;
  authorUsername: string;
  isTopIdea: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchCouncil(): Promise<CouncilData> {
  const { data } = await apiClient.get('/council');
  return data;
}

async function fetchIdeas(): Promise<Idea[]> {
  const { data } = await apiClient.get('/council/ideas');
  return data.ideas ?? [];
}

async function voteOnIdea(ideaId: string): Promise<void> {
  await apiClient.post(`/council/ideas/${ideaId}/vote`);
}

async function submitIdea(payload: { title: string; body: string }): Promise<void> {
  await apiClient.post('/council/ideas', payload);
}

// ---------------------------------------------------------------------------
// Submit Idea Modal
// ---------------------------------------------------------------------------

interface SubmitIdeaModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmitted: () => void;
}

function SubmitIdeaModal({ visible, onClose, onSubmitted }: SubmitIdeaModalProps) {
  const { colors: themeColors, isDark } = useTheme();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  const mutation = useMutation({
    mutationFn: submitIdea,
    onSuccess: () => {
      setTitle('');
      setBody('');
      onSubmitted();
    },
    onError: () => Alert.alert('Error', 'Could not submit idea. Please try again.'),
  });

  function handleSubmit() {
    if (!title.trim()) {
      Alert.alert('Missing title', 'Please enter a title for your idea.');
      return;
    }
    mutation.mutate({ title: title.trim(), body: body.trim() });
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={[styles.modalCard, { backgroundColor: themeColors.surface }]} onPress={() => {}}>
          <Text style={[styles.modalTitle, { color: themeColors.text }]}>Submit a Feature Idea</Text>
          <TextInput
            style={[styles.modalInput, { backgroundColor: isDark ? colors.neutral[800] : colors.neutral[100], color: themeColors.text }]}
            placeholder="Title"
            placeholderTextColor={themeColors.textMuted}
            value={title}
            onChangeText={setTitle}
            maxLength={100}
          />
          <TextInput
            style={[styles.modalInput, styles.modalInputMulti, { backgroundColor: isDark ? colors.neutral[800] : colors.neutral[100], color: themeColors.text }]}
            placeholder="Describe your idea…"
            placeholderTextColor={themeColors.textMuted}
            value={body}
            onChangeText={setBody}
            multiline
            maxLength={500}
            textAlignVertical="top"
          />
          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose} accessibilityRole="button">
              <Text style={[styles.cancelBtnText, { color: themeColors.textMuted }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.submitBtn, mutation.isPending && { opacity: 0.6 }]}
              onPress={handleSubmit}
              disabled={mutation.isPending}
              accessibilityRole="button"
            >
              {mutation.isPending ? (
                <ActivityIndicator size="small" color={colors.neutral[0]} />
              ) : (
                <Text style={styles.submitBtnText}>Submit</Text>
              )}
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Idea card
// ---------------------------------------------------------------------------

function IdeaCard({ idea, onVote }: { idea: Idea; onVote: (id: string) => void }) {
  const { colors: themeColors } = useTheme();
  return (
    <View style={[styles.ideaCard, idea.isTopIdea && styles.ideaCardTop, { borderColor: idea.isTopIdea ? colors.brand.gold : themeColors.border }]}>
      {idea.isTopIdea && (
        <View style={styles.topIdeaBadge}>
          <Text style={styles.topIdeaBadgeText}>🏆 Top Idea of the Month</Text>
        </View>
      )}
      <Text style={[styles.ideaTitle, { color: themeColors.text }]}>{idea.title}</Text>
      {idea.body ? (
        <Text style={[styles.ideaBody, { color: themeColors.textMuted }]} numberOfLines={3}>
          {idea.body}
        </Text>
      ) : null}
      <View style={styles.ideaMeta}>
        <Text style={[styles.ideaAuthor, { color: themeColors.textMuted }]}>
          by @{idea.authorUsername}
        </Text>
        <TouchableOpacity
          style={[styles.voteBtn, idea.userVoted && styles.voteBtnActive]}
          onPress={() => onVote(idea.id)}
          accessibilityRole="button"
          accessibilityLabel={`Vote for ${idea.title}`}
        >
          <Text style={[styles.voteBtnText, idea.userVoted && styles.voteBtnTextActive]}>
            ▲ {idea.voteCount}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Council member row
// ---------------------------------------------------------------------------

function MemberRow({ member }: { member: CouncilMember }) {
  const { colors: themeColors } = useTheme();
  return (
    <View style={[styles.memberRow, { borderBottomColor: themeColors.border }]}>
      <Text style={styles.memberRank}>#{member.rank}</Text>
      <View style={styles.memberAvatar}>
        <Text style={styles.memberAvatarEmoji}>{member.avatarEmoji}</Text>
      </View>
      <Text style={[styles.memberName, { color: themeColors.text }]} numberOfLines={1}>
        {member.displayName}
        {member.isCurrentUser ? ' (You)' : ''}
      </Text>
      <Text style={[styles.memberScore, { color: colors.brand.gold }]}>
        {member.legacyScore.toLocaleString()}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function Skeleton() {
  return (
    <View style={styles.skeletonContainer}>
      {[1, 2, 3, 4].map((i) => <View key={i} style={styles.skeletonRow} />)}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function CouncilScreen() {
  const { colors: themeColors } = useTheme();
  const queryClient = useQueryClient();
  const [showIdeas, setShowIdeas] = useState(false);
  const [showSubmitModal, setShowSubmitModal] = useState(false);

  const { data: council, isLoading: councilLoading, isError: councilError } = useQuery({
    queryKey: ['council'],
    queryFn: fetchCouncil,
  });

  const { data: ideas = [], isLoading: ideasLoading } = useQuery({
    queryKey: ['council-ideas'],
    queryFn: fetchIdeas,
    enabled: showIdeas,
  });

  const voteMutation = useMutation({
    mutationFn: voteOnIdea,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['council-ideas'] }),
    onError: () => Alert.alert('Error', 'Could not register vote.'),
  });

  if (councilLoading) return <Screen><Skeleton /></Screen>;

  if (councilError || !council) {
    return (
      <Screen>
        <View style={styles.errorState}>
          <Text style={[styles.errorText, { color: themeColors.textMuted }]}>
            Could not load council data.
          </Text>
        </View>
      </Screen>
    );
  }

  const topIdeas = ideas.filter((i: Idea) => i.isTopIdea);
  const otherIdeas = ideas.filter((i: Idea) => !i.isTopIdea);
  const sortedIdeas = [...topIdeas, ...otherIdeas];

  return (
    <Screen scrollable>
      {/* Header */}
      <View style={[styles.hero, { backgroundColor: themeColors.surface }]}>
        <Text style={styles.heroEmoji}>🏛️</Text>
        <Text style={[styles.heroTitle, { color: themeColors.text }]}>Platform Council</Text>
        <Text style={[styles.heroSubtitle, { color: themeColors.textMuted }]}>
          Top 50 members by Legacy Score
        </Text>
        {council.isCouncilMember && (
          <View style={styles.councilBadge}>
            <Text style={styles.councilBadgeText}>⚖️ Council Member</Text>
          </View>
        )}
      </View>

      {/* Member list */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: themeColors.text }]}>Council Members</Text>
        {council.members.map((m: CouncilMember) => (
          <MemberRow key={m.userId} member={m} />
        ))}
      </View>

      {/* Ideas toggle */}
      <View style={styles.section}>
        <View style={styles.ideasHeader}>
          <Text style={[styles.sectionTitle, { color: themeColors.text }]}>Feature Ideas</Text>
          <Pressable
            style={styles.ideasToggle}
            onPress={() => setShowIdeas((v) => !v)}
            accessibilityRole="button"
          >
            <Text style={styles.ideasToggleText}>{showIdeas ? 'Hide' : 'Show'}</Text>
          </Pressable>
        </View>

        {showIdeas && (
          <>
            <TouchableOpacity
              style={styles.submitIdeaBtn}
              onPress={() => setShowSubmitModal(true)}
              accessibilityRole="button"
            >
              <Text style={styles.submitIdeaBtnText}>+ Submit an Idea</Text>
            </TouchableOpacity>

            {ideasLoading ? (
              <ActivityIndicator color={colors.brand.blue} style={{ marginTop: 16 }} />
            ) : sortedIdeas.length === 0 ? (
              <Text style={[styles.emptyText, { color: themeColors.textMuted }]}>
                No ideas yet. Be the first!
              </Text>
            ) : (
              sortedIdeas.map((idea) => (
                <IdeaCard
                  key={idea.id}
                  idea={idea}
                  onVote={(id) => voteMutation.mutate(id)}
                />
              ))
            )}
          </>
        )}
      </View>

      <SubmitIdeaModal
        visible={showSubmitModal}
        onClose={() => setShowSubmitModal(false)}
        onSubmitted={() => {
          setShowSubmitModal(false);
          queryClient.invalidateQueries({ queryKey: ['council-ideas'] });
          Alert.alert('Submitted!', 'Your idea has been added.');
        }}
      />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  hero: {
    alignItems: 'center',
    paddingVertical: 28,
    paddingHorizontal: 20,
    gap: 8,
  },
  heroEmoji: { fontSize: 48 },
  heroTitle: { fontSize: 22, fontWeight: '800' },
  heroSubtitle: { fontSize: 14 },
  councilBadge: {
    backgroundColor: `${colors.brand.gold}22`,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  councilBadgeText: { color: colors.brand.goldDark, fontSize: 13, fontWeight: '700' },

  section: { padding: 16, gap: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 4 },

  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
    minHeight: 44,
  },
  memberRank: { width: 36, fontSize: 13, fontWeight: '700', color: colors.neutral[500] },
  memberAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.neutral[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberAvatarEmoji: { fontSize: 20 },
  memberName: { flex: 1, fontSize: 14, fontWeight: '600' },
  memberScore: { fontSize: 13, fontWeight: '700' },

  ideasHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  ideasToggle: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: colors.neutral[100],
    minHeight: 44,
    justifyContent: 'center',
  },
  ideasToggleText: { fontSize: 13, fontWeight: '600', color: colors.brand.blue },

  submitIdeaBtn: {
    backgroundColor: colors.brand.blue,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  submitIdeaBtnText: { color: colors.neutral[0], fontSize: 14, fontWeight: '700' },

  ideaCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    gap: 6,
  },
  ideaCardTop: {
    backgroundColor: `${colors.brand.gold}0C`,
  },
  topIdeaBadge: {
    marginBottom: 4,
  },
  topIdeaBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.brand.goldDark,
  },
  ideaTitle: { fontSize: 15, fontWeight: '700' },
  ideaBody: { fontSize: 13, lineHeight: 19 },
  ideaMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  ideaAuthor: { fontSize: 12 },
  voteBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.neutral[100],
    minHeight: 44,
    justifyContent: 'center',
  },
  voteBtnActive: { backgroundColor: `${colors.brand.blue}18` },
  voteBtnText: { fontSize: 13, fontWeight: '700', color: colors.neutral[600] },
  voteBtnTextActive: { color: colors.brand.blue },

  emptyText: { fontSize: 14, textAlign: 'center', paddingVertical: 12 },

  // Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    gap: 12,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 4 },
  modalInput: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    minHeight: 44,
  },
  modalInputMulti: { minHeight: 100, textAlignVertical: 'top' },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 10,
    backgroundColor: colors.neutral[100],
    minHeight: 44,
    justifyContent: 'center',
  },
  cancelBtnText: { fontSize: 15, fontWeight: '600' },
  submitBtn: {
    flex: 2,
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 10,
    backgroundColor: colors.brand.blue,
    minHeight: 44,
    justifyContent: 'center',
  },
  submitBtnText: { color: colors.neutral[0], fontSize: 15, fontWeight: '700' },

  errorState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorText: { fontSize: 15, textAlign: 'center' },

  skeletonContainer: { padding: 16, gap: 12 },
  skeletonRow: { height: 56, borderRadius: 10, backgroundColor: colors.neutral[200] },
});
