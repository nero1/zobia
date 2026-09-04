/**
 * apps/android/src/routes/games/$slug/play.tsx
 *
 * Plays a game inside the app: embeds the existing web player
 * (<API_BASE_URL>/g/<slug>/embed) in a full-screen <iframe> instead of
 * handing off to a Custom Tab (the previous behaviour via
 * openAuthenticatedWebLink — see the removed onClick in
 * routes/games/$slug/index.tsx), which visibly kicked the user out of the
 * app to play. Auth rides the same `?t=<bearer token>` mechanism the
 * embed page already supports (built for the now-retired Expo app's
 * react-native-webview host — see apps/expo/components/games/GameWebView.tsx
 * for the reference implementation this ports from).
 *
 * The embed page (via components/games/GameRunner.tsx's `bridge()`) posts
 * lifecycle messages to the parent frame:
 *   - { type: 'game_over', score, reward: { credits, xp, stars } }
 *   - { type: 'game_exit' }
 * `window.location.origin` here is the Capacitor WebView's own origin
 * (https://localhost — see capacitor.config.ts), NOT the game's origin, so
 * postMessage's origin check below is against the *game's* API base URL,
 * matching the sender.
 *
 * middleware.ts's CSP only allows this route's parent origin
 * (https://localhost / capacitor://localhost) to frame /g/<slug>/embed
 * specifically — every other route keeps frame-ancestors 'self'.
 */

import { useEffect, useRef, useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { getCachedToken } from '@/lib/api/client';
import { env } from '@/lib/env';
import { useFloatingReward } from '@/components/notifications/FloatingRewardProvider';

function GamePlayPage() {
  const { slug } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { fireReward } = useFloatingReward();
  const [loaded, setLoaded] = useState(false);
  const exitedRef = useRef(false);

  const token = getCachedToken();
  const gameOrigin = (() => {
    try { return new URL(env.VITE_API_BASE_URL).origin; } catch { return 'https://zobia.vercel.app'; }
  })();
  const src = `${env.VITE_API_BASE_URL}/g/${encodeURIComponent(slug)}/embed?t=${encodeURIComponent(token ?? '')}`;

  function exitToGame() {
    if (exitedRef.current) return;
    exitedRef.current = true;
    navigate({ to: '/games/$slug', params: { slug }, replace: true });
  }

  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (e.origin !== gameOrigin) return;
      let msg: { type?: string; score?: number; reward?: { credits?: number; xp?: number; stars?: number } };
      try {
        msg = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
      } catch {
        return;
      }
      if (!msg || typeof msg.type !== 'string') return;

      if (msg.type === 'game_over') {
        // Wallet sync: invalidate the same ['users', 'me'] query the wallet
        // page and RewardedAdButton flow already use as their source of
        // truth for coin_balance, so the new balance shows up there without
        // a manual refresh.
        void qc.invalidateQueries({ queryKey: ['users', 'me'] });
        const reward = msg.reward;
        if (reward && (reward.credits || reward.xp || reward.stars)) {
          fireReward({
            credits: typeof reward.credits === 'number' ? reward.credits : undefined,
            xp: typeof reward.xp === 'number' ? reward.xp : undefined,
            stars: typeof reward.stars === 'number' ? reward.stars : undefined,
          });
        }
        return;
      }

      if (msg.type === 'game_exit') {
        exitToGame();
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameOrigin, slug]);

  return (
    <div className="relative h-full w-full bg-black">
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        </div>
      )}
      <button
        type="button"
        onClick={exitToGame}
        aria-label="Close game"
        className="absolute right-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white"
        style={{ top: 'calc(0.75rem + env(safe-area-inset-top))' }}
      >
        ✕
      </button>
      <iframe
        src={src}
        onLoad={() => setLoaded(true)}
        title="Game"
        className="h-full w-full border-0"
        allow="autoplay; fullscreen"
      />
    </div>
  );
}

export const Route = createFileRoute('/games/$slug/play')({
  component: GamePlayPage,
});
