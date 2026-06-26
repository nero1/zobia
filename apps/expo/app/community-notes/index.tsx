/**
 * app/community-notes/index.tsx
 *
 * Community Notes screen.
 *
 * Shows community notes on flagged content. Each note has:
 *  - Content being noted
 *  - The note text
 *  - Vote count with up/downvote
 *  - "Add Note" button
 *
 * Only shown when Community Notes feature flag is enabled.
 */

import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
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

type VoteDirection = 'up' | 'down';

interface CommunityNote {
  id: string;
  contentSnippet: string;
  noteText: string;
  upvotes: number;
  downvotes: number;
  userVote: VoteDirection | null;
  authorUsername: string;
  createdAt: string;
}

interface CommunityNotesData {
  featureEnabled: boolean;
  notes: CommunityNote[];
}

interface VotePayload {
  noteId: string;
  direction: VoteDirection;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchCommunityNotes(): Promise<CommunityNotesData> {
  const { data } = await apiClient.get('/community-notes');
  return data;
}

async function voteOnNote(payload: VotePayload): Promise<void> {
  await apiClient.post(`/community-notes/${payload.noteId}/vote`, {
    direction: payload.direction,
  });
}

async function addNote(payload: { contentId: string; noteText: string }): Promise<void> {
  await apiClient.post('/community-notes', payload);
}

// ---------------------------------------------------------------------------
// Add Note Modal
// ---------------------------------------------------------------------------

interface AddNoteModalProps {
  visible: boolean;
  onClose: () => void;
  onAdded: () => void;
}

function AddNoteModal({ visible, onClose, onAdded }: AddNoteModalProps) {
  const { colors: themeColors, isDark } = useTheme();
  const [contentId, setContentId] = useState('');
  const [noteText, setNoteText] = useState('');

  const mutation = useMutation({
    mutationFn: addNote,
    onSuccess: () => {
      setContentId('');
      setNoteText('');
      onAdded();
    },
    onError: () => Alert.alert('Error', 'Could not submit note. Please try again.'),
  });

  function handleSubmit() {
    if (!contentId.trim()) {
      Alert.alert('Required', 'Please enter the content ID to annotate.');
      return;
    }
    if (!noteText.trim()) {
      Alert.alert('Required', 'Please write a note.');
      return;
    }
    mutation.mutate({ contentId: contentId.trim(), noteText: noteText.trim() });
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
          <Text style={[styles.modalTitle, { color: themeColors.text }]}>Add Community Note</Text>
          <TextInput
            style={[styles.modalInput, { backgroundColor: isDark ? colors.neutral[800] : colors.neutral[100], color: themeColors.text }]}
            placeholder="Content ID (post/message ID)"
            placeholderTextColor={themeColors.textMuted}
            value={contentId}
            onChangeText={setContentId}
            autoCapitalize="none"
          />
          <TextInput
            style={[styles.modalInput, styles.modalInputMulti, { backgroundColor: isDark ? colors.neutral[800] : colors.neutral[100], color: themeColors.text }]}
            placeholder="Write your note — explain the context or correction…"
            placeholderTextColor={themeColors.textMuted}
            value={noteText}
            onChangeText={setNoteText}
            multiline
            maxLength={500}
            textAlignVertical="top"
          />
          <Text style={[styles.charCount, { color: themeColors.textMuted }]}>{noteText.length}/500</Text>
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
                <Text style={styles.submitBtnText}>Add Note</Text>
              )}
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Note card
// ---------------------------------------------------------------------------

function NoteCard({ note, onVote }: { note: CommunityNote; onVote: (id: string, dir: VoteDirection) => void }) {
  const { colors: themeColors } = useTheme();
  const netVotes = note.upvotes - note.downvotes;

  return (
    <View style={[styles.noteCard, { backgroundColor: themeColors.surface, borderColor: themeColors.border }]}>
      {/* Content snippet */}
      <View style={[styles.contentSnippet, { backgroundColor: colors.neutral[100] }]}>
        <Text style={[styles.contentSnippetLabel, { color: colors.neutral[500] }]}>Original content</Text>
        <Text style={[styles.contentSnippetText, { color: themeColors.textMuted }]} numberOfLines={2}>
          "{note.contentSnippet}"
        </Text>
      </View>

      {/* Note text */}
      <Text style={[styles.noteText, { color: themeColors.text }]}>{note.noteText}</Text>

      {/* Footer */}
      <View style={styles.noteFooter}>
        <Text style={[styles.noteAuthor, { color: themeColors.textMuted }]}>
          by @{note.authorUsername}
        </Text>
        <View style={styles.voteRow}>
          <TouchableOpacity
            style={[styles.voteBtn, note.userVote === 'up' && styles.voteBtnActive]}
            onPress={() => onVote(note.id, 'up')}
            accessibilityRole="button"
            accessibilityLabel="Upvote note"
          >
            <Text style={[styles.voteBtnText, note.userVote === 'up' && styles.voteBtnTextActive]}>▲</Text>
          </TouchableOpacity>
          <Text style={[styles.voteCount, {
            color: netVotes > 0 ? colors.semantic.success : netVotes < 0 ? colors.semantic.error : themeColors.textMuted,
          }]}>
            {netVotes > 0 ? '+' : ''}{netVotes}
          </Text>
          <TouchableOpacity
            style={[styles.voteBtn, note.userVote === 'down' && styles.voteBtnDownActive]}
            onPress={() => onVote(note.id, 'down')}
            accessibilityRole="button"
            accessibilityLabel="Downvote note"
          >
            <Text style={[styles.voteBtnText, note.userVote === 'down' && styles.voteBtnTextDownActive]}>▼</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function Skeleton() {
  return (
    <View style={styles.skeletonContainer}>
      {[1, 2, 3].map((i) => <View key={i} style={styles.skeletonRow} />)}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function CommunityNotesScreen() {
  const { colors: themeColors } = useTheme();
  const queryClient = useQueryClient();
  const [showAddModal, setShowAddModal] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['community-notes'],
    queryFn: fetchCommunityNotes,
  });

  const voteMutation = useMutation({
    mutationFn: voteOnNote,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['community-notes'] }),
    onError: () => Alert.alert('Error', 'Could not register vote.'),
  });

  if (isLoading) return <Screen><Skeleton /></Screen>;

  if (isError || !data) {
    return (
      <Screen>
        <View style={styles.errorState}>
          <Text style={[styles.errorText, { color: themeColors.textMuted }]}>
            Could not load community notes.
          </Text>
        </View>
      </Screen>
    );
  }

  if (!data.featureEnabled) {
    return (
      <Screen>
        <View style={styles.errorState}>
          <Text style={[styles.errorText, { color: themeColors.textMuted }]}>
            Community Notes is not currently enabled.
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <FlatList
        data={data.notes}
        keyExtractor={(n) => n.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={() => (
          <View style={styles.listHeader}>
            <View style={styles.headerRow}>
              <Text style={[styles.screenTitle, { color: themeColors.text }]}>Community Notes</Text>
              <TouchableOpacity
                style={styles.addBtn}
                onPress={() => setShowAddModal(true)}
                accessibilityRole="button"
                accessibilityLabel="Add a community note"
              >
                <Text style={styles.addBtnText}>+ Add Note</Text>
              </TouchableOpacity>
            </View>
            <Text style={[styles.screenSubtitle, { color: themeColors.textMuted }]}>
              Community-sourced context on flagged content.
            </Text>
          </View>
        )}
        renderItem={({ item }) => (
          <NoteCard
            note={item}
            onVote={(id, dir) => voteMutation.mutate({ noteId: id, direction: dir })}
          />
        )}
        ListEmptyComponent={() => (
          <View style={styles.emptyState}>
            <Text style={[styles.emptyText, { color: themeColors.textMuted }]}>
              No community notes yet.
            </Text>
          </View>
        )}
      />

      <AddNoteModal
        visible={showAddModal}
        onClose={() => setShowAddModal(false)}
        onAdded={() => {
          setShowAddModal(false);
          queryClient.invalidateQueries({ queryKey: ['community-notes'] });
          Alert.alert('Note Added', 'Your note has been submitted for community review.');
        }}
      />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  list: { padding: 16, gap: 12 },
  listHeader: { marginBottom: 8, gap: 6 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  screenTitle: { fontSize: 22, fontWeight: '800' },
  screenSubtitle: { fontSize: 14, lineHeight: 20 },

  addBtn: {
    backgroundColor: colors.brand.blue,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 44,
    justifyContent: 'center',
  },
  addBtnText: { color: colors.neutral[0], fontSize: 13, fontWeight: '700' },

  noteCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  contentSnippet: {
    borderRadius: 8,
    padding: 10,
    gap: 2,
  },
  contentSnippetLabel: { fontSize: 10, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  contentSnippetText: { fontSize: 13, lineHeight: 18, fontStyle: 'italic' },

  noteText: { fontSize: 14, lineHeight: 20 },

  noteFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  noteAuthor: { fontSize: 12 },
  voteRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  voteBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: colors.neutral[100],
  },
  voteBtnActive: { backgroundColor: `${colors.semantic.success}22` },
  voteBtnDownActive: { backgroundColor: `${colors.semantic.error}18` },
  voteBtnText: { fontSize: 14, color: colors.neutral[600] },
  voteBtnTextActive: { color: colors.semantic.success },
  voteBtnTextDownActive: { color: colors.semantic.error },
  voteCount: { fontSize: 14, fontWeight: '700', minWidth: 28, textAlign: 'center' },

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
  modalTitle: { fontSize: 18, fontWeight: '700' },
  modalInput: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    minHeight: 44,
  },
  modalInputMulti: { minHeight: 100, textAlignVertical: 'top' },
  charCount: { fontSize: 11, textAlign: 'right', marginTop: -4 },
  modalActions: { flexDirection: 'row', gap: 10 },
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

  emptyState: { padding: 32, alignItems: 'center' },
  emptyText: { fontSize: 14, textAlign: 'center' },

  errorState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorText: { fontSize: 15, textAlign: 'center' },

  skeletonContainer: { padding: 16, gap: 12 },
  skeletonRow: { height: 140, borderRadius: 12, backgroundColor: colors.neutral[200] },
});
export { ErrorBoundary } from '@/components/ui/ScreenErrorBoundary';
