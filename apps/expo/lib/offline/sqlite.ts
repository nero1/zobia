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
      id                TEXT PRIMARY KEY,
      conversation_id   TEXT NOT NULL,
      conversation_type TEXT NOT NULL DEFAULT 'dm',
      content           TEXT NOT NULL,
      message_type      TEXT NOT NULL DEFAULT 'text',
      idempotency_key   TEXT,
      created_at        INTEGER NOT NULL,
      retry_count       INTEGER NOT NULL DEFAULT 0,
      sync_status       TEXT NOT NULL DEFAULT 'pending'
        CHECK (sync_status IN ('pending', 'sending', 'failed', 'permanent_failure'))
    );

    CREATE INDEX IF NOT EXISTS idx_offline_messages_status
      ON offline_messages(sync_status, created_at);
  `);

  // Migration: add new columns to existing installations that lack them.
  // SQLite ignores "duplicate column" errors so we suppress them individually.
  const migrations = [
    `ALTER TABLE offline_messages ADD COLUMN conversation_type TEXT NOT NULL DEFAULT 'dm'`,
    `ALTER TABLE offline_messages ADD COLUMN idempotency_key TEXT`,
    `ALTER TABLE offline_messages ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0`,
  ];
  for (const sql of migrations) {
    try {
      await db.execAsync(sql);
    } catch {
      // Column already exists — safe to ignore.
    }
  }
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
 * @param conversationId   - DM conversation ID or group chat ID
 * @param content          - Message content
 * @param messageType      - 'text' | 'gif' | 'sticker' | etc.
 * @param conversationType - 'dm' | 'group'
 * @returns Generated local ID for the queued message
 */
export async function queueMessage(
  conversationId: string,
  content: string,
  messageType: string = 'text',
  conversationType: 'dm' | 'group' | 'room' = 'dm'
): Promise<string> {
  const localId = `offline_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const idempotencyKey = `${localId}_${Date.now()}`;

  await getDB().runAsync(
    `INSERT INTO offline_messages
       (id, conversation_id, conversation_type, content, message_type, idempotency_key, created_at, retry_count, sync_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'pending')`,
    [localId, conversationId, conversationType, content, messageType, idempotencyKey, Date.now()]
  );

  return localId;
}

/**
 * Get all messages waiting to be sent.
 */
export async function getPendingMessages(): Promise<{
  id: string;
  conversationId: string;
  conversationType: 'dm' | 'group' | 'room';
  content: string;
  messageType: string;
  idempotencyKey: string | null;
  createdAt: number;
}[]> {
  const rows = await getDB().getAllAsync<{
    id: string;
    conversation_id: string;
    conversation_type: string;
    content: string;
    message_type: string;
    idempotency_key: string | null;
    created_at: number;
  }>(
    `SELECT id, conversation_id, conversation_type, content, message_type, idempotency_key, created_at
     FROM offline_messages
     WHERE sync_status = 'pending'
     ORDER BY created_at ASC`
  );

  return rows.map((r) => ({
    id: r.id,
    conversationId: r.conversation_id,
    conversationType: (r.conversation_type === 'group' ? 'group' : r.conversation_type === 'room' ? 'room' : 'dm') as 'dm' | 'group' | 'room',
    content: r.content,
    messageType: r.message_type,
    idempotencyKey: r.idempotency_key,
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
 * Mark a message as transiently failed (increments retry_count; will retry on next sync).
 */
export async function markMessageFailed(localId: string): Promise<void> {
  await getDB().runAsync(
    `UPDATE offline_messages
     SET sync_status = 'failed', retry_count = retry_count + 1
     WHERE id = ?`,
    [localId]
  );
}

/**
 * Mark a message as permanently failed (4xx client error — no point retrying).
 */
export async function markMessagePermanentlyFailed(localId: string): Promise<void> {
  await getDB().runAsync(
    `UPDATE offline_messages SET sync_status = 'permanent_failure' WHERE id = ?`,
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
 * Reset failed messages that have not yet hit the retry ceiling back to pending.
 * Messages with retry_count >= 3 are left as 'failed' for manual review.
 */
export async function resetFailedMessages(): Promise<void> {
  await getDB().runAsync(
    `UPDATE offline_messages SET sync_status = 'pending'
     WHERE sync_status = 'failed' AND retry_count < 3`
  );
}

/**
 * Get all messages that have permanently failed (4xx or >= 3 retries).
 */
export async function getPermanentlyFailedMessages(): Promise<{
  id: string;
  conversationId: string;
  content: string;
  retryCount: number;
  createdAt: number;
}[]> {
  const rows = await getDB().getAllAsync<{
    id: string;
    conversation_id: string;
    content: string;
    retry_count: number;
    created_at: number;
  }>(
    `SELECT id, conversation_id, content, retry_count, created_at
     FROM offline_messages
     WHERE sync_status = 'permanent_failure' OR (sync_status = 'failed' AND retry_count >= 3)
     ORDER BY created_at ASC`
  );

  return rows.map((r) => ({
    id: r.id,
    conversationId: r.conversation_id,
    content: r.content,
    retryCount: r.retry_count,
    createdAt: r.created_at,
  }));
}

/**
 * Mark a message as in-flight (sending) before the API call to prevent
 * double-send on crash-restart. (BUG-20)
 */
export async function markMessageSending(localId: string): Promise<void> {
  await getDB().runAsync(
    `UPDATE offline_messages SET sync_status = 'sending' WHERE id = ?`,
    [localId]
  );
}

/**
 * On app startup, reset any messages stuck in 'sending' (interrupted mid-send)
 * back to 'pending' so they are retried. (BUG-20)
 */
export async function resetSendingMessages(): Promise<void> {
  await getDB().runAsync(
    `UPDATE offline_messages SET sync_status = 'pending'
     WHERE sync_status = 'sending'`
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
