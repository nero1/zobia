/**
 * AnnouncementBanner
 *
 * Fetches the active banner announcement for the authenticated user from
 * /api/admin/announcements/banners and renders it as a fixed banner above
 * the tab content. Severity drives background colour. Dismissal is stored
 * in MMKV for the session.
 */

import React, { useEffect, useState } from 'react';
import {
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

interface BannerData {
  id: string;
  content: string;
  contentType: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>?/gm, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, '')
    .trim();
}

function getBannerDismissKey(id: string): string {
  return `announcement_banner_dismissed_${id}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * AnnouncementBanner — render above the tab content.
 *
 * When visible it adds `paddingTop` equal to the banner height so that
 * content beneath is not obscured.  Pass `onHeightChange` if the parent
 * needs to adjust its layout dynamically; otherwise the banner simply
 * overlays naturally inside the scroll hierarchy.
 */
export function AnnouncementBanner() {
  const [banner, setBanner] = useState<BannerData | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { data } = await apiClient.get<{ data: { banner: BannerData | null } }>(
          '/announcements/banner',
        );
        const b = data?.data?.banner;
        if (!b || cancelled) return;

        // Check if dismissed this session
        if (storage.getBoolean(getBannerDismissKey(b.id))) return;

        setBanner(b);
      } catch {
        // Non-fatal
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  function handleDismiss() {
    if (banner) {
      storage.set(getBannerDismissKey(banner.id), true);
    }
    setDismissed(true);
  }

  if (!banner || dismissed) return null;

  const bgColor =
    banner.contentType === 'danger'
      ? colors.semantic.error
      : banner.contentType === 'warning'
      ? colors.brand.gold
      : colors.brand.blue;

  return (
    <View style={[styles.banner, { backgroundColor: bgColor }]}>
      <Text style={styles.text} numberOfLines={2}>
        {stripHtml(banner.content)}
      </Text>
      <Pressable
        style={styles.closeBtn}
        onPress={handleDismiss}
        accessibilityLabel="Dismiss announcement"
        accessibilityRole="button"
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={styles.closeText}>×</Text>
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    minHeight: 44,
    gap: 8,
    zIndex: 100,
  },
  text: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: colors.neutral[0],
    lineHeight: 18,
  },
  closeBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
  },
  closeText: {
    fontSize: 22,
    color: colors.neutral[0],
    lineHeight: 26,
    fontWeight: '700',
  },
});
