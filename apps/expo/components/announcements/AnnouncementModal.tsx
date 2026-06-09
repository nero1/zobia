/**
 * AnnouncementModal
 *
 * Fetches the active modal announcement for the authenticated user from
 * /api/admin/announcements/modals and shows it in a React Native Modal once
 * per session. On dismiss the modal ID is stored in MMKV so it never shows
 * twice in the same session.
 */

import React, { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { storage } from '@/lib/offline/store';
import { apiClient } from '@/lib/api/client';
import { colors } from '@/lib/theme/colors';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AnnouncementModalData {
  id: string;
  title: string;
  content: string;
  contentType: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip HTML tags and decode common entities for plain-text display. */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function getSessionKey(id: string): string {
  return `announcement_modal_dismissed_${id}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * AnnouncementModal — mount once inside the authenticated root.
 *
 * Fetches the active modal announcement and shows it to the user if they
 * have not already dismissed it this session.  Uses MMKV for session-scoped
 * dismissal persistence.
 */
export function AnnouncementModal() {
  const [announcement, setAnnouncement] = useState<AnnouncementModalData | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { data } = await apiClient.get<{ data: { modal: AnnouncementModalData | null } }>(
          '/api/announcements/modal',
        );
        const modal = data?.data?.modal;
        if (!modal || cancelled) return;

        // Check if already dismissed this session
        const key = getSessionKey(modal.id);
        if (storage.getBoolean(key)) return;

        setAnnouncement(modal);
        setVisible(true);
      } catch {
        // Non-fatal — announcements are best-effort
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  function handleDismiss() {
    if (announcement) {
      storage.set(getSessionKey(announcement.id), true);
    }
    setVisible(false);
  }

  if (!announcement) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={handleDismiss}
      accessibilityViewIsModal
    >
      <Pressable style={styles.backdrop} onPress={handleDismiss}>
        <Pressable
          style={styles.card}
          onPress={() => {
            // Prevent closing when tapping inside the card
          }}
          accessibilityRole="none"
        >
          {/* Header row */}
          <View style={styles.header}>
            <Text style={styles.subject} numberOfLines={2}>
              {announcement.title}
            </Text>
            <Pressable
              style={styles.closeBtn}
              onPress={handleDismiss}
              accessibilityLabel="Close announcement"
              accessibilityRole="button"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.closeText}>×</Text>
            </Pressable>
          </View>

          {/* Body */}
          <Text style={styles.body}>{stripHtml(announcement.content)}</Text>

          {/* Dismiss button */}
          <Pressable
            style={styles.dismissBtn}
            onPress={handleDismiss}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
          >
            <Text style={styles.dismissText}>Got it</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: colors.neutral[0],
    borderRadius: 18,
    padding: 24,
    width: '100%',
    maxWidth: 440,
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  subject: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: colors.neutral[900],
    lineHeight: 24,
  },
  closeBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: colors.neutral[100],
  },
  closeText: {
    fontSize: 24,
    color: colors.neutral[600],
    lineHeight: 28,
  },
  body: {
    fontSize: 15,
    color: colors.neutral[700],
    lineHeight: 22,
  },
  dismissBtn: {
    marginTop: 4,
    backgroundColor: colors.brand.blue,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  dismissText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.neutral[0],
  },
});
