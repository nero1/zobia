"use client";

/**
 * lib/realtime/ablyShared.ts
 *
 * One Ably connection per signed-in browser tab, shared by every
 * useRealtimeChannel() subscriber.
 *
 * Why: the hook used to open a new Ably.Realtime client (and fetch a new
 * token from /api/realtime/ably-token) on every mount of every channel, so
 * moving between a room, a DM and back cost a token request and a new socket
 * each time; every token request is billed Vercel Active CPU. Now the tab
 * holds one client whose token covers every channel currently in use: a new
 * token is requested only when a channel the current token does not cover
 * is joined, or when the token expires (1 h).
 *
 * Security is unchanged: the server still authorizes every channel
 * individually and signs a subscribe-only capability for exactly the channels
 * it approved (see app/api/realtime/ably-token/route.ts). The client is
 * closed on logout (closeAbly, called from the session fetch guard) and after
 * IDLE_CLOSE_MS with no subscribers.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const IDLE_CLOSE_MS = 30_000;
/** Upper bound on channels in one token (matches the server's limit). */
export const MAX_TOKEN_CHANNELS = 20;

let client: any = null;
/** Channels the current token's capability grants. */
let covered = new Set<string>();
/** Channels wanted by mounted subscribers, with reference counts (insertion = recency). */
const wanted = new Map<string, number>();
let authorizing: Promise<void> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

/** Channels to put in the next token: the most recently acquired, bounded. */
function channelsForToken(): string[] {
  return Array.from(wanted.keys()).slice(-MAX_TOKEN_CHANNELS);
}

async function fetchTokenRequest(channels: string[]): Promise<unknown> {
  const res = await fetch(
    `/api/realtime/ably-token?channels=${encodeURIComponent(channels.join(","))}`,
    { credentials: "include" }
  );
  if (!res.ok) throw new Error(`ably-token ${res.status}`);
  return res.json();
}

/** Channels a signed TokenRequest actually grants (the server may drop some). */
export function grantedChannels(tokenRequest: unknown): Set<string> {
  try {
    const capability = (tokenRequest as { capability?: string }).capability;
    return new Set(Object.keys(JSON.parse(capability ?? "{}") as Record<string, unknown>));
  } catch {
    return new Set();
  }
}

async function getClient(): Promise<any> {
  if (client) return client;
  const Ably = (await import("ably")) as any;
  if (client) return client;
  client = new Ably.Realtime({
    autoConnect: false,
    authCallback: (_params: unknown, callback: (err: unknown, token: unknown) => void) => {
      fetchTokenRequest(channelsForToken())
        .then((tokenRequest) => {
          covered = grantedChannels(tokenRequest);
          callback(null, tokenRequest);
        })
        .catch((err) => callback(err, null));
    },
  });
  return client;
}

/** Make sure the current token covers `channel`, re-authorizing at most twice. */
async function ensureCovered(c: any, channel: string): Promise<void> {
  for (let attempt = 0; attempt < 2 && !covered.has(channel); attempt++) {
    if (!authorizing) {
      authorizing = Promise.resolve(c.auth.authorize())
        .then(() => undefined)
        .finally(() => {
          authorizing = null;
        });
    }
    await authorizing;
  }
  if (!covered.has(channel)) throw new Error(`ably: channel not authorized: ${channel}`);
}

/**
 * Join `channel` on the shared client. Resolves with the client and a
 * `release` function the subscriber must call on unmount.
 */
export async function acquireAblyChannel(channel: string): Promise<{ client: any; release: () => void }> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  wanted.delete(channel); // re-insert to mark as most recent
  wanted.set(channel, (wanted.get(channel) ?? 0) + 1);

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    const n = (wanted.get(channel) ?? 1) - 1;
    if (n > 0) {
      wanted.set(channel, n);
    } else {
      wanted.delete(channel);
      try {
        client?.channels.get(channel).detach();
      } catch {
        // ignore
      }
    }
    if (wanted.size === 0 && !idleTimer) {
      idleTimer = setTimeout(closeAbly, IDLE_CLOSE_MS);
    }
  };

  try {
    const c = await getClient();
    await ensureCovered(c, channel);
    const state = c.connection.state as string;
    if (state === "initialized" || state === "closed" || state === "closing" || state === "failed") {
      c.connect();
    }
    return { client: c, release };
  } catch (err) {
    release();
    throw err;
  }
}

/** Close the shared connection (logout, user change, idle). */
export function closeAbly(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  try {
    client?.close();
  } catch {
    // ignore
  }
  client = null;
  covered = new Set();
  authorizing = null;
}
