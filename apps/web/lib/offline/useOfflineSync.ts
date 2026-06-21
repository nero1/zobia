/**
 * lib/offline/useOfflineSync.ts
 *
 * React hook that monitors network status and replays the offline message queue
 * when connectivity is restored.
 *
 * Usage:
 *   useOfflineSync()  // Mount once in the root layout — fires-and-forgets
 */

"use client";

import { useEffect, useRef, useCallback } from "react";
import {
  getPendingMessages,
  updateMessageStatus,
  dequeueMessage,
  resetSendingMessages,
} from "./messageQueue";

const MAX_ATTEMPTS = 5;
/** Base delay for the exponential backoff formula: delay = min(BASE * 2^attempt, MAX_DELAY) */
const RETRY_BASE_DELAY_MS = 2_000;
const RETRY_MAX_DELAY_MS = 60_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function sendMessage(msg: {
  recipientId: string;
  conversationId: string | null;
  content: string;
  messageType: "text" | "gif" | "moment";
  mediaUrl?: string;
  idempotencyKey: string;
}): Promise<void> {
  const body: Record<string, unknown> = {
    recipientId: msg.recipientId,
    content: msg.content,
    messageType: msg.messageType,
    idempotencyKey: msg.idempotencyKey,
  };
  if (msg.mediaUrl) body.mediaUrl = msg.mediaUrl;

  const res = await fetch("/api/messages/dm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "include",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useOfflineSync(): void {
  const isRunning = useRef(false);

  const flushQueue = useCallback(async () => {
    if (isRunning.current) return;
    isRunning.current = true;

    try {
      const pending = await getPendingMessages();
      const toSend = pending.filter(
        (m) => m.status !== "sending" && m.attempts < MAX_ATTEMPTS
      );

      for (const msg of toSend) {
        try {
          await updateMessageStatus(msg.id, {
            status: "sending",
            attempts: msg.attempts + 1,
            lastAttemptAt: Date.now(),
          });

          await sendMessage(msg);
          await dequeueMessage(msg.id);
        } catch {
          const nextAttempts = msg.attempts + 1;
          if (nextAttempts >= MAX_ATTEMPTS) {
            await updateMessageStatus(msg.id, {
              status: "failed",
              attempts: nextAttempts,
              lastAttemptAt: Date.now(),
            });
          } else {
            await updateMessageStatus(msg.id, {
              status: "pending",
              attempts: nextAttempts,
              lastAttemptAt: Date.now(),
            });
          }
          // Exponential backoff: 2s, 4s, 8s, 16s, capped at 60s (BUG-19)
          const delay = Math.min(RETRY_BASE_DELAY_MS * Math.pow(2, nextAttempts - 1), RETRY_MAX_DELAY_MS);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    } finally {
      isRunning.current = false;
    }
  }, []);

  useEffect(() => {
    // BUG-M03: resetSendingMessages was called outside the isRunning guard, allowing
    // concurrent resets when both the "online" event and the mount useEffect fired
    // simultaneously. Guard the reset under isRunning, release before handing off
    // to flushQueue so flushQueue can acquire the guard on its own path.
    const safeResetAndFlush = async () => {
      if (isRunning.current) return;
      isRunning.current = true;
      try {
        await resetSendingMessages();
      } catch {
        // Non-fatal — reset failure is benign; proceed to flush anyway.
      } finally {
        isRunning.current = false;
      }
      // Guard released — flushQueue acquires it independently.
      if (navigator.onLine) flushQueue();
    };

    const handleOnline = () => {
      safeResetAndFlush();
    };

    window.addEventListener("online", handleOnline);

    // On mount: reset stranded "sending" messages from a previous session,
    // then flush if already online.
    safeResetAndFlush();

    return () => {
      window.removeEventListener("online", handleOnline);
    };
  }, [flushQueue]);
}
