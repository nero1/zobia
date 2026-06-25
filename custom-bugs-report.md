# Zobia Expo App — Forensic Bug Report

**Generated:** June 25, 2026 at 02:29 PM  
**Scope:** `apps/expo/` — Android API 36 target  
**Analyst:** Deep forensic analysis — all source files reviewed

---

## Current Code Quality Rating

| Dimension | Current | Post-Fix |
|-----------|---------|----------|
| Security | 3 / 10 | 8 / 10 |
| Correctness | 5 / 10 | 9 / 10 |
| Robustness | 5 / 10 | 8 / 10 |
| Offline/Resilience | 6 / 10 | 9 / 10 |
| Code Quality | 6 / 10 | 8 / 10 |
| **Overall** | **5 / 10** | **8.5 / 10** |

**Review:** The app has a solid architectural foundation — React Query, offline SQLite queue, idempotency keys, Ably realtime with polling fallback, encrypted MMKV storage, and server-side purchase verification are all good choices. However, the security of the game WebView is critically broken (full JWT exposed to game scripts), and there are several high-severity correctness issues including the `APP_ENV` environment variable always being `'development'` in production builds, room messages having no offline fallback, and a swallowed billing error that silently proceeds to a broken purchase call. Post-fix the app would be significantly more trustworthy, secure, and reliable.

---

## Bug Index (Quick Reference)

1. BUG-SEC-01: Full JWT access token injected into WebView window global — any game script can steal it
2. BUG-SEC-02: User PIN sent as plaintext string to /auth/pin/verify — not hashed client-side
3. BUG-ENV-01: APP_ENV always resolves to 'development' in production builds — isProd is always false
4. BUG-OFFLINE-01: Room chat has no offline message queue — messages silently lost when offline
5. BUG-PAY-01: Google Play Billing init error swallowed before purchaseCoins call — broken silent failure
6. BUG-ADS-01: showInterstitialAd leaves dangling event listener when .show() throws
7. BUG-ADS-02: showRewardedAd EARNED_REWARD/CLOSED race — can resolve {rewarded:false} when reward was earned
8. BUG-PAY-02: disconnectGooglePlayBilling doesn't clear resolver/session maps — stale state after reconnect
9. BUG-AUTH-01: handleDeepLink stale closure in login.tsx useEffect — eslint warning suppressed incorrectly
10. BUG-MEM-01: XP flash setTimeout not cleared on room screen unmount — memory leak
11. BUG-UI-01: Tab bar fixed height 60 clips on Android gesture-navigation devices
12. BUG-PERM-01: READ_CONTACTS permission missing from app.json for ContactsImporter
13. BUG-CHAT-01: Pidgin suggestion chips replace entire input text instead of just the last word
14. BUG-CHAT-02: DM message dedup key uses content+sender — incorrectly collapses genuinely duplicate messages
15. BUG-CHAT-03: pendingIdCounter is module-level — persists across component unmount/remount
16. BUG-CHAT-04: room.dropEndsAt fake 1-hour fallback timer shown to real users
17. BUG-CHAT-05: Gift send URL passes empty string for creatorId when room has no creator
18. BUG-CHAT-06: GifPickerModal re-fetches trending GIFs on every open with no cache guard
19. BUG-I18N-01: i18n resolveLocale() never auto-selects 'pidgin' locale from device settings
20. BUG-WV-01: GameWebView originWhitelist hardcodes staging URL instead of using env config
21. BUG-MEM-02: Home screen daily login toast setTimeout not cleared on unmount
22. BUG-CRASH-01: Daily login dedup reads MMKV storage before guaranteed initialization
23. BUG-NAV-01: SwipeDrawer router.push wrapped in fragile 50 ms setTimeout
24. BUG-NAV-02: SwipeDrawer signOut called inside setTimeout with no error handling
25. BUG-NAV-03: SwipeDrawer dual-state (Reanimated shared value + React state) can diverge
26. BUG-API-01: subscription.tsx fetchMe returns data.user ?? data — yields inconsistent type shape
27. BUG-DUP-01: Capacity increase code copy-pasted verbatim in room catch block
28. BUG-UX-01: isAtBottomRef initialized to true causes auto-scroll on first room screen load
29. BUG-MINOR-01: idempotencyKey has redundant Date.now() suffix when localId already contains it
30. BUG-MINOR-02: ContactsImporter sends duplicate phone numbers (same contact in multiple entries)
31. BUG-MINOR-03: purchaseCoins 5-min timeout setTimeout never cleared when promise resolves first
32. BUG-CI-01: EAS auth step in build-android.yml uses continue-on-error:true — silent auth failures
33. BUG-THEME-01: Wallet tab uses raw useColorScheme instead of useTheme() — ignores user preference
34. BUG-UI-02: QuestCard and NemesisXPBar flex:0 collapses progress bars at exactly 0%
35. BUG-CRASH-02: Profile screen friend/follow mutations use non-null assertion profile! — potential crash

---

## Detailed Bug Descriptions

---

### 1. BUG-SEC-01: Full JWT access token injected into WebView window global

**FILES:** `apps/expo/components/games/GameWebView.tsx`

**Description:** The full JWT access token is injected into `window.__ZOBIA_TOKEN__` via `injectedJavaScriptBeforeContentLoaded` before the WebView content loads. This means any JavaScript running inside the WebView — whether in the game itself, a third-party dependency bundled by the game author, or via an XSS in the game HTML — can read `window.__ZOBIA_TOKEN__` and exfiltrate a live session token. The comment in the file even acknowledges this is a temporary measure but provides no mitigation. The `originWhitelist` only restricts navigation, not script access to window globals.

**FIX:** Never expose the raw JWT to the WebView. Instead implement a proper postMessage-based capability channel: the game should post a signed request message, the React Native host validates it via the `onMessage` handler, performs the API call itself, and posts the result back. If the game absolutely needs to call the API directly, issue a short-lived (60s), single-use capability token scoped only to the game's endpoints. Remove `window.__ZOBIA_TOKEN__` entirely.

---

### 2. BUG-SEC-02: User PIN sent as plaintext string to /auth/pin/verify

**FILES:** `apps/expo/app/economy/store.tsx` (line 347)

**Description:** `submitPin()` calls `apiClient.post('/auth/pin/verify', { pin: pinInput })` sending the raw 4-digit PIN as a JSON string. While the connection is HTTPS, this means the plaintext PIN is logged in any API access log, proxy log, or middleware that records request bodies. If the server stores or logs request payloads for debugging, the PIN is exposed.

**FIX:** Hash the PIN client-side before sending. Use `expo-crypto` (already a dependency) to compute a SHA-256 hash of the PIN concatenated with the user's ID or a server-provided nonce: `const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, userId + pin)`. Send the hash instead of the raw PIN, and update the server endpoint to compare hashes.

---

### 3. BUG-ENV-01: APP_ENV always resolves to 'development' in all production builds

**FILES:** `apps/expo/lib/env.ts`, `apps/expo/eas.json`, `apps/expo/app.json`

**Description:** `env.ts` reads `APP_ENV` from `Constants.expoConfig?.extra?.APP_ENV`. However, in `eas.json`, `APP_ENV` is set inside the `env` block of each build profile (e.g. `"APP_ENV": "production"`), NOT inside the `extra` block. The `extra` block in `app.json` does not include `APP_ENV` at all. Expo's `Constants.expoConfig.extra` is populated from `app.json`'s `extra` key — EAS `env` variables are process-level environment variables at build time but are NOT forwarded to `Constants.expoConfig.extra` automatically. As a result, `Constants.expoConfig?.extra?.APP_ENV` is always `undefined`, Zod coerces it to the default `'development'`, and `isProd` is always `false` — even in production builds. Any code that gates on `env.isProd` or `env.APP_ENV === 'production'` (e.g., ad unit ID selection, debug tooling, API base URL decisions) is broken in production.

**FIX:** In `app.json` add the `extra` block that reads from the process env at build time:
```json
"extra": {
  "APP_ENV": "$APP_ENV",
  "API_BASE_URL": "$API_BASE_URL"
}
```
Or use `app.config.ts` (dynamic config) to forward process env vars into `extra`. Also add `EXPO_PUBLIC_APP_ENV` as the variable name to leverage Expo's inline public env var support via `process.env.EXPO_PUBLIC_APP_ENV` as an alternative approach that doesn't require `Constants.expoConfig.extra`.

---

### 4. BUG-OFFLINE-01: Room chat messages are silently lost when offline — no queue fallback

**FILES:** `apps/expo/app/rooms/[roomId].tsx`

**Description:** The DM conversation screen (`messages/[conversationId].tsx`) has a proper offline fallback: on message send failure it calls `queueMessage(...)` to persist the message to the SQLite offline queue, which is then synced when connectivity returns. The room screen (`rooms/[roomId].tsx`) has no equivalent — its `onError` callback only rolls back the optimistic update and shows an alert. There is no call to any offline queue function. Any message sent in a room while offline, or when the server returns a network error, is permanently lost.

**FIX:** Import and call `queueMessage()` from `lib/offline/sqlite.ts` in the room message mutation's `onError` handler, passing `conversationType: 'room'` and `conversationId: roomId`. The existing `syncPendingMessages()` in `syncQueue.ts` already handles the `'room'` conversation type with the `/rooms/${conversationId}/messages` endpoint, so the sync side is already wired; only the enqueue step is missing from the room screen.

---

### 5. BUG-PAY-01: Google Play Billing init error swallowed before purchaseCoins — silent broken flow

**FILES:** `apps/expo/app/economy/store.tsx` (lines 319–331)

**Description:** The Android coin pack purchase flow in `handleBuy()` is:
```js
initGooglePlayBilling()
  .catch(() => {})          // swallows ALL init errors
  .then(() => purchaseCoins(playProduct.id))   // still called even if init failed
```
If `initGooglePlayBilling()` throws (e.g., Play Store not available, billing API unavailable, device not supported), the `.catch(() => {})` silently suppresses it and the `.then()` chain still calls `purchaseCoins()`. `purchaseCoins` will then fail with a confusing "billing not initialized" or "cannot call purchaseCoins before initGooglePlayBilling" error that reaches the user as a generic "An unexpected error occurred" dialog. The user has no idea why the purchase failed.

**FIX:** Chain with proper error handling using `async/await` or a `.catch()` that actually surfaces the error:
```js
try {
  await initGooglePlayBilling();
  const result = await purchaseCoins(playProduct.id);
  // handle result
} catch (err) {
  Alert.alert('Purchase Failed', 'Could not connect to Google Play. Please try again.');
} finally {
  setPurchasingId(null);
}
```

---

### 6. BUG-ADS-01: showInterstitialAd leaves a dangling event listener when .show() throws

**FILES:** `apps/expo/lib/ads/admob.ts`

**Description:** In `showInterstitialAd()`, the ad's `CLOSED` event listener is set up with `const unsubClosed = interstitialAd.addAdEventListener(AdEventType.CLOSED, ...)`. However, inside the `.catch()` handler for `interstitialAd.show()`, only the promise is rejected — `unsubClosed()` is never called. This means every time an interstitial ad fails to show (e.g., network error, ad not loaded), a new event listener is attached but never removed, causing a permanent listener leak that grows unboundedly with each failed show attempt.

**FIX:** Call `unsubClosed()` inside the catch block before rejecting:
```js
interstitialAd.show().catch((err) => {
  unsubClosed();
  reject(err);
});
```

---

### 7. BUG-ADS-02: showRewardedAd EARNED_REWARD/CLOSED event race condition

**FILES:** `apps/expo/lib/ads/admob.ts`

**Description:** `showRewardedAd()` resolves the promise inside the `CLOSED` event handler, using a `rewarded` flag that is set by the `EARNED_REWARD` handler. However, on some Android devices and AdMob SDK versions, `CLOSED` fires before `EARNED_REWARD` completes its callback chain, meaning `rewarded` is still `false` when `CLOSED` fires, causing the function to resolve `{rewarded: false}` even though the user earned the reward. The user gets no reward despite watching the full ad.

**FIX:** Do not resolve in `CLOSED`. Instead, resolve in `EARNED_REWARD` with `{rewarded: true}` and resolve in `CLOSED` only if `EARNED_REWARD` has not yet fired (i.e., as a timeout fallback). Alternatively, keep a short `setTimeout` delay in the `CLOSED` handler (100ms) to allow the `EARNED_REWARD` callback to arrive first, then resolve with the current `rewarded` value.

---

### 8. BUG-PAY-02: disconnectGooglePlayBilling doesn't clear resolver/session maps

**FILES:** `apps/expo/lib/payments/googlePlay.ts`

**Description:** `disconnectGooglePlayBilling()` calls `RNIap.endConnection()` but does NOT clear `purchaseResolvers`, `activePurchaseSessions`, or `pendingRecovery` maps. After disconnect and reconnect (e.g., the app goes to background and returns), any stale entries in these maps remain. A new purchase attempt may find a stale resolver from a previous session and incorrectly resolve or reject it, or `activePurchaseSessions` may wrongly block a new purchase of the same product by reporting it as "already in progress."

**FIX:** In `disconnectGooglePlayBilling()`, after `await RNIap.endConnection()`, clear all maps:
```js
purchaseResolvers.clear();
activePurchaseSessions.clear();
pendingRecovery.clear();
```

---

### 9. BUG-AUTH-01: handleDeepLink stale closure in login screen useEffect

**FILES:** `apps/expo/app/auth/login.tsx`

**Description:** `handleDeepLink` is a non-memoized function defined inside the component and referenced in the `useEffect` that subscribes to `Linking.addEventListener('url', handleDeepLink)`. The `useEffect` dependency array either omits `handleDeepLink` (suppressed via `// eslint-disable-next-line react-hooks/exhaustive-deps`) or includes a stale reference. Because `handleDeepLink` closes over state like `telegramBotUsername`, `authState`, or similar values, a stale closure will process deep links with outdated state — potentially failing to correctly handle the auth callback or token exchange.

**FIX:** Wrap `handleDeepLink` in `useCallback` with the correct dependencies, or apply the same ref pattern used in `useRealtimeChannel.ts` (BUG-MOB-22 fix): store `handleDeepLink` in a `useRef` and update it on every render, then call `handleDeepLinkRef.current(url)` inside the stable event handler. Remove the `eslint-disable` suppression.

---

### 10. BUG-MEM-01: XP flash setTimeout not cleared on room screen unmount

**FILES:** `apps/expo/app/rooms/[roomId].tsx`

**Description:** The room screen has multiple `setTimeout` calls for XP flash animations (e.g., `setTimeout(() => setShowXPFlash(false), 2000)`) triggered by realtime events. These timers are not tracked or cleaned up in a `useEffect` return function. If the user navigates away from the room while an XP flash is pending, the timer fires on the unmounted component, calling `setShowXPFlash(false)` on unmounted state. In React Native this can cause a "Can't perform a React state update on an unmounted component" warning and wastes memory holding the closure.

**FIX:** Store the timer ID in a `useRef<NodeJS.Timeout | null>` and clear it on unmount:
```js
const xpFlashTimerRef = useRef<NodeJS.Timeout | null>(null);
// when setting:
xpFlashTimerRef.current = setTimeout(() => setShowXPFlash(false), 2000);
// in cleanup:
useEffect(() => () => { if (xpFlashTimerRef.current) clearTimeout(xpFlashTimerRef.current); }, []);
```

---

### 11. BUG-UI-01: Tab bar fixed height 60 clips on Android gesture-navigation devices

**FILES:** `apps/expo/app/(tabs)/_layout.tsx`

**Description:** The bottom tab navigator has `style={{ height: 60 }}` hardcoded. On Android devices using gesture navigation (no hardware back button, bottom gesture bar), the system gesture indicator occupies the bottom of the screen. With a fixed height of 60, the tab bar content overlaps the gesture area, making the bottom tab buttons unreachable or clipped. This affects all modern Android flagships (Pixel, Samsung Galaxy with gesture nav enabled).

**FIX:** Use `useSafeAreaInsets()` from `react-native-safe-area-context` to calculate the total height:
```js
const { bottom } = useSafeAreaInsets();
// tabBarStyle:
{ height: 60 + bottom, paddingBottom: bottom }
```
Or rely on React Navigation's built-in `safeAreaInsets` support by removing the hardcoded height and letting the tab bar manage its own safe area padding via `tabBarStyle: { paddingBottom: bottom }`.

---

### 12. BUG-PERM-01: READ_CONTACTS permission missing from app.json for ContactsImporter

**FILES:** `apps/expo/app.json`, `apps/expo/components/ContactsImporter.tsx`

**Description:** `ContactsImporter.tsx` calls `Contacts.requestPermissionsAsync()` which requires the Android `READ_CONTACTS` permission. However, `app.json`'s `android.permissions` array only lists `["POST_NOTIFICATIONS", "ACCESS_NETWORK_STATE"]`. Without declaring `android.permission.READ_CONTACTS` in the manifest, the runtime permission request will always be denied on Android (the OS cannot grant a permission not declared in the manifest). The onboarding contacts import step will silently fail for all Android users.

**FIX:** Add `"READ_CONTACTS"` to `android.permissions` in `app.json`:
```json
"android": {
  "permissions": ["POST_NOTIFICATIONS", "ACCESS_NETWORK_STATE", "READ_CONTACTS"]
}
```
Also verify that `expo-contacts` is configured with the appropriate `infoPlist` entries for iOS (`NSContactsUsageDescription`).

---

### 13. BUG-CHAT-01: Pidgin suggestion chips replace entire input text instead of last word

**FILES:** `apps/expo/app/messages/[conversationId].tsx`

**Description:** When a user taps a Pidgin suggestion chip, the handler calls `setInputText(suggestion)` which replaces the entire message input with the suggestion string. The intended behavior is to replace only the last typed word with the suggestion (autocomplete style), preserving the rest of the message the user has typed.

**FIX:** Split the current input text on whitespace, replace the last token with the suggestion, and rejoin:
```js
setInputText(prev => {
  const words = prev.split(' ');
  words[words.length - 1] = suggestion;
  return words.join(' ');
});
```

---

### 14. BUG-CHAT-02: DM message dedup key uses content+sender — wrongly deduplicates identical messages

**FILES:** `apps/expo/app/messages/[conversationId].tsx`

**Description:** Messages are deduplicated using the key `${senderUserId}|${content}`. This is semantically wrong: if the same user sends the same message text twice (e.g., "ok" then "ok" again), the second message is treated as a duplicate and removed from the UI. Message deduplication should be based on the message's unique server ID, not its content.

**FIX:** Use `msg.id` (server-assigned message ID) as the dedup key. For optimistic messages that don't yet have a server ID, use the `idempotencyKey` as the dedup key, and once the server response arrives with the real ID, replace the optimistic entry.

---

### 15. BUG-CHAT-03: pendingIdCounter is module-level — persists across component unmount/remount

**FILES:** `apps/expo/app/messages/[conversationId].tsx`

**Description:** `let pendingIdCounter = 0` is declared at module scope outside the component. When the user navigates away from a conversation and back, the component unmounts and remounts, but `pendingIdCounter` retains its value from the previous mount. This causes new optimistic messages to have IDs like `pending_5`, `pending_6` etc. rather than starting from `pending_0`. While not immediately breaking, this can cause state mismatches if there are pending messages from a previous mount that get confused with new ones.

**FIX:** Move `pendingIdCounter` inside the component and reset it via `useRef`:
```js
const pendingIdCounterRef = useRef(0);
// When creating optimistic message:
const localId = `pending_${pendingIdCounterRef.current++}`;
```

---

### 16. BUG-CHAT-04: Fake 1-hour fallback timer displayed to users when room has no drop end time

**FILES:** `apps/expo/app/rooms/[roomId].tsx`

**Description:** The room screen uses `room.dropEndsAt ?? new Date(Date.now() + 3_600_000)` as the drop timer's end time. When `dropEndsAt` is null (no drop scheduled), this displays a countdown timer that counts down from exactly 1 hour — fabricated data shown to real users as if it were a real scheduled drop. This is misleading and constitutes UI fiction.

**FIX:** Conditionally render the drop timer only when `room.dropEndsAt` is non-null:
```jsx
{room.dropEndsAt ? <DropTimer endsAt={new Date(room.dropEndsAt)} /> : null}
```
Remove the `?? new Date(Date.now() + 3_600_000)` fallback entirely.

---

### 17. BUG-CHAT-05: Gift send URL passes empty string for creatorId when room has no creator

**FILES:** `apps/expo/app/rooms/[roomId].tsx`

**Description:** The gift button navigates to the gift send screen with `toUserId: room?.creatorId ?? ''`. When `room.creatorId` is null or undefined (e.g., community rooms without a creator), an empty string `''` is passed as `toUserId`. The gift send screen will then submit a gift to userId `""`, which will either produce a server-side 400 error or silently gift to nobody.

**FIX:** Disable the gift button when `room.creatorId` is falsy, or hide it entirely for rooms without a creator:
```jsx
{room.creatorId ? (
  <GiftButton onPress={() => router.push({ 
    pathname: '/economy/gift-send', 
    params: { toUserId: room.creatorId } 
  })} />
) : null}
```

---

### 18. BUG-CHAT-06: GifPickerModal re-fetches trending GIFs on every open with no cache or debounce guard

**FILES:** `apps/expo/app/messages/[conversationId].tsx`

**Description:** Every time the user opens the GIF picker (taps the GIF button), the component fetches trending GIFs from the API with no caching and no guard against rapid open/close. If the user opens and closes the picker multiple times quickly, multiple concurrent requests fire. There is no abort controller or React Query integration — it uses a raw `useEffect` with `apiClient.get()`.

**FIX:** Move the GIF fetch into a React Query `useQuery` with `staleTime: 5 * 60_000` so results are cached across opens. Add `enabled: isGifPickerOpen` to only fetch when the picker is visible. Alternatively, use an `AbortController` in the `useEffect` to cancel in-flight requests when the component hides.

---

### 19. BUG-I18N-01: i18n resolveLocale() can never auto-select 'pidgin' from device locale

**FILES:** `apps/expo/lib/i18n/index.ts`

**Description:** `resolveLocale()` iterates device locales and compares `locale.languageCode` against `SUPPORTED_LOCALES`. `languageCode` is derived from BCP 47 locale identifiers (e.g., `en`, `fr`, `ar`, `ha`) per the Expo Localization API. There is no standard BCP 47 language tag for Nigerian Pidgin — devices will never report `languageCode === 'pidgin'`. Pidgin can therefore never be auto-detected from device settings; users must manually select it. This is a known limitation but should be explicitly documented and the fallback behavior confirmed.

**FIX:** After the BCP 47 check loop, add a fallback check for region codes associated with Nigeria/West Africa if no supported locale was found: if `locale.regionCode === 'NG'` and no other locale matched, consider defaulting to `'en'` with a note suggesting Pidgin. Also wire up the user's explicit language preference from MMKV (if stored) as the highest-priority override, checked before the device locale loop. Document in code that Pidgin requires manual selection.

---

### 20. BUG-WV-01: GameWebView originWhitelist hardcodes staging URL instead of using env config

**FILES:** `apps/expo/components/games/GameWebView.tsx`

**Description:** `originWhitelist={['https://zobia.vercel.app']}` is hardcoded. If the production app runs against a different domain (e.g., `https://api.zobia.app`), the WebView will refuse to load game pages from that origin, silently showing a blank screen or navigation error. Additionally, the `authCallback` URL for the Ably token request goes through `apiClient` which uses `env.API_BASE_URL`, but the WebView's URL is independently hardcoded and inconsistent.

**FIX:** Derive the allowed origin from `env.API_BASE_URL` or a dedicated `GAME_BASE_URL` env var:
```js
const gameOrigin = new URL(env.API_BASE_URL).origin;
originWhitelist={[gameOrigin, 'about:blank']}
```
Also add `'about:blank'` to the whitelist as WebView requires it during initial load.

---

### 21. BUG-MEM-02: Home screen daily-login toast setTimeout not cleared on unmount

**FILES:** `apps/expo/app/(tabs)/index.tsx` (line ~907)

**Description:** On successful daily login, `setTimeout(() => setShowLoginToast(false), 3500)` is called without storing the timer ID or clearing it on unmount. If the user navigates away from the home tab within 3.5 seconds of the daily login XP toast appearing, the timer fires on an unmounted component, calling `setShowLoginToast(false)` on stale state.

**FIX:** Track the timer in a ref and clear it in a `useEffect` cleanup:
```js
const toastTimerRef = useRef<NodeJS.Timeout | null>(null);
// on success:
toastTimerRef.current = setTimeout(() => setShowLoginToast(false), 3500);
// in effect cleanup:
useEffect(() => () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); }, []);
```

---

### 22. BUG-CRASH-01: Daily login dedup reads MMKV storage before guaranteed initialization

**FILES:** `apps/expo/app/(tabs)/index.tsx` (lines ~912–916)

**Description:** The home screen's daily login `useEffect` reads `storage.getString('daily_login_last_date')` where `storage` is the MMKV proxy from `lib/offline/store.ts`. The `storage` proxy throws a descriptive error if `initStore()` has not been called yet. While the root layout calls `initStore()` in a `useEffect`, there is a race window during app startup where the home tab mounts and its `useEffect` fires before the root layout's `useEffect` completes. On cold start this could cause an unhandled rejection that crashes the app.

**FIX:** Guard the daily login check with a try/catch, or ensure the home screen's daily login effect has a dependency on an `isStoreReady` flag that is set after `initStore()` resolves in the root layout. Alternatively, expose a synchronous `isInitialized()` check on the storage proxy and short-circuit if not ready.

---

### 23. BUG-NAV-01: SwipeDrawer router.push uses fragile 50 ms setTimeout

**FILES:** `apps/expo/components/layout/SwipeDrawer.tsx`

**Description:** Navigation after closing the drawer is done with `setTimeout(() => router.push(route), 50)`. This 50ms delay is intended to let the drawer animation finish before navigating. On slow devices or under heavy load, 50ms may not be sufficient, causing navigation to interrupt the animation. Conversely, if the component unmounts within 50ms (e.g., the user taps multiple items quickly), the timer fires after unmount.

**FIX:** Use the Reanimated `runOnJS` callback pattern or `withTiming`'s callback to trigger navigation exactly when the animation finishes:
```js
drawerTranslateX.value = withTiming(DRAWER_WIDTH, { duration: 200 }, (finished) => {
  if (finished) runOnJS(router.push)(route);
});
```
This is deterministic and safe.

---

### 24. BUG-NAV-02: SwipeDrawer signOut called inside setTimeout with no error handling

**FILES:** `apps/expo/components/layout/SwipeDrawer.tsx`

**Description:** The logout handler uses `setTimeout(() => signOut(), 100)` with no error handling. If `signOut()` throws (e.g., SecureStore fails, network error during server-side session invalidation), the error is swallowed silently. The user might see the drawer close but remain signed in.

**FIX:** Await `signOut()` properly and show an error if it fails:
```js
try {
  await signOut();
} catch {
  Alert.alert('Sign Out Failed', 'Please try again.');
}
```
If animation sequencing is the concern, use the `runOnJS` pattern (see BUG-NAV-01).

---

### 25. BUG-NAV-03: SwipeDrawer has dual-state drawer open representation

**FILES:** `apps/expo/components/layout/SwipeDrawer.tsx`

**Description:** The drawer open state is tracked by both a Reanimated shared value (`isDrawerOpen`) used for animations and a React `useState` (`isOpen`) used for conditional rendering. These two representations can diverge: if the animation completes but the state update is batched, or if a gesture is interrupted mid-way, the render state and animation state may disagree — causing the drawer to be visually closed but logically still "open" (or vice versa), breaking subsequent gesture interactions.

**FIX:** Use a single source of truth. Either use only the Reanimated shared value and derive the rendered content from it (reading the value in a `useAnimatedStyle` that controls `display`), or use only the React state and drive the animation via a `useEffect` that watches the state. The `useDerivedValue` + `useAnimatedReaction` pattern in Reanimated 3 is designed for exactly this case.

---

### 26. BUG-API-01: subscription.tsx fetchMe returns data.user ?? data — inconsistent shape

**FILES:** `apps/expo/app/settings/subscription.tsx` (line 168–170)

**Description:** `fetchMe()` does `return data.user ?? data`. This means the returned type can be either the full response envelope (`{ user: UserMe, ... }`) or the `UserMe` object directly, depending on what the API returns. The `UserMe` type expects fields like `planTier`, `coinBalance`, etc. If the server returns `{ user: { ... } }`, `data.user` is returned correctly. But if the server returns the object directly, `data` (the full response) is returned, which may have additional fields but could also be missing the expected ones. Also, `currentTier` reads `me?.planTier` but if the API field is actually `plan` (as used in the `AuthUser` type elsewhere), this will always be `undefined`, defaulting to `'free'` even for paid subscribers.

**FIX:** Define a consistent response contract with the backend and use a typed response. Use the same field name for plan tier across the app (standardize on either `planTier` or `plan`). Remove the `?? data` fallback and assert the specific response shape.

---

### 27. BUG-DUP-01: Capacity increase code copy-pasted verbatim in room catch block

**FILES:** `apps/expo/app/rooms/[roomId].tsx`

**Description:** The handler for increasing room capacity has the full implementation duplicated inside the `catch` block of the capacity increase mutation. This means bug fixes to the capacity increase logic must be applied in two places. It's also logically incorrect — if the mutation fails and falls into the catch block, re-running the capacity increase attempt would likely fail again for the same reason.

**FIX:** Extract the capacity increase logic into a dedicated `handleIncreaseCapacity` function. The catch block should only handle the error (show alert, reset state) — not retry the same operation.

---

### 28. BUG-UX-01: isAtBottomRef initialized to true causes auto-scroll on first load

**FILES:** `apps/expo/app/rooms/[roomId].tsx`

**Description:** `const isAtBottomRef = useRef(true)` initializes the "is at bottom" flag to `true`. When the first batch of messages loads, the `useEffect` that calls `scrollToEnd()` fires because `isAtBottomRef.current` is `true`. This causes an immediate scroll-to-bottom, which is jarring if the user has loaded the room to read from a specific position (e.g., via a deep link to an older message). The correct initial value should depend on whether this is a fresh session (scroll to bottom) or a return to a room (preserve scroll position).

**FIX:** Initialize `isAtBottomRef` to `false` and only set it to `true` after the initial render + first scroll. For new sessions (no cached messages), scroll to bottom unconditionally on mount as a one-time action, separate from the `isAtBottom` reactive auto-scroll logic.

---

### 29. BUG-MINOR-01: idempotencyKey has redundant Date.now() suffix when localId already contains timestamp

**FILES:** `apps/expo/lib/offline/sqlite.ts`

**Description:** The idempotency key is generated as `${localId}_${Date.now()}`, but `localId` already contains a timestamp component. This produces keys like `msg_1719323445231_1719323445235` — the second timestamp adds nothing unique that `localId` doesn't already provide and makes the key unnecessarily long.

**FIX:** Use `localId` directly as the idempotency key, as it already provides sufficient uniqueness for deduplication purposes.

---

### 30. BUG-MINOR-02: ContactsImporter sends duplicate phone numbers from multi-entry contacts

**FILES:** `apps/expo/components/ContactsImporter.tsx`

**Description:** The component collects all phone numbers from all contacts and sends them to `/users/contacts/cross-reference`. A contact that appears with multiple phone number entries (e.g., "mobile" and "work") contributes each number independently. If two contacts share a number (common with paired entries), or a person has the same number under two contact cards, the array sent to the server contains duplicates. This wastes bandwidth and may cause the server to return duplicate `ZobiaContact` entries.

**FIX:** Deduplicate phone numbers before sending:
```js
const uniquePhones = [...new Set(phoneNumbers)].slice(0, 500);
```

---

### 31. BUG-MINOR-03: Purchase timeout setTimeout never cleared when purchaseCoins resolves

**FILES:** `apps/expo/lib/payments/googlePlay.ts`

**Description:** Inside `purchaseCoins()`, a 5-minute timeout is created via `setTimeout(...)` as `timeoutPromise` and races against the purchase promise via `Promise.race`. When the purchase completes successfully before the timeout, the `setTimeout` is never cleared — it remains running for up to 5 minutes holding a reference to the resolve/reject callbacks.

**FIX:** Store the timeout ID and clear it when the purchase promise settles:
```js
let timeoutId: NodeJS.Timeout;
const timeoutPromise = new Promise((_, reject) => {
  timeoutId = setTimeout(() => reject(new Error('Purchase timed out')), 5 * 60_000);
});
try {
  return await Promise.race([purchasePromise, timeoutPromise]);
} finally {
  clearTimeout(timeoutId);
}
```

---

### 32. BUG-CI-01: EAS auth step in build workflow uses continue-on-error:true — auth failures are silent

**FILES:** `.github/workflows/build-android.yml`

**Description:** The `eas whoami` step uses `continue-on-error: true`. If `EXPO_TOKEN` is missing or invalid, this step "succeeds" (outcome is set based on the `if` condition in the next step). The build step is gated on `steps.eas-auth.outcome == 'success'` — but `continue-on-error: true` means the outcome is always `'success'` (it was allowed to continue). Actually on re-reading: with `continue-on-error: true`, the step's `outcome` is set to `'failure'` if the command failed, but `conclusion` is `'success'`. The next step uses `outcome`, which would be `'failure'` — so the build is correctly skipped. However, the workflow then reports overall success ("Notify build complete" step runs on `success()`) even though no build was produced. This silently masks credential issues.

**FIX:** Remove `continue-on-error: true` and let the auth step fail the workflow if credentials are not configured. Add explicit error messaging. The build step gate is redundant once auth always fails properly.

---

### 33. BUG-THEME-01: Wallet tab uses raw useColorScheme instead of app theme system

**FILES:** `apps/expo/app/(tabs)/wallet.tsx`

**Description:** The wallet tab imports `useColorScheme` from `react-native` and uses it directly to derive colors. The app's theme system (`lib/theme/index.tsx`) uses MMKV to persist user theme preference (`'light'`, `'dark'`, or `'system'`) and exposes it via the `useTheme()` hook. The wallet tab bypasses this — if a user has explicitly chosen "always dark" or "always light" in settings, the wallet tab will still follow the system scheme and appear with wrong colors while all other tabs are correct.

**FIX:** Replace `const scheme = useColorScheme()` and all derived color logic with `const { colors: themeColors, isDark } = useTheme()`. Then use `themeColors.background`, `themeColors.surface`, `themeColors.text`, etc. consistently with the rest of the app.

---

### 34. BUG-UI-02: QuestCard and NemesisXPBar flex:0 collapses progress bars at exactly 0%

**FILES:** `apps/expo/app/(tabs)/index.tsx`

**Description:** Both `QuestCard` and `NemesisXPBar` use a `flexDirection: 'row'` container with two children that have `flex: progressPct` and `flex: 1 - progressPct`. When `progressPct === 0`, both values are `0` and `1` respectively — this works. But when `progressPct === 1` (100%), the fill has `flex: 1` and the empty has `flex: 0`. A `flex: 0` View collapses to zero width, which is correct visually but can cause a React Native layout warning or flicker. More critically, when `myXP === nemesisXP === 0` in `NemesisXPBar`, `myRatio === 0.5` so `flex: 0.5` on each — this is fine. But if `myXP === 0` and `nemesisXP > 0`, `myRatio === 0` and the fill has `flex: 0`, which may not render properly on some RN versions.

**FIX:** Replace the flex-based approach with a `width: \`${pct * 100}%\`` approach on an absolute-positioned inner view, using a fixed-height container with `overflow: 'hidden'`. This is more reliable and avoids the flex: 0 edge case.

---

### 35. BUG-CRASH-02: Profile screen friend/follow mutations use non-null assertion on profile

**FILES:** `apps/expo/app/profile/[userId].tsx` (lines ~184–191)

**Description:** The friend and follow mutation functions are defined as:
```js
const friendMutation = useMutation({
  mutationFn: () => toggleFriend(userId!, profile!.isFriend),
  ...
});
```
`profile!.isFriend` uses a non-null assertion. These mutations are configured at the top of the component before the loading/error guards. While `profile` will typically be set by the time the user can tap the buttons, React Query can set `data` to `undefined` during a background refetch (e.g., after `invalidateQueries`). If a refetch clears the cache and triggers while a mutation is in flight, `profile!` throws a TypeError crash.

**FIX:** Guard the mutation call site rather than using non-null assertion at definition time:
```js
mutationFn: () => {
  if (!profile || !userId) throw new Error('Profile not loaded');
  return toggleFriend(userId, profile.isFriend);
}
```

---

*Report generated: June 25, 2026 at 02:29 PM*  
*Scope: apps/expo/ — all source files reviewed forensically*
