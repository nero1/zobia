/**
 * lib/offline/messageQueue.ts
 *
 * IndexedDB-backed offline message queue for the web PWA.
 *
 * When the user sends a message while offline (or the request fails),
 * the message is stored here and replayed when connectivity is restored.
 *
 * DB: "zobia_offline" / store: "message_queue"
 */

const DB_NAME = "zobia_offline";
const DB_VERSION = 1;
const STORE_NAME = "message_queue";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PendingMessageStatus = "pending" | "sending" | "failed";

export interface PendingMessage {
  id: string;
  conversationId: string | null;
  recipientId: string;
  content: string;
  messageType: "text" | "gif" | "moment";
  mediaUrl?: string;
  idempotencyKey: string;
  status: PendingMessageStatus;
  attempts: number;
  createdAt: number;
  lastAttemptAt: number | null;
}

// ---------------------------------------------------------------------------
// DB bootstrap
// ---------------------------------------------------------------------------

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !("indexedDB" in window)) {
      reject(new Error("IndexedDB not available"));
      return;
    }

    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("status", "status", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };

    req.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
    req.onerror = (e) => reject((e.target as IDBOpenDBRequest).error);
  });

  return dbPromise;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function txStore(
  db: IDBDatabase,
  mode: IDBTransactionMode
): IDBObjectStore {
  return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function generateId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Enqueue a message for offline sending.
 */
export async function enqueueMessage(
  msg: Omit<PendingMessage, "id" | "status" | "attempts" | "createdAt" | "lastAttemptAt">
): Promise<PendingMessage> {
  const db = await openDB();
  const pending: PendingMessage = {
    ...msg,
    id: generateId(),
    status: "pending",
    attempts: 0,
    createdAt: Date.now(),
    lastAttemptAt: null,
  };
  await promisify(txStore(db, "readwrite").put(pending));
  return pending;
}

/**
 * Get all pending (unsent) messages, ordered by creation time.
 * Only returns messages with status === 'pending'.
 */
export async function getPendingMessages(): Promise<PendingMessage[]> {
  const db = await openDB();
  const store = txStore(db, "readonly");
  const index = store.index("status");
  return promisify(index.getAll(IDBKeyRange.only("pending")));
}

/**
 * Update the status of a queued message.
 */
export async function updateMessageStatus(
  id: string,
  updates: Partial<Pick<PendingMessage, "status" | "attempts" | "lastAttemptAt">>
): Promise<void> {
  const db = await openDB();
  const store = txStore(db, "readwrite");
  const existing = await promisify<PendingMessage>(store.get(id));
  if (!existing) return;
  await promisify(store.put({ ...existing, ...updates }));
}

/**
 * Remove a successfully sent message from the queue.
 */
export async function dequeueMessage(id: string): Promise<void> {
  const db = await openDB();
  await promisify(txStore(db, "readwrite").delete(id));
}

/**
 * Count messages by status.
 */
export async function getQueueCounts(): Promise<Record<PendingMessageStatus, number>> {
  const all = await getPendingMessages();
  const counts: Record<PendingMessageStatus, number> = { pending: 0, sending: 0, failed: 0 };
  for (const m of all) counts[m.status]++;
  return counts;
}

/**
 * Clear all queued messages (e.g., on sign-out).
 */
export async function clearQueue(): Promise<void> {
  const db = await openDB();
  await promisify(txStore(db, "readwrite").clear());
}

/**
 * Reset all 'failed' messages back to 'pending' so they are retried.
 * Returns the number of messages re-queued.
 */
export async function retryFailed(): Promise<number> {
  const db = await openDB();
  const store = txStore(db, "readwrite");
  const index = store.index("status");
  const failedMessages = await promisify<PendingMessage[]>(
    index.getAll(IDBKeyRange.only("failed"))
  );
  for (const msg of failedMessages) {
    await promisify(store.put({ ...msg, status: "pending" as PendingMessageStatus, lastAttemptAt: null }));
  }
  return failedMessages.length;
}
