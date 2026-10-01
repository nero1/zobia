/**
 * apps/android/src/lib/realtime/ablyShared.ts
 *
 * One Ably connection per signed-in session, shared by every
 * useRealtimeChannel() subscriber. Mirrors apps/web/lib/realtime/ablyShared.ts.
 *
 * Why: the hook used to create a new Ably.Realtime client, and fetch a new
 * token from /api/realtime/ably-token, on every mount of every channel. Each
 * token request is billed Vercel Active CPU. Now one client holds a token
 * covering every channel in use; a new token is requested only when a
 * channel the current token does not cover is joined, or on expiry (1 h).
 *
 * Security is unchanged: the server authorizes each channel and signs a
 * subscribe-only capability for exactly the approved ones. The connection
 * closes on sign-out or when a different user signs in (token `sub`
 * changes), and after IDLE_CLOSE_MS with no subscribers.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { App } from '@capacitor/app';
import { apiClient, onCachedTokenChange, refreshAccessToken } from '@/lib/api/client';

const IDLE_CLOSE_MS = 30_000;
/** Upper bound on channels in one token (matches the server's limit). */
export const MAX_TOKEN_CHANNELS = 20;

let client: any = null;
let covered = new Set<string>();
const wanted = new Map<string, number>();
let authorizing: Promise<void> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let appStateHandle: { remove: () => Promise<void> } | null = null;
let currentSub: string | null = null;

/** `sub` claim of a JWT, or null. */
function subOf(token: string | null): string | null {
  if (!token) return null;
  try {
    const payload = token.split('.')[1] ?? '';
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return (JSON.parse(json) as { sub?: string }).sub ?? null;
  } catch {
    return null;
  }
}

// Close on sign-out or account switch; a plain token refresh keeps the socket.
onCachedTokenChange((token) => {
  const sub = subOf(token);
  if (sub === null || (currentSub !== null && sub !== currentSub)) closeAbly();
  currentSub = sub;
});

function channelsForToken(): string[] {
  return Array.from(wanted.keys()).slice(-MAX_TOKEN_CHANNELS);
}

async function fetchTokenRequest(channels: string[]): Promise<unknown> {
  const url = `/realtime/ably-token?channels=${encodeURIComponent(channels.join(','))}`;
  try {
    const { data } = await apiClient.get(url);
    return data;
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 401 && (await refreshAccessToken())) {
      const { data } = await apiClient.get(url);
      return data;
    }
    throw err;
  }
}

/** Channels a signed TokenRequest actually grants (the server may drop some). */
export function grantedChannels(tokenRequest: unknown): Set<string> {
  try {
    const capability = (tokenRequest as { capability?: string }).capability;
    return new Set(Object.keys(JSON.parse(capability ?? '{}') as Record<string, unknown>));
  } catch {
    return new Set();
  }
}

async function getClient(): Promise<any> {
  if (client) return client;
  const Ably = (await import('ably')) as any;
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
  // Reconnect when the app returns to the foreground (WebView sockets drop
  // while backgrounded).
  const RECOVERABLE_STATES = new Set(['initialized', 'suspended', 'disconnected']);
  void App.addListener('appStateChange', ({ isActive }) => {
    if (isActive && client && wanted.size > 0 && RECOVERABLE_STATES.has(client.connection.state)) {
      client.connect();
    }
  }).then((h) => {
    appStateHandle = h;
  });
  return client;
}

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

/** Join `channel` on the shared client; call `release` on unmount. */
export async function acquireAblyChannel(channel: string): Promise<{ client: any; release: () => void }> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  wanted.delete(channel);
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
    if (wanted.size === 0 && !idleTimer) idleTimer = setTimeout(closeAbly, IDLE_CLOSE_MS);
  };

  try {
    const c = await getClient();
    await ensureCovered(c, channel);
    const state = c.connection.state as string;
    if (state === 'initialized' || state === 'closed' || state === 'closing' || state === 'failed') {
      c.connect();
    }
    return { client: c, release };
  } catch (err) {
    release();
    throw err;
  }
}

/** Close the shared connection (sign-out, account switch, idle). */
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
  void appStateHandle?.remove();
  appStateHandle = null;
  client = null;
  covered = new Set();
  authorizing = null;
}
