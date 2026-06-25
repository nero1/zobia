/**
 * components/games/GameWebView.tsx
 *
 * Renders a Zobia game inside the mobile app by loading the web embed page
 * (<API_BASE_URL>/g/<slug>/embed) in a WebView. The same HTML5 engine powers
 * web, PWA and mobile — write once, run everywhere.
 *
 * Auth: the stored access token is injected via the URL and as a global so the
 * embed's fetches authenticate without a cookie. Score/reward lifecycle events
 * are posted back from the embed via window.ReactNativeWebView.postMessage.
 */

import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import * as SecureStore from 'expo-secure-store';
import { JWT_KEY } from '@/lib/api/client';
import { env } from '@/lib/env';

interface GameWebViewProps {
  slug: string;
  /** When set, plays a round of this challenge instead of a solo run. */
  challengeId?: string | null;
  onGameOver?: (payload: { score: number; reward?: { credits: number; xp: number; stars: number } }) => void;
}

export function GameWebView({ slug, challengeId, onGameOver }: GameWebViewProps) {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const onGameOverRef = useRef(onGameOver);
  onGameOverRef.current = onGameOver;

  useEffect(() => {
    SecureStore.getItemAsync(JWT_KEY).then((t) => {
      setToken(t ?? null);
      setReady(true);
    });
  }, []);

  if (!ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const params = new URLSearchParams();
  if (challengeId) params.set('c', challengeId);
  const uri = `${env.API_BASE_URL}/g/${encodeURIComponent(slug)}/embed?${params.toString()}`;

  // Make the token available before content scripts run, too.
  const injectedBefore = token
    ? `window.__ZOBIA_TOKEN__ = ${JSON.stringify(token)}; true;`
    : 'true;';

  const handleMessage = (e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data) as {
        type: string;
        score?: number;
        reward?: { credits: number; xp: number; stars: number };
      };
      if (msg.type === 'game_over') {
        onGameOverRef.current?.({ score: msg.score ?? 0, reward: msg.reward });
      }
    } catch {
      /* ignore malformed bridge messages */
    }
  };

  return (
    <WebView
      source={{ uri }}
      injectedJavaScriptBeforeContentLoaded={injectedBefore}
      onMessage={handleMessage}
      originWhitelist={['https://zobia.vercel.app']}
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
