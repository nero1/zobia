"use client";

/**
 * lib/hooks/useAdaptiveChatPoll.ts
 *
 * Baseline message poll for chat surfaces (rooms, DMs, groups), tuned to keep
 * serverless function usage as low as possible — important on constrained
 * hosting (e.g. Vercel Hobby) where every poll is a billable invocation + a DB
 * read + Redis auth/rate-limit reads.
 *
 * Behaviour:
 *   - When a realtime provider is connected (`connected === true`), new messages
 *     arrive over the WebSocket, so this hook only runs a SLOW reconcile poll
 *     (default 30s) to heal any gaps (missed broadcast, brief disconnect).
 *   - When NOT connected (no provider configured, or the socket is down), it
 *     runs a FAST poll (default 3s) so delivery still works — but with
 *     ACTIVITY-BASED BACKOFF: while the conversation is quiet the interval grows
 *     geometrically up to `maxMs` (default 15s), and snaps back to `fastMs` the
 *     instant new data arrives (or the caller calls `pokePoll`). A 1:1 chat that
 *     is idle for a minute therefore costs ~4 polls instead of ~20, with no
 *     perceptible latency once either side is active.
 *   - While the tab is hidden it stops polling entirely (a backgrounded tab does
 *     not need live updates); on becoming visible again it polls once
 *     immediately and resumes at the fast cadence.
 *   - It also polls once immediately whenever connectivity changes, so a
 *     (re)connection triggers an instant catch-up.
 *
 * To enable backoff, the `poll` fn should return `true` when it applied new
 * messages and `false` when nothing changed. Returning `void`/`undefined`
 * disables backoff (the interval stays at `fastMs`), preserving legacy
 * behaviour for callers that have not been updated.
 *
 * Dedup/ordering is the caller's responsibility (their incoming-message handler
 * already ignores ids it has seen), so extra poll calls are always safe.
 */

import { useEffect, useRef } from "react";

interface AdaptiveChatPollOptions {
  /**
   * Fetches the latest messages and merges them into state.
   * Return `true` if new messages were applied, `false` if not, to drive
   * idle backoff. Returning nothing disables backoff.
   */
  poll: () => boolean | void | Promise<boolean | void>;
  /** Whether a realtime provider socket is currently connected. */
  connected: boolean;
  /** Disable entirely (e.g. while the conversation id is not yet known). */
  enabled?: boolean;
  /** Poll interval while disconnected / no provider, when active (ms). */
  fastMs?: number;
  /** Upper bound the disconnected interval backs off to while idle (ms). */
  maxMs?: number;
  /** Poll interval while the realtime socket is connected (ms). */
  slowMs?: number;
}

/** Imperative handle returned by the hook so callers can reset the cadence. */
export interface AdaptiveChatPollHandle {
  /**
   * Snap the poll cadence back to `fastMs` and fetch immediately. Call this on
   * local activity (e.g. right after the user sends a message) so the reply is
   * picked up without waiting out an idle backoff.
   */
  pokePoll: () => void;
}

export function useAdaptiveChatPoll({
  poll,
  connected,
  enabled = true,
  fastMs = 3_000,
  maxMs = 15_000,
  slowMs = 30_000,
}: AdaptiveChatPollOptions): AdaptiveChatPollHandle {
  // Keep the latest poll fn in a ref so changing it does not tear down/restart
  // the loop (and so the visibility listener always calls the current one).
  const pollRef = useRef(poll);
  useEffect(() => {
    pollRef.current = poll;
  }, [poll]);

  // Imperative poke handle kept stable across renders.
  const pokeRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!enabled) return;

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    // Current backoff interval for the disconnected fast path.
    let currentMs = fastMs;

    const baseMs = () => (connected ? slowMs : fastMs);
    const ceilMs = () => (connected ? slowMs : maxMs);

    const clear = () => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }
    };

    const schedule = () => {
      clear();
      if (stopped) return;
      timeoutId = setTimeout(() => void tick(), currentMs);
    };

    const tick = async () => {
      let changed: boolean | void;
      try {
        changed = await pollRef.current();
      } catch {
        changed = undefined;
      }
      // Adapt the next interval. New data (or an undefined result) keeps us
      // responsive; a quiet poll grows the gap geometrically up to the ceiling.
      if (changed === false) {
        currentMs = Math.min(Math.round(currentMs * 1.6), ceilMs());
      } else {
        currentMs = baseMs();
      }
      schedule();
    };

    const pokeNow = () => {
      currentMs = baseMs();
      void tick();
    };
    pokeRef.current = pokeNow;

    const onVisibilityChange = () => {
      if (typeof document !== "undefined" && document.hidden) {
        stopped = true;
        clear();
      } else {
        stopped = false;
        pokeNow(); // immediate catch-up on focus, reset to fast cadence
      }
    };

    // Immediate poll on mount / whenever connectivity flips (instant catch-up
    // after a (re)connect or a drop), then arm the loop if visible.
    if (typeof document === "undefined" || !document.hidden) {
      void tick();
    } else {
      stopped = true;
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }

    return () => {
      stopped = true;
      clear();
      pokeRef.current = () => {};
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
    };
  }, [connected, enabled, fastMs, maxMs, slowMs]);

  return { pokePoll: () => pokeRef.current() };
}
