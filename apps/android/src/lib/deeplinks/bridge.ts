/**
 * apps/android/src/lib/deeplinks/bridge.ts
 *
 * ZSB-04 fix: the Custom Tab opened by `Browser.open({ url: universalLink(...) })`
 * has no web session at all — the mobile OAuth flow never sets browser cookies
 * — so tapping "Verify identity (KYC)", "Manage on web", "View KYC Submissions",
 * or "Resume"/"Play" on a game just landed on the web login page.
 *
 * `openAuthenticatedWebLink()` mints a short-lived, single-use bridge code via
 * POST /api/auth/mobile-bridge (authenticated with this app's Bearer token),
 * then opens the consume endpoint, which exchanges the code for a real,
 * cookie-backed web session before redirecting to the requested path.
 */

import { Browser } from '@capacitor/browser';
import { apiClient } from '@/lib/api/client';
import { universalLink } from '@/lib/deeplinks/routes';

interface MintBridgeResponse {
  code: string;
}

/**
 * Open an authenticated web page in the in-app browser, bridging the current
 * mobile session into a real web session first.
 *
 * Falls back to a plain (unauthenticated) `universalLink(path)` open if
 * minting the bridge code fails, so a transient network error degrades to
 * the previous (broken-but-familiar) behaviour instead of doing nothing.
 */
export async function openAuthenticatedWebLink(path: string): Promise<void> {
  try {
    const { data } = await apiClient.post<MintBridgeResponse>('/auth/mobile-bridge', { path });
    const consumeUrl = universalLink(
      `/api/auth/mobile-bridge/consume?code=${encodeURIComponent(data.code)}&redirect=${encodeURIComponent(path)}`
    );
    await Browser.open({ url: consumeUrl, presentationStyle: 'popover' });
  } catch (err) {
    console.error('[bridge] Failed to mint mobile-bridge code, opening unauthenticated link:', err);
    await Browser.open({ url: universalLink(path), presentationStyle: 'popover' });
  }
}
