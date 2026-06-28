/**
 * DebugOverlay
 *
 * An on-device error/log surface for non-production builds. Renders nothing in
 * production and nothing while the log buffer is empty; otherwise it shows a
 * small floating badge with the captured error count. Tapping it expands a
 * scrollable, copyable panel listing the most recent errors, warnings and
 * fatal exceptions captured by lib/debug/logStore.
 *
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * EAS release builds (preview/staging) run with `__DEV__ === false`, which
 * disables React Native's red-box. Combined with testing an installed APK (no
 * Metro/CLI logs), an uncaught error becomes an undebuggable white screen. This
 * overlay makes the underlying error visible right on the device.
 *
 * It is deliberately self-contained: no theme, auth, i18n or query providers —
 * so it can render even when those providers are exactly what failed. It is
 * mounted as the LAST child of the root tree so it paints above everything.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { env } from '@/lib/env';
import {
  clearEntries,
  subscribe,
  type LogEntry,
} from '@/lib/debug/logStore';

/**
 * Explicit, build-time kill-switch for the on-device diagnostics. Metro inlines
 * any `EXPO_PUBLIC_*` var, so setting `EXPO_PUBLIC_DEBUG_OVERLAY=1` in an EAS
 * build profile (see eas.json) force-enables the overlay, the native-alert
 * fallback (lib/debug/logStore) and the error-boundary detail — even in a
 * release/production bundle. This is the escape hatch for the exact situation
 * the user hit: an installed APK that white-screens with NO chip because the
 * build profile resolved APP_ENV to 'production', which silently suppressed
 * every on-screen diagnostic. Set it to '0' to force everything off.
 */
const DEBUG_FLAG = process.env.EXPO_PUBLIC_DEBUG_OVERLAY;
export const DEBUG_OVERLAY_FORCED_ON = DEBUG_FLAG === '1' || DEBUG_FLAG === 'true';
export const DEBUG_OVERLAY_FORCED_OFF = DEBUG_FLAG === '0' || DEBUG_FLAG === 'false';

/**
 * Whether the overlay is allowed to show. Forced on/off by
 * `EXPO_PUBLIC_DEBUG_OVERLAY` when set; otherwise on in every non-production
 * build (development / preview / staging) and in any dev bundle, off in
 * production so end users never see it.
 */
export const DEBUG_OVERLAY_ENABLED =
  !DEBUG_OVERLAY_FORCED_OFF &&
  (DEBUG_OVERLAY_FORCED_ON || __DEV__ || env.APP_ENV !== 'production');

export function DebugOverlay(): React.ReactElement | null {
  const insets = useSafeAreaInsets();
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!DEBUG_OVERLAY_ENABLED) return;
    return subscribe(setEntries);
  }, []);

  // Only error/fatal entries drive the badge count; warnings are visible in the
  // expanded panel but should not nag with a red badge on their own.
  const errorCount = useMemo(
    () => entries.filter((e) => e.level === 'error' || e.level === 'fatal').length,
    [entries],
  );

  if (!DEBUG_OVERLAY_ENABLED) return null;

  // Anchor to the TOP of the screen so the badge is always visible regardless
  // of navigation-bar height (Android gesture nav, 3-button nav, API 36
  // edge-to-edge, etc.). A bottom-anchored badge can be hidden behind the
  // navigation bar on various device configurations.
  const topOffset = (insets.top > 0 ? insets.top : (Platform.OS === 'ios' ? 44 : 28)) + 4;

  if (!expanded) {
    // Always render at least a minimal handle (even with zero captured
    // entries). Its mere presence confirms that React mounted the root tree —
    // so if the screen is blank AND this dot is absent, the failure happened
    // before React rendered (a module-evaluation or native crash; see the
    // native Alert fallback in lib/debug/logStore.ts). Tapping it opens the
    // panel so warnings/errors can be read on-device with no Metro/CLI.
    if (entries.length === 0) {
      return (
        <Pressable
          style={[styles.dot, { top: topOffset }]}
          onPress={() => setExpanded(true)}
          accessibilityRole="button"
          accessibilityLabel="Open debug logs (no entries yet)"
        >
          <Text style={styles.dotText}>›_</Text>
        </Pressable>
      );
    }
    return (
      <Pressable
        style={[styles.badge, errorCount === 0 && styles.badgeWarn, { top: topOffset }]}
        onPress={() => setExpanded(true)}
        accessibilityRole="button"
        accessibilityLabel={`Show debug logs (${entries.length} entries)`}
      >
        <Text style={styles.badgeText}>
          {errorCount > 0 ? `⚠︎ ${errorCount} error${errorCount === 1 ? '' : 's'}` : `${entries.length} logs`}
        </Text>
      </Pressable>
    );
  }

  async function handleExport() {
    const lines = entries
      .slice()
      .reverse()
      .map((e) => `[${formatTime(e.time)}] ${e.level.toUpperCase()}: ${e.message}${e.stack ? `\n${e.stack}` : ''}`)
      .join('\n\n');
    const text = `Zobia Debug Log — ${new Date().toISOString()}\n${'='.repeat(40)}\n\n${lines}`;
    try {
      await Share.share({ message: text, title: 'Zobia Debug Logs' });
    } catch {
      // Share cancelled — no-op
    }
  }

  return (
    <View style={styles.panel} pointerEvents="box-none">
      <View style={[styles.panelInner, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Debug logs ({entries.length})</Text>
          <View style={styles.headerButtons}>
            <Pressable
              style={styles.headerBtn}
              onPress={handleExport}
              accessibilityRole="button"
              accessibilityLabel="Export logs"
            >
              <Text style={styles.headerBtnText}>⬆ Export</Text>
            </Pressable>
            <Pressable
              style={styles.headerBtn}
              onPress={clearEntries}
              accessibilityRole="button"
              accessibilityLabel="Clear logs"
            >
              <Text style={styles.headerBtnText}>Clear</Text>
            </Pressable>
            <Pressable
              style={styles.headerBtn}
              onPress={() => setExpanded(false)}
              accessibilityRole="button"
              accessibilityLabel="Close debug logs"
            >
              <Text style={styles.headerBtnText}>Close</Text>
            </Pressable>
          </View>
        </View>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {entries.length === 0 ? (
            <Text style={styles.emptyText} selectable>
              No errors or warnings captured yet. If the app is stuck on a blank
              screen, the failure happened before React rendered (a startup /
              native crash) — a native alert will pop up with the cause.
            </Text>
          ) : null}
          {/* Newest first so the most recent failure is on top. */}
          {entries
            .slice()
            .reverse()
            .map((entry) => (
              <View key={entry.id} style={styles.entry}>
                <Text style={[styles.entryLevel, levelStyle(entry.level)]} selectable>
                  {entry.level.toUpperCase()} · {formatTime(entry.time)}
                </Text>
                <Text style={styles.entryMessage} selectable>
                  {entry.message}
                </Text>
                {entry.stack ? (
                  <Text style={styles.entryStack} selectable>
                    {entry.stack}
                  </Text>
                ) : null}
              </View>
            ))}
        </ScrollView>
      </View>
    </View>
  );
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function levelStyle(level: LogEntry['level']) {
  switch (level) {
    case 'fatal':
      return { color: '#fca5a5' };
    case 'error':
      return { color: '#f87171' };
    default:
      return { color: '#fbbf24' };
  }
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    right: 12,
    backgroundColor: 'rgba(220, 38, 38, 0.92)',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    zIndex: 99999,
    elevation: 24,
  },
  badgeWarn: {
    backgroundColor: 'rgba(202, 138, 4, 0.92)',
  },
  dot: {
    position: 'absolute',
    right: 12,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(31, 41, 55, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 99999,
    elevation: 24,
  },
  dotText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  emptyText: {
    color: '#9ca3af',
    fontSize: 12,
    lineHeight: 18,
    paddingVertical: 8,
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  panel: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'flex-end',
    zIndex: 99999,
    elevation: 24,
  },
  panelInner: {
    maxHeight: '70%',
    backgroundColor: 'rgba(17, 24, 39, 0.98)',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  headerTitle: {
    color: '#f9fafb',
    fontSize: 14,
    fontWeight: '700',
  },
  headerButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  headerBtn: {
    backgroundColor: '#374151',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  headerBtnText: {
    color: '#f9fafb',
    fontSize: 12,
    fontWeight: '600',
  },
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    paddingBottom: 8,
  },
  entry: {
    marginBottom: 10,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#374151',
  },
  entryLevel: {
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 2,
  },
  entryMessage: {
    color: '#e5e7eb',
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  entryStack: {
    color: '#9ca3af',
    fontSize: 10,
    marginTop: 4,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
});
