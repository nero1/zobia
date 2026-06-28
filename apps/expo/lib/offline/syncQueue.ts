/**
 * lib/offline/syncQueue.ts
 *
 * Sync offline message queue when internet reconnects.
 *
 * Flow:
 *  1. Check if device is connected and has internet
 *  2. Reset previously-failed messages (under retry ceiling) back to pending
 *  3. Fetch pending messages from local SQLite queue
 *  4. Route each message to the correct endpoint based on conversation type
 *  5. Mark as sent on success
 *  6. On 4xx: mark permanently failed (no retry); on other errors: mark failed (retry later)
 */

import NetInfo from '@react-native-community/netinfo';
import { type AxiosError } from 'axios';
import { apiClient } from '@/lib/api/client';
import {
  isOfflineDBReady,
  getPendingMessages,
  markMessageSent,
  markMessageFailed,
  markMessagePermanentlyFailed,
  markMessageSending,
  resetFailedMessages,
  purgePermanentlyFailedMessages,
  resetSendingMessages,
} from './sqlite';
// Re-export so callers can still use the named import from syncQueue.
export { resetSendingMessages };

// BUG-RACE-02 FIX: guard against concurrent sync runs
let _syncInProgress = false;

/**
 * Sync all pending offline messages to the backend.
 * Safe to call repeatedly; skips if offline or if a sync is already in progress.
 */
export async function syncPendingMessages(): Promise<void> {
  // BUG-RACE-02 FIX: skip if already syncing
  if (_syncInProgress) return;
  // Skip sync if the DB hasn't finished initialising yet
  if (!isOfflineDBReady()) return;

  // Check network state
  const state = await NetInfo.fetch();
  if (!state.isConnected) return;
  // isInternetReachable can be null during initial NetInfo fetch — treat null as
  // "unknown/potentially connected" and proceed; only explicit false means offline.
  if (state.isInternetReachable === false) return;

  _syncInProgress = true;
  try {
    // BUG-RACE-03 FIX: resetSendingMessages() is only called at startup (from
    // _layout.tsx), NOT inside each sync pass, to prevent race conditions where
    // a message currently being sent gets reset back to pending mid-flight.
    // Reset failed messages (under retry ceiling) back to pending before this sync pass
    await resetFailedMessages();

    const pending = await getPendingMessages();

    // Process in concurrent batches of 3 so one stuck message does not block others.
    const BATCH_SIZE = 3;
    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      const batch = pending.slice(i, i + BATCH_SIZE);

      await Promise.allSettled(
        batch.map(async (msg) => {
          try {
            // mark in-flight before calling API to prevent double-send on crash-restart
            await markMessageSending(msg.id);

            // Route to the correct endpoint based on conversation type
            const endpoint =
              msg.conversationType === 'room'
                ? `/rooms/${msg.conversationId}/messages`
                : msg.conversationType === 'group'
                ? `/messages/group/${msg.conversationId}`
                : `/messages/dm/${msg.conversationId}`;

            await apiClient.post(endpoint, {
              content: msg.content,
              messageType: msg.messageType,
              idempotencyKey: msg.idempotencyKey,
            });

            await markMessageSent(msg.id);
          } catch (err) {
            const status = (err as AxiosError)?.response?.status;
            if (status !== undefined && status >= 400 && status < 500) {
              // Client error (bad request, auth failure, validation) — retrying won't help
              await markMessagePermanentlyFailed(msg.id);
              console.warn(`[offline:sync] Permanent failure for message ${msg.id} (HTTP ${status})`);
            } else {
              // Server error or network failure — schedule for retry
              await markMessageFailed(msg.id);
              console.warn(`[offline:sync] Transient failure for message ${msg.id}`, err);
            }
          }
        })
      );
    }
    // Purge old permanently-failed messages to prevent unbounded DB growth (BUG-008).
    await purgePermanentlyFailedMessages();
  } catch (err) {
    console.error('[offline:sync] Sync failed', err);
  } finally {
    _syncInProgress = false;
  }
}
