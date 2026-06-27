/**
 * lib/debug/logStore.ts
 *
 * A tiny, dependency-free in-memory ring buffer for runtime diagnostics, plus
 * global handlers that funnel uncaught JS errors, unhandled promise rejections
 * and console.error/console.warn into it.
 *
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * Release builds (EAS `preview`/`staging`/`production` profiles → Gradle
 * `assembleRelease`) run with `__DEV__ === false`, which DISABLES React
 * Native's red-box error screen. Any uncaught error then presents as a silent
 * white screen with no on-device way to see what happened — and developers
 * testing an installed APK have no Metro/CLI logs to fall back on.
 *
 * This buffer captures those errors so the on-screen <DebugOverlay /> can
 * display them. It is intentionally:
 *   - dependency-free (imported from polyfills.ts, the very first module), so it
 *     can begin capturing before anything else evaluates;
 *   - allocation-light (a capped ring buffer) so it is safe to leave installed.
 *
 * It does NOT decide whether to SHOW anything — that gating lives in
 * <DebugOverlay /> (off in production). Capturing is always on and cheap.
 */

export type LogLevel = 'error' | 'warn' | 'fatal';

export interface LogEntry {
  id: number;
  level: LogLevel;
  /** Human-readable, single-string message. */
  message: string;
  /** Stack trace if one was available. */
  stack?: string;
  /** Epoch ms when captured. */
  time: number;
}

const MAX_ENTRIES = 200;

let _entries: LogEntry[] = [];
let _nextId = 1;
let _installed = false;

type Listener = (entries: LogEntry[]) => void;
const _listeners = new Set<Listener>();

function emit(): void {
  // Hand out a fresh array reference so React state updates register a change.
  const snapshot = _entries;
  _listeners.forEach((l) => {
    try {
      l(snapshot);
    } catch {
      // A listener throwing must never break logging.
    }
  });
}

/** Subscribe to buffer changes. Returns an unsubscribe function. */
export function subscribe(listener: Listener): () => void {
  _listeners.add(listener);
  // Push the current state immediately so a late subscriber is up to date.
  try {
    listener(_entries);
  } catch {
    /* ignore */
  }
  return () => {
    _listeners.delete(listener);
  };
}

/** Current buffer contents (newest last). */
export function getEntries(): LogEntry[] {
  return _entries;
}

/** Clear the buffer (wired to the overlay's "Clear" button). */
export function clearEntries(): void {
  _entries = [];
  emit();
}

/** Push a record into the buffer. Safe to call from anywhere, never throws. */
export function record(level: LogLevel, message: string, stack?: string): void {
  try {
    const entry: LogEntry = {
      id: _nextId++,
      level,
      message: message.length > 4000 ? `${message.slice(0, 4000)}…` : message,
      stack,
      time: Date.now(),
    };
    // Replace the array (immutable update) and cap its length.
    const next = _entries.length >= MAX_ENTRIES ? _entries.slice(1) : _entries.slice();
    next.push(entry);
    _entries = next;
    emit();
  } catch {
    // Diagnostics must never crash the app.
  }
}

// ---------------------------------------------------------------------------
// Native alert fallback for invisible (pre-React) crashes
// ---------------------------------------------------------------------------
//
// The on-screen <DebugOverlay /> can only surface an error once React has
// mounted the root tree. But the worst white-screen failures happen DURING
// MODULE EVALUATION — before any component (including the overlay and the root
// error boundary) renders — so they are completely invisible: the app shows the
// splash, then a permanent white screen, with no chip and no red box (release
// builds disable it). A native Alert is rendered by the platform, not by our
// React tree, so it still appears even when React never mounted. This is the
// only way such a crash becomes readable on a device with no Metro/CLI logs.

let _nativeAlertShown = false;

function nativeAlertsAllowed(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isDev = Boolean((globalThis as any).__DEV__);
  // In development the red box already shows the error — no alert needed.
  if (isDev) return false;
  // Explicit build-time override (EXPO_PUBLIC_DEBUG_OVERLAY) wins over APP_ENV so
  // a release/production bundle built for debugging still surfaces a startup
  // crash via a native Alert. Metro inlines EXPO_PUBLIC_* at build time.
  const flag = process.env.EXPO_PUBLIC_DEBUG_OVERLAY;
  if (flag === '1' || flag === 'true') return true;
  if (flag === '0' || flag === 'false') return false;
  try {
    // Lazy require so this module stays dependency-free at import time (it is
    // imported first, from polyfills.ts). env does not import logStore, so there
    // is no circular dependency.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { env } = require('@/lib/env') as typeof import('@/lib/env');
    return env.APP_ENV !== 'production';
  } catch {
    // If env itself failed to evaluate (it may BE the early crash), still show
    // the alert on any non-dev build — visibility beats a silent white screen.
    return true;
  }
}

/** Surface a single blocking native alert for an otherwise-invisible fatal crash. */
function maybeShowNativeAlert(title: string, body: string): void {
  if (_nativeAlertShown) return;
  if (!nativeAlertsAllowed()) return;
  _nativeAlertShown = true;
  // Defer so we are not re-entering native UI from inside the crashing tick.
  setTimeout(() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { Alert } = require('react-native') as typeof import('react-native');
      Alert.alert(title, body.length > 1500 ? `${body.slice(0, 1500)}…` : body);
    } catch {
      // Native module not ready (e.g. a true native crash) — nothing more we
      // can do from JS; the captured entry is still in the ring buffer.
    }
  }, 0);
}

/** Best-effort stringify of an arbitrary console/handler argument. */
function stringifyArg(arg: unknown): string {
  if (arg instanceof Error) {
    return arg.stack || `${arg.name}: ${arg.message}`;
  }
  if (typeof arg === 'string') return arg;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function joinArgs(args: unknown[]): { message: string; stack?: string } {
  // Prefer a real Error's stack if one is among the args.
  const firstError = args.find((a): a is Error => a instanceof Error);
  const message = args.map(stringifyArg).join(' ');
  return { message, stack: firstError?.stack };
}

/**
 * Install global capture hooks. Idempotent — safe to call more than once.
 * Call this as early as possible (from polyfills.ts).
 */
export function installGlobalErrorHandlers(): void {
  if (_installed) return;
  _installed = true;

  // ---- console.error / console.warn ---------------------------------------
  // Patch but always delegate to the originals so Metro/EAS logs are unchanged.
  const origError = console.error;
  const origWarn = console.warn;

  console.error = (...args: unknown[]) => {
    const { message, stack } = joinArgs(args);
    record('error', message, stack);
    origError.apply(console, args as []);
  };

  console.warn = (...args: unknown[]) => {
    const { message, stack } = joinArgs(args);
    record('warn', message, stack);
    origWarn.apply(console, args as []);
  };

  // ---- uncaught JS exceptions (ErrorUtils) --------------------------------
  // React Native exposes a global error handler hook. Chaining preserves the
  // default behaviour (which in dev shows the red box) while letting us record.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  const errorUtils = g.ErrorUtils;
  if (errorUtils && typeof errorUtils.setGlobalHandler === 'function') {
    const previous =
      typeof errorUtils.getGlobalHandler === 'function'
        ? errorUtils.getGlobalHandler()
        : undefined;
    errorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
      const err = error instanceof Error ? error : new Error(stringifyArg(error));
      record(
        isFatal ? 'fatal' : 'error',
        `${isFatal ? '[FATAL] ' : ''}${err.name}: ${err.message}`,
        err.stack,
      );
      // A fatal uncaught error is exactly the case where the app strands on a
      // white screen with no on-screen overlay (it can crash before React even
      // mounts). Surface it via a native Alert so it is finally readable.
      if (isFatal) {
        maybeShowNativeAlert(
          'Startup error',
          `${err.name}: ${err.message}\n\n${(err.stack ?? '').slice(0, 1200)}`,
        );
      }
      if (typeof previous === 'function') {
        try {
          previous(error, isFatal);
        } catch {
          /* ignore */
        }
      }
    });
  }

  // ---- unhandled promise rejections ---------------------------------------
  // Hermes / RN routes these through a rejection tracker; the most portable hook
  // is the global `onunhandledrejection` if present.
  if (typeof g.addEventListener === 'function') {
    try {
      g.addEventListener('unhandledrejection', (event: { reason?: unknown }) => {
        const reason = event?.reason;
        const err = reason instanceof Error ? reason : new Error(stringifyArg(reason));
        record('error', `Unhandled promise rejection: ${err.message}`, err.stack);
      });
    } catch {
      /* not all RN runtimes support this — ignore */
    }
  }
}
