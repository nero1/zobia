/**
 * lib/offline/syncQueue.ts
 *
 * Sync offline message queue when internet reconnects.
 *
 * Flow:
 *  1. Check if device is connected and has internet
 *  2. Fetch pending messages from local SQLite queue
 *  3. Attempt to send each to the backend
 *  4. Mark as sent on success, failed on error
 *  5. Silent errors (don't break the sync loop for one failure)
 */

import NetInfo from '@react-native-community/netinfo';
import { apiClient } from '@/lib/api/client';
import {
  getPendingMessages,
  markMessageSent,
  markMessageFailed,
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
    const pending = await getPendingMessages();

    // Sync each pending message
    for (const msg of pending) {
      try {
        // Send to backend
        await apiClient.post(`/api/messages/${msg.conversation_id}`, {
          content: msg.content,
          messageType: msg.message_type,
        });

        // Mark as sent
        await markMessageSent(msg.id);
      } catch (err) {
        // Mark as failed but continue syncing other messages
        await markMessageFailed(msg.id);
        console.warn(`[offline:sync] Failed to send message ${msg.id}`, err);
      }
    }
  } catch (err) {
    console.error('[offline:sync] Sync failed', err);
  }
}
