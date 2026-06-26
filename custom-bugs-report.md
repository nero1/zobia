# Zobia Expo App — Forensic Bug Report

> **Analysis scope:** `apps/expo/` — all files read and analyzed forensically across three passes.
> Files analyzed include: `app.config.ts`, `eas.json`, `app/_layout.tsx`, all `app/` screens (auth, onboarding, economy, settings, rooms, messages, games, guilds, notifications, profile, creator), all `lib/` modules (auth, api, payments, offline, realtime, deeplinks, chat, ads, i18n, theme, env, hooks, utils), and all `components/`.
> No fixes were applied. This report is analysis only.

---

## Bug List (one-line summary)

1. **[SEC-01]** EAS_PROJECT_ID is never injected into any EAS build profile — the `'YOUR_EAS_PROJECT_ID'` placeholder ships in production, breaking push-notification token registration.
2. **[SEC-02]** Email change in Settings sends a PATCH immediately with no email-verification flow — a user can claim any email address they do not own.
3. **[SEC-03]** `requestNonPersonalizedAdsOnly: true` is hardcoded in all ad requests regardless of UMP consent status — personalized ads are never served even when the user has consented, reducing ad revenue and potentially violating AdMob policy.
4. **[SEC-04]** GIF URLs sent in messages are not validated before forwarding to the API — if the backend ever fetches or proxies those URLs (e.g., for thumbnail generation), this is an SSRF vector.
5. **[SEC-05]** GameWebView `originWhitelist` uses `["${gameOrigin}/*", gameOrigin]` — the `/*` suffix is a URL pattern, not an origin; `postMessage` origin whitelisting in React Native WebView uses the document origin, so the wildcard is semantically wrong and could cause false rejections or false acceptances depending on SDK version.
6. **[SEC-06]** `settings/pin.tsx` uses raw-string MMKV keys (`'settings_pin_failed_attempts'`, `'settings_pin_locked_until'`) outside the `STORE_KEYS` registry — `clearStore()` called on sign-out never removes them, so PIN lockout state persists across user accounts on the same device.
7. **[BF-01]** TOTP lockout (two-factor.tsx) uses a fixed 15-minute window with no exponential backoff — after expiry, an attacker gets another 5 attempts; repeated 15-minute cycles enable eventual brute force.
8. **[BF-02]** Gift-send PIN lockout (gift-send.tsx) uses a fixed 15-minute window, while the Store PIN uses exponential backoff — inconsistent protection levels across the same app.
9. **[BF-03]** Settings PIN setup/change (settings/pin.tsx) uses a fixed 1-minute lockout (`PIN_LOCKOUT_MS = 60_000`) — far shorter than other flows (15 min) and no exponential backoff.
10. **[DATA-01]** `handleSubscribe` callback in `subscription.tsx` has `[queryClient, isAnnual]` as deps but reads `currentTier` (from query data) as a free variable — stale closure means the wrong `oldProductId` may be sent to Google Play Billing on upgrade if the subscription query refetches mid-flow.
11. **[DATA-02]** `notifications/index.tsx` has no cursor-based or offset pagination — it fetches all notifications in a single request with `GET /notifications`; accounts with large notification histories may encounter timeouts or excessive memory use.
12. **[DATA-03]** Contacts upload in onboarding (`handleFindFriends`) sends all phone numbers in a single unchunked HTTP POST — a user with 10,000+ contacts can produce a payload exceeding typical server body-size limits, silently truncating the contact list.
13. **[UX-01]** `NotifRow` in `notifications/index.tsx` has no `onPress` handler — notification rows are visually interactive but tapping them does nothing; users cannot navigate to the relevant content.
14. **[UX-02]** TOTP locked-out state in `two-factor.tsx` is never reset by a timer — once `lockedOut` is true, the UI stays locked until the component is destroyed and re-mounted even after the 15-minute window has elapsed.
15. **[UX-03]** `change-password.tsx` renders `<Button title={...} />` but the `Button` component API uses a `label` prop — the button label silently renders empty/blank.
16. **[UX-04]** `handleFindFriends` in `onboarding/index.tsx` sets status `'unavailable'` for ALL errors that are not `'permission_denied'` — API errors, network failures, and any other problem shows the misleading message "Contacts access is not available on this device."
17. **[UX-05]** The `'enter_remove'` step in `settings/pin.tsx` is dead code — the remove flow enters at `'enter_current'` with `mode = 'remove'` and `advance()` routes removal there; `'enter_remove'` can never be reached.
18. **[UX-06]** `welcome-drop.tsx` — if `POST /onboarding/complete` returns a 4xx (e.g., 409 Conflict for an already-completed account), `setSubmitError(true)` fires but `ONBOARDING_COMPLETE` is never written to MMKV — the app loops back to onboarding on next launch.
19. **[UX-07]** Settings notifications panel dispatches a full `merged.notifications` object (all 7 notification keys) on every single toggle via `patchMutation.mutate({ notifications: updated })` — every single toggle sends all preferences to the server rather than just the changed one.
20. **[PERF-01]** `notifications/index.tsx` performs no pagination — `GET /notifications` returns all notifications; this is both a server-load and a memory issue at scale.
21. **[PERF-02]** `useCurrency` hook and the `manifestFeatures` query in `settings/index.tsx` both call `GET /manifest` with different React Query keys (`['manifest','currency']` vs `['manifest','features']`) — the same endpoint is fetched twice and cached separately; two round trips where one would suffice.
22. **[PERF-03]** `app/rooms/[roomId].tsx` uses the plain `Image` from `react-native` for GIF thumbnails, while `app/messages/[conversationId].tsx` correctly uses `expo-image` — inconsistent; react-native's `Image` has inferior GIF rendering, recycling, and memory management on Android.
23. **[FIN-01]** Subscription screen `PlanCard` has hardcoded Naira price strings (`₦500`, `₦1,500`, etc.) that are used as fallback display values; although live Play Store prices are fetched and overlaid, any fetch failure silently reverts to the Naira fallback — potentially displaying wrong prices to non-NGN users or after a pricing update.
24. **[FIN-02]** `koboToNairaStr` and `koboToDecimal` are scoped to NGN only (prefix `₦`, function names say "Naira") — any future multi-currency payout support would require renaming and refactoring; the naming is architecturally misleading.
25. **[ARCH-01]** Four independent PIN-rate-limiting key namespaces exist in MMKV (TOTP, gift-send, payout, store, settings/pin) but only some are in `STORE_KEYS`; the `settings/pin.tsx` keys are entirely outside the registry — cleanup on sign-out is incomplete, and any future audit of rate-limit state is unreliable.
26. **[ARCH-02]** `settings/index.tsx` has a dual query under the same key `['user-me-totp']` shared between `TwoFactorSection` and the outer `SettingsScreen` — the outer query has a different `select` shape than the inner one, making the cache semantics confusing and fragile.
27. **[ARCH-03]** `GameWebView` `handleMessage` guards against oversized single payloads (> 65 536 bytes) but imposes no rate limit on the number of bridge messages — a malicious or buggy game embed could flood the JS bridge with rapid low-size messages.
28. **[HARD-01]** `settings/index.tsx` allows email change without requiring the current password or any second-factor — any XSS or device-unlock attacker who reaches the settings screen can silently change the account email.
29. **[HARD-02]** `notifications/index.tsx` — the `formatTime` function can produce negative or `NaN` time strings if `createdAt` is malformed ISO (e.g., missing timezone suffix) — no `isNaN` guard on the `diff` value.
30. **[HARD-03]** `app/onboarding/index.tsx` `validateBirthYear` caps at `currentYear - MINIMUM_AGE` but does not enforce a floor that rejects obviously invalid birth years like 0, negative, or unrealistically old values (below 1900 is guarded, but anything from 1 to 1899 would be caught only by the 1900 lower bound — edge cases for integer overflow inputs like `9999` would produce a negative `maxBirthYear` check).
31. **[HARD-04]** `EAS_PROJECT_ID` is set to `'YOUR_EAS_PROJECT_ID'` in `app.config.ts` as a fallback — none of the `eas.json` build profiles inject this env var (only `ADMOB_*` env vars appear in the production profile), so every EAS build — including production — ships with the placeholder. Expo's push service will reject token registrations.
32. **[MISC-01]** RTL reload (`Updates.reloadAsync()`) is triggered from `settings/index.tsx` when the RTL state changes, but `lib/i18n/rtl.ts` also calls `setupRTL()` on `languageChanged` events — if language is changed programmatically (not through settings), `setupRTL()` runs but the app is never reloaded, causing a partial RTL state where the React Native layout is updated but native components are not mirrored.

---

## Detailed Bug Entries

### BUG-SEC-01 — EAS_PROJECT_ID Placeholder Ships in Production

**Severity:** Critical / Showstopper

In `app.config.ts`, the `eas.projectId` value defaults to the literal string `'YOUR_EAS_PROJECT_ID'` when the `EAS_PROJECT_ID` environment variable is not set. Crucially, `eas.json` defines four build profiles (`development`, `preview`, `staging`, `production`) but none of them inject `EAS_PROJECT_ID` into the build environment — the `env` blocks only carry `APP_ENV`, `API_BASE_URL`, and `ADMOB_*` variables. As a result, every EAS build — including the production store bundle — ships with the placeholder string as the projectId. Expo's push-notification service uses the projectId to scope push tokens; tokens registered against `'YOUR_EAS_PROJECT_ID'` will be rejected or silently dropped, meaning the entire push-notification system is non-functional in all production builds.

**Fix:** Add `EAS_PROJECT_ID: "$EAS_PROJECT_ID"` to each build profile's `env` block in `eas.json`, and set the secret in the EAS secrets dashboard. Alternatively, remove the hardcoded fallback in `app.config.ts` and let the Expo CLI inject the project ID automatically from the `.expo/` directory (which only works for local builds, not CI).

**Affected files:** `apps/expo/eas.json`, `apps/expo/app.config.ts`

---

### BUG-SEC-02 — Email Change Requires No Verification

**Severity:** High — Account integrity

`settings/index.tsx` `patchMutation` sends `{ email: newEmail }` to `PATCH /users/me/settings` immediately when the user finishes editing the email field and moves focus away (`onEndEditing`). No confirmation is required: no "verify your new email" step, no current-password confirmation, and no second-factor check. An attacker with temporary device access (or after an XSS on a WebView) can silently change the account email to one they control, then use "forgot password" to take over the account.

**Fix:** Remove `email` from the inline settings PATCH. Replace it with a dedicated "Change Email" flow behind `/settings/change-email` that: (1) requires current password, (2) sends a verification link to the new address, and (3) only updates the stored email upon the verification callback. Until this is implemented, at minimum require the current password before sending the email PATCH.

**Affected files:** `apps/expo/app/settings/index.tsx`

---

### BUG-SEC-03 — Personalized Ads Disabled Unconditionally

**Severity:** Medium — Revenue and policy compliance

`lib/ads/admob.ts` creates every rewarded and interstitial ad with `requestNonPersonalizedAdsOnly: true` hardcoded, regardless of the outcome of the UMP consent flow. The consent form is shown when required, but even when the user grants consent for personalized ads, the `RewardedAd.createForAdRequest` and `InterstitialAd.createForAdRequest` calls still pass `requestNonPersonalizedAdsOnly: true`. This means the app can never serve personalized ads to consenting users, which forfeits the CPM premium (typically 2–5× higher) and misrepresents the UMP consent purpose.

**Fix:** Store the consent status returned from `AdsConsent.requestInfoUpdate()` and `AdsConsent.showForm()`. Pass `requestNonPersonalizedAdsOnly: false` (or omit the flag) when `consentInfo.status === AdsConsentStatus.OBTAINED`. Re-export a module-level flag (e.g., `export let personalizedAdsEnabled = false`) that is set after consent resolution and read by `loadRewardedAd()`, `loadInterstitialAd()`, and `showInterstitialAd()`.

**Affected files:** `apps/expo/lib/ads/admob.ts`

---

### BUG-SEC-04 — GIF URLs Not Validated (Potential SSRF)

**Severity:** Medium — depends on backend GIF handling

Both `app/rooms/[roomId].tsx` and `app/messages/[conversationId].tsx` allow users to select GIFs from a picker and send the raw GIF URL to the server as message content. There is no URL validation (host allowlist, scheme check) before the URL is included in the API payload. If the backend ever fetches, proxies, resizes, or caches GIF images server-side (common for content delivery optimization), an attacker can inject internal network URLs (`http://169.254.169.254/`, `http://localhost:8080/admin`, etc.) and trigger SSRF.

**Fix:** On the client side, validate that GIF URLs match an allowlist of trusted CDN hostnames (e.g., `media.giphy.com`, `media.tenor.com`) before sending. On the backend, enforce the same allowlist before any outbound fetch. The client-side check is defense-in-depth; the server-side check is mandatory.

**Affected files:** `apps/expo/app/rooms/[roomId].tsx`, `apps/expo/app/messages/[conversationId].tsx`

---

### BUG-SEC-05 — GameWebView originWhitelist Uses URL Pattern, Not Origin

**Severity:** Low–Medium — depends on attack surface

`components/games/GameWebView.tsx` sets:
```
originWhitelist={[`${gameOrigin}/*`, gameOrigin]}
```
The React Native WebView `originWhitelist` prop controls which URLs are allowed to load inside the WebView (navigation control), not which origins can send `postMessage` events. The `onMessage` handler fires for messages from any loaded document regardless of `originWhitelist`. The `/*` suffix is therefore not a restriction on postMessage origin — it is a URL navigation allowlist. A malicious redirect or an open redirect on the game server could load a different-origin document that still sends bridge messages. The actual `game_over` and `API_REQUEST` handlers should validate `e.nativeEvent.url` or compare the WebView's current URL against the expected game origin.

**Fix:** Inside `handleMessage`, extract the source URL from `e.nativeEvent` (or maintain a `currentUrl` ref via `onNavigationStateChange`) and reject any message where the source is not from `gameOrigin`. This cannot be done via `originWhitelist` alone.

**Affected files:** `apps/expo/components/games/GameWebView.tsx`

---

### BUG-SEC-06 — Settings PIN Keys Not in STORE_KEYS Registry

**Severity:** High — cross-account data leakage

`settings/pin.tsx` persists rate-limit state with raw string keys:
```
const PIN_ATTEMPTS_KEY = 'settings_pin_failed_attempts';
const PIN_LOCKED_UNTIL_KEY = 'settings_pin_locked_until';
```
These keys are not in the `STORE_KEYS` registry in `lib/offline/store.ts`. When `clearStore()` is called during sign-out (which clears all keys in the MMKV store), these hardcoded keys ARE cleared because `clearAll()` wipes the whole store. However, the values persist until sign-out; more importantly, the disconnect from the central registry means:
1. Future refactors that use `removeItem(STORE_KEYS.X)` for selective cleanup will never touch these keys.
2. If `clearStore()` is ever changed from `clearAll()` to selective key-by-key deletion (the safest form of clearout), these keys will be missed.
3. The PIN lockout state for one user's settings-PIN change attempt persists to a newly signed-in user on the same device, giving that user a false lockout.

**Fix:** Add `SETTINGS_PIN_ATTEMPTS` and `SETTINGS_PIN_LOCKED_UNTIL` to the `STORE_KEYS` registry in `lib/offline/store.ts`, and update `settings/pin.tsx` to use those constants.

**Affected files:** `apps/expo/app/settings/pin.tsx`, `apps/expo/lib/offline/store.ts`

---

### BUG-BF-01 — TOTP Lockout Fixed Window, No Exponential Backoff

**Severity:** High — brute-force protection gap

`app/auth/two-factor.tsx` locks out TOTP attempts for a fixed 15 minutes after 5 failures (`TOTP_MAX_ATTEMPTS = 5`). After the 15-minute window, the attempt counter resets to 0, allowing another 5 attempts per window indefinitely. There is no progressive penalty (no exponential backoff) and no permanent lockout after repeated windows. Over 24 hours, an attacker can make 5 × 96 = 480 attempts if they sustain access. The server-side rate limit is the primary protection here, but defense-in-depth at the client requires escalating lockouts.

**Fix:** Implement exponential backoff on the client: first lockout = 15 min, second = 30 min, third = 1 hour, max = 24 hours (or permanent until admin unlock). Use a `TOTP_LOCKOUT_COUNT` key in MMKV similar to the `PIN_LOCKOUT_COUNT` pattern already present in `STORE_KEYS`. Reset the count only on a successful TOTP verification. Ensure the server enforces the same escalating policy.

**Affected files:** `apps/expo/app/auth/two-factor.tsx`

---

### BUG-BF-02 — Gift-Send PIN Lockout Inconsistent (Fixed vs Exponential)

**Severity:** Medium — inconsistent security posture

`app/economy/gift-send.tsx` uses a fixed 15-minute PIN lockout, while `app/economy/store.tsx` implements exponential backoff (30 s → 60 s → 120 s → ... → 30 min, tracked by `STORE_KEYS.PIN_LOCKOUT_COUNT`). Gift send is a high-value financial operation and arguably warrants at least as strong protection as the store PIN. The inconsistency also suggests the store's exponential logic was not ported when the gift-send PIN flow was added.

**Fix:** Refactor PIN lockout into a shared hook (e.g., `usePinLockout(storageKeys)`) that accepts MMKV key names and implements exponential backoff. Apply the hook uniformly in gift-send, store, payout, TOTP, and settings PIN screens. Use separate MMKV keys per flow so lockout state does not bleed across contexts.

**Affected files:** `apps/expo/app/economy/gift-send.tsx`, `apps/expo/app/economy/store.tsx`

---

### BUG-BF-03 — Settings PIN Screen Uses 1-Minute Lockout (Too Short)

**Severity:** Medium

`settings/pin.tsx` locks out PIN setup/change attempts for only 1 minute (`PIN_LOCKOUT_MS = 60_000`) after 5 failures, while other flows use 15+ minutes. Setting up or changing a PIN protects payment operations; a 1-minute lockout is insufficient for this sensitivity level.

**Fix:** Increase `PIN_LOCKOUT_MS` to at least `15 * 60 * 1_000` (15 minutes) and apply the exponential backoff pattern described in BUG-BF-02.

**Affected files:** `apps/expo/app/settings/pin.tsx`

---

### BUG-DATA-01 — `handleSubscribe` Stale Closure on `currentTier`

**Severity:** Medium — incorrect financial operation

In `app/settings/subscription.tsx`, `handleSubscribe` is memoized with `useCallback([queryClient, isAnnual])` but reads `currentTier` (derived from the `user-me` query) as a free variable. If React Query refetches `user-me` in the background during the subscription purchase flow (staleTime is 60 s, so a background refetch can happen during a long purchase dialog), `currentTier` inside the callback remains stale. The wrong `oldProductId` may be passed to `purchaseSubscription()`, causing Google Play Billing to apply the wrong proration on an upgrade.

**Fix:** Add `currentTier` to the `useCallback` dep array, or derive it inside the callback from a ref that always holds the latest value:
```typescript
const currentTierRef = useRef(currentTier);
useEffect(() => { currentTierRef.current = currentTier; }, [currentTier]);
```

**Affected files:** `apps/expo/app/settings/subscription.tsx`

---

### BUG-DATA-02 — Notifications Not Paginated

**Severity:** Medium — scalability / performance

`app/notifications/index.tsx` calls `GET /notifications` with no limit, page, or cursor parameter. The endpoint returns all notifications for the user. Active users on a mature platform accumulate thousands of notifications. A single response could be multi-megabyte, causing:
- Slow/failed responses on poor connections
- Excessive memory allocation when `map(formatNotification)` processes thousands of records
- UI jank as the full list is rendered at once (despite FlatList windowing, the data array is fully allocated)

**Fix:** Add cursor-based pagination (`?cursor=<lastId>&limit=50`) to the API call. Store the cursor in component state and append additional pages when the FlatList `onEndReached` fires. Use React Query's `useInfiniteQuery` for correct cursor management. Mark all returned notifications as read in a batch using the existing `mark-all-read` endpoint.

**Affected files:** `apps/expo/app/notifications/index.tsx`

---

### BUG-DATA-03 — Contacts Upload Not Chunked

**Severity:** Medium — reliability

`app/onboarding/index.tsx` `handleFindFriends()` collects all phone numbers from the device contacts (potentially thousands) and sends them in one `POST /friends/contacts-check` body. Servers typically enforce maximum body sizes (commonly 1 MB with Express, Vercel, or nginx defaults). A user with 5,000+ contacts each averaging 15 bytes produces a payload of ~75 KB, which is within most limits, but users with 20,000+ contacts (not uncommon on Android) could produce larger payloads. Any payload rejection silently swallows the error (`.catch(() => {})`) and shows "done" — giving false feedback that contact matching succeeded.

**Fix:** Chunk the numbers array into batches of 500 before sending (e.g., `for (let i = 0; i < numbers.length; i += 500)`). Send each batch with `await apiClient.post(...)`. Catch per-batch errors independently and still show "done" if at least one batch succeeded. Remove the blanket `.catch(() => {})` so the status transitions to `'unavailable'` on network failure.

**Affected files:** `apps/expo/app/onboarding/index.tsx`

---

### BUG-UX-01 — Notification Rows Are Not Tappable

**Severity:** High — core UX failure

`components`-level `NotifRow` in `app/notifications/index.tsx` renders notification items as plain `View` containers with no `onPress` handler. Every notification type (guild war, gift, rank up, DM mention, friend request, etc.) has a payload with a relevant navigation target, but tapping a notification row does nothing. The notifications screen is essentially a read-only list with no action. This is a significant UX regression and likely a shipping bug.

**Fix:** Add an `onPress` handler to `NotifRow` that routes to the appropriate screen based on `notif.type` and `notif.payload`:
- `type === 'dm'` → `/messages/${payload.conversationId}`
- `type === 'guild_war'` → `/guilds/${payload.guildId}`
- `type === 'gift'` → `/economy/wallet`
- `type === 'friend'` → `/profile/${payload.senderId}`
- `type === 'mention'` or `type === 'room'` → `/rooms/${payload.roomId}`
- etc.

Also mark individual notifications as read on tap via `PATCH /notifications/:id/read`.

**Affected files:** `apps/expo/app/notifications/index.tsx`

---

### BUG-UX-02 — TOTP Lockout State Never Auto-Resets

**Severity:** Medium — UX degradation

In `app/auth/two-factor.tsx`, once `lockedOut` is set to `true`, there is no timer that re-checks `storage.getNumber(STORE_KEYS.TOTP_LOCKED_UNTIL)` to automatically clear the lockout when the 15-minute window expires. The user must navigate away from the screen and return (or restart the app) to re-initialize the `useState` call that reads MMKV. A user who waits the required 15 minutes on the same screen is still shown the "locked out" state with no way to retry without navigating away.

**Fix:** Add a `useEffect` that sets a `setTimeout` for `lockUntil - Date.now()` ms on mount (and when `lockedOut` becomes true). When the timer fires, re-check MMKV and set `setLockedOut(false)`. Also display a countdown timer so the user knows how long they must wait.

**Affected files:** `apps/expo/app/auth/two-factor.tsx`

---

### BUG-UX-03 — `change-password.tsx` Uses Wrong Prop Name on Button

**Severity:** Medium — UI breakage

`app/settings/change-password.tsx` line 164 renders:
```jsx
<Button
  title={t('settings.changePasswordButton')}
  onPress={handleSubmit}
  style={styles.button}
/>
```
The shared `Button` component (`components/ui/Button.tsx`) uses a `label` prop, not `title`. This means the button label is silently undefined and renders empty (or the component falls back to no text). The button is still pressable but shows no text, making the action invisible to the user.

**Fix:** Change `title={...}` to `label={...}` in `change-password.tsx`.

**Affected files:** `apps/expo/app/settings/change-password.tsx`

---

### BUG-UX-04 — Misleading Error Message for Non-Permission Contacts Errors

**Severity:** Low — UX clarity

`app/onboarding/index.tsx` `handleFindFriends()` catches errors and distinguishes only `'permission_denied'` from all others:
```typescript
if (msg === 'permission_denied') {
  setContactsStatus('denied');
} else {
  setContactsStatus('unavailable');
}
```
Any non-permission error (API failure, network timeout, unexpected exception) sets the status to `'unavailable'` which renders: *"Contacts access is not available on this device."* This is factually wrong for network errors — the device has contacts access, but the server request failed.

**Fix:** Add a third status value (e.g., `'error'`) for non-permission failures. Display a more accurate message such as *"Something went wrong. You can add friends manually."* Differentiate the three states clearly in the UI.

**Affected files:** `apps/expo/app/onboarding/index.tsx`

---

### BUG-UX-05 — `enter_remove` Step in Pin Screen Is Unreachable Dead Code

**Severity:** Low — code correctness

`app/settings/pin.tsx` defines four steps: `'enter_current'`, `'enter_new'`, `'confirm_new'`, and `'enter_remove'`. The remove flow sets `mode = 'remove'` and `step = 'enter_current'`. Inside `advance()`, when `step === 'enter_current'` and `mode === 'remove'`, it calls `removeMutation.mutate({ pin: value })` directly and returns. The `'enter_remove'` case inside `advance()` is never reached because there is no code path that sets `step` to `'enter_remove'`. The strings, heading, subtext, and `advance()` branch for this step are all dead code.

**Fix:** Either remove the `'enter_remove'` step entirely (the current `'enter_current'` + `mode='remove'` flow is correct), or wire up the "Remove PIN" button to set `step = 'enter_remove'` instead of `'enter_current'` and update `advance()` accordingly. The first option is simpler.

**Affected files:** `apps/expo/app/settings/pin.tsx`

---

### BUG-UX-06 — Onboarding Loop on 4xx from `/onboarding/complete`

**Severity:** High — app flow breakage

`app/onboarding/welcome-drop.tsx` fires `POST /onboarding/complete` in a `useEffect` and only writes `STORE_KEYS.ONBOARDING_COMPLETE = true` inside the `.then()` callback. If the server returns a 4xx (e.g., 409 if the username is already taken by a race between two devices, or 422 for validation), the `.catch()` sets `setSubmitError(true)` — but ONBOARDING_COMPLETE is never set. On next app launch, the root layout detects onboarding is not complete and redirects to `/onboarding`, creating an infinite loop for users who reached the final step but received a server error.

**Fix:** Differentiate recoverable vs. non-recoverable server errors. For 409 (duplicate username), navigate back to step 1 with an error message. For other 4xx errors, set ONBOARDING_COMPLETE = true anyway (the server already knows the user exists) and let the user proceed — the server can reconcile incomplete profiles. Alternatively, implement a "Retry" button in the error banner that re-fires the POST, and only block the "Start exploring" CTA while the POST is in-flight or has failed with a recoverable error.

**Affected files:** `apps/expo/app/onboarding/welcome-drop.tsx`

---

### BUG-UX-07 — Settings Notification Toggles Send Full Preferences Object

**Severity:** Low — unnecessary data transfer and potential overwrite race

`app/settings/index.tsx` manages `mergedNotifications` as a full object of all 7 notification preference keys. When any single toggle is changed, `set('notifications', updated)` fires, sending the entire merged object to `PATCH /users/me/settings`. If the user toggles two preferences in rapid succession (before the first PATCH completes), the second PATCH may overwrite the server's response from the first, losing changes. The `ChatPushToggles` sub-component correctly debounces and batches individual column-level changes, but the outer notification toggles do not.

**Fix:** Follow the same pattern as `ChatPushToggles`: send only the changed key(s) in the PATCH body (e.g., `{ notifications: { new_message: false } }` rather than the full object). Alternatively, debounce the outer notification PATCH as well, accumulating changes into a pending patch ref before firing.

**Affected files:** `apps/expo/app/settings/index.tsx`

---

### BUG-PERF-01 — No Pagination on Notifications

*(Cross-referenced with DATA-02 above.)*

The notification list fetches all records unbounded. See BUG-DATA-02 for full details and fix.

**Affected files:** `apps/expo/app/notifications/index.tsx`

---

### BUG-PERF-02 — `/manifest` Fetched Twice with Different Query Keys

**Severity:** Low — unnecessary network traffic

`lib/hooks/useCurrency.ts` uses query key `['manifest', 'currency']` and `settings/index.tsx` `manifestFeatures` uses `['manifest', 'features']`. Both call `GET /manifest` but React Query treats them as separate cache entries, issuing two HTTP requests when both are mounted simultaneously (e.g., on the settings screen which uses both). The manifest endpoint presumably returns a single JSON document containing both `currency` and `features` fields.

**Fix:** Use a single manifest query key (e.g., `['manifest']`) that fetches the full manifest object. Create selector hooks that derive `currency` and `features` from the shared cache: `useQuery({ queryKey: ['manifest'], queryFn: fetchManifest, select: (d) => d.currency })` and `select: (d) => d.features`. This collapses two HTTP requests into one.

**Affected files:** `apps/expo/lib/hooks/useCurrency.ts`, `apps/expo/app/settings/index.tsx`

---

### BUG-PERF-03 — Room Screen Uses `react-native` `Image` Instead of `expo-image`

**Severity:** Low — Android memory / GIF performance

`app/rooms/[roomId].tsx` uses `Image` from `react-native` for GIF thumbnail display. `app/messages/[conversationId].tsx` correctly uses `expo-image`. On Android, `react-native` `Image` does not recycle bitmaps efficiently, lacks a cross-platform GIF decoder pool, and can cause memory pressure in high-throughput rooms with frequent GIF messages. `expo-image` handles recycling, progressive loading, and GIF playback significantly better.

**Fix:** Replace `import { Image } from 'react-native'` with `import { Image } from 'expo-image'` in `app/rooms/[roomId].tsx`. No prop changes are required for basic usage.

**Affected files:** `apps/expo/app/rooms/[roomId].tsx`

---

### BUG-FIN-01 — Hardcoded Naira Price Fallbacks in Subscription Screen

**Severity:** Medium — incorrect display for non-NGN users

`app/settings/subscription.tsx` defines the `PLANS` array with hardcoded Naira price strings as defaults. Even though live Google Play prices are fetched and overlaid, a failed `getSubscriptionProducts()` call (offline, billing not available, etc.) silently falls back to the Naira strings, displaying incorrect prices to users in other currencies. This can mislead users into incorrect purchase expectations.

**Fix:** When `liveMonthlyPrices` fetch fails, display "Price not available" or a generic placeholder rather than the Naira fallback. Disable the subscribe button until live prices are confirmed. Cache the last successful live prices in MMKV so offline users see the last known correct price rather than a hardcoded fallback.

**Affected files:** `apps/expo/app/settings/subscription.tsx`

---

### BUG-FIN-02 — Currency Utility Naming Tightly Couples to NGN

**Severity:** Low — architectural / maintainability

`lib/utils/currency.ts` exports `koboToNairaStr`, `koboToDecimal`, `koboToNairaInt` — names that encode both the sub-unit ("kobo") and the currency ("naira"). If payout amounts are ever denominated in a different currency (USD cents, USDT satoshi, etc.), these utility functions would need renaming and all call sites updated. This is a code hygiene issue rather than an immediate bug.

**Fix:** Rename to `minorUnitToStr`, `minorUnitToDecimal`, `minorUnitToInt` and accept an optional `currencySymbol` parameter (defaulting to `'₦'` for backward compatibility). Update call sites.

**Affected files:** `apps/expo/lib/utils/currency.ts`

---

### BUG-ARCH-01 — Fragmented PIN Rate-Limit Key Namespace

**Severity:** Medium — maintainability and security auditability

Five separate PIN-rate-limiting contexts each use their own MMKV key names: TOTP (via `STORE_KEYS.TOTP_ATTEMPTS`/`TOTP_LOCKED_UNTIL`), gift-send (via `STORE_KEYS.GIFT_PIN_ATTEMPTS`/`GIFT_PIN_LOCKED_UNTIL`), payout (via `STORE_KEYS.PAYOUT_PIN_ATTEMPTS`/`PAYOUT_PIN_LOCKED_UNTIL`), store (`STORE_KEYS.STORE_PIN_FAILED_ATTEMPTS`/`STORE_PIN_LOCKED_UNTIL`), and settings/pin (raw strings outside the registry). The exponential backoff implementation also differs (some flows have it, some don't). This fragmentation makes it easy for a future change to miss one flow, and the inconsistent implementations create unequal security guarantees.

**Fix:** Create a shared `usePinRateLimit(keyPrefix: string)` hook that encapsulates the MMKV persistence, exponential backoff calculation, and lockout state logic. Pass a key prefix (registered in `STORE_KEYS`) to the hook. Replace all five independent implementations with calls to this hook.

**Affected files:** `apps/expo/lib/offline/store.ts`, `apps/expo/app/auth/two-factor.tsx`, `apps/expo/app/economy/gift-send.tsx`, `apps/expo/app/economy/store.tsx`, `apps/expo/app/settings/pin.tsx`

---

### BUG-ARCH-02 — Dual `['user-me-totp']` Query with Different Select Shapes

**Severity:** Low — cache integrity / confusion

`settings/index.tsx` and `TwoFactorSection` both register a query with key `['user-me-totp']` and `queryFn: () => apiClient.get('/users/me')`. `SettingsScreen` expects `{ user?: { totp_enabled?, date_of_birth? } }` and `TwoFactorSection` also reads `user.totp_enabled`. The cache entry is shared (same key), but if any future code adds a `select:` transform to one of them, it would silently corrupt the other's cache entry. This is an incidental correctness risk rather than an active bug, but it violates the React Query contract that the same `queryKey` must always produce the same shape.

**Fix:** Consolidate into a single named query (`'user-me'`) with the full response shape, and derive local selections via `select:` transforms in each consumer or read from `data.user?.fieldName` directly.

**Affected files:** `apps/expo/app/settings/index.tsx`

---

### BUG-ARCH-03 — GameWebView Bridge Message Rate Not Capped

**Severity:** Low — DoS from malicious/buggy game

`components/games/GameWebView.tsx` correctly caps individual message payload size at 65,536 bytes, but imposes no rate limit on the volume of messages. A misbehaving or malicious game embed could post thousands of small messages per second, flooding the JS bridge and degrading app responsiveness.

**Fix:** Add a per-second message counter in `handleMessage`. If more than N messages (e.g., 100) are received within 1 second, log a warning and stop processing further messages from that WebView instance for a penalty window (e.g., 5 seconds). Reset the counter on a 1-second sliding window.

**Affected files:** `apps/expo/components/games/GameWebView.tsx`

---

### BUG-HARD-01 — Email Change Without Current-Password Confirmation

*(Cross-referenced with SEC-02 above. Listed here for completeness.)*

See BUG-SEC-02. The Settings screen allows email changes via a text field with no password or second-factor confirmation.

---

### BUG-HARD-02 — `formatTime` in Notifications Unguarded Against Bad Timestamps

**Severity:** Low — display corruption

`app/notifications/index.tsx` `formatTime(iso: string)` computes `Date.now() - new Date(iso).getTime()`. If `iso` is malformed (missing timezone, empty string, or a server-returned `null` coerced to string), `new Date(iso).getTime()` returns `NaN`, and `diff` is `NaN`. All `Math.floor(NaN / …)` expressions return `NaN`, causing the rendered time to display as `NaN m ago` or `NaNh ago`.

**Fix:** Guard the function:
```typescript
function formatTime(iso: string): string {
  const ts = new Date(iso).getTime();
  if (!iso || isNaN(ts)) return '';
  const diff = Date.now() - ts;
  // ... existing logic
}
```

**Affected files:** `apps/expo/app/notifications/index.tsx`

---

### BUG-HARD-03 — TOTP Lockout No Countdown Displayed

**Severity:** Low — UX

When `lockedOut` is true in `two-factor.tsx`, the screen disables the input and button but shows no countdown of how long remains before the user may retry. Combined with BUG-UX-02 (the timer never auto-resets), the user has no feedback on when they can try again.

**Fix:** Implement a countdown display alongside the lockout state fix in BUG-UX-02.

**Affected files:** `apps/expo/app/auth/two-factor.tsx`

---

### BUG-MISC-01 — RTL Reload Not Triggered on Programmatic Language Changes

**Severity:** Low — layout correctness for Arabic users

`lib/i18n/rtl.ts` `setupRTL()` is called from `lib/i18n/index.ts` on `languageChanged` events, which updates `I18nManager.forceRTL()`. However, `Updates.reloadAsync()` (needed to apply native RTL mirroring of navigation icons, drawers, etc.) is only called from `settings/index.tsx` when the RTL state actually changes. If language is changed programmatically (e.g., from `applyStoredLanguagePref()` during app startup, or from the two-factor flow after login with a saved Arabic preference), `setupRTL()` runs but `Updates.reloadAsync()` never fires, leaving native components un-mirrored while the JS layout becomes RTL — a visual mismatch.

**Fix:** In `lib/i18n/index.ts`, in the `languageChanged` listener, if `I18nManager.isRTL` changes state, call `Updates.reloadAsync()` (import conditionally so it doesn't break non-Expo environments). This makes RTL reload consistent regardless of the code path that triggers the language change.

**Affected files:** `apps/expo/lib/i18n/index.ts`, `apps/expo/lib/i18n/rtl.ts`

---

## Code Rating

### Current State — 6.5 / 10

**Strengths:**
- Solid security foundation: JWT in SecureStore, AES-256-GCM encrypted MMKV and SQLite, HTTPS enforced, no plaintext secrets in tracked files.
- Financial integrity: Decimal.js used for all money math, idempotency keys on message send, server-side purchase token validation.
- Offline resilience: SQLite queue with encryption, sync on reconnect, proper stuck-message recovery on startup.
- Good retry/backoff patterns in `apiFetch.ts` and the Axios interceptor.
- Rate-limiting is present on most sensitive flows (TOTP, gift PIN, store PIN).
- Deep link handling is robust (referral code capture, MMKV draft for onboarding PII, referral code clearance after attribution).
- Realtime fallback (polling with jitter when Ably disconnects) is well-architected.
- React Query wiring (focusManager, onlineManager, QueryClient retry policy) is correct.
- Error boundaries are applied at the screen level via `export { ErrorBoundary }` pattern.
- Accessibility attributes (`accessibilityRole`, `accessibilityLabel`, `accessibilityState`) are present on most interactive elements.

**Weaknesses:**
- Push notifications are entirely non-functional in production due to the EAS_PROJECT_ID placeholder (critical).
- Core UX: notification rows are completely untappable — a shipping regression.
- Inconsistent rate-limiting across flows (3 different strategies, one much weaker than the rest).
- Email change requires no verification — account security gap.
- Contacts upload is unsharded — reliability risk for large contact lists.
- No cursor pagination on notifications — scalability gap.
- One dead step in the PIN screen and one unreachable error state in onboarding.
- Minor inconsistencies: wrong Button prop, GIF Image component mismatch, manifest double-fetch.

---

### After All Fixes — 8.5 / 10

- Push notifications restored to functional (EAS_PROJECT_ID injected).
- Email change secured with verification flow and password confirmation.
- Notification rows navigatable; pagination in place; formatTime guarded.
- Consistent exponential-backoff rate limiting across all 5 PIN/TOTP flows, backed by the centralized STORE_KEYS registry.
- GIF URLs validated against an allowlist; GameWebView message rate capped; origin validation hardened.
- MMKV keys for settings/pin moved into registry; clearStore() on sign-out is now complete.
- Personalized ads served to consenting users; ad revenue improved.
- RTL reload triggered consistently from i18n module.
- Dead code (`enter_remove` step, Naira price fallback warnings) removed/hardened.
- Contacts upload chunked; onboarding loop on 4xx fixed.
- Subscription stale closure fixed; notification dispatch granularized.
- Manifest fetched once; expo-image used consistently.

The remaining gap to 10/10 would be full server-side SSRF validation for GIF URLs, a comprehensive RLS audit of the backend, cursor-based pagination on all list endpoints (not just notifications), and accessibility testing with TalkBack.
