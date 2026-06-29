/**
 * apps/android/src/components/debug/DebugOverlay.tsx
 *
 * Adapted from apps/expo/components/DebugOverlay.tsx for the web/Capacitor runtime.
 * Changes: React Native components → DOM elements; StyleSheet → inline styles;
 * useSafeAreaInsets → CSS top offset; Share.share → navigator.share/clipboard.
 *
 * An on-device error/log surface for non-production builds. Renders nothing in
 * production and nothing while the log buffer is empty; otherwise shows a small
 * floating badge with the captured error count. Tapping it expands a scrollable
 * panel listing errors, warnings, and fatal exceptions.
 *
 * Controlled by VITE_DEBUG_OVERLAY env var (same pattern as Expo's
 * EXPO_PUBLIC_DEBUG_OVERLAY). Set to '1' to force-enable even in production.
 * Mounted as the last child of the app root so it paints above everything.
 */

import { useEffect, useMemo, useState } from 'react';
import { env } from '@/lib/env';
import { clearEntries, subscribe, type LogEntry } from '@/lib/debug/logStore';

const VITE_DEBUG_OVERLAY = import.meta.env.VITE_DEBUG_OVERLAY as string | undefined;
const FORCED_ON = VITE_DEBUG_OVERLAY === '1' || VITE_DEBUG_OVERLAY === 'true';
const FORCED_OFF = VITE_DEBUG_OVERLAY === '0' || VITE_DEBUG_OVERLAY === 'false';

export const DEBUG_OVERLAY_ENABLED =
  !FORCED_OFF &&
  (FORCED_ON || import.meta.env.DEV || env.VITE_APP_ENV !== 'production');

export function DebugOverlay(): React.ReactElement | null {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!DEBUG_OVERLAY_ENABLED) return;
    return subscribe(setEntries);
  }, []);

  const errorCount = useMemo(
    () => entries.filter((e) => e.level === 'error' || e.level === 'fatal').length,
    [entries],
  );

  if (!DEBUG_OVERLAY_ENABLED) return null;

  async function handleExport() {
    const lines = entries
      .slice()
      .reverse()
      .map(
        (e) =>
          `[${formatTime(e.time)}] ${e.level.toUpperCase()}: ${e.message}${e.stack ? `\n${e.stack}` : ''}`,
      )
      .join('\n\n');
    const text = `Zobia Debug Log — ${new Date().toISOString()}\n${'='.repeat(40)}\n\n${lines}`;
    try {
      if (navigator.share) {
        await navigator.share({ text, title: 'Zobia Debug Logs' });
      } else {
        await navigator.clipboard.writeText(text);
      }
    } catch {
      // Share cancelled or not supported
    }
  }

  if (!expanded) {
    if (entries.length === 0) {
      return (
        <button
          onClick={() => setExpanded(true)}
          aria-label="Open debug logs (no entries yet)"
          style={dotStyle}
        >
          ›_
        </button>
      );
    }
    return (
      <button
        onClick={() => setExpanded(true)}
        aria-label={`Show debug logs (${entries.length} entries)`}
        style={{
          ...badgeStyle,
          background: errorCount > 0 ? 'rgba(220,38,38,0.92)' : 'rgba(202,138,4,0.92)',
        }}
      >
        {errorCount > 0
          ? `⚠︎ ${errorCount} error${errorCount === 1 ? '' : 's'}`
          : `${entries.length} logs`}
      </button>
    );
  }

  return (
    <div style={panelWrapStyle} onClick={(e) => e.stopPropagation()}>
      <div style={panelInnerStyle}>
        <div style={headerStyle}>
          <span style={headerTitleStyle}>Debug logs ({entries.length})</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleExport} style={btnStyle}>
              ⬆ Export
            </button>
            <button onClick={clearEntries} style={btnStyle}>
              Clear
            </button>
            <button onClick={() => setExpanded(false)} style={btnStyle}>
              Close
            </button>
          </div>
        </div>
        <div style={scrollStyle}>
          {entries.length === 0 && (
            <p style={emptyStyle}>
              No errors or warnings captured yet. If the app is blank, the failure happened before React rendered.
            </p>
          )}
          {entries
            .slice()
            .reverse()
            .map((entry) => (
              <div key={entry.id} style={entryStyle}>
                <div style={{ ...levelStyle(entry.level), fontSize: 11, fontWeight: 700, marginBottom: 2 }}>
                  {entry.level.toUpperCase()} · {formatTime(entry.time)}
                </div>
                <div style={messageStyle}>{entry.message}</div>
                {entry.stack && <div style={stackStyle}>{entry.stack}</div>}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function levelStyle(level: LogEntry['level']): React.CSSProperties {
  const colors: Record<LogEntry['level'], string> = {
    fatal: '#fca5a5',
    error: '#f87171',
    warn: '#fbbf24',
  };
  return { color: colors[level] };
}

const ZINDEX = 99999;

const dotStyle: React.CSSProperties = {
  position: 'fixed',
  top: 40,
  right: 12,
  width: 34,
  height: 34,
  borderRadius: '50%',
  background: 'rgba(31,41,55,0.55)',
  color: '#fff',
  fontSize: 12,
  fontWeight: 700,
  border: 'none',
  cursor: 'pointer',
  zIndex: ZINDEX,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const badgeStyle: React.CSSProperties = {
  position: 'fixed',
  top: 40,
  right: 12,
  padding: '6px 12px',
  borderRadius: 16,
  color: '#fff',
  fontSize: 12,
  fontWeight: 700,
  border: 'none',
  cursor: 'pointer',
  zIndex: ZINDEX,
};

const panelWrapStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'flex-end',
  zIndex: ZINDEX,
  pointerEvents: 'none',
};

const panelInnerStyle: React.CSSProperties = {
  maxHeight: '70%',
  background: 'rgba(17,24,39,0.98)',
  borderTopLeftRadius: 16,
  borderTopRightRadius: 16,
  padding: '10px 12px 20px',
  display: 'flex',
  flexDirection: 'column',
  pointerEvents: 'auto',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 8,
  flexShrink: 0,
};

const headerTitleStyle: React.CSSProperties = {
  color: '#f9fafb',
  fontSize: 14,
  fontWeight: 700,
};

const btnStyle: React.CSSProperties = {
  background: '#374151',
  color: '#f9fafb',
  fontSize: 12,
  fontWeight: 600,
  border: 'none',
  padding: '6px 12px',
  borderRadius: 8,
  cursor: 'pointer',
};

const scrollStyle: React.CSSProperties = {
  overflowY: 'auto',
  flex: 1,
  WebkitOverflowScrolling: 'touch' as React.CSSProperties['WebkitOverflowScrolling'],
};

const emptyStyle: React.CSSProperties = {
  color: '#9ca3af',
  fontSize: 12,
  lineHeight: '18px',
  padding: '8px 0',
};

const entryStyle: React.CSSProperties = {
  marginBottom: 10,
  paddingBottom: 10,
  borderBottom: '1px solid #374151',
};

const messageStyle: React.CSSProperties = {
  color: '#e5e7eb',
  fontSize: 12,
  fontFamily: 'monospace',
  userSelect: 'text',
  WebkitUserSelect: 'text',
  wordBreak: 'break-all',
};

const stackStyle: React.CSSProperties = {
  color: '#9ca3af',
  fontSize: 10,
  marginTop: 4,
  fontFamily: 'monospace',
  userSelect: 'text',
  WebkitUserSelect: 'text',
  wordBreak: 'break-all',
};
