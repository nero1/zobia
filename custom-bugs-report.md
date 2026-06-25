# Zobia Expo App — Forensic Bug Report

**Generated:** June 25, 2026 — 10:30 AM  
**Target:** Expo (React Native 0.74 / Expo SDK 51) — Android API 36  
**Branch:** `claude/expo-app-bug-analysis-o4kt0l`  
**Analyst:** Independent forensic code review (no prior bug reports consulted)

---

## Bug Index (Quick Reference)

1. BUG-CFG-01: Test AdMob App ID shipped in production config
2. BUG-CFG-02: Missing expo-updates channel configuration
3. BUG-SEC-01: GameWebView API proxy has no endpoint allowlist
4. BUG-SEC-02: PIN verified via client-side SHA256 (brute-forceable)
5. BUG-SEC-03: Inconsistent PIN handling — gift-send sends raw PIN, store hashes it
6. BUG-SEC-04: i18n language preference stored in unencrypted MMKV instance
7. BUG-PAY-01: Star pack purchases on Android use external payment URLs
8. BUG-PAY-02: subscriptionOfferTokens map not cleared on Google Play disconnect
9. BUG-NET-01: OfflineBanner misses null isInternetReachable state
10. BUG-ADS-01: loadRewardedAd race condition — overwrites in-flight instance
11. BUG-ADS-02: RewardedAdButton accesses MMKV storage before initStore()
12. BUG-UI-01: Nested Alert.alert for reaction picker broken on Android
13. BUG-UI-02: Hardcoded keyboardVerticalOffset=88 breaks on many Android devices
14. BUG-UI-03: handleSendMoment — UX dead-end with no compose option
15. BUG-UI-04: DropRoomTimer interval reset every second instead of running continuously
16. BUG-UI-05: Featured and Full badges overlap at identical absolute position
17. BUG-UI-06: Rooms tab error state renders raw i18n key string, not translated text
18. BUG-UI-07: Dead ROOM_TYPE_FILTER_COLOR 'guild' key not reachable from filter chips
19. BUG-UI-08: Settings language change saves to server but doesn't update app UI language
20. BUG-UI-09: Settings language change doesn't call setupRTL — RTL layout never applied
21. BUG-UI-10: Settings text fields fire a PATCH API mutation on every single keystroke
22. BUG-UI-11: Change Password in Settings is an unimplemented stub Alert
23. BUG-UI-12: ChatPushToggles fires a duplicate /users/me/settings fetch
24. BUG-UI-13: friends.tsx composite loading state only tracks friendsLoading
25. BUG-DSG-01: midnight chat theme uses forbidden purple #6366f1 for own message bubbles
26. BUG-DSG-02: FloatingNotificationProvider star badge uses forbidden purple #8b5cf6
27. BUG-DSG-03: Quests tab New Member Quest card uses forbidden purple #8b5cf6
28. BUG-IMG-01: Avatar cosmetic frames served as SVG but expo-image has no SVG support
29. BUG-IMG-02: Avatar component uses process.env directly instead of validated env object
30. BUG-LIFE-01: CURRENT_YEAR evaluated at module import time — wrong year on long-running app
31. BUG-PERF-01: CoinBalance background hardcoded to neutral[100] — invisible in dark mode

---

## Detailed Bug Reports

---

### 1. BUG-CFG-01: Test AdMob App ID shipped in production config

**FILES:** `/home/user/zobia/apps/expo/app.json`

**FIX:** The `googleMobileAdsAppId` field in `app.json` is set to Google's public test value `ca-app-pub-3940256099942544~3347511713`. This ID must be replaced with the real production AdMob App ID before any release build. Test IDs return test ads in production and can trigger policy violations. Store the real ID in an EAS secret and inject it via `app.config.js` so it is never committed to the repository.

---

### 2. BUG-CFG-02: Missing expo-updates channel configuration

**FILES:** `/home/user/zobia/apps/expo/app.json`, `/home/user/zobia/apps/expo/eas.json`

**FIX:** The `expo-updates` plugin is present but no `channel` is configured in `app.json` for any build profile, and `eas.json` build profiles (`production`, `preview`) do not set the `channel` field. Without a channel, OTA updates cannot be targeted to specific build tracks, meaning a production build and a preview build would receive the same updates indiscriminately. Add `"channel": "production"` to the production profile and `"channel": "preview"` to the preview profile in `eas.json`, and ensure `app.json` does not hardcode a channel.

---

### 3. BUG-SEC-01: GameWebView API proxy has no endpoint allowlist

**FILES:** `/home/user/zobia/apps/expo/components/games/GameWebView.tsx`

**FIX:** The `postMessage` handler inside `GameWebView` forwards any `endpoint` string from the WebView iframe directly to `apiClient`, using the authenticated user's Bearer JWT. There is no allowlist of permitted endpoints. Any game with XSS, any compromised CDN asset, or any malicious game injected via a man-in-the-middle can invoke any API endpoint — including payment, profile mutation, admin, or data-exfiltration routes — with full auth. Define a hardcoded array of permitted path prefixes (e.g. `/games/`, `/users/me/coins`) and reject any message whose endpoint does not match before forwarding it.

---

### 4. BUG-SEC-02: PIN verified via client-side SHA256 (brute-forceable)

**FILES:** `/home/user/zobia/apps/expo/app/economy/store.tsx`

**FIX:** The economy store PIN is verified by computing `SHA256(userId + ':' + enteredPin)` in JavaScript and comparing the result to a hash stored locally. A 4-digit PIN has only 10,000 possible values; an attacker with access to the device can enumerate all combinations in milliseconds. PIN verification must happen server-side over HTTPS, where rate-limiting and lockout logic can be applied. The client should send the plaintext PIN (over TLS) to a dedicated backend endpoint that performs the comparison using a proper password hash (bcrypt / argon2) stored server-side.

---

### 5. BUG-SEC-03: Inconsistent PIN handling — gift-send sends raw PIN, store hashes it

**FILES:** `/home/user/zobia/apps/expo/app/economy/store.tsx`, `/home/user/zobia/apps/expo/app/economy/gift-send.tsx`

**FIX:** `store.tsx` hashes the PIN client-side before any server call, while `gift-send.tsx` posts `{ pin }` as plaintext to the server. This inconsistency means the two flows cannot both be correct; one of them will fail on the server. Whichever approach is adopted (plain-over-TLS is preferred; see BUG-SEC-02), it must be applied uniformly across both screens. Until BUG-SEC-02 is addressed, at minimum `gift-send.tsx` and `store.tsx` must use the same strategy.

---

### 6. BUG-SEC-04: i18n language preference stored in unencrypted MMKV instance

**FILES:** `/home/user/zobia/apps/expo/lib/i18n/index.ts`

**FIX:** A separate `new MMKV({ id: 'zobia_prefs' })` instance is created without an encryption key to store the user's language preference. While the language preference itself is not highly sensitive, the existence of a second unencrypted MMKV database on disk is an inconsistency that could grow over time. The theme store also creates a separate unencrypted instance (by design), but the i18n store is not documented as intentionally unencrypted. Consolidate the i18n preference into the theme preference store (also unencrypted, `id: 'zobia-theme-pref'`), or document clearly that these stores are intentionally unencrypted and non-sensitive.

---

### 7. BUG-PAY-01: Star pack purchases on Android use external payment URLs (Play Store policy violation)

**FILES:** `/home/user/zobia/apps/expo/app/economy/store.tsx`

**FIX:** On Android, star pack purchases (digital goods/virtual currency) open an external payment URL instead of using Google Play Billing. Google Play Developer Policy requires that all in-app purchases of digital content (including virtual currency) on Android be processed through Google Play Billing. Using an external payment URL for digital goods risks immediate app removal from the Play Store. Star pack purchases must be routed through `react-native-iap` (already a dependency) using one-time product purchases, the same way subscription purchases are handled.

---

### 8. BUG-PAY-02: subscriptionOfferTokens map not cleared on Google Play disconnect

**FILES:** `/home/user/zobia/apps/expo/lib/payments/googlePlay.ts`

**FIX:** The `subscriptionOfferTokens` Map is populated when subscription products are fetched and is used to supply the `offerToken` during purchase. The `disconnectGooglePlayBilling()` function does not call `subscriptionOfferTokens.clear()`. On reconnect, the map may contain stale tokens from a previous session (e.g., tokens for offers that have since expired or been modified by Google). A stale token passed to `requestSubscription` will produce a purchase failure. Add `subscriptionOfferTokens.clear()` inside `disconnectGooglePlayBilling()`.

---

### 9. BUG-NET-01: OfflineBanner misses null isInternetReachable state

**FILES:** `/home/user/zobia/apps/expo/components/offline/OfflineBanner.tsx`

**FIX:** The offline banner is only shown when `state.isInternetReachable === false`. The `@react-native-community/netinfo` library sets `isInternetReachable` to `null` when the reachability status is unknown — which happens immediately after app launch before the first reachability check completes, and when the network type changes. The `null` case is treated as "online" by the strict equality check, so the banner is not shown during those transition windows. Change the condition to `state.isConnected === false || state.isInternetReachable === false` (or additionally handle `null` as a loading/uncertain state) so users are correctly informed.

---

### 10. BUG-ADS-01: loadRewardedAd race condition — overwrites in-flight instance without cleanup

**FILES:** `/home/user/zobia/apps/expo/lib/ads/admob.ts`

**FIX:** `loadRewardedAd()` creates a new `RewardedAd` instance and immediately overwrites the module-level reference. If called a second time before the first instance fires its `LOADED` event, the first instance is orphaned with no cleanup: its event listeners continue to fire, its internal state is leaked, and the old `AdEventListener` subscription is never removed. Add a guard that returns early if a load is already in progress, or call the existing instance's `.destroy()` equivalent before creating a new one.

---

### 11. BUG-ADS-02: RewardedAdButton accesses MMKV storage before initStore()

**FILES:** `/home/user/zobia/apps/expo/components/ads/RewardedAdButton.tsx`

**FIX:** Inside a `useEffect`, the component reads from the `storage` proxy (which delegates to `getStorage()`) to check the user's coin balance. If `initStore()` has not completed by the time this component mounts, `getStorage()` throws `"[store] initStore() has not been called yet"`. While `initStore()` is awaited in the root layout before rendering, any component that renders during the brief async initialization window (e.g. via a suspense boundary or conditional render) will crash. Wrap the access in a try/catch, or gate the component render behind the `storeReady` flag that the root layout already tracks.

---

### 12. BUG-UI-01: Nested Alert.alert for reaction picker broken on Android

**FILES:** `/home/user/zobia/apps/expo/app/rooms/[roomId].tsx`

**FIX:** The reaction emoji picker is implemented by showing a second `Alert.alert` from within the `onPress` callback of the first `Alert.alert`'s button. On Android, the native alert dialog system does not reliably support spawning a second alert from inside an alert button callback — the second dialog either does not appear or flickers. Replace the chained alerts with a proper bottom sheet, `ActionSheet`, or a custom modal overlay for the reaction selection UI.

---

### 13. BUG-UI-02: Hardcoded keyboardVerticalOffset=88 breaks on many Android devices

**FILES:** `/home/user/zobia/apps/expo/app/rooms/[roomId].tsx`, `/home/user/zobia/apps/expo/app/messages/[conversationId].tsx`

**FIX:** Both chat screens use `KeyboardAvoidingView` with `behavior="padding"` and `keyboardVerticalOffset={88}` hardcoded. This value was presumably measured on one specific device. Android navigation bar heights vary widely (gesture navigation = ~0 dp extra, 3-button nav = ~48 dp, manufacturer overlays differ further), and header heights also vary per device. The keyboard input area will be incorrectly offset on most real devices, clipping the message input or leaving dead space. Use `react-native-safe-area-context`'s `useSafeAreaInsets()` to obtain the bottom inset at runtime and compute the correct offset dynamically, or use `react-native-keyboard-controller` for a more reliable approach.

---

### 14. BUG-UI-03: handleSendMoment — UX dead-end with no compose option

**FILES:** `/home/user/zobia/apps/expo/app/messages/[conversationId].tsx`

**FIX:** `handleSendMoment` shows an `Alert.alert` that informs the user a Moment can be sent, but the alert's only actions are dismissal options — there is no button to actually open a camera, picker, or compose flow. The user cannot complete the action they initiated. Either implement the Moment compose flow (camera launch / media picker → upload → send), or remove the "Send Moment" entry point entirely until the feature is ready, rather than leaving a dead-end in production.

---

### 15. BUG-UI-04: DropRoomTimer interval resets every second instead of running continuously

**FILES:** `/home/user/zobia/apps/expo/components/rooms/RoomCard.tsx`

**FIX:** The countdown timer `useEffect` lists `[secondsLeft]` in its dependency array. Because `setInterval` fires and calls `setSecondsLeft`, the state updates, the effect's deps change, the old interval is cleared, and a brand new interval is created — every single second. This means the timer always starts counting from the moment the interval fires, but the `clear + restart` cycle itself adds ~0–16 ms jitter per second, and the effect runs its full body (including the conditional check) every tick. Change the dependency array to `[endTime]` (or `[]` combined with a ref for `secondsLeft`), so the interval is created once and runs continuously until the component unmounts or the room changes.

---

### 16. BUG-UI-05: Featured and Full room badges overlap at identical absolute position

**FILES:** `/home/user/zobia/apps/expo/components/rooms/RoomCard.tsx`

**FIX:** Both `featuredBadge` and `fullBadge` are styled with `position: 'absolute', top: 8, left: 8`. When a room is both featured and at capacity, both badges are rendered and they occupy exactly the same coordinates, stacking on top of each other with only the topmost visible. Assign distinct positions (e.g. `featuredBadge` at `top: 8, left: 8` and `fullBadge` at `top: 8, right: 8`, or stack them vertically) so both are always visible simultaneously.

---

### 17. BUG-UI-06: Rooms tab error state renders raw i18n key string instead of translated text

**FILES:** `/home/user/zobia/apps/expo/app/(tabs)/rooms.tsx`

**FIX:** When the room list fails to load, the code runs `setError('rooms.loadError')` — storing the literal translation key string — and then renders it directly as `{error}` in the JSX. The user sees the raw key `"rooms.loadError"` on screen instead of a localized error message. Fix by calling `t('rooms.loadError')` at the point of display, or by storing the already-translated string via `setError(t('rooms.loadError'))` at the point of the catch.

---

### 18. BUG-UI-07: Dead 'guild' key in ROOM_TYPE_FILTER_COLOR map

**FILES:** `/home/user/zobia/apps/expo/app/(tabs)/rooms.tsx`

**FIX:** `ROOM_TYPE_FILTER_COLOR` contains a `guild` key with a color value, but `FILTER_CHIPS` (which drives which chips are rendered and which types can be selected) has no `guild` entry. No code path can ever set `activeFilter` to `'guild'`, so the color for that key is dead code. Either add a `guild` filter chip if the room type is planned, or remove the `guild` entry from `ROOM_TYPE_FILTER_COLOR` to keep the map consistent with the actual filter options.

---

### 19. BUG-UI-08: Language change in Settings saves to server but doesn't update app UI language

**FILES:** `/home/user/zobia/apps/expo/app/settings/index.tsx`

**FIX:** When the user picks a new language, the settings screen calls the mutation that PATCHes the preference to the server. It does not call `i18next.changeLanguage(lang.code)`. As a result, the entire app UI remains in the previous language for the duration of the session — the change only takes effect after an app restart (when the i18n init reads the stored preference). Add `await i18next.changeLanguage(lang.code)` immediately after the server mutation succeeds so the language switches in real time.

---

### 20. BUG-UI-09: Language change in Settings doesn't call setupRTL — RTL layout never applied on switch

**FILES:** `/home/user/zobia/apps/expo/app/settings/index.tsx`, `/home/user/zobia/apps/expo/lib/i18n/rtl.ts`

**FIX:** `setupRTL(locale)` calls `I18nManager.forceRTL(true/false)` and must be called whenever the active language changes, because React Native's RTL layout is applied per-launch and not reactive to i18next alone. The settings screen does not call `setupRTL` after a language change. Switching to Arabic will correctly load the Arabic translations after BUG-UI-08 is fixed, but all layout directions (flex direction, text alignment, icon mirroring) will remain LTR. Call `setupRTL(lang.code)` as part of the language-change handler; note that a full app restart (via `expo-updates` reload or `RNRestart`) is typically required for `I18nManager.forceRTL` to fully propagate through native views.

---

### 21. BUG-UI-10: Settings text fields fire PATCH API mutation on every keystroke

**FILES:** `/home/user/zobia/apps/expo/app/settings/index.tsx`

**FIX:** The `displayName`, `bio`, and `email` fields each use `onChangeText` to call `patchMutation.mutate({ [key]: value })` directly. Every single character typed triggers a network request. For a field like `displayName`, typing "Hello world" fires 11 separate PATCH requests. This hammers the server, creates race conditions (out-of-order responses can overwrite newer input with older values), and degrades battery and network performance. Replace with a debounced save (e.g. debounce of 600–800 ms) or switch to a "Save" button that sends the current values once on explicit user confirmation.

---

### 22. BUG-UI-11: Change Password in Settings is an unimplemented stub

**FILES:** `/home/user/zobia/apps/expo/app/settings/index.tsx`

**FIX:** The "Change Password" settings row has `onPress: () => Alert.alert('Change Password', 'Password change flow would open here.')`. This is a placeholder that was never implemented. Users who tap it are shown a dialog with no actionable content. Either implement the password-change screen (current password → new password → confirm → PATCH `/auth/change-password`) or hide the row entirely until the feature is ready. Shipping a visible-but-non-functional setting erodes user trust.

---

### 23. BUG-UI-12: ChatPushToggles fires a duplicate /users/me/settings fetch

**FILES:** `/home/user/zobia/apps/expo/app/settings/index.tsx`

**FIX:** The `ChatPushToggles` component mounted inside the settings screen independently calls `useQuery` with key `['user-settings']` to fetch `/users/me/settings`. The parent settings screen also fetches the same endpoint with the same key. While React Query deduplicates requests sharing a key, the child's query is declared with different options (different `staleTime`, `enabled` condition), which causes it to re-fetch independently in some cache-miss scenarios. Lift the query to the parent, pass the settings data as a prop to `ChatPushToggles`, and remove the child's own `useQuery` call.

---

### 24. BUG-UI-13: friends.tsx composite loading spinner only tracks friendsLoading

**FILES:** `/home/user/zobia/apps/expo/app/(tabs)/friends.tsx`

**FIX:** The `loading` boolean used to show the activity indicator is set only to `friendsLoading`. The screen also fires queries for friend requests and suggestions, but those loading states are not included. As a result, the loading spinner disappears as soon as the friends list resolves, even if the other queries are still in flight, causing partial renders with empty sections that then populate after a brief flicker. Change `loading` to `friendsLoading || requestsLoading || suggestionsLoading` (using all relevant query loading flags).

---

### 25. BUG-DSG-01: midnight chat theme uses forbidden purple #6366f1 for own message bubbles

**FILES:** `/home/user/zobia/apps/expo/lib/theme/chatThemes.ts`

**FIX:** The `midnight` chat theme sets `bubbleOwn: '#6366f1'`, which is an Indigo/purple color. The design constraint for this app is: no purple anywhere, primary brand color is `#2563EB` (blue). Replace `'#6366f1'` with an appropriate dark-mode-compatible blue (e.g. `colors.brand.blue` `#2563EB` or `colors.brand.blueLight`).

---

### 26. BUG-DSG-02: FloatingNotificationProvider star badge uses forbidden purple #8b5cf6

**FILES:** `/home/user/zobia/apps/expo/components/providers/FloatingNotificationProvider.tsx`

**FIX:** `STAR_COLORS` defines `backgroundColor: '#8b5cf6'`, a violet/purple. This is used for the star-gifting floating notification badge. Replace with an appropriate brand color such as the brand gold (`colors.brand.gold`) or brand blue (`#2563EB`) per the design system.

---

### 27. BUG-DSG-03: Quests tab New Member Quest card uses forbidden purple #8b5cf6

**FILES:** `/home/user/zobia/apps/expo/app/(tabs)/quests.tsx`

**FIX:** The New Member Quest card hardcodes `borderColor: '#8b5cf6'` for its container border and `backgroundColor: '#8b5cf6'` for the progress bar fill. Both are violet/purple, violating the no-purple constraint. Replace with the brand blue `#2563EB` or brand green/gold as appropriate for quest progress indicators.

---

### 28. BUG-IMG-01: Avatar cosmetic frames served as SVG but expo-image has no native SVG support

**FILES:** `/home/user/zobia/apps/expo/components/ui/Avatar.tsx`

**FIX:** When a user has an equipped cosmetic frame, the frame image URL points to a `.svg` file served from the API. `expo-image` (and the underlying platform image decoders on Android) cannot natively decode SVG files — the frame image will fail to render silently, leaving the avatar without its decorated frame. Either: (a) have the backend serve frames as pre-rasterized PNG/WebP at the required sizes, or (b) replace the frame `<Image>` with `react-native-svg`'s `SvgUri` component for SVG rendering. Option (a) is simpler and more performant.

---

### 29. BUG-IMG-02: Avatar component reads API URL from process.env instead of validated env object

**FILES:** `/home/user/zobia/apps/expo/components/ui/Avatar.tsx`

**FIX:** The Avatar component constructs the frame URL using `process.env.EXPO_PUBLIC_API_URL` directly, bypassing the Zod-validated `env` object defined in `lib/env.ts`. If the env var is missing or mis-spelled, the URL will be `undefined/path` with no validation error and no fallback — producing broken image requests silently. Replace with `env.API_BASE_URL` (or the equivalent validated field from `lib/env.ts`) so any configuration error surfaces at startup rather than at runtime.

---

### 30. BUG-LIFE-01: CURRENT_YEAR evaluated at module import time — wrong in long-running sessions

**FILES:** `/home/user/zobia/apps/expo/app/onboarding/index.tsx`

**FIX:** `const CURRENT_YEAR = new Date().getFullYear()` is a module-level constant evaluated once when the module is first imported. If the app is opened on December 31 and remains open past midnight, or if a JS bundle is cached across a year boundary, the displayed copyright/age-calculation year will be stale. Move the expression inside the component function body or inside a `useMemo` with an empty dependency array so it is evaluated fresh each time the onboarding screen renders.

---

### 31. BUG-PERF-01: CoinBalance background hardcoded — invisible in dark mode

**FILES:** `/home/user/zobia/apps/expo/components/economy/CoinBalance.tsx`

**FIX:** The CoinBalance pill component hardcodes `backgroundColor: colors.neutral[100]`, which is a very light grey. In dark mode, the surrounding surface is `colors.neutral[900]` or `colors.neutral[950]`, making the coin balance pill nearly invisible (light grey chip on near-black background). Use `theme.colors.surface` or a theme-aware token (e.g. `isDark ? colors.neutral[800] : colors.neutral[100]`) so the component is always legible regardless of the active color scheme.

---

## Code Quality Assessment

### Current Rating: **5.5 / 10**

The codebase demonstrates solid architectural intent: React Query for server state, MMKV + SQLite for offline persistence, encrypted storage, an Axios interceptor chain for auth, an Ably realtime layer with polling fallback, and a reasonably structured Expo Router layout. The abstractions are mostly in the right places, and several bug-fix annotations in the code (e.g. BUG-MOB-22, BUG-SEC-03 comments) show the team is actively addressing issues.

However, the 31 bugs span security vulnerabilities (SEC-01 is critical), a direct Play Store policy violation (PAY-01), three design-constraint violations, multiple UX dead-ends (unimplemented password change, Moment compose), per-keystroke network hammering, a timer implementation that thrashes the event loop, and a test AdMob ID in production. Several bugs (SEC-02, SEC-03, SEC-04) suggest the security model for the economy/PIN flow was not fully thought through.

### Projected Rating After All Fixes: **8.0 / 10**

Resolving the 31 issues will eliminate all critical security holes, bring the app into Play Store compliance, align the UI with the design system, and fix multiple UX regressions. The underlying architecture is sound and the post-fix codebase would be production-grade for the current feature set. The remaining gap to 10/10 would be addressed by adding proper integration tests, a storybook for UI components, and a more formal security review of the payment and PIN flows.

---

*Report generated: June 25, 2026 — 10:30 AM*  
*Zobia Expo App — Forensic Bug Analysis | nero1/zobia | branch: claude/expo-app-bug-analysis-o4kt0l*
