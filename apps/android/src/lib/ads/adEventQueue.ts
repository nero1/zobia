/**
 * apps/android/src/lib/ads/adEventQueue.ts
 *
 * Offline-friendly, batched impression/click reporting for the in-house ad
 * system — Android port of apps/web/components/ads/adEventQueue.ts
 * (ZB-AND-11 fix). AdSlot.tsx previously POSTed one HTTP request per
 * impression/click with no batching, unlike web's queue-and-flush pattern;
 * a feed with several ad slots produced one POST per impression per slot.
 *
 * Storage uses idb-keyval (already a project dependency via the query
 * persister, lib/query/client.ts) instead of localStorage — Capacitor's
 * Android WebView supports both, but idb-keyval is already the established
 * async-storage convention in this app. Flushing uses a periodic timer plus
 * a `@capacitor/app` `appStateChange` listener (no `sendBeacon` equivalent
 * inside a Capacitor WebView), instead of web's `beforeunload`/`visibilitychange`.
 */

import { get, set } from 'idb-keyval';
import { App as CapApp } from '@capacitor/app';
import { apiClient } from '@/lib/api/client';

const QUEUE_KEY = 'zobia_ad_event_queue_v1';
const MAX_BATCH = 20;
const FLUSH_DEBOUNCE_MS = 2500;
const FLUSH_INTERVAL_MS = 20_000;

export interface QueuedAdEvent {
  creativeId: string;
  placementKey: string;
  type: 'impression' | 'click';
  clientEventId: string;
}

async function readQueue(): Promise<QueuedAdEvent[]> {
  try {
    return (await get<QueuedAdEvent[]>(QUEUE_KEY)) ?? [];
  } catch {
    return [];
  }
}

async function writeQueue(events: QueuedAdEvent[]): Promise<void> {
  try {
    await set(QUEUE_KEY, events.slice(0, MAX_BATCH * 4));
  } catch {
    /* storage unavailable/full — drop silently, non-critical telemetry */
  }
}

let flushTimer: ReturnType<typeof setTimeout> | null = null;

// ZSB-09 fix: `enqueueAdEvent` used to fire an unawaited async IIFE that did
// an unguarded read-modify-write of the idb-keyval queue — two ad
// impressions logged in quick succession (a common case: a feed can render
// several AdSlots that all become visible around the same time) could both
// read the same queue snapshot before either wrote, so the second write
// clobbered the first, silently dropping an event. `flushAdEventQueue`'s own
// read-modify-write had the same race against a concurrent enqueue. Serialize
// every queue read+write (from both enqueue and flush) through a single
// in-memory promise chain so they can never interleave.
let writeChain: Promise<void> = Promise.resolve();

function withQueueLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = writeChain.then(fn, fn);
  writeChain = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

export function enqueueAdEvent(event: Omit<QueuedAdEvent, 'clientEventId'>): void {
  const clientEventId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  void withQueueLock(async () => {
    const queue = await readQueue();
    queue.push({ ...event, clientEventId });
    await writeQueue(queue);
  });

  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => void flushAdEventQueue(), FLUSH_DEBOUNCE_MS);
}

export async function flushAdEventQueue(): Promise<void> {
  return withQueueLock(async () => {
    const queue = await readQueue();
    if (queue.length === 0) return;

    const batch = queue.slice(0, MAX_BATCH);
    const rest = queue.slice(MAX_BATCH);

    try {
      await apiClient.post('/ads/events', { events: batch });
      await writeQueue(rest);
      if (rest.length > 0) {
        flushTimer = setTimeout(() => void flushAdEventQueue(), FLUSH_DEBOUNCE_MS);
      }
      // Non-OK (thrown by apiClient) — leave the queue intact for the next flush attempt.
    } catch {
      // Offline or network error — events stay queued in idb-keyval for the next trigger.
    }
  });
}

let backgroundFlushInitialized = false;

/** Call once at app root to wire periodic + backgrounding flush triggers. */
export function initAdEventQueueFlush(): void {
  if (backgroundFlushInitialized) return;
  backgroundFlushInitialized = true;

  setInterval(() => void flushAdEventQueue(), FLUSH_INTERVAL_MS);

  void CapApp.addListener('appStateChange', ({ isActive }) => {
    if (!isActive) void flushAdEventQueue();
  });

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void flushAdEventQueue();
    });
  }
}
