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

// BUG-IDB-01 FIX: use a lazy getter that clears the cached promise on rejection
// so the next call retries the open. The original module-level assignment cached
// a rejected promise permanently, breaking the offline queue for the entire
// session with no recovery path (e.g. private-browsing IDB block, quota exceeded).
let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
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
  }).catch((err) => {
    // Clear the cache so the next caller can retry the open rather than
    // receiving the same permanent rejection for the rest of the session.
    dbPromise = null;
    throw err;
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
 * Update the status of a queued message atomically.
 *
 * BUG-IDB-02 FIX: perform the get and put inside a single readwrite
 * transaction using raw IDB callbacks (no `await` between get and put).
 * Awaiting between two separate promisified IDB operations allows the
 * browser to auto-commit the transaction between them, and allows a
 * concurrent call to read a stale snapshot and silently overwrite the
 * first call's put with stale data (lost update).
 */
export async function updateMessageStatus(
  id: string,
  updates: Partial<Pick<PendingMessage, "status" | "attempts" | "lastAttemptAt">>
): Promise<void> {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const existing = getReq.result as PendingMessage | undefined;
      if (!existing) { resolve(); return; }
      store.put({ ...existing, ...updates });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Remove a successfully sent message from the queue.
 */
export async function dequeueMessage(id: string): Promise<void> {
  const db = await openDB();
  await promisify(txStore(db, "readwrite").delete(id));
}

/**
 * Fetch all messages in the queue regardless of status.
 */
async function getAllMessages(): Promise<PendingMessage[]> {
  const db = await openDB();
  const store = txStore(db, "readonly");
  return promisify(store.getAll());
}

/**
 * Count messages by status.
 */
export async function getQueueCounts(): Promise<Record<PendingMessageStatus, number>> {
  // Use getAllMessages so failed/sending counts are not always 0 (L-07)
  const all = await getAllMessages();
  const counts: Record<PendingMessageStatus, number> = { pending: 0, sending: 0, failed: 0 };
  for (const m of all) {
    if (m.status in counts) counts[m.status]++;
  }
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
 * Reset all 'sending' messages back to 'pending'.
 * Call this on app start / reconnect to recover messages that were in-flight
 * when the tab crashed or the browser was closed mid-send.
 *
 * BUG-IDB-01 FIX: use raw IDB callbacks for both the index.getAll and the
 * subsequent store.put calls so they all execute within the same readwrite
 * transaction. Awaiting between promisified IDB requests allows the browser to
 * auto-commit the transaction before the put calls are issued.
 */
export async function resetSendingMessages(): Promise<number> {
  const db = await openDB();
  return new Promise<number>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const index = store.index("status");
    const getReq = index.getAll(IDBKeyRange.only("sending"));
    getReq.onsuccess = () => {
      const messages = (getReq.result ?? []) as PendingMessage[];
      for (const msg of messages) {
        store.put({ ...msg, status: "pending" as PendingMessageStatus });
      }
      // count captured synchronously; resolve when tx commits
      tx.oncomplete = () => resolve(messages.length);
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Reset all 'failed' messages back to 'pending' so they are retried.
 * Returns the number of messages re-queued.
 *
 * BUG-IDB-01 FIX: same raw-callback pattern as resetSendingMessages.
 */
export async function retryFailed(): Promise<number> {
  const db = await openDB();
  return new Promise<number>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const index = store.index("status");
    const getReq = index.getAll(IDBKeyRange.only("failed"));
    getReq.onsuccess = () => {
      const messages = (getReq.result ?? []) as PendingMessage[];
      for (const msg of messages) {
        store.put({ ...msg, status: "pending" as PendingMessageStatus, lastAttemptAt: null });
      }
      tx.oncomplete = () => resolve(messages.length);
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
