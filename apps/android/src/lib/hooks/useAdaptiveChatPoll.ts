/**
 * apps/android/src/lib/hooks/useAdaptiveChatPoll.ts
 *
 * Copied verbatim from apps/web/lib/hooks/useAdaptiveChatPoll.ts.
 * No changes needed — it is already framework-agnostic React.
 */

import { useEffect, useRef } from "react";

interface AdaptiveChatPollOptions {
  poll: () => boolean | void | Promise<boolean | void>;
  connected: boolean;
  enabled?: boolean;
  fastMs?: number;
  maxMs?: number;
  slowMs?: number;
}

export interface AdaptiveChatPollHandle {
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
  const pollRef = useRef(poll);
  useEffect(() => {
    pollRef.current = poll;
  }, [poll]);

  const pokeRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!enabled) return;

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
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
        pokeNow();
      }
    };

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
