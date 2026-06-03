/**
 * Zobia Social — Moments Create Screen.
 *
 * Lets users compose and share a new Moment (disappears after 24 hours).
 *
 * Route: /moments/create
 */

import React, { useState } from 'react';
import {
  Alert,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { Screen } from '@/components/ui/Screen';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useTheme } from '@/lib/theme';
import { colors } from '@/lib/theme/colors';
import { apiClient } from '@/lib/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CreateMomentPayload {
  content: string;
  content_type: 'text';
  media_url?: string;
  caption?: string;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function createMoment(payload: CreateMomentPayload) {
  const { data } = await apiClient.post('/api/moments', payload);
  return data;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * MomentsCreateScreen — compose a new Moment.
 */
export default function MomentsCreateScreen() {
  const { isDark, colors: themeColors } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [content, setContent] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [caption, setCaption] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | undefined>();

  const textColor = isDark ? colors.neutral[100] : colors.neutral[900];
  const subtitleColor = isDark ? colors.neutral[400] : colors.neutral[500];
  const counterColor =
    content.length >= 450
      ? colors.semantic.error
      : isDark
      ? colors.neutral[500]
      : colors.neutral[400];

  const createMutation = useMutation({
    mutationFn: createMoment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['moments'] });
      router.back();
    },
    onError: (err: Error) => {
      setErrorMsg(err.message ?? 'Could not share moment. Please try again.');
    },
  });

  function handleShare() {
    if (!content.trim()) {
      Alert.alert('Content required', 'Please write something to share.');
      return;
    }
    const payload: CreateMomentPayload = {
      content: content.trim(),
      content_type: 'text',
    };
    if (mediaUrl.trim()) payload.media_url = mediaUrl.trim();
    if (caption.trim()) payload.caption = caption.trim();
    createMutation.mutate(payload);
  }

  return (
    <Screen scrollable contentStyle={styles.content}>
      {/* Header row */}
      <View style={styles.headerRow}>
        <Button
          label="Cancel"
          variant="ghost"
          size="sm"
          onPress={() => router.back()}
          accessibilityLabel="Cancel and go back"
        />
        <Text style={[styles.screenTitle, { color: textColor }]}>Share a Moment</Text>
        <View style={styles.headerSpacer} />
      </View>

      <Text style={[styles.hint, { color: subtitleColor }]}>
        Moments disappear after 24 hours
      </Text>

      {/* Main content input */}
      <View style={styles.contentInputWrapper}>
        <TextInput
          style={[
            styles.contentInput,
            {
              color: textColor,
              backgroundColor: isDark ? colors.neutral[800] : colors.neutral[0],
              borderColor: isDark ? colors.neutral[700] : colors.neutral[300],
            },
          ]}
          placeholder="What's happening?"
          placeholderTextColor={isDark ? colors.neutral[500] : colors.neutral[400]}
          value={content}
          onChangeText={(v) => {
            setContent(v);
            if (errorMsg) setErrorMsg(undefined);
          }}
          multiline
          maxLength={500}
          textAlignVertical="top"
          accessibilityLabel="Moment content"
        />
        <Text style={[styles.counter, { color: counterColor }]}>
          {content.length}/500
        </Text>
      </View>

      {/* Image URL (optional) */}
      <View style={styles.section}>
        <Input
          label="Image URL (optional)"
          placeholder="https://..."
          value={mediaUrl}
          onChangeText={setMediaUrl}
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Optional image URL"
        />
      </View>

      {/* Caption (optional) */}
      <View style={styles.section}>
        <Input
          label="Caption (optional)"
          placeholder="Add a caption..."
          value={caption}
          onChangeText={setCaption}
          maxLength={200}
          accessibilityLabel="Optional caption for the image"
        />
        {caption.length > 0 && (
          <Text style={[styles.captionCounter, { color: subtitleColor }]}>
            {caption.length}/200
          </Text>
        )}
      </View>

      {/* Error message */}
      {errorMsg ? (
        <Text style={styles.errorText} accessibilityRole="alert">
          {errorMsg}
        </Text>
      ) : null}

      {/* Submit */}
      <Button
        label="Share"
        size="lg"
        onPress={handleShare}
        loading={createMutation.isPending}
        disabled={!content.trim()}
        style={styles.submitBtn}
        accessibilityLabel="Share moment"
      />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 32,
    gap: 20,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  screenTitle: {
    fontSize: 17,
    fontWeight: '700',
    flex: 1,
    textAlign: 'center',
  },
  headerSpacer: {
    minWidth: 70,
  },
  hint: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: -8,
  },
  contentInputWrapper: {
    gap: 6,
  },
  contentInput: {
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    minHeight: 140,
    lineHeight: 24,
  },
  counter: {
    fontSize: 12,
    textAlign: 'right',
    fontWeight: '500',
  },
  section: {
    gap: 4,
  },
  captionCounter: {
    fontSize: 11,
    textAlign: 'right',
    marginTop: 2,
  },
  errorText: {
    fontSize: 13,
    color: colors.semantic.error,
    textAlign: 'center',
  },
  submitBtn: {
    marginTop: 4,
  },
});
