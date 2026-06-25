/**
 * lib/offline/sqlite.ts
 *
 * SQLite-backed offline message queue for Android.
 * Queues outgoing messages when the device is offline and syncs when reconnected.
 *
 * BUG-PRIV-01 FIX: message content is now encrypted at rest using AES-256-GCM
 * before being written to SQLite. The encryption key is generated once per device
 * and stored in expo-secure-store (backed by Android Keystore / iOS Secure Enclave).
 *
 * Encryption format: `${base64url(iv)}.${base64url(ciphertext)}`
 * The prefix `v1:` distinguishes encrypted from legacy plaintext rows so that
 * existing installations can be migrated without data loss.
 */

import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';

// ---------------------------------------------------------------------------
// Database setup
// ---------------------------------------------------------------------------

let db: SQLite.SQLiteDatabase | null = null;
let encryptionKey: CryptoKey | null = null;
let _encKeyPromise: Promise<CryptoKey> | null = null;

const DB_NAME = 'zobia_offline.db';
const SECURE_KEY_NAME = 'offline_db_aes_key_v1';
const ENCRYPTION_PREFIX = 'v1:';

// ---------------------------------------------------------------------------
// Encryption helpers
// ---------------------------------------------------------------------------

function toBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function fromBase64Url(b64: string): Uint8Array {
  const padded = b64.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  const withPad = padded + '='.repeat(padLen);
  const binary = atob(withPad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function getOrCreateEncryptionKey(): Promise<CryptoKey> {
  if (encryptionKey) return encryptionKey;
  if (_encKeyPromise) return _encKeyPromise;

  _encKeyPromise = (async () => {
    let rawKeyBase64 = await SecureStore.getItemAsync(SECURE_KEY_NAME);

    if (!rawKeyBase64) {
      // Generate a new 256-bit AES key
      const rawBytes = crypto.getRandomValues(new Uint8Array(32));
      rawKeyBase64 = toBase64Url(rawBytes.buffer);
      await SecureStore.setItemAsync(SECURE_KEY_NAME, rawKeyBase64, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    }

    const keyBytes = fromBase64Url(rawKeyBase64);
    encryptionKey = await crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );
    return encryptionKey;
  })();

  // Clear the cached promise on rejection so callers can retry
  _encKeyPromise = _encKeyPromise.catch((err) => {
    _encKeyPromise = null;
    throw err;
  });

  return _encKeyPromise;
}

async function encryptContent(plaintext: string): Promise<string> {
  const key = await getOrCreateEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return ENCRYPTION_PREFIX + toBase64Url(iv.buffer) + '.' + toBase64Url(ciphertext);
}

async function decryptContent(stored: string): Promise<string> {
  if (!stored.startsWith(ENCRYPTION_PREFIX)) {
    // Legacy plaintext row — return as-is (migration path)
    return stored;
  }
  const key = await getOrCreateEncryptionKey();
  const payload = stored.slice(ENCRYPTION_PREFIX.length);
  const dotIdx = payload.indexOf('.');
  if (dotIdx === -1) throw new Error('Malformed encrypted content');
  const iv = fromBase64Url(payload.slice(0, dotIdx));
  const ciphertext = fromBase64Url(payload.slice(dotIdx + 1));
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted);
}

// ---------------------------------------------------------------------------
// Database setup
// ---------------------------------------------------------------------------

/**
 * Initialise the offline SQLite database and create tables if needed.
 * Also initialises the encryption key (loaded from SecureStore or generated).
 */
export async function initOfflineDB(): Promise<void> {
  // Prime the encryption key so the first queueMessage call doesn't race
  await getOrCreateEncryptionKey();

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
  // Each statement is an ALTER TABLE ADD COLUMN which SQLite rejects with
  // "duplicate column name" if the column already exists — that error is
  // expected on repeat app launches and is safe to ignore. Any other error
  // (table missing, syntax error, disk full) is re-thrown so it surfaces.
  const migrations = [
    `ALTER TABLE offline_messages ADD COLUMN conversation_type TEXT NOT NULL DEFAULT 'dm'`,
    `ALTER TABLE offline_messages ADD COLUMN idempotency_key TEXT`,
    `ALTER TABLE offline_messages ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0`,
  ];
  for (const sql of migrations) {
    try {
      await db.execAsync(sql);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.toLowerCase().includes('duplicate column')) throw err;
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
 * Content is encrypted with AES-256-GCM before being written to SQLite.
 *
 * @param conversationId   - DM conversation ID or group chat ID
 * @param content          - Message content (stored encrypted)
 * @param messageType      - 'text' | 'gif' | 'sticker' | etc.
 * @param conversationType - 'dm' | 'group'
 * @returns Generated local ID for the queued message
 */
export async function queueMessage(
  conversationId: string,
  content: string,
  messageType: string = 'text',
  conversationType: 'dm' | 'group' | 'room' = 'dm',
  providedIdempotencyKey?: string,
): Promise<string> {
  const localId = `offline_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const idempotencyKey = providedIdempotencyKey ?? localId;
  const encryptedContent = await encryptContent(content);

  await getDB().runAsync(
    `INSERT INTO offline_messages
       (id, conversation_id, conversation_type, content, message_type, idempotency_key, created_at, retry_count, sync_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'pending')`,
    [localId, conversationId, conversationType, encryptedContent, messageType, idempotencyKey, Date.now()]
  );

  return localId;
}

/**
 * Get all messages waiting to be sent.
 * Content is decrypted before being returned.
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

  return Promise.all(rows.map(async (r) => ({
    id: r.id,
    conversationId: r.conversation_id,
    conversationType: (r.conversation_type === 'group' ? 'group' : r.conversation_type === 'room' ? 'room' : 'dm') as 'dm' | 'group' | 'room',
    content: await decryptContent(r.content),
    messageType: r.message_type,
    idempotencyKey: r.idempotency_key,
    createdAt: r.created_at,
  })));
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

  return Promise.all(rows.map(async (r) => ({
    id: r.id,
    conversationId: r.conversation_id,
    content: await decryptContent(r.content),
    retryCount: r.retry_count,
    createdAt: r.created_at,
  })));
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
