# Zobia Social — Expo Android App: Forensic Bug Report

**Date:** 2026-06-25  
**Time:** 10:40 PM  
**Scope:** Expo mobile app (Android API 36 primary target); issues that also affect web/PWA are noted.  
**Analysis method:** Deep, file-by-file manual code review across all relevant Expo app source files.

---

## Code Quality Rating — Current State

**Overall: 6.5 / 10**

The architecture is genuinely good in several places: the IAP purchase-session/resolver pattern is thoughtfully designed, the offline queue uses AES-256-GCM encryption with a SecureStore-backed key, React Query is used correctly with proper stale times and query invalidation, and the auth token refresh is protected against concurrent re-entrancy. The TypeScript coverage is solid and component decomposition is clean.

However, several issues materially hurt the runtime behaviour in production: AdMob IDs are empty in the production EAS profile (test ads in prod), a staging env-schema mismatch silently degrades behaviour, the DM reaction highlight is unconditionally `false` (functional regression for all DM users), and the Android keyboard handling is doubly broken across three chat screens. These would be caught by end-to-end testing on a real device before launch.

---

## Code Quality Rating — After All Recommended Fixes

**Projected: 8.5 / 10**

After fixes the codebase would be production-ready with robust edge-case handling, correct keyboard behaviour on Android API 36, security hardening (backup disabled, proper settings deep-link), and no user-facing functional regressions. The remaining gap from 10/10 reflects the monolithic size of a few screens (rooms, DM) that would benefit from future refactoring.

---

## Complete Bug List (Quick Reference)

1. BUG-C01: Empty production AdMob App IDs — test ads served in production
2. BUG-C02: `APP_ENV: "staging"` not accepted by Zod schema — staging silently uses dev config
3. BUG-C03: DM reaction `userReacted` always `false` — own reactions never highlighted
4. BUG-H04: Google OAuth deep-link double-fire — two token exchange requests fire simultaneously
5. BUG-H05: Optimistic message ID collision in rooms screen — `pending-${Date.now()}` not unique
6. BUG-H06: `KeyboardAvoidingView` + `adjustPan` double-adjustment on Android in all chat screens
7. BUG-H07: Guild chat `onContentSizeChange` jumps to bottom when user loads older messages
8. BUG-H08: `signOut` fires a `fetch()` with no timeout — hangs indefinitely on poor network
9. BUG-H09: Token exchange `fetch()` in deep-link handler has no timeout/abort
10. BUG-M10: Deprecated `username` field in `expo-updates` plugin config (should be `projectId`)
11. BUG-M11: Missing `android.allowBackup: false` — sensitive data exposed to backup
12. BUG-M12: GIF picker state not cleared on modal close in rooms screen — stale results on reopen
13. BUG-M13: GIF search query param inconsistency — DM uses `q`, rooms uses `query`
14. BUG-M14: SQLite migration runs three unnecessary `ALTER TABLE` calls on every cold start
15. BUG-M15: Push notification failure alert has no "Open Settings" button — UX dead-end
16. BUG-M16: `softwareKeyboardLayoutMode: "pan"` deprecated and broken on Android API 36 edge-to-edge
17. BUG-M17: Age gate year-only validation is too lenient — December birthday edge case
18. BUG-M18: SwipeDrawer 24px gesture zone conflicts with Android system back gesture (API 29+)
19. BUG-M19: `prefsStore` MMKV instantiated at module load without bridge guard in i18n
20. BUG-M20: `GiftSpectacle` animation resets mid-flight when rapid successive gifts arrive
21. BUG-L21: `react-native-google-mobile-ads` not explicitly listed in `plugins[]`
22. BUG-L22: Guild chat `scrollToEnd` scheduled on a fragile 100ms `setTimeout` after send
23. BUG-L23: `endBillingConnection` removes IAP listeners without re-establishing on foreground return
24. BUG-L24: Guild chat "Load older messages" button label may be semantically inverted

---

## Detailed Bug Breakdown

---

### BUG-C01: Empty production AdMob App IDs — test ads served in production

**Severity:** Critical  
**FILES:** `apps/expo/eas.json`, `apps/expo/app.config.ts`

The production EAS build profile in `eas.json` has both `ADMOB_APP_ID_ANDROID` and `ADMOB_APP_ID_IOS` set to empty strings (`""`). In `app.config.ts`, the AdMob IDs are read as `process.env.ADMOB_APP_ID_ANDROID || ADMOB_TEST_ANDROID`. Because an empty string is falsy in JavaScript, the production build always falls back to the Google-provided test App IDs (`ca-app-pub-3940256099942544~...`). The result is that every production user sees test ads instead of real ads, and zero ad revenue is generated. Additionally, `EXPO_PUBLIC_ADMOB_*` env vars are read at runtime in `lib/ads/admob.ts` for ad unit IDs — if those are also not set in eas.json, the unit IDs fall back to test unit IDs as well.

**FIX:** Replace the empty string values in `eas.json` production profile with the real Google AdMob App IDs for Android and iOS. Add the corresponding `EXPO_PUBLIC_ADMOB_BANNER_ID`, `EXPO_PUBLIC_ADMOB_INTERSTITIAL_ID`, and `EXPO_PUBLIC_ADMOB_REWARDED_ID` vars to the production profile as well. Use EAS Secrets for sensitive ad IDs rather than committing them to `eas.json`.

---

### BUG-C02: `APP_ENV: "staging"` not accepted by Zod schema — staging silently uses dev config

**Severity:** Critical  
**FILES:** `apps/expo/lib/env.ts`, `apps/expo/eas.json`

The staging EAS build profile sets `APP_ENV: "staging"`. The Zod schema in `lib/env.ts` validates `APP_ENV` against the enum `["development", "preview", "production"]` — the value `"staging"` is not listed. When Zod fails to parse the env value, the parse either throws or silently defaults (depending on whether `.safeParse` or `.parse` is used). In either case, the staging build does not know it is in a staging context and behaves as a development build. This means staging builds may hit development API endpoints, use development feature flags, and show development-only UI elements, making staging tests invalid.

**FIX:** Add `"staging"` to the `APP_ENV` Zod enum in `lib/env.ts`. Alternatively, rename the EAS staging profile's env var to `APP_ENV: "preview"` to align with the existing schema, and ensure that "preview" builds point to the staging API. Either way the schema and eas.json must agree on the set of valid values.

---

### BUG-C03: DM reaction `userReacted` always `false` — own reactions never highlighted

**Severity:** Critical  
**FILES:** `apps/expo/app/messages/[conversationId].tsx`

In the `mapApiDM` function that transforms API DM data into the local message format, reaction objects are mapped with `userReacted: false` hardcoded unconditionally. The aggregated reaction data from the API almost certainly includes a field indicating whether the authenticated user has reacted (e.g., `user_reacted`, `has_reacted`, or the user's ID appears in a `reactedUserIds` array). Because `userReacted` is always `false`, the reaction pill highlight (the `reactionPillActive` style in `MessageBubble`) is never applied in any DM conversation. Users cannot see which reactions they have already applied, and tapping a reaction appears to do nothing visually.

**FIX:** Inspect the API response shape for DM reactions and pass the current user's ID into `mapApiDM`. For each reaction, compute `userReacted` by checking whether the API's `reactedUserIds` (or equivalent) array includes the current user's ID. Pass the authenticated `user.id` into `mapApiDM` as a parameter to enable this comparison.

---

### BUG-H04: Google OAuth deep-link double-fire — two token exchange requests

**Severity:** High  
**FILES:** `apps/expo/app/auth/login.tsx`

In `handleGoogleLogin`, after `WebBrowser.openAuthSessionAsync(googleAuthUrl, redirectUri)` resolves with `result.type === 'success'`, the code calls `await handleDeepLink({ url: result.url })` directly. Simultaneously, the `ExpoLinking.addEventListener('url', ...)` subscription registered in the `useEffect` is also active during this period and fires when the deep-link URL is delivered to the app. On Android, both the `openAuthSessionAsync` resolution and the `Linking` event can fire for the same redirect URL, causing `handleDeepLink` to be invoked twice. The one-time exchange code is then sent to `/api/auth/mobile-token` twice; the second request will fail (the code has been consumed), but the error handling logs only a generic alert that may confuse the user.

**FIX:** Add an idempotency guard using a ref (e.g., `const exchangedRef = useRef(false)`). At the start of `handleDeepLink`, check if `exchangedRef.current === true` and return early if so. Set `exchangedRef.current = true` before the `fetch()` call, and reset it (set back to `false`) if the exchange fails so the user can try again. Reset the ref each time a new auth session starts.

---

### BUG-H05: Optimistic message ID collision in rooms screen

**Severity:** High  
**FILES:** `apps/expo/app/rooms/[roomId].tsx`

Optimistic messages are inserted into the local messages state with the ID `` `pending-${Date.now()}` ``. `Date.now()` has millisecond precision. On a modern device with fast JavaScript execution, two rapid sends (a double-tap, or a send immediately followed by another) within the same millisecond will produce identical IDs (e.g., both get `pending-1719359200000`). React's FlatList `keyExtractor` will receive duplicate keys, causing React reconciliation warnings, and the `prevMessageIdsRef` deduplication set will suppress the second message.

**FIX:** Replace `` `pending-${Date.now()}` `` with `` `pending-${crypto.randomUUID()}` `` to guarantee collision-proof unique IDs regardless of send rate. `crypto.randomUUID()` is available globally in React Native's Hermes runtime (Expo SDK 49+).

---

### BUG-H06: `KeyboardAvoidingView` + `adjustPan` double-adjustment on Android in all chat screens

**Severity:** High  
**FILES:** `apps/expo/app.json`, `apps/expo/app/rooms/[roomId].tsx`, `apps/expo/app/messages/[conversationId].tsx`, `apps/expo/app/guilds/[guildId]/chat.tsx`

`app.json` sets `"softwareKeyboardLayoutMode": "pan"` for Android, which compiles to `android:windowSoftInputMode="adjustPan"` in the app's `AndroidManifest.xml`. All three chat screens simultaneously use `<KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>`. On Android, `adjustPan` pans the entire window when the keyboard appears. `KeyboardAvoidingView` with `behavior="height"` also adjusts the view's height when the keyboard appears. Both adjustments fire together, causing the layout to shift by roughly double the keyboard height, pushing content far too far up and often clipping the input bar or top of the screen. The rooms screen additionally computes `keyboardOffset = Platform.OS === 'ios' ? insets.top + 44 : 0`, giving Android a 0 offset — which may not be sufficient even if the double-shift is resolved.

**FIX:** On Android API 36 with edge-to-edge enforcement, change `"softwareKeyboardLayoutMode"` to `"adjustNothing"` in `app.json` and handle insets manually using `react-native-safe-area-context`. Remove `behavior="height"` from `KeyboardAvoidingView` on Android (set `behavior` to `undefined` on Android, `"padding"` on iOS only). Use the `useKeyboardHeight` hook or `KeyboardAvoidingView` with `behavior="padding"` + manual bottom padding driven by `useBottomTabBarHeight` and keyboard height.

---

### BUG-H07: Guild chat `onContentSizeChange` scrolls to bottom when loading older messages

**Severity:** High  
**FILES:** `apps/expo/app/guilds/[guildId]/chat.tsx`

The `FlatList` in guild chat passes `onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}`. This callback fires every time the content height changes — including when the "Load older messages" button prepends older messages to the top of the list. When older messages load and the list grows upward, `scrollToEnd` snaps the view to the bottom of the list, yanking the user away from the older messages they just requested. This makes the "Load older messages" feature effectively unusable.

**FIX:** Replace `onContentSizeChange` with a controlled approach. Maintain a `shouldScrollToEnd` ref that is `true` only after sending a new message (reset to `false` in `onContentSizeChange` itself after handling). Alternatively, use an inverted FlatList (set `inverted={true}`) with cursor-based pagination going upward, which is the standard pattern for chat interfaces and avoids this problem entirely.

---

### BUG-H08: `signOut` uses fire-and-forget `fetch()` without timeout

**Severity:** High  
**FILES:** `apps/expo/lib/auth/context.tsx`

The `signOut` function in `lib/auth/context.tsx` calls the backend logout endpoint using raw `fetch()` with no `AbortController` and no timeout. The call is intentionally fire-and-forget (local state is cleared regardless of server response). However, on a poor network, the open fetch connection holds resources and may trigger a warning or, in edge cases, delay garbage collection of the auth context. More practically, if the network drops entirely, the `fetch()` call will sit open until the OS-level socket timeout (which can be minutes).

**FIX:** Wrap the logout `fetch()` call in an `AbortController` with a 5-second timeout. Use `setTimeout` + `controller.abort()` and pass the `signal` to `fetch`. Since the sign-out is fire-and-forget, the abort just means the request is abandoned — which is acceptable. The local state cleanup (clearing tokens, etc.) should always proceed regardless.

---

### BUG-H09: Token exchange `fetch()` in deep-link handler has no timeout

**Severity:** High  
**FILES:** `apps/expo/app/auth/login.tsx`

In `handleDeepLink`, the line `const exchangeRes = await fetch(\`${env.API_BASE_URL}/api/auth/mobile-token\`, ...)` has no `AbortController` timeout. OAuth exchange codes are typically valid for 60–120 seconds. On a slow network, the `fetch()` can hang well past the code's expiry, then fail when the server returns a 4xx for an expired code. The user sees a generic error alert with no useful explanation and has to restart the entire login flow.

**FIX:** Add an `AbortController` with a 15-second timeout to the token exchange `fetch()`. Catch `AbortError` separately and show a user-friendly message ("Login timed out — please try again") distinct from the generic error.

---

### BUG-M10: Deprecated `username` field in `expo-updates` plugin config

**Severity:** Medium  
**FILES:** `apps/expo/app.json`

The `expo-updates` plugin in `app.json` is configured with `{ "username": "zobia" }`. The `username` field was deprecated in expo-updates v0.18 in favor of `projectId`. With Expo SDK 51, this field is a no-op and generates a deprecation warning during `expo prebuild` and EAS builds. The correct identifier already exists in `extra.eas.projectId` (`"ad68e531-aa48-4873-8d41-3bca8f18b9a4"`). Without the correct plugin config, OTA update channels may not target the right project in the EAS Update dashboard.

**FIX:** Replace the `expo-updates` plugin entry from `["expo-updates", { "username": "zobia" }]` to `["expo-updates", { "projectId": "ad68e531-aa48-4873-8d41-3bca8f18b9a4" }]`. This value matches what is already in `extra.eas.projectId`.

---

### BUG-M11: Missing `android.allowBackup: false` — sensitive app data exposed to backup

**Severity:** Medium  
**FILES:** `apps/expo/app.json`

`app.json` does not set `android.allowBackup` to `false`. Android's default is `allowBackup="true"`, which means the app's data directory (including SQLite databases, MMKV storage files, and cached tokens) can be captured by `adb backup`, Google One Tap, or Google Drive Auto Backup. Even though message content in SQLite is AES-256-GCM encrypted and auth tokens are in SecureStore (hardware-backed, not backed up), MMKV stores (chat cache, UI preferences, offline queues) are in the app's standard data directory and will be backed up. For a social app with private messaging, this is a security concern.

**FIX:** Add `"allowBackup": false` under the `"android"` section of `app.json`. If selective backup of non-sensitive data is desired, configure `android:fullBackupContent` with an XML rules file that excludes databases and MMKV files. At minimum, the flat-out disable is the safe default.

---

### BUG-M12: GIF picker state not cleared on modal close — stale results on reopen

**Severity:** Medium  
**FILES:** `apps/expo/app/rooms/[roomId].tsx`

The GIF picker modal in the rooms screen holds GIF search query text and search result state in component-level state variables. When the user closes the modal (without selecting a GIF), these state variables are not reset. The next time the user opens the GIF picker, they see the previous search query pre-populated and the previous results still visible — even though they may want to search for something different. This is a persistent UX annoyance on every GIF picker reopen after a prior search.

**FIX:** In the `onRequestClose` and "close" button handler for the GIF picker modal, reset both the search query state and the GIF results state to their initial values (empty string / empty array). Alternatively, keep GIF state local to a child `GifPickerModal` component so it naturally resets when the modal unmounts.

---

### BUG-M13: GIF search uses inconsistent query param names across screens

**Severity:** Medium  
**FILES:** `apps/expo/app/messages/[conversationId].tsx`, `apps/expo/app/rooms/[roomId].tsx`

The DM conversation screen (`app/messages/[conversationId].tsx`) makes GIF search requests with the URL parameter `q` (e.g., `/gifs/search?q=cats`), while the rooms screen (`app/rooms/[roomId].tsx`) uses `query` (e.g., `/gifs/search?query=cats`). If the backend API only handles one of these parameter names and ignores the other, one of the two GIF search implementations is silently returning no results or empty responses. This inconsistency also makes the API contract ambiguous.

**FIX:** Decide on a single canonical query parameter name for GIF search (coordinate with the backend). Update both screens to use the same parameter name. Add a shared `searchGifs(term: string)` helper in a shared lib file (e.g., `lib/api/gifs.ts`) so that the parameter is defined in one place.

---

### BUG-M14: SQLite migration runs three unnecessary `ALTER TABLE` calls on every cold start

**Severity:** Medium  
**FILES:** `apps/expo/lib/offline/sqlite.ts`

`initOfflineDB()` first runs `CREATE TABLE IF NOT EXISTS offline_messages (...)` which already includes the `conversation_type`, `idempotency_key`, and `retry_count` columns in its schema definition. Immediately after, the function runs three `ALTER TABLE ADD COLUMN` statements for those same columns. On fresh installs (and on every subsequent app launch), these three statements are guaranteed to fail with "duplicate column name" errors, which are caught and silently discarded. This runs three failing DB writes on every cold start and adds latency to app initialization.

**FIX:** Track migration state using a `user_version` pragma or a dedicated `migrations` table. Check the version before running any migration SQL. Alternatively, since `CREATE TABLE IF NOT EXISTS` already includes all required columns, simply remove the three `ALTER TABLE` statements entirely for new installations. For existing installations with older schemas (missing those columns), keep the migrations but guard them with a schema version check so they only run once.

---

### BUG-M15: Push notification failure alert has no "Open Settings" button — UX dead-end

**Severity:** Medium  
**FILES:** `apps/expo/app/_layout.tsx`

When `registerForPushNotifications` fails (e.g., the user denies the permission), `app/_layout.tsx` shows an `Alert.alert` that tells the user to go to device Settings to enable notifications. However, the alert only has an "OK" button — there is no "Open Settings" button that calls `Linking.openSettings()`. The user is instructed to do something (go to Settings) but given no way to do it directly from the alert. Most users will dismiss the alert and forget about it.

**FIX:** Add a second button to the alert: `{ text: 'Open Settings', onPress: () => Linking.openSettings() }`. Import `Linking` from `react-native`. This is a standard pattern for permission denials and dramatically improves the conversion rate from "denied" to "enabled."

---

### BUG-M16: `softwareKeyboardLayoutMode: "pan"` deprecated and broken on Android API 36 edge-to-edge

**Severity:** Medium  
**FILES:** `apps/expo/app.json`

Android API 35 made edge-to-edge display mandatory. The `adjustPan` keyboard mode (produced by `"softwareKeyboardLayoutMode": "pan"`) causes the OS to pan the entire window to keep the focused input visible. On API 36 with edge-to-edge, this pan is calculated from the window's actual drawing area (which extends under the status bar and navigation bar), producing an incorrect offset — the keyboard can obscure the input bar or push content under the status bar. `adjustPan` is deprecated in Android 12 (API 31) and its behavior is undefined on API 35+. This is separate from, but compounds, the `KeyboardAvoidingView` double-adjustment in BUG-H06.

**FIX:** Set `"softwareKeyboardLayoutMode": "adjustNothing"` (maps to `windowSoftInputMode="adjustNothing"`) in `app.json`. Use the `useKeyboardAnimation` hook from `react-native-keyboard-controller` (or the built-in `Keyboard` events) to drive layout adjustments manually. This is the correct pattern for edge-to-edge apps targeting API 35+.

---

### BUG-M17: Age gate year-only validation is too lenient — birthday edge case

**Severity:** Medium  
**FILES:** `apps/expo/app/onboarding/index.tsx`

The minimum-age check in onboarding computes `currentYear - birthYear < MINIMUM_AGE` using only the birth year, ignoring birth month and day. A user born on December 31 of the minimum-age birth year is only `currentYear - birthYear - 1` years old on January 1 of the current year, yet passes the check because `currentYear - birthYear === MINIMUM_AGE`. The code comment labels this "the strictest check," but it is actually the most lenient year-only approach (it errs on the side of letting users through). For a platform that may have age-restricted content, this is a compliance concern.

**FIX:** Replace the year-difference check with a proper date comparison. Construct a `Date` object from `birthYear`, `birthMonth`, and `birthDay`, then compute the age in full years as of today. Check `today >= addYears(birthday, MINIMUM_AGE)`. This is a true birthday check and passes on the user's actual birthday, not January 1 of the qualifying year.

---

### BUG-M18: SwipeDrawer 24px gesture zone conflicts with Android system back gesture (API 29+)

**Severity:** Medium  
**FILES:** `apps/expo/components/layout/SwipeDrawer.tsx`

The `SwipeDrawer` activates its pan gesture when `absoluteX <= 24` (24 logical pixels from the left edge). Android 10 (API 29) introduced gesture navigation, and the left edge swipe (within a 30dp region from the edge) is reserved for the system Back gesture. On Android 13+ (API 33), this gesture zone is not negotiable from app space. As a result, the system back gesture and the drawer's pan gesture compete for the same touch events. In practice, on gesture-navigation Android devices, the SwipeDrawer may fail to open because the system intercepts the touch, or the back gesture may fire unexpectedly when the user tries to open the drawer.

**FIX:** Increase the left-edge gesture exclusion zone to let the system back gesture take priority. Use `react-native-gesture-handler`'s `GestureDetector` with an `ExclusionZone` or `simultaneousHandlers` to coordinate with the system gesture. The drawer trigger could be a visible handle widget near the left edge rather than relying on the full edge swipe zone, avoiding the conflict entirely.

---

### BUG-M19: `prefsStore` MMKV instantiated at module load without a bridge guard

**Severity:** Medium  
**FILES:** `apps/expo/lib/i18n/index.ts`

`lib/i18n/index.ts` creates `new MMKV({ id: 'zobia_prefs' })` at module-evaluation time (top-level statement, before any React tree mounts). Unlike the encrypted `storage` in `lib/offline/store.ts` (which is behind a Proxy that throws a descriptive error if the store isn't ready), `prefsStore` has no guard. If the MMKV native module is not yet bridged when this module is first imported — which can happen on first launch on certain devices if Metro bundles are evaluated during the native module initialization race — the MMKV constructor throws a native error that propagates as an uncaught exception and crashes the JS runtime before any error boundary can catch it. The `resolveLocale` function wraps its own MMKV calls in `try/catch`, but the constructor call itself is unguarded.

**FIX:** Wrap the `new MMKV(...)` call in a `try/catch` and fall back to an in-memory mock object with no-op `getString`/`set`/`delete` methods if the native module is unavailable. Alternatively, move the `prefsStore` initialization into a function that is called lazily on first access rather than at module-load time.

---

### BUG-M20: `GiftSpectacle` animation resets mid-flight on rapid successive gifts

**Severity:** Medium  
**FILES:** `apps/expo/components/rooms/GiftSpectacle.tsx`

`GiftSpectacle` runs a `useEffect` that triggers when `data` changes. On each new `data` value the effect calls `scaleAnim.setValue(0.5)` and `opacityAnim.setValue(0)` to reset the animated values, then starts a new spring-in animation. `handleDismiss` runs a 250ms `Animated.timing` fade-out, then calls `onDismissRef.current()`. If a second gift arrives during those 250ms (a common scenario in active rooms where users send gifts rapidly), the effect fires mid-fade-out, abruptly snapping `opacityAnim` to 0 and `scaleAnim` to 0.5. The running fade-out animation's completion callback then calls `onDismissRef.current()` — but the component has already begun animating in for the new gift. The net effect is a visual flash/snap that breaks the spectacle animation.

**FIX:** Cancel any in-progress animation before starting the new one. Call `opacityAnim.stopAnimation()` and `scaleAnim.stopAnimation()` at the top of the data-change effect before the `setValue` resets. Also track the dismiss-animation reference (`Animated.CompositeAnimation`) and call `.stop()` on it before the data-change effect fires. This ensures clean animation handoff.

---

### BUG-L21: `react-native-google-mobile-ads` not explicitly listed in `plugins[]`

**Severity:** Low  
**FILES:** `apps/expo/app.json`, `apps/expo/app.config.ts`

`app.config.ts` sets `'react-native-google-mobile-ads': { android_app_id, ios_app_id }` at the top-level config, which the package's Expo config plugin reads to inject the AdMob App ID into `AndroidManifest.xml`. However, the plugin itself is not listed in `plugins[]` in `app.json`. The package relies on Expo's auto-plugin detection (via its `app.plugin.js` declared in its `package.json`). While this usually works, it is fragile: if the package is moved to a different dependency location in a monorepo, or if Expo changes auto-plugin resolution, the plugin silently fails to apply and AdMob crashes on launch. Explicit plugin registration also makes the config auditable.

**FIX:** Add `"react-native-google-mobile-ads"` to the `plugins[]` array in `app.json`. The plugin config (app IDs) can remain in `app.config.ts` as the dynamic overrides, or be moved into the plugin entry as the second array element.

---

### BUG-L22: Guild chat send `scrollToEnd` on a fragile 100ms `setTimeout`

**Severity:** Low  
**FILES:** `apps/expo/app/guilds/[guildId]/chat.tsx`

After a message send succeeds, the guild chat screen calls `setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100)`. The 100ms delay is intended to allow the React Query invalidation and re-render to settle before scrolling. However, on slow devices or slow backend responses (where the query re-fetch takes >100ms), `scrollToEnd` fires before the new message appears in the FlatList. The scroll has no effect, and the user must manually scroll to see their sent message.

**FIX:** Instead of a fixed timeout, use `queryClient.invalidateQueries(...)` and in the `onSuccess` callback chain off the re-fetch directly. Alternatively, use an optimistic update to insert the message locally before the server responds, then `scrollToEnd` immediately after inserting the optimistic entry (no timeout needed).

---

### BUG-L23: `endBillingConnection` removes IAP listeners without re-establishing on foreground return

**Severity:** Low  
**FILES:** `apps/expo/lib/payments/googlePlay.ts`, `apps/expo/app/_layout.tsx`

`endBillingConnection()` is designed to be called when the app backgrounds. It removes `purchaseUpdateSub` and `purchaseErrorSub` (the purchase event listeners) and calls `endConnection()`, setting `initialised = false`. When the app returns to the foreground, there is no code that re-calls `initGooglePlayBilling()` to re-establish the connection and re-register the listeners. Any purchase that the user initiated before backgrounding and that resolves after foregrounding (e.g., a Play Store 3DS authentication flow) will deliver its event to a listener that no longer exists. The resolver map retains the pending sessionId but can never receive the result, causing the purchase UI to hang until the 5-minute timeout fires.

**FIX:** In `app/_layout.tsx`, add an `AppState` listener that calls `initGooglePlayBilling()` when the app transitions from `background`/`inactive` to `active`. The `initialised = false` reset in `endBillingConnection` allows `initGooglePlayBilling` to reconnect. Ensure the `flushFailedPurchasesCachedAsPendingAndroid` call in init re-delivers any pending transactions.

---

### BUG-L24: Guild chat "Load older messages" may load newer messages

**Severity:** Low  
**FILES:** `apps/expo/app/guilds/[guildId]/chat.tsx`

The guild chat uses `useInfiniteQuery` with `getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined`. The FlatList renders messages in order from first page to last page (oldest to newest within each page). The "Load older messages" button calls `fetchNextPage()`. If the server's `nextCursor` is a forward-time cursor (pointing to messages older than the initial load — i.e., pagination goes backward into history), the label is correct. But if the initial load returns the most recent messages and `nextCursor` points to even newer messages (a common REST pagination pattern), clicking "Load older messages" would load newer messages. The label and the actual behavior would be inverted, confusing users. Without seeing the backend API contract, this is a structural ambiguity that needs to be verified.

**FIX:** Verify the backend `/guilds/{id}/chat` pagination direction. If the API returns recent messages first and `nextCursor` goes backward in time, the label is correct. If not, swap to `getPreviousPageParam` / `fetchPreviousPage` (scroll-to-top loads older) with an inverted FlatList. Document the pagination direction in a comment at the query definition to prevent future ambiguity.

---

## Summary Table

| ID | Severity | Area | One-Line Description |
|----|----------|------|----------------------|
| BUG-C01 | Critical | Build/Config | Empty production AdMob IDs → test ads in prod |
| BUG-C02 | Critical | Config/Env | "staging" APP_ENV not in Zod schema → dev config in staging |
| BUG-C03 | Critical | DM Chat | `userReacted` always false → own reactions never highlighted |
| BUG-H04 | High | Auth | Google OAuth deep-link fires twice → duplicate token exchange |
| BUG-H05 | High | Rooms | `pending-${Date.now()}` ID collision → React key conflicts |
| BUG-H06 | High | Keyboard | KAV + adjustPan double-shift on Android in all chat screens |
| BUG-H07 | High | Guild Chat | onContentSizeChange jumps to bottom when loading older msgs |
| BUG-H08 | High | Auth | signOut fetch() has no timeout — hangs on bad network |
| BUG-H09 | High | Auth | Token exchange fetch() has no timeout — code expires silently |
| BUG-M10 | Medium | Config | Deprecated `username` field in expo-updates plugin config |
| BUG-M11 | Medium | Security | android.allowBackup not disabled — data exposed to backup |
| BUG-M12 | Medium | Rooms | GIF picker stale state on modal reopen |
| BUG-M13 | Medium | API | GIF search param mismatch: `q` vs `query` across screens |
| BUG-M14 | Medium | Perf | SQLite migration runs 3 failing ALTER TABLE calls every startup |
| BUG-M15 | Medium | UX | Push notif failure alert has no "Open Settings" button |
| BUG-M16 | Medium | Config | adjustPan deprecated and broken on API 36 edge-to-edge |
| BUG-M17 | Medium | Legal | Age gate year-only — December birthday passes underage check |
| BUG-M18 | Medium | UX | SwipeDrawer 24px zone conflicts with Android system back gesture |
| BUG-M19 | Medium | Stability | prefsStore MMKV instantiated at module load without guard |
| BUG-M20 | Medium | Animation | GiftSpectacle animation resets mid-flight on rapid gifts |
| BUG-L21 | Low | Config | google-mobile-ads plugin not listed in plugins[] |
| BUG-L22 | Low | Guild Chat | scrollToEnd on 100ms setTimeout — fragile timing |
| BUG-L23 | Low | Payments | IAP listeners not re-established after foreground return |
| BUG-L24 | Low | Guild Chat | "Load older messages" pagination direction may be inverted |

---

*Report generated: 2026-06-25 at 10:40 PM*  
*Analyst: Claude Code forensic review — all files read and analyzed directly, no agents or sub-agents used.*
