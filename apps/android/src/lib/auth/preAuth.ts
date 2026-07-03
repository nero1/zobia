let _preAuthToken: string | null = null;

export const getPreAuthToken = () => _preAuthToken;
export const setPreAuthToken = (token: string | null) => {
  _preAuthToken = token;
};

// ---------------------------------------------------------------------------
// OAuth-in-progress tracking (ZSB-22)
// ---------------------------------------------------------------------------

/**
 * Module-level "an OAuth Custom Tab is currently open" flag, shared between
 * login.tsx/register.tsx (which set it before opening the tab and read it to
 * drive their loading spinner) and __root.tsx's `appUrlOpen` handler (which
 * clears it once the OAuth exchange actually finishes, success or failure).
 *
 * Previously each screen's own `finally { setGoogleLoading(false) }` cleared
 * the spinner the instant `Browser.open(...)` resolved — i.e. the moment the
 * tab opened, not when the user finished (or abandoned) the flow in it — so
 * the spinner was visible for well under a second, giving almost no
 * protection against a user backgrounding the tab and tapping the same
 * button again.
 */
let _oauthInProgress = false;
type OAuthEndCallback = () => void;
const oauthEndCallbacks: OAuthEndCallback[] = [];

export function isOAuthInProgress(): boolean {
  return _oauthInProgress;
}

export function beginOAuthAttempt(): void {
  _oauthInProgress = true;
}

export function endOAuthAttempt(): void {
  if (!_oauthInProgress) return;
  _oauthInProgress = false;
  oauthEndCallbacks.forEach((cb) => {
    try { cb(); } catch {}
  });
}

/** Subscribe to "the in-progress OAuth attempt just ended." Returns an unsubscribe fn. */
export function onOAuthEnd(cb: OAuthEndCallback): () => void {
  oauthEndCallbacks.push(cb);
  return () => {
    const idx = oauthEndCallbacks.indexOf(cb);
    if (idx !== -1) oauthEndCallbacks.splice(idx, 1);
  };
}
