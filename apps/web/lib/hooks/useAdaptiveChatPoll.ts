"use client";

/**
 * lib/hooks/useAdaptiveChatPoll.ts
 *
 * Baseline message poll for chat surfaces (rooms, DMs, groups), tuned to keep
 * serverless function usage as low as possible — important on constrained
 * hosting (e.g. Vercel Hobby) where every poll is a billable invocation + a DB
 * read.
 *
 * Behaviour:
 *   - When a realtime provider is connected (`connected === true`), new messages
 *     arrive over the WebSocket, so this hook only runs a SLOW reconcile poll
 *     (default 30s) to heal any gaps (missed broadcast, brief disconnect).
 *   - When NOT connected (no provider configured, or the socket is down), it
 *     runs the FAST poll (default 3s) so delivery still works.
 *   - While the tab is hidden it stops polling entirely (a backgrounded tab does
 *     not need live updates); on becoming visible again it polls once
 *     immediately and resumes.
 *   - It also polls once immediately whenever connectivity changes, so a
 *     (re)connection triggers an instant catch-up.
 *
 * Dedup/ordering is the caller's responsibility (their incoming-message handler
 * already ignores ids it has seen), so extra poll calls are always safe.
 */

import { useEffect, useRef } from "react";

interface AdaptiveChatPollOptions {
  /** Fetches the latest messages and merges them into state. */
  poll: () => void | Promise<void>;
  /** Whether a realtime provider socket is currently connected. */
  connected: boolean;
  /** Disable entirely (e.g. while the conversation id is not yet known). */
  enabled?: boolean;
  /** Poll interval while disconnected / no provider (ms). */
  fastMs?: number;
  /** Poll interval while the realtime socket is connected (ms). */
  slowMs?: number;
}

export function useAdaptiveChatPoll({
  poll,
  connected,
  enabled = true,
  fastMs = 3_000,
  slowMs = 30_000,
}: AdaptiveChatPollOptions): void {
  // Keep the latest poll fn in a ref so changing it does not tear down/restart
  // the interval (and so the visibility listener always calls the current one).
  const pollRef = useRef(poll);
  useEffect(() => {
    pollRef.current = poll;
  }, [poll]);

  useEffect(() => {
    if (!enabled) return;

    let intervalId: ReturnType<typeof setInterval> | undefined;
    const run = () => {
      void pollRef.current();
    };
    const periodMs = connected ? slowMs : fastMs;

    const startInterval = () => {
      if (intervalId === undefined) {
        intervalId = setInterval(run, periodMs);
      }
    };
    const stopInterval = () => {
      if (intervalId !== undefined) {
        clearInterval(intervalId);
        intervalId = undefined;
      }
    };

    const onVisibilityChange = () => {
      if (typeof document !== "undefined" && document.hidden) {
        stopInterval();
      } else {
        run(); // immediate catch-up on focus
        startInterval();
      }
    };

    // Immediate poll on mount / whenever connectivity flips (instant catch-up
    // after a (re)connect or a drop), then arm the interval if visible.
    run();
    if (typeof document === "undefined" || !document.hidden) {
      startInterval();
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }

    return () => {
      stopInterval();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
    };
  }, [connected, enabled, fastMs, slowMs]);
}
