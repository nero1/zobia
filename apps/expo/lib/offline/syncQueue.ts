/**
 * lib/offline/syncQueue.ts
 *
 * Sync offline message queue when internet reconnects.
 *
 * Flow:
 *  1. Check if device is connected and has internet
 *  2. Reset previously-failed messages back to pending so they are retried
 *  3. Fetch pending messages from local SQLite queue
 *  4. Route each message to the correct endpoint based on conversation type
 *  5. Mark as sent on success, failed on error
 *  6. Silent per-message errors (don't break the sync loop for one failure)
 */

import NetInfo from '@react-native-community/netinfo';
import { apiClient } from '@/lib/api/client';
import {
  getPendingMessages,
  markMessageSent,
  markMessageFailed,
  resetFailedMessages,
} from './sqlite';

/**
 * Sync all pending offline messages to the backend.
 * Safe to call repeatedly; skips if offline.
 */
export async function syncPendingMessages(): Promise<void> {
  // Check network state
  const state = await NetInfo.fetch();
  if (!state.isConnected || !state.isInternetReachable) {
    return;
  }

  try {
    // Reset failed messages back to pending before this sync pass
    await resetFailedMessages();

    const pending = await getPendingMessages();

    for (const msg of pending) {
      try {
        // Route to the correct endpoint based on conversation type
        const endpoint =
          msg.conversationType === 'group'
            ? `/messages/group/${msg.conversationId}`
            : `/messages/dm/${msg.conversationId}`;

        await apiClient.post(endpoint, {
          content: msg.content,
          messageType: msg.messageType,
          idempotencyKey: msg.idempotencyKey,
        });

        await markMessageSent(msg.id);
      } catch (err) {
        await markMessageFailed(msg.id);
        console.warn(`[offline:sync] Failed to send message ${msg.id}`, err);
      }
    }
  } catch (err) {
    console.error('[offline:sync] Sync failed', err);
  }
}
