/**
 * components/games/GameWebView.tsx
 *
 * Renders a Zobia game inside the mobile app by loading the web embed page
 * (<API_BASE_URL>/g/<slug>/embed) in a WebView. The same HTML5 engine powers
 * web, PWA and mobile — write once, run everywhere.
 *
 * Auth: games communicate with the API via a postMessage-based proxy. The game
 * posts { type: 'API_REQUEST', requestId, method, endpoint, body } and the host
 * makes the call using the secure React Native apiClient, then posts back the
 * result. The raw JWT is never exposed to WebView scripts.
 *
 * Score/reward lifecycle events are posted back from the embed via
 * window.ReactNativeWebView.postMessage.
 */

import { useRef } from 'react';
import { StyleSheet } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { apiClient } from '@/lib/api/client';
import { env } from '@/lib/env';

const ALLOWED_GAME_METHODS = new Set(['get', 'post']);

const ALLOWED_GAME_ENDPOINTS: RegExp[] = [
  /^\/games\/[^/]+\/score$/,
  /^\/games\/[^/]+\/events$/,
  /^\/games\/[^/]+\/state$/,
  /^\/challenges\/[^/]+\/score$/,
  /^\/challenges\/[^/]+\/events$/,
];

interface GameWebViewProps {
  slug: string;
  /** When set, plays a round of this challenge instead of a solo run. */
  challengeId?: string | null;
  onGameOver?: (payload: { score: number; reward?: { credits: number; xp: number; stars: number } }) => void;
}

export function GameWebView({ slug, challengeId, onGameOver }: GameWebViewProps) {
  const webViewRef = useRef<WebView>(null);
  const onGameOverRef = useRef(onGameOver);
  onGameOverRef.current = onGameOver;

  const params = new URLSearchParams();
  if (challengeId) params.set('c', challengeId);
  const uri = `${env.API_BASE_URL}/g/${encodeURIComponent(slug)}/embed?${params.toString()}`;

  // Derive the allowed origin from the configured API base URL so staging and
  // production builds each allow the correct domain (BUG-WV-01).
  const gameOrigin = (() => {
    try { return new URL(env.API_BASE_URL).origin; } catch { return 'https://zobia.vercel.app'; }
  })();

  const handleMessage = async (e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data) as {
        type: string;
        requestId?: string;
        method?: string;
        endpoint?: string;
        body?: unknown;
        score?: number;
        reward?: { credits: number; xp: number; stars: number };
      };

      if (msg.type === 'game_over') {
        onGameOverRef.current?.({ score: msg.score ?? 0, reward: msg.reward });
        return;
      }

      // postMessage-based API proxy — game posts API_REQUEST, host responds with
      // API_RESPONSE. The JWT never touches WebView script scope (BUG-SEC-01).
      if (msg.type === 'API_REQUEST' && msg.requestId && msg.method && msg.endpoint) {
        const method = msg.method.toLowerCase();
        const endpoint = msg.endpoint;
        const reject = (reason: string) =>
          webViewRef.current?.postMessage(
            JSON.stringify({ type: 'API_RESPONSE', requestId: msg.requestId, error: reason })
          );

        if (!ALLOWED_GAME_METHODS.has(method)) {
          reject('Method not allowed');
          return;
        }
        if (!ALLOWED_GAME_ENDPOINTS.some((re) => re.test(endpoint))) {
          reject('Endpoint not allowed');
          return;
        }

        try {
          type ApiMethod = (url: string, data?: unknown) => Promise<{ data: unknown }>;
          const response = await (apiClient[method as 'get' | 'post'] as ApiMethod)(endpoint, msg.body);
          webViewRef.current?.postMessage(
            JSON.stringify({ type: 'API_RESPONSE', requestId: msg.requestId, data: response.data })
          );
        } catch (err) {
          const error = err instanceof Error ? err.message : 'Request failed';
          webViewRef.current?.postMessage(
            JSON.stringify({ type: 'API_RESPONSE', requestId: msg.requestId, error })
          );
        }
      }
    } catch {
      /* ignore malformed bridge messages */
    }
  };

  return (
    <WebView
      ref={webViewRef}
      source={{ uri }}
      onMessage={handleMessage}
      originWhitelist={[`${gameOrigin}/*`, gameOrigin, 'about:blank']}
      javaScriptEnabled
      domStorageEnabled
      startInLoadingState
      style={styles.web}
    />
  );
}

const styles = StyleSheet.create({
  web: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
