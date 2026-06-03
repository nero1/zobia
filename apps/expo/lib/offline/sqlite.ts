/**
 * lib/offline/sqlite.ts
 *
 * SQLite-backed offline message queue for Android.
 * Queues outgoing messages when the device is offline and syncs when reconnected.
 */

import * as SQLite from 'expo-sqlite';

// ---------------------------------------------------------------------------
// Database setup
// ---------------------------------------------------------------------------

let db: SQLite.SQLiteDatabase | null = null;

const DB_NAME = 'zobia_offline.db';

/**
 * Initialise the offline SQLite database and create tables if needed.
 */
export async function initOfflineDB(): Promise<void> {
  db = await SQLite.openDatabaseAsync(DB_NAME);

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS offline_messages (
      id            TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      content       TEXT NOT NULL,
      message_type  TEXT NOT NULL DEFAULT 'text',
      created_at    INTEGER NOT NULL,
      sync_status   TEXT NOT NULL DEFAULT 'pending'
        CHECK (sync_status IN ('pending', 'sending', 'failed'))
    );

    CREATE INDEX IF NOT EXISTS idx_offline_messages_status
      ON offline_messages(sync_status, created_at);
  `);
}

function getDB(): SQLite.SQLiteDatabase {
  if (!db) throw new Error('Offline DB not initialised — call initOfflineDB() first');
  return db;
}

// ---------------------------------------------------------------------------
// Queue operations
// ---------------------------------------------------------------------------

/**
 * Queue a message for later delivery.
 *
 * @param conversationId - DM conversation ID or group chat ID
 * @param content        - Message content
 * @param messageType    - 'text' | 'gif' | 'sticker' | etc.
 * @returns Generated local ID for the queued message
 */
export async function queueMessage(
  conversationId: string,
  content: string,
  messageType: string = 'text'
): Promise<string> {
  const localId = `offline_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  await getDB().runAsync(
    `INSERT INTO offline_messages (id, conversation_id, content, message_type, created_at, sync_status)
     VALUES (?, ?, ?, ?, ?, 'pending')`,
    [localId, conversationId, content, messageType, Date.now()]
  );

  return localId;
}

/**
 * Get all messages waiting to be sent.
 */
export async function getPendingMessages(): Promise<Array<{
  id: string;
  conversationId: string;
  content: string;
  messageType: string;
  createdAt: number;
}>> {
  const rows = await getDB().getAllAsync<{
    id: string;
    conversation_id: string;
    content: string;
    message_type: string;
    created_at: number;
  }>(
    `SELECT id, conversation_id, content, message_type, created_at
     FROM offline_messages
     WHERE sync_status = 'pending'
     ORDER BY created_at ASC`
  );

  return rows.map((r) => ({
    id: r.id,
    conversationId: r.conversation_id,
    content: r.content,
    messageType: r.message_type,
    createdAt: r.created_at,
  }));
}

/**
 * Mark a queued message as successfully sent and remove it.
 */
export async function markMessageSent(localId: string): Promise<void> {
  await getDB().runAsync(
    `DELETE FROM offline_messages WHERE id = ?`,
    [localId]
  );
}

/**
 * Mark a message as failed (will retry on next sync attempt).
 */
export async function markMessageFailed(localId: string): Promise<void> {
  await getDB().runAsync(
    `UPDATE offline_messages SET sync_status = 'failed' WHERE id = ?`,
    [localId]
  );
}

/**
 * Delete a queued message (e.g. user cancelled or discarded).
 */
export async function deleteMessage(localId: string): Promise<void> {
  await getDB().runAsync(
    `DELETE FROM offline_messages WHERE id = ?`,
    [localId]
  );
}

/**
 * Reset all failed messages back to pending for retry.
 */
export async function resetFailedMessages(): Promise<void> {
  await getDB().runAsync(
    `UPDATE offline_messages SET sync_status = 'pending' WHERE sync_status = 'failed'`
  );
}

/**
 * Count pending messages (useful for badge display).
 */
export async function getPendingMessageCount(): Promise<number> {
  const result = await getDB().getFirstAsync<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM offline_messages WHERE sync_status = 'pending'`
  );
  return result?.cnt ?? 0;
}
