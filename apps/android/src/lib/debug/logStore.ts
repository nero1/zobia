/**
 * apps/android/src/lib/debug/logStore.ts
 *
 * Adapted from apps/expo/lib/debug/logStore.ts for the web/Capacitor runtime.
 * Changes: ErrorUtils (React Native) → window.onerror + window.onunhandledrejection.
 *
 * A tiny, dependency-free in-memory ring buffer for runtime diagnostics.
 * Captures console.error/warn, uncaught JS errors, and unhandled promise
 * rejections. The <DebugOverlay /> component subscribes and renders them.
 *
 * Capturing is always on and cheap. Whether the overlay SHOWS is controlled
 * by DebugOverlay.tsx based on VITE_APP_ENV.
 */

export type LogLevel = 'error' | 'warn' | 'fatal';

export interface LogEntry {
  id: number;
  level: LogLevel;
  message: string;
  stack?: string;
  time: number;
}

const MAX_ENTRIES = 200;

let _entries: LogEntry[] = [];
let _nextId = 1;
let _installed = false;

type Listener = (entries: LogEntry[]) => void;
const _listeners = new Set<Listener>();

function emit(): void {
  const snapshot = _entries;
  _listeners.forEach((l) => {
    try { l(snapshot); } catch {}
  });
}

export function subscribe(listener: Listener): () => void {
  _listeners.add(listener);
  try { listener(_entries); } catch {}
  return () => { _listeners.delete(listener); };
}

export function getEntries(): LogEntry[] { return _entries; }

export function clearEntries(): void {
  _entries = [];
  emit();
}

export function record(level: LogLevel, message: string, stack?: string): void {
  try {
    const entry: LogEntry = {
      id: _nextId++,
      level,
      message: message.length > 4000 ? `${message.slice(0, 4000)}…` : message,
      stack,
      time: Date.now(),
    };
    const next = _entries.length >= MAX_ENTRIES ? _entries.slice(1) : _entries.slice();
    next.push(entry);
    _entries = next;
    emit();
  } catch {}
}

function stringifyArg(arg: unknown): string {
  if (arg instanceof Error) return arg.stack || `${arg.name}: ${arg.message}`;
  if (typeof arg === 'string') return arg;
  try { return JSON.stringify(arg); } catch { return String(arg); }
}

function joinArgs(args: unknown[]): { message: string; stack?: string } {
  const firstError = args.find((a): a is Error => a instanceof Error);
  const message = args.map(stringifyArg).join(' ');
  return { message, stack: firstError?.stack };
}

export function installGlobalErrorHandlers(): void {
  if (_installed) return;
  _installed = true;

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

  // Uncaught synchronous errors
  const prevOnError = window.onerror;
  window.onerror = (msg, _source, _lineno, _colno, error) => {
    const message = error
      ? `[FATAL] ${error.name}: ${error.message}`
      : `[FATAL] ${String(msg)}`;
    record('fatal', message, error?.stack);
    if (typeof prevOnError === 'function') {
      prevOnError(msg, _source, _lineno, _colno, error);
    }
    return false;
  };

  // Unhandled promise rejections
  const prevOnUnhandled = window.onunhandledrejection;
  window.onunhandledrejection = (event) => {
    const reason = event.reason;
    const err = reason instanceof Error ? reason : new Error(stringifyArg(reason));
    record('error', `Unhandled rejection: ${err.message}`, err.stack);
    if (typeof prevOnUnhandled === 'function') {
      prevOnUnhandled.call(window, event);
    }
  };
}
