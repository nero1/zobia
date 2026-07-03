/**
 * apps/android/src/lib/hooks/useAdaptiveChatPoll.ts
 *
 * Adapted from apps/web/lib/hooks/useAdaptiveChatPoll.ts.
 * ZB-AND-08 fix: the original comment said "copied verbatim... no changes
 * needed" on the assumption `visibilitychange` alone was enough, but a
 * sibling hook in this same directory (usePresenceHeartbeat.ts) explicitly
 * documents that `visibilitychange` is unreliable inside a Capacitor
 * WebView. Added a `@capacitor/app` `appStateChange` listener alongside the
 * existing `visibilitychange` one — same pattern already used in
 * lib/api/client.ts's focusManager wiring — so backgrounding the Android
 * app reliably pauses the poll instead of continuing to fire every
 * 3-30 seconds while off-screen.
 */

import { useEffect, useRef } from "react";
import { App as CapApp } from "@capacitor/app";

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
    // Two independent signals can each demand a pause; only resume once BOTH
    // agree the app is visible/foregrounded, so one listener firing "resume"
    // can't override the other still saying "hidden/backgrounded".
    let documentHidden = typeof document !== "undefined" && document.hidden;
    let appBackgrounded = false;
    let stopped = documentHidden || appBackgrounded;
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

    const applyState = () => {
      if (documentHidden || appBackgrounded) {
        stopped = true;
        clear();
      } else if (stopped) {
        stopped = false;
        pokeNow();
      }
    };

    const onVisibilityChange = () => {
      documentHidden = typeof document !== "undefined" && document.hidden;
      applyState();
    };

    if (!stopped) {
      void tick();
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }

    const appStateHandle = CapApp.addListener("appStateChange", ({ isActive }) => {
      appBackgrounded = !isActive;
      applyState();
    });

    return () => {
      stopped = true;
      clear();
      pokeRef.current = () => {};
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
      appStateHandle.then((h) => h.remove());
    };
  }, [connected, enabled, fastMs, maxMs, slowMs]);

  return { pokePoll: () => pokeRef.current() };
}
