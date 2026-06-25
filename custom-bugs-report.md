# Zobia Social — Expo App Bug Report

**Generated:** June 25, 2026 12:43 PM  
**Scope:** apps/expo (Android primary, API 36 target)  
**Analyst:** Claude (forensic code review — no agents, no subagents)

---

## Complete Bug Index (One-Line Descriptions)

1. **BUG-CRIT-01** — Settings logout does not call `signOut()`, leaving the JWT and auth context fully intact
2. **BUG-CRIT-02** — Settings delete account does not call `signOut()`, same broken teardown as BUG-CRIT-01
3. **BUG-CRIT-03** — Google Play Billing permanently disconnected after the first background event, never reconnected
4. **BUG-CRIT-04** — AdMob `android_app_id` and `ios_app_id` are Google's test IDs; real ads will never serve in production
5. **BUG-HIGH-05** — Booster purchase passes `booster.id` (UUID) as `boosterType`; server expects a semantic type string
6. **BUG-HIGH-06** — Offline SQLite encryption key promise cached permanently on failure; offline queue is broken until app restart
7. **BUG-HIGH-07** — Push notification deep-link allowlist missing `/guilds/[id]/chat` and `/messages/group/[id]`; taps silently blocked
8. **BUG-HIGH-08** — Billing disconnected on `'inactive'` AppState (notification shade pull), not just true background
9. **BUG-HIGH-09** — Coin store on Android calls `purchaseCoins()` without re-initialising billing; silent failure after background
10. **BUG-MED-10** — Pidgin locale code `'pidgin'` never matched by `getPidginSuggestions` or `isPidginEnabled`; suggestions never fire
11. **BUG-MED-11** — `ThemeProvider` only reads system color scheme; user-selected light/dark theme saved in settings has no effect
12. **BUG-MED-12** — `setSpectacle()` called inside React Query `select` callback (rooms screen); side-effects in `select` are forbidden
13. **BUG-MED-13** — Game `WebView` injects access token into `window.__ZOBIA_TOKEN__` before content loads; accessible to any third-party script
14. **BUG-MED-14** — Settings language picker missing `'pidgin'` locale option despite full translations existing
15. **BUG-MED-15** — Duplicate session-expired UI: root layout shows `SessionExpiredModal` and login screen shows its own banner simultaneously
16. **BUG-MED-16** — `KeyboardAvoidingView` hardcoded to `behavior="padding"` in rooms screen; keyboard overlaps input on Android
17. **BUG-MED-17** — Pending messages and API messages not deduplicated in DM and group chat screens; messages can appear twice
18. **BUG-MED-18** — `MessageBubble` has no render branch for `'broadcast'` message type; falls through to text path with potentially null content
19. **BUG-MED-19** — `handleDeepLink` in login screen is not in its `useEffect` dependency array; holds stale `t` after locale change
20. **BUG-MED-20** — Coin pack matched to Play Store product by `coinsGranted` amount, not ID; mismatch silently blocks purchase
21. **BUG-MED-21** — iOS `associatedDomains` uses `zobia.vercel.app`; Vercel subdomains require explicit AASA configuration or universal links fail
22. **BUG-MED-22** — Android manifest missing `ACCESS_NETWORK_STATE` permission; `isInternetReachable` may always be `null` on some devices
23. **BUG-LOW-23** — `telegramBotName` set to `"Zobia_bot_bot"` in `app.json`; double `_bot` suffix looks like a leftover test value
24. **BUG-LOW-24** — `signOut()` does not clear `sessionExpired` flag; expired-session state persists after a clean manual logout
25. **BUG-LOW-25** — `FloatingNotificationProvider` `setTimeout` calls for quest/deck completion events never cleared on unmount
26. **BUG-LOW-26** — `AnnouncementBanner` ignores `contentType` severity field; danger/warning banners always render as blue info banners
27. **BUG-LOW-27** — GIF search `debounceRef` in rooms screen not cleared on unmount; can fire state update after unmount
28. **BUG-LOW-28** — Wallet `formatDate` hardcodes `'en-NG'` locale; transaction timestamps always show in Nigerian English regardless of user locale
29. **BUG-LOW-29** — Auth context AppState foreground-refresh effect has `[token]` dependency; subscribe/unsubscribe on every token rotation
30. **BUG-LOW-30** — `refreshAccessToken` typed as `{ expiresIn: number }` but immediately cast to `{ accessToken?: string }`; unsafe TypeScript
31. **BUG-LOW-31** — `GiftSpectacle` auto-dismiss timer closes over `onDismiss` from render; stale if prop identity changes before timer fires
32. **BUG-LOW-32** — Two-factor screen submit button has redundant disabled condition (`!!error && code.length !== 6` is a subset of `code.length !== 6`)
33. **BUG-LOW-33** — `apiFetch` `MAX_RETRIES = 3` but loop runs `attempt <= MAX_RETRIES` giving 4 total attempts; misleading constant name
34. **BUG-LOW-34** — Telegram OAuth polling backoff comment says "2s first delay" but actual first delay is 500ms

---

## Detailed Bug Analysis

---

### BUG-CRIT-01 — Settings logout does not call `signOut()`

`handleLogout` in the settings screen calls `logoutUser()` (HTTP POST to `/auth/logout`) and then navigates to `/auth/login` with `router.replace`. It never calls `signOut()` from the auth context. The JWT remains in SecureStore, the auth context still holds `user` and `token`, the React Query cache is not cleared, and the MMKV store is not wiped. Since the app's root navigation reads the auth context to decide where to route the user, navigating to `/auth/login` while `user !== null` will immediately redirect back to the main tabs, making logout appear broken. The server session is invalidated but the client session is completely intact.

**FILES:** `apps/expo/app/settings/index.tsx` (lines 676–689)

**FIX:** Import and call `signOut()` from `useAuth()` inside the logout handler, after the server call succeeds. `signOut()` handles token deletion from SecureStore, context reset, and store clearing. Replace `router.replace('/auth/login')` with `signOut()` — the auth context's redirect logic will navigate to login automatically once `user` becomes null.

---

### BUG-CRIT-02 — Settings delete account does not call `signOut()`

`handleConfirmDelete` in the settings screen calls `deleteAccount(pin)` (HTTP DELETE to `/users/me`) and then `router.replace('/auth/login')`. Same teardown failure as BUG-CRIT-01: JWT stays in SecureStore, auth context still has the user, React Query cache is intact. The user will be navigated to login and immediately redirected back to the main app because the client still considers them authenticated.

**FILES:** `apps/expo/app/settings/index.tsx` (lines 708–723)

**FIX:** Call `signOut()` after the delete API call succeeds, instead of `router.replace('/auth/login')`. Auth context teardown will navigate automatically. Ensure SecureStore keys for JWT, refresh token, and user profile are all cleared.

---

### BUG-CRIT-03 — Google Play Billing permanently disconnected after first app background

`disconnectGooglePlayBilling()` is called in `_layout.tsx` whenever `AppState` transitions to `'background'` or `'inactive'`. This sets `initialised = false` and calls `endConnection()`. However `initGooglePlayBilling()` is only called once, inside a `useEffect([], [])` (empty deps, mount-only). There is no listener that calls `initGooglePlayBilling()` when the app returns to the foreground. After the first background event, the billing connection is dead for the remainder of the app session. The coin purchase screen (`store.tsx`) calls `purchaseCoins()` directly without re-initialising billing; it will silently fail with a rejected promise after the first background. The subscription screen does call `initGooglePlayBilling()` before purchasing (and that would reconnect it), but the coin store does not.

**FILES:** `apps/expo/app/_layout.tsx` (lines 213–221), `apps/expo/app/economy/store.tsx` (lines 303–324), `apps/expo/lib/payments/googlePlay.ts`

**FIX:** In `_layout.tsx`, add a listener branch for `'active'` state that calls `initGooglePlayBilling()`. Alternatively (and more defensively), call `initGooglePlayBilling()` at the top of both `purchaseCoins()` and `purchaseSubscription()` — similar to how the subscription screen already does it. Also see BUG-HIGH-08 for the related over-aggressive disconnect.

---

### BUG-CRIT-04 — AdMob using Google's official test app IDs in production

`app.json` sets `react-native-google-mobile-ads.android_app_id` to `ca-app-pub-3940256099942544~3347511713` and `ios_app_id` to `ca-app-pub-3940256099942544~1458002511`. Both are Google's well-known test AdMob app IDs and are globally documented. Any build using these IDs will only ever show test ads; no real ad revenue will be earned in production. The AdMob SDK also logs a warning when test IDs are used in non-debug builds.

**FILES:** `apps/expo/app.json` (lines 101–104)

**FIX:** Create a real AdMob account, register the app, and replace both values with the production app IDs issued by AdMob. Test IDs should only be present in dev/preview builds. Use EAS environment variables or a separate `app.config.js` to switch IDs per build profile.

---

### BUG-HIGH-05 — Booster purchase passes `booster.id` as `boosterType`

The booster section of the store screen renders a "Buy" button for each booster and calls `handleBuyBooster(booster.id, booster.id)`. Both arguments receive the booster's UUID. The second argument is `boosterType`, which the `purchaseBooster` API function sends to `/economy/boosters` as `{ boosterType, quantity: 1 }`. The backend expects a semantic type string (e.g., `'xp_boost'`, `'coin_boost'`) to identify which booster to apply. Sending a UUID will match nothing, causing the purchase to fail server-side or apply the wrong booster.

**FILES:** `apps/expo/app/economy/store.tsx` (line 465)

**FIX:** The `BoosterItem` interface needs a `type` field (e.g., `type: string`) returned from `/economy/store`, and the call should be `handleBuyBooster(booster.id, booster.type)`. Ensure the API response for boosters includes the semantic type string.

---

### BUG-HIGH-06 — Offline SQLite encryption key promise cached permanently on failure

In `getOrCreateEncryptionKey()`, `_encKeyPromise` is assigned the async IIFE before it resolves. If `SecureStore.getItemAsync` or `crypto.subtle.importKey` throws, the promise rejects. The `_encKeyPromise` variable is never cleared on rejection. Every subsequent call to `getOrCreateEncryptionKey()` immediately returns the same rejected promise. This permanently breaks `encryptContent()` and `decryptContent()`, meaning `queueMessage()` throws on every call and offline messages can never be queued until the app is fully restarted.

**FILES:** `apps/expo/lib/offline/sqlite.ts` (lines 57–84)

**FIX:** Clear `_encKeyPromise` in a `.catch()` on the inner promise, or wrap the IIFE in a try/catch that resets it: `_encKeyPromise = myPromise.catch((e) => { _encKeyPromise = null; throw e; })`. This allows a subsequent call to retry key creation.

---

### BUG-HIGH-07 — Push notification deep-link allowlist missing guild chat and group chat routes

`VALID_PUSH_ROUTES` in `_layout.tsx` is the allowlist for push notification `action` payloads. It includes `/guilds/[uuid]` but only matches that exact depth — the pattern `/^\/guilds\/[a-f0-9-]+$/` does NOT match `/guilds/some-id/chat`. Similarly, there is no pattern for `/messages/group/[id]`. When a push notification for a new guild chat message or new group message is tapped, the `action` payload (e.g., `/guilds/abc/chat`) is silently blocked and navigation never occurs. Users are dropped to the home screen.

**FILES:** `apps/expo/app/_layout.tsx` (lines 66–76)

**FIX:** Add the missing patterns to `VALID_PUSH_ROUTES`:
- `/^\/guilds\/[a-f0-9-]+\/chat$/` for guild chat
- `/^\/messages\/group\/[a-f0-9-]+$/` for group messages
- Review all active push notification action payloads the server sends and ensure each has a corresponding allowlist entry.

---

### BUG-HIGH-08 — Billing disconnected on `'inactive'` AppState, not just true background

The AppState listener in `_layout.tsx` calls `disconnectGooglePlayBilling()` when `status === 'background' || status === 'inactive'`. The `'inactive'` state fires on Android when the user pulls down the notification shade, accepts a phone call, or opens the quick-settings panel. This means a user browsing the store who pulls down notifications will have billing silently disconnected mid-session. Combined with BUG-CRIT-03 (no foreground reconnect), even brief `'inactive'` transitions permanently kill billing for that session.

**FILES:** `apps/expo/app/_layout.tsx` (line 216)

**FIX:** Change the condition to `status === 'background'` only. The `'inactive'` state is transient and does not represent the app truly going to the background. On Android, the billing service connection is tolerant of brief interruptions; there is no benefit to tearing it down during `'inactive'`.

---

### BUG-HIGH-09 — Coin store on Android calls `purchaseCoins()` without re-initialising billing

The `handleBuy` function in the store screen detects an Android coin pack purchase and calls `purchaseCoins(playProduct.id)` directly (lines 303–324). Unlike the subscription screen which calls `await initGooglePlayBilling()` before `purchaseSubscription()`, the coin store skips this step. After any background event (even a notification shade pull per BUG-HIGH-08), billing is disconnected. The next coin purchase attempt will fail silently inside `purchaseCoins()` because `initialised` is false and the connection is down.

**FILES:** `apps/expo/app/economy/store.tsx` (lines 303–324)

**FIX:** Add `await initGooglePlayBilling()` before the `purchaseCoins()` call on the Android path, consistent with the subscription screen. Alternatively, have `purchaseCoins()` itself call `initGooglePlayBilling()` at the top (guard with `if (!initialised)`).

---

### BUG-MED-10 — Pidgin locale code never matched; suggestions never fire for Pidgin users

`getPidginSuggestions()` in `pidgin.ts` checks `locale.startsWith('en-NG') || locale === 'ng'`. `isPidginEnabled()` in `pidginEnabled.ts` checks against `['en-NG', 'ha', 'ng', 'yo', 'ig']`. The app registers the Pidgin language with the locale code `'pidgin'` (matching the filename `locales/pidgin.json` and the i18n setup). The string `'pidgin'` matches none of the checks in either function. Pidgin-locale users never receive autocomplete suggestions and `isPidginEnabled` never auto-enables Pidgin mode for them based on locale, even when the admin has the feature on.

**FILES:** `apps/expo/lib/i18n/pidgin.ts`, `apps/expo/lib/i18n/pidginEnabled.ts`

**FIX:** Add `'pidgin'` to both functions' locale checks. In `getPidginSuggestions`: `locale.startsWith('en-NG') || locale === 'ng' || locale === 'pidgin'`. In `isPidginEnabled`: add `'pidgin'` to the array. Optionally also add `'yo'` and `'ig'` support in `getPidginSuggestions` for consistency.

---

### BUG-MED-11 — User-selected theme preference has no effect on the app

The settings screen shows a 'Light / Dark / System' theme picker. Selecting an option calls `set('theme', opt.key)` which PATCHes the preference to the server. However, `ThemeProvider` in `lib/theme/index.tsx` only reads `useColorScheme()` (the device system setting). It never reads the user's saved theme preference — not from the API, not from MMKV. The toggle appears functional (the selection highlights) but the app's actual colours never change in response. Users who prefer forced-light or forced-dark mode cannot achieve it.

**FILES:** `apps/expo/lib/theme/index.tsx`, `apps/expo/app/settings/index.tsx`

**FIX:** Persist the selected theme to MMKV (e.g., `STORE_KEYS.USER_PREFERENCES`) and read it back in `ThemeProvider`. If the stored value is `'light'` or `'dark'`, override `useColorScheme()`. If it is `'system'` or absent, fall back to device scheme. The `ThemeProvider` needs a `userTheme` state that it initialises from MMKV on mount.

---

### BUG-MED-12 — Side effect (`setSpectacle`) called inside React Query `select` callback

In `app/rooms/[roomId].tsx`, the `select` function attached to the messages `useQuery` calls `setSpectacle(...)` when a new gift message arrives. `select` is called by React Query as a pure transformation function on cached data — it may be called multiple times per render cycle, on intermediate renders, and with the same data on re-renders. React Query's own documentation explicitly warns that `select` must be a pure function with no side effects. The `!spectacle` check inside `select` uses a stale closure, so if two gift messages arrive in the same batch, both may or may not trigger the spectacle depending on render ordering. The `prevMessageIdsRef` mutation inside `select` is also a secondary concern (mutable ref mutation in a pure function context).

**FILES:** `apps/expo/app/rooms/[roomId].tsx` (lines 472–495)

**FIX:** Remove the `setSpectacle` call from `select` entirely. Instead, use a `useEffect` that watches the messages list for new gift messages above threshold, keeping the `setSpectacle` call inside a proper effect. The `select` function should only transform and return data.

---

### BUG-MED-13 — Game WebView injects JWT into a `window` global accessible to all scripts

`GameWebView` injects `window.__ZOBIA_TOKEN__ = <jwt>` via `injectedJavaScriptBeforeContentLoaded`. The JWT is thus available to every script that runs in the WebView, including any third-party analytics, ad SDK, or user-supplied content embedded in the game page. If the game embed page ever loads third-party scripts or the server is XSS-susceptible, the token is exfiltrated. The inline comment also incorrectly states the token is "injected via the URL" when it is not — the URL contains no token — but any reader of that comment may be misled about the security surface.

**FILES:** `apps/expo/components/games/GameWebView.tsx` (lines 53–55, 77)

**FIX:** On the server side, issue a short-lived (≤5 min) game-session token scoped only to the game embed, rather than using the full user JWT. Inject that limited token instead. At minimum, fix the misleading comment. Ensure the embed page sets a strict `Content-Security-Policy` that forbids loading third-party scripts.

---

### BUG-MED-14 — Settings language picker missing Pidgin option

The `LANGUAGES` array in the settings screen contains 8 entries: `en, fr, ar, ha, sw, am, zu, pt`. The app has a full `locales/pidgin.json` translation file, `'pidgin'` is a registered locale in the i18n setup, and the manifest feature flag `pidginAutocomplete` controls a Pidgin toggle in the same settings screen. However, there is no `{ code: 'pidgin', label: 'Pidgin' }` entry in the language list. Pidgin-speaking users cannot select their language and are stuck with whichever locale the device reports.

**FILES:** `apps/expo/app/settings/index.tsx` (lines 65–74)

**FIX:** Add `{ code: 'pidgin', label: 'Pidgin' }` to the `LANGUAGES` array.

---

### BUG-MED-15 — Duplicate session-expired UI shown simultaneously on login screen

When `sessionExpired` is true in the auth context, both the root layout and the login screen render expired-session UI concurrently. The root `_layout.tsx` renders `<SessionExpiredModal />` (a React Native Modal). The login screen (`auth/login.tsx`) independently renders its own inline `expiredBanner` view. Both components key off the same `sessionExpired` auth state. Users see two overlapping notifications for the same event.

**FILES:** `apps/expo/app/auth/login.tsx`, `apps/expo/app/_layout.tsx`

**FIX:** Remove the inline expired-session banner from `auth/login.tsx` and rely solely on `SessionExpiredModal`. Alternatively keep the inline banner on the login screen and remove `SessionExpiredModal` from the root layout, but consolidating to one place is cleaner.

---

### BUG-MED-16 — `KeyboardAvoidingView` uses `behavior="padding"` on Android in rooms screen

`app/rooms/[roomId].tsx` uses `<KeyboardAvoidingView behavior="padding">` unconditionally. On Android, `"padding"` does not correctly adjust the layout when the software keyboard appears; `"height"` is the correct value. All other chat screens (`messages/[conversationId].tsx`, `guilds/[guildId]/chat.tsx`, `messages/group/[groupId].tsx`) use `Platform.OS === 'ios' ? 'padding' : 'height'` correctly. The rooms screen is the odd one out, causing the message input bar to be hidden behind the keyboard on Android.

**FILES:** `apps/expo/app/rooms/[roomId].tsx`

**FIX:** Change `behavior="padding"` to `behavior={Platform.OS === 'ios' ? 'padding' : 'height'}` in the rooms screen's `KeyboardAvoidingView`.

---

### BUG-MED-17 — Pending + API messages not deduplicated; messages can appear twice

In `app/messages/[conversationId].tsx` and `app/messages/group/[groupId].tsx`, the combined message list is built as `const combinedMessages = [...pendingMessages, ...messages]`. Optimistic pending messages are added on send and removed `onSuccess` when the server responds. However, between the optimistic add and the `onSuccess` removal, an API poll can fetch the server-confirmed message (with a real server ID) while the pending message (with a local ID) is still in state. The `mergeNewestFirst` deduplication in `delta.ts` only dedupes by ID — since pending messages have `pending-N` IDs and server messages have UUIDs, they are treated as distinct. The same message thus appears twice until the next render cycle clears the pending state.

**FILES:** `apps/expo/app/messages/[conversationId].tsx`, `apps/expo/app/messages/group/[groupId].tsx`

**FIX:** Add content-based deduplication: when building `combinedMessages`, filter out any pending message whose `content` already appears in a server message with a matching `senderUserId` and a `createdAt` within a small window (e.g., ≤5 s). Alternatively, include the pending message's expected content hash in the server response so the client can match by idempotency key.

---

### BUG-MED-18 — `MessageBubble` has no render branch for `'broadcast'` message type

The `MessageBubble` component in `components/rooms/MessageBubble.tsx` accepts a `messageType` prop that includes `'broadcast'` in its TypeScript union. However, the render logic has no `case 'broadcast':` branch (or equivalent condition). Broadcast messages fall through to the default text rendering path. If a broadcast message has `null` content (broadcast messages may have structured data rather than plain text), the `accessibilityLabel` will contain the string `"null"` and the rendered bubble will display nothing or a broken layout.

**FILES:** `apps/expo/components/rooms/MessageBubble.tsx`

**FIX:** Add a dedicated render branch for `'broadcast'` that renders the broadcast in an appropriate styled container (e.g., a system-message style that spans the full width). If broadcast messages carry structured payload rather than plain text `content`, the branch should handle that shape explicitly.

---

### BUG-MED-19 — `handleDeepLink` in login screen has stale closure on `t` after locale change

In `app/auth/login.tsx`, `handleDeepLink` uses `t` (the i18next translation function) inside its body. The `useEffect` that registers it as an event listener has `// eslint-disable-next-line react-hooks/exhaustive-deps` with `handleDeepLink` excluded from the deps array. If the user's locale changes (e.g., the app initialises, determines locale, and updates `i18n`), the registered handler closes over the stale `t` that existed when the effect first ran. Error messages displayed to the user during deep-link handling after a locale switch will be untranslated.

**FILES:** `apps/expo/app/auth/login.tsx`

**FIX:** Either add `handleDeepLink` to the effect's dependency array (which requires it to be stable — wrap it in `useCallback` with `[t]` as deps), or switch to a ref pattern: store `handleDeepLink` in a `useRef` and update it on every render, calling through the ref inside the event listener.

---

### BUG-MED-20 — Coin pack matched to Play Store product by `coinsGranted` amount, not by ID

In `store.tsx` (`handleBuy`), the code finds the Play Store product for a coin pack using `COIN_PRODUCTS.find((cp) => cp.coins === pack.coinsGranted)`. This relies on the server's `coinsGranted` value exactly matching the locally hardcoded `coins` field in `COIN_PRODUCTS`. If the server ever adjusts a pack (e.g., a promotional bonus changes the granted amount from 100 to 150), the lookup returns `undefined`, the purchase path falls to the "not available" alert, and users cannot buy coins. There is no stable ID-based mapping between server packs and Play Store products.

**FILES:** `apps/expo/app/economy/store.tsx` (lines 305–311)

**FIX:** Have the server include a `playStoreProductId` field in the coin pack response that maps directly to the Play Store product ID. Use that field for the lookup: `COIN_PRODUCTS.find((cp) => cp.id === pack.playStoreProductId)`. This is a stable, intent-explicit mapping.

---

### BUG-MED-21 — iOS `associatedDomains` uses `zobia.vercel.app`; AASA hosting may fail

`app.json` sets iOS `associatedDomains` to `applinks:zobia.vercel.app` and `applinks:www.zobia.vercel.app`. For universal links to work on iOS, Apple fetches `https://<domain>/.well-known/apple-app-site-association` (AASA) from the domain. Vercel serves this file correctly for custom domains configured in the Vercel dashboard, but `vercel.app` subdomains are shared infrastructure. If the AASA file is not served at the correct path or with the correct `Content-Type: application/json` header on this specific subdomain, iOS universal links will silently fall back to opening the URL in Safari instead of the app.

**FILES:** `apps/expo/app.json` (lines 22–25)

**FIX:** Verify that `https://zobia.vercel.app/.well-known/apple-app-site-association` serves the correct AASA JSON with the app's bundle ID (`org.zobia.social`). When the custom domain `zobia.app` or `zobia.org` is connected, update `associatedDomains` to use it. Universal links on a proper custom domain are more reliable.

---

### BUG-MED-22 — Android manifest missing `ACCESS_NETWORK_STATE` permission

`app.json` only lists `["android.permission.POST_NOTIFICATIONS"]` in the Android permissions array. `@react-native-community/netinfo` uses `ACCESS_NETWORK_STATE` to determine `isInternetReachable`. On some Android devices and Android 14+ (API 34+) targets, `isInternetReachable` returns `null` if this permission is not declared, causing the offline sync logic in `_layout.tsx` and `syncQueue.ts` to never trigger (the condition `state.isConnected && state.isInternetReachable` is false when `isInternetReachable` is null). Most Expo modules add their own permissions via Gradle plugins, but explicit declaration in `app.json` is the reliable guarantee.

**FILES:** `apps/expo/app.json` (line 36)

**FIX:** Add `"android.permission.ACCESS_NETWORK_STATE"` to the permissions array. Also consider adding `"android.permission.INTERNET"` explicitly (granted by default but declared for clarity) and `"android.permission.VIBRATE"` if notification vibration is desired.

---

### BUG-LOW-23 — Telegram bot name looks like a test/dev value

`extra.telegramBotName` in `app.json` is set to `"Zobia_bot_bot"`. Telegram bot usernames must end in `bot` (case-insensitive), so `Zobia_bot` would be a valid bot name with `@Zobia_bot` as the handle. The double suffix `_bot_bot` is extremely unusual and suggests either a test bot was registered with an accidentally doubled suffix, or the field contains the bot's display name rather than its username handle. If this value is used to construct the Telegram OAuth URL (e.g., `https://t.me/${telegramBotName}`), the link will be broken.

**FILES:** `apps/expo/app.json` (line 95)

**FIX:** Verify the actual registered Telegram bot username and update this value. It should be the bot's `@username` without the `@` prefix. Confirm the OAuth deep-link URL that login.tsx constructs works end-to-end in production.

---

### BUG-LOW-24 — `signOut` does not clear `sessionExpired` flag

In `lib/auth/context.tsx`, the `signOut()` function clears the JWT from SecureStore and resets `user`/`token` state, but it does not reset the `sessionExpired` flag. If a session expires (setting `sessionExpired = true`), the user dismisses the expired modal, then manually signs out from settings (which now calls `signOut()` per BUG-CRIT-01 fix), then signs back in — the `sessionExpired` flag is still `true` from the previous session. The `SessionExpiredModal` may reappear briefly on the next session.

**FILES:** `apps/expo/lib/auth/context.tsx`

**FIX:** Add `setSessionExpired(false)` to the `signOut` function body.

---

### BUG-LOW-25 — `FloatingNotificationProvider` `setTimeout` calls not cleared on unmount

`handleRealtimeEvent` for `quest_complete` and `deck_complete` events calls `setTimeout` to stagger XP and coin notifications (400ms delay). `fireDeckComplete` also uses two `setTimeout` calls. None of these timeouts are stored in refs for cleanup. If the provider unmounts while a 400ms timer is in flight (e.g., during a fast navigation event), the timer fires and calls `addNotification` on unmounted state. While React 18 no longer throws on this, it still triggers unnecessary state updates and potential memory retention.

**FILES:** `apps/expo/components/providers/FloatingNotificationProvider.tsx` (lines 178–202, 272–286)

**FIX:** Store the timeout IDs in refs (or an array ref) and clear them in a `useEffect` cleanup. Alternatively, wrap the delayed notifications in a single `useEffect` with proper cleanup.

---

### BUG-LOW-26 — `AnnouncementBanner` ignores `contentType` severity; always renders blue

`BannerData` includes a `contentType` field (presumably values like `'info'`, `'warning'`, `'danger'`). The component always sets `bgColor = colors.brand.blue` regardless of `contentType`. A `'danger'` announcement (e.g., security notice, emergency maintenance) looks visually identical to an informational one, reducing the urgency signal to users.

**FILES:** `apps/expo/components/announcements/AnnouncementBanner.tsx` (line 101)

**FIX:** Map `contentType` to appropriate colours: `'danger'` → `colors.semantic.error`, `'warning'` → `colors.brand.gold`, default → `colors.brand.blue`. Apply the mapped colour to `bgColor`.

---

### BUG-LOW-27 — GIF search `debounceRef` in rooms screen not cleared on unmount

In `app/rooms/[roomId].tsx`, a `debounceRef` is used to debounce GIF search input. The `useEffect` that handles the GIF search does not clear `debounceRef.current` in its cleanup function. If the user types in the GIF search box and then quickly navigates away (unmounting the screen), the debounce timer fires after unmount, calling `setGifResults` on a component that no longer exists.

**FILES:** `apps/expo/app/rooms/[roomId].tsx`

**FIX:** In the GIF search `useEffect`'s cleanup, add `if (debounceRef.current) clearTimeout(debounceRef.current)`.

---

### BUG-LOW-28 — Wallet `formatDate` hardcodes `'en-NG'` locale for all users

The `formatDate` helper in `app/economy/wallet.tsx` uses `new Date(ts).toLocaleDateString('en-NG', ...)`. This forces all transaction timestamps to display in Nigerian English date format regardless of the authenticated user's chosen language. French, Arabic, Swahili, and other locale users see their wallet dates formatted for Nigeria.

**FILES:** `apps/expo/app/economy/wallet.tsx`

**FIX:** Replace the hardcoded `'en-NG'` with `i18n.language` from `useTranslation()`, or use `undefined` to let the device locale determine formatting. Import `useTranslation` and pass `i18n.language` to `toLocaleDateString`.

---

### BUG-LOW-29 — Auth context AppState effect re-subscribes on every token rotation

The `useEffect` in `lib/auth/context.tsx` that subscribes to `AppState` for foreground token-refresh has `[token]` in its dependency array. Every time the access token rotates (every ~15–60 minutes typically), this effect's cleanup runs (removing the listener) and the effect runs again (re-adding it). This causes a brief gap in AppState coverage and unnecessary churn. The effect body only uses `token` to trigger a conditional token refresh — not as event handler state — so the subscription itself has no need to re-register when `token` changes.

**FILES:** `apps/expo/lib/auth/context.tsx`

**FIX:** Use a stable ref for the token inside the AppState listener so the subscription itself only registers once (empty deps). Update the ref whenever `token` changes in a separate `useEffect`.

---

### BUG-LOW-30 — `refreshAccessToken` TypeScript type mismatch

`axios.post` in `refreshAccessToken` is typed as `axios.post<{ expiresIn: number }>(...)`. The return type annotation `res.data` is therefore `{ expiresIn: number }`. Immediately after, the code casts it to `{ accessToken?: string }` and `{ refreshToken?: string }` without any intermediary type assertion. TypeScript accepts this because of the explicit `as` cast, but the declared return type is incorrect and misleads developers reading the code about what the server actually returns. If the response shape changes, TypeScript will not warn.

**FILES:** `apps/expo/lib/api/client.ts` (lines 123–148)

**FIX:** Change the generic to `axios.post<{ accessToken: string; refreshToken?: string; expiresIn: number }>`. Remove the `as` casts and use the typed fields directly. This ensures TypeScript enforces the contract.

---

### BUG-LOW-31 — `GiftSpectacle` auto-dismiss timer closes over potentially stale `onDismiss`

In `GiftSpectacle`, the `useEffect` that starts the dismiss timer calls `handleDismiss()` via `setTimeout`. `handleDismiss` is defined inside the component and closes over `onDismiss` from props. The dependency array is `[data]` (eslint-disabled). If `onDismiss` identity changes between mount and when the timer fires (3 seconds), the stale version is called. In practice `onDismiss` is typically a stable state setter, so the risk is low — but it's an unnecessary fragility.

**FILES:** `apps/expo/components/rooms/GiftSpectacle.tsx` (lines 71–105)

**FIX:** Store `handleDismiss` in a `useRef` (`handleDismissRef`) and update it on every render. Call `handleDismissRef.current()` inside the `setTimeout`. This eliminates the stale closure without requiring any additional deps.

---

### BUG-LOW-32 — Two-factor screen submit button has redundant disabled condition

In `app/auth/two-factor.tsx`, the submit button has:
`disabled={loading || code.length !== 6 || !!error && code.length !== 6}`

The last sub-expression `!!error && code.length !== 6` is logically subsumed by `code.length !== 6` which already appears earlier. The button is disabled whenever `code.length !== 6`, making the `!!error &&` prefix pointless. This is harmless to functionality but creates confusion for future readers about intent.

**FILES:** `apps/expo/app/auth/two-factor.tsx`

**FIX:** Simplify to `disabled={loading || code.length !== 6}`. If the intent was to keep the button enabled when there's an error and 6 digits are entered (to allow retry), the logic needs rethinking — but that isn't the current behaviour anyway.

---

### BUG-LOW-33 — `apiFetch` `MAX_RETRIES = 3` runs 4 total attempts

In `lib/api/apiFetch.ts`, `const MAX_RETRIES = 3` but the retry loop condition is `attempt <= MAX_RETRIES`. This executes `attempt = 0, 1, 2, 3` — four attempts total. The naming implies 3 retries (plus the initial attempt = 4 total, which is fine) but could equally be read as "maximum 3 total attempts." The variable name and the loop condition are inconsistent in their semantics.

**FILES:** `apps/expo/lib/api/apiFetch.ts`

**FIX:** Either rename to `MAX_ATTEMPTS = 4` and change the condition to `attempt < MAX_ATTEMPTS`, or keep `MAX_RETRIES = 3` and change to `attempt < MAX_RETRIES + 1`. Pick one consistent convention and stick to it.

---

### BUG-LOW-34 — Telegram OAuth polling first delay is 500ms, not 2s as documented

In `app/auth/login.tsx`, the Telegram polling backoff schedules the first check using `scheduleNext(0)`. The delay for attempt `0` is calculated as `Math.min(2000 * Math.pow(2, Math.max(0, 0 - 2)), 16000)` = `Math.min(2000 * 0.25, 16000)` = 500ms. The comment says "2-second backoff starting at attempt 0" which is factually incorrect. Functionally the 500ms first ping is fine (arguably preferable), but the comment misleads maintainers.

**FILES:** `apps/expo/app/auth/login.tsx`

**FIX:** Update the comment to accurately describe the actual backoff curve, or adjust the formula to match what the comment says. If the intent is 500ms → 1s → 2s → 4s → ... → 16s cap, document that explicitly.

---

## Code Quality Rating

### Current State: **5.5 / 10**

**Strengths:**
- Solid architecture foundations: React Query, Zustand-free auth with SecureStore, typed env via Zod, offline SQLite queue with AES-256-GCM encryption, proper MMKV proxy pattern, ref-based realtime callback to avoid re-subscriptions (BUG-MOB-22 fix), concurrent purchase session map with UUID session IDs, server-side purchase verification before `finishTransaction`.
- Good security awareness in several areas: idempotency keys on offline messages, origin header on all API requests for CSRF, push notification action allowlist, encrypted MMKV store.
- Delta message fetching (`newestCreatedAt`, `mergeNewestFirst`) is cleanly abstracted and correct.
- `withIapPlayFlavor` Gradle plugin correctly resolves the react-native-iap store dimension ambiguity.
- The `resetSendingMessages` / `resetFailedMessages` pattern for crash recovery is well-thought-out.

**Weaknesses:**
- Two critical authentication bugs (BUG-CRIT-01/02) mean logout and account deletion are fully broken — this is the single most impactful class of bug in the codebase.
- The billing lifecycle (CRIT-03, HIGH-08, HIGH-09) is architecturally broken; in-app purchases will fail silently after any background event.
- Test AdMob IDs in production config means zero ad revenue.
- Several medium bugs (theme preference, Pidgin locale, push allowlist gaps) indicate features that were built but not fully wired together.
- TypeScript is used inconsistently — some files rely on `as` casts that defeat type safety.

### Projected Rating After All Fixes: **8.5 / 10**

Fixing the critical and high bugs transforms the app from "broken in production for most users who background the app or try to log out" to a well-structured and reasonably secure mobile app. The medium fixes close UX gaps (keyboard, theme, Pidgin) and the low fixes tighten up edge cases and type safety. The remaining gap to 10/10 would be addressed by: a proper Content Security Policy on game WebViews, migrating the game token injection to a scoped session token, adding integration tests for the purchase flow, and migrating the `select` side-effect pattern to a dedicated `useEffect`.

---

*Report generated: June 25, 2026 12:43 PM*  
*Zobia Social — Expo App Forensic Bug Analysis*
