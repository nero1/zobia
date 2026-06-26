# Zobia Social — Expo Mobile App: Forensic Bug Report

> **Scope:** Expo mobile app (Android primary target, API 36). Produced after line-by-line forensic analysis of the full app codebase.
> **Status:** DO NOT FIX — awaiting plan review.

---

## Current Code Quality Rating

| Dimension | Score | Notes |
|---|---|---|
| Security | 6.5 / 10 | AES-256-GCM offline encryption, JWT interceptor, PKCE OAuth, rate-limiting, but several client-side-only guard gaps |
| Reliability | 6 / 10 | React Query with retry, offline queue, but race conditions and stale data paths |
| Performance | 6.5 / 10 | Realtime + poll fallback, delta fetching, but O(n) operations and unbounded list loads |
| Correctness | 6 / 10 | Decimal.js for finance, but several wrong endpoints and logic duplications |
| Accessibility | 5 / 10 | Some `accessibilityRole` usage but widespread missing hints and labels |
| Maintainability | 7 / 10 | Well-structured, consistent patterns, but duplicated PIN logic and inconsistent APIs |
| **Overall** | **6.2 / 10** | Solid foundation with significant critical bugs requiring remediation |

**Estimated post-fix rating: 8.4 / 10**

---

## Bug Index (Numbered List)

1. Stars transaction history hits wrong API endpoint — history is entirely broken
2. Duplicate PIN verification logic in store screen creates silent divergence risk
3. Non-NGN currency costs displayed with floating-point math despite Decimal.js availability
4. `endBillingConnection` clears `initialised` flag but leaves stale `_initPromise` reference
5. EAS Project ID placeholder string `'YOUR_EAS_PROJECT_ID'` baked into release builds if env var unset
6. Google Play service account JSON path hardcoded in `eas.json`; file should not be committed
7. `EAS_PROJECT_ID` env var missing from development and preview build profiles in `eas.json`
8. MMKV message cache LRU index not updated on key collision — incorrect eviction order
9. `myUserId` defaults to empty string causing own messages to render as "other" when not authenticated
10. `prevMessageIdsRef` eviction loop is O(n) per new message batch
11. `_notifiedUnauthenticated` 5-second reset window allows duplicate session-expired modals
12. `VALID_PUSH_ROUTES` allowlist silently drops valid deep-link targets from push notifications
13. Telegram bot name missing from development/preview EAS build profiles
14. `Updates.reloadAsync()` for RTL language switch silently no-ops in Expo Go / dev builds
15. Local `PIN_MAX_ATTEMPTS = 5` in store screen is decoupled from `usePinRateLimit` constant
16. Widespread missing `accessibilityHint` on interactive elements across multiple screens
17. Gift button in room screen hardcodes `room.creatorId` as recipient without null check
18. AdMob `interstitialAd` reference cleared asynchronously — second show before CLOSED event fails
19. Pidgin autocomplete `lower.endsWith(key)` condition incorrectly matches word-ending substrings
20. Announcement dismiss key based on content slice can collide across different modals
21. Rewarded ad daily cap `adsWatched + 1` reads stale React state — rapid taps can bypass cap
22. Game WebView origin check uses `nativeEvent.url` (page URL) not message sender origin
23. `SlugRedirect` `toInternalPath` function in `useEffect` deps causes infinite re-resolve loop if not memoized
24. `markNotifRead` called fire-and-forget then `invalidateQueries` fires immediately before PATCH completes
25. `getNotificationRoute` maps gift notifications to `'/(tabs)/economy/wallet'` — wrong tab path
26. `toggleFriend` in profile screen uses different API path pattern than `ContactsImporter`
27. Gift-send wallet query fetches from coins-only endpoint — stars balance always shows 0
28. Notification type toggles in settings fire mutations on every change without debounce
29. `handleConfirmDelete` returns silently on invalid PIN format with no user-visible error
30. Date-of-birth field uses `numbers-and-punctuation` keyboard type, unreliable on Android
31. 2FA setup modal has no retry path when fetching the TOTP secret fails
32. TOTP lockout state read from MMKV during initial render without `storeReady` guard
33. `storage` proxy and `getStorage()` function coexist with no enforced access pattern
34. `pendingRecovery` purchases in Google Play Billing are in-memory only — lost on app restart
35. Presence heartbeat interval in room screen not cleared when screen is backgrounded without unmounting
36. Swipe drawer React `isOpen` state and Reanimated `isDrawerOpen` shared value can desync during animation
37. `toE164` normalizes 10-digit numbers without leading 0 as international, incorrectly prepending `+`
38. Notifications screen fetches all notifications with no pagination limit
39. Language settings rollback on PATCH failure clears all other pending edits via `setSettings({})`
40. Gift-send screen does not re-verify wallet balance after PIN modal delay
41. Inverted FlatList on Android API 36 with `softInputMode` can push content off-screen on keyboard open
42. Pidgin suggestions dictionary includes insult terms (`Mumu`, `Olodo`) surfaced as autocomplete
43. `mergeNewestFirst` in delta.ts performs O(n log n) full re-sort on every delta fetch
44. `OfflineBanner` initializes offline state to `false` — banner invisible if device is offline at mount
45. Gift-send PIN lockout uses flat 15-minute duration without exponential backoff
46. `GIFT_PIN_LOCKOUT_COUNT` exists in `STORE_KEYS` but is never read or written in gift-send screen
47. FlatList components across the app lack `accessibilityLabel`, screen readers announce generic names
48. `onNavigationStateChange` uses `stopLoading()` to block navigation; does not prevent all navigation paths
49. `contactsImporter` sends up to 500 numbers but there is no deduplication across multiple import runs
50. `OfflineBanner` uses strict `===` false comparisons for `isInternetReachable` — null state (common at startup) treated as connected
51. `two-factor.tsx` lockout logic duplicated in two separate `try/catch` blocks with identical code
52. `RewardedAdButton` lacks server-side ad daily cap verification — client-side MMKV cap is bypassable
53. `settings/index.tsx` fires `Updates.reloadAsync()` for RTL without confirming the language was saved first
54. SwipeDrawer left-edge gesture conflicts with Android API 33+ predictive back gesture on target API 36
55. `getNotificationRoute` doesn't sanitize payload IDs before embedding in route strings

---

## Detailed Bug Descriptions

---

### Bug 1 — Stars Transaction History Hits Wrong API Endpoint
**File:** `apps/expo/app/economy/wallet.tsx`
**Severity:** Critical — feature entirely broken

The wallet screen's stars tab transaction history calls `fetchTransactionPage` with a `stars` flag, but internally the function routes to `/economy/stars/balance?page=N` — the balance endpoint, not a transactions endpoint. This returns balance data interpreted as transactions, causing the history list to show empty or garbage data. The function should route to something like `/economy/stars/transactions?page=N`. Every user who navigates to the stars transaction history tab sees broken content.

---

### Bug 2 — Duplicate PIN Verification Logic in Store Screen
**File:** `apps/expo/app/economy/store.tsx`
**Severity:** High — divergence risk on any future change

PIN verification is implemented twice: once in an explicit `submitPin()` function and again in the `onChangeText` auto-submit handler that fires when the input reaches 4 digits. Both paths implement attempt counting, lockout checking, and API calls with slightly different parameter structures. Any logic change made to one path will silently not apply to the other. This has already created inconsistency in how the lockout reset is triggered. The duplicated paths should be unified into a single `verifyPin()` utility.

---

### Bug 3 — Non-NGN Currency Costs Use Floating-Point Division
**File:** `apps/expo/app/economy/store.tsx`
**Severity:** Medium — display inconsistency for international users

The `formatKobo` helper uses Decimal.js correctly for NGN (kobo → naira). However, in the section that displays coin pack prices for non-NGN currencies, a plain JavaScript division (`cost / 100`) is used without Decimal.js. For amounts that don't divide evenly (e.g., 10001 minor units), this produces floating-point artifacts like `100.00999999999999` in the UI. Decimal.js is already imported — all currency division should route through it.

---

### Bug 4 — `endBillingConnection` Leaves Stale `_initPromise`
**File:** `apps/expo/lib/payments/googlePlay.ts`
**Severity:** High — billing fails silently after sign-out/sign-in

`endBillingConnection()` sets `initialised = false` but does not clear `_initPromise`. When `initGooglePlayBilling()` is called again after a new sign-in, the guard `if (_initPromise) return _initPromise` returns the stale resolved/rejected promise immediately, causing the billing module to re-use dead connection state. The fix is to also set `_initPromise = null` inside `endBillingConnection`.

---

### Bug 5 — Placeholder EAS Project ID Baked Into Builds
**File:** `apps/expo/app.config.ts`
**Severity:** Medium — incorrect project linkage in release builds

The config falls back to the string literal `'YOUR_EAS_PROJECT_ID'` when `process.env.EAS_PROJECT_ID` is not set. This means if a developer builds without the env var, the resulting binary is linked to a non-existent project. Push notifications, OTA updates, and EAS services will silently fail. The fallback should throw an error in production builds, not silently substitute a placeholder.

---

### Bug 6 — Google Service Account Path Hardcoded in `eas.json`
**File:** `apps/expo/eas.json`
**Severity:** Medium — CI/CD brittleness, potential credential leak

`googleServiceAccountKeyPath: "google-service-account.json"` refers to a file that must never be committed to git. The file path is hardcoded relative to the project root with no indication that it should come from a secret. If this file is accidentally committed, Google Play credentials are exposed. The path should be referenced via an EAS secret (e.g., `$GOOGLE_SERVICE_ACCOUNT_KEY`) and the `.json` file should be in `.gitignore`.

---

### Bug 7 — `EAS_PROJECT_ID` Missing From Dev/Preview Build Profiles
**File:** `apps/expo/eas.json`
**Severity:** Medium — development builds cannot link to EAS project

Only the `production` profile's `env` block contains `EAS_PROJECT_ID`. Development and preview profiles have no `env` section. Developers running `eas build --profile development` will produce binaries with the placeholder Project ID from Bug 5 (or whatever is in their local shell). OTA updates and push notification certificates won't work in staging.

---

### Bug 8 — Message Cache LRU Index Not Updated on Key Collision
**File:** `apps/expo/lib/chat/messageCache.ts`
**Severity:** Low-Medium — incorrect eviction order

The `put()` method appends the conversation key to the index without first checking if it already exists. If the same conversation is written twice, its key appears twice in the index. When the index reaches the 50-conversation limit, the oldest entry is evicted — but the "oldest" may be a stale duplicate, while an earlier entry that should be evicted remains. This causes memory growth beyond the intended 50-conversation cap and potentially evicts fresher data.

---

### Bug 9 — `myUserId` Defaults to Empty String
**File:** `apps/expo/app/messages/[conversationId].tsx`
**Severity:** Medium — messages visually misclassified when user auth resolves late

`const myUserId = user?.id ?? ''` means that before the auth context resolves (including on cold start when `user` is briefly null), all messages in the DM list are classified as "incoming" (from the other party) regardless of their actual `senderId`. Optimistic messages sent during this window also have the wrong alignment. Should gate rendering on `user` being available, or default to a sentinel value that can never match a real `senderId`.

---

### Bug 10 — O(n) Message ID Eviction in Room Screen
**File:** `apps/expo/app/rooms/[roomId].tsx`
**Severity:** Low-Medium — performance degrades in long-running rooms

`prevMessageIdsRef` stores seen message IDs in a Set for deduplication, with a max-size eviction that slices the Set to remove old entries. Slicing a Set requires converting to array first, making each eviction O(n). In a busy room with thousands of messages over a session, this compounds. The correct fix is to maintain the IDs in a size-bounded data structure (e.g., a Map with insertion-order key deletion) that supports O(1) eviction.

---

### Bug 11 — Duplicate Session-Expired Modals From 5-Second Reset Window
**File:** `apps/expo/lib/api/client.ts`
**Severity:** Low-Medium — UX disruption for users with slow connections

`_notifiedUnauthenticated` is a flag that prevents duplicate session-expiry notifications, but it's reset after 5 seconds via `setTimeout`. If multiple background requests (presence heartbeat, realtime token refresh, feed polling) each return 401 within a 5-second window, the first call sets the flag, the timer fires and clears it, then a second 401 triggers another modal. The flag should persist until the user explicitly dismisses/handles the session expiry or signs back in.

---

### Bug 12 — `VALID_PUSH_ROUTES` Allowlist Silently Drops Valid Routes
**File:** `apps/expo/app/_layout.tsx`
**Severity:** Medium — push notification deep-links broken for unlisted routes

The allowlist that validates notification deep-link targets before navigating may not include all routes that the backend can send (e.g., `/notifications`, `/guilds/:id`, `/events/:id`). When a notification arrives with a route that is not in the allowlist, the app silently ignores the navigation instead of showing the user the relevant screen. Any new notification type added on the server that targets a new route requires a corresponding update to this client-side allowlist.

---

### Bug 13 — Telegram Bot Name Missing From Dev/Preview Build Profiles
**File:** `apps/expo/eas.json`
**Severity:** Medium — Telegram OAuth unavailable in dev builds

`TELEGRAM_BOT_NAME` is not set in the development or preview EAS profiles. In the login screen, `Constants.expoConfig?.extra?.telegramBotName` falls back to `undefined`, making the "Login with Telegram" button non-functional or displaying an empty bot name. Developers testing auth flows in dev builds cannot test Telegram login.

---

### Bug 14 — RTL Reload No-Op in Expo Go and Dev Client
**File:** `apps/expo/lib/i18n/index.ts`, `apps/expo/app/settings/index.tsx`
**Severity:** Medium — RTL layout untestable in standard dev workflow

`Updates.reloadAsync()` is called when the user switches to/from Arabic (RTL). In Expo Go and in development builds, `expo-updates` is not active and `reloadAsync()` throws or silently no-ops. This means RTL layout changes are invisible during development, masking potential RTL rendering bugs until a production release is tested. The call should be guarded by `Updates.isAvailable` and a clear user message shown in dev mode.

---

### Bug 15 — PIN Attempt Constants Decoupled Across Screens
**File:** `apps/expo/app/economy/store.tsx`, `apps/expo/lib/hooks/usePinRateLimit.ts`
**Severity:** Low-Medium — constants can drift causing inconsistent lockout behavior

The store screen hardcodes `PIN_MAX_ATTEMPTS = 5` locally. The `usePinRateLimit` hook also defines its own internal `MAX_ATTEMPTS`. If one is changed, the other won't update. A user could get a "locked out" message from the hook but the local counter still allows attempts, or vice versa. Both should reference a single exported constant from `usePinRateLimit`.

---

### Bug 16 — Widespread Missing `accessibilityHint` on Interactive Elements
**Files:** `apps/expo/app/rooms/[roomId].tsx`, `apps/expo/app/messages/[conversationId].tsx`, `apps/expo/app/economy/store.tsx`, and others
**Severity:** Medium — Android TalkBack cannot describe non-obvious actions

Many `Pressable` and `TouchableOpacity` components have `accessibilityRole="button"` and `accessibilityLabel` but lack `accessibilityHint` explaining the outcome of the action. Examples: the tier tab buttons in the store ("changes displayed gift tier"), the reaction picker button, the GIF picker button. Android TalkBack reads role and label but the action consequence is opaque to screen-reader users.

---

### Bug 17 — Gift Button Hardcodes `room.creatorId` Without Null Check
**File:** `apps/expo/app/rooms/[roomId].tsx`
**Severity:** Medium — crash or incorrect recipient for rooms without a creator ID

The "Gift" button constructs the gift URL with `recipientId: room.creatorId`. If `room.creatorId` is null or undefined (possible for system-created rooms or after a creator deletion), the gift-send screen receives an invalid recipient ID, which either crashes the navigation or silently sends a gift to no one. Should check `room.creatorId != null` before rendering the button.

---

### Bug 18 — AdMob Interstitial `adLoaded` Cleared Before `interstitialAd` Reference
**File:** `apps/expo/lib/ads/admob.ts`
**Severity:** Low-Medium — second interstitial attempt fails before CLOSED event

Inside `showInterstitialAd()`, `adLoaded` is set to `false` before calling `.show()`, but `interstitialAd` is only nulled in the CLOSED event handler. A second caller that checks `adLoaded` before CLOSED fires will see `adLoaded=false` and try to reload the ad. If `show()` is called while the ad is in the process of dismissing, the new load and the old show race, potentially causing an SDK state error. Both `adLoaded` and `interstitialAd` should be cleared atomically before calling show.

---

### Bug 19 — Pidgin Autocomplete `lower.endsWith(key)` Condition Incorrect
**File:** `apps/expo/lib/i18n/pidgin.ts`
**Severity:** Low — unexpected suggestions surfaced for word endings

`getPidginSuggestions` matches dictionary keys using `key.startsWith(lower) || lower.endsWith(key)`. The second clause checks if the user's input *ends with* a dictionary key, not if the key starts with the input. This means typing "welcome" matches the "come" entry and suggests "Comot" and "Waka". For an autocomplete feature, only `key.startsWith(lower)` (or `lower.startsWith(key)`) makes semantic sense. The current logic produces misleading suggestions mid-word.

---

### Bug 20 — Announcement Dismiss Key Collision Across Modals
**File:** `apps/expo/components/announcements/AnnouncementModal.tsx`
**Severity:** Low — wrong modal suppressed for users who saw a different modal

`getSessionKey` falls back to `modal.content.slice(0, 32).replace(/\W/g, '_')` when `modal.version` is null. Two different modals whose content starts with the same 32 characters would share the same dismiss key. If user A dismissed modal X, and modal Y happens to share the same key prefix, modal Y would also be suppressed for that user even though they've never seen it. The dismiss key should incorporate the full modal `id` plus a reliable version field, not a content hash.

---

### Bug 21 — Rewarded Ad Daily Cap Bypassable via React State Race
**File:** `apps/expo/components/ads/RewardedAdButton.tsx`
**Severity:** Medium — double-earning possible under rapid taps

The counter increment `newWatched = adsWatched + 1` reads from React state (`adsWatched`). If two ad shows are triggered in quick succession before state updates propagate, both read `adsWatched=0` and both write `newWatched=1` to MMKV. The `pendingRef` guard prevents concurrent `show()` calls but doesn't prevent both increment writes. The increment should use a functional state update (`setAdsWatched(prev => prev + 1)`) and the check should be done against a ref. Additionally, the daily cap is entirely client-side — the server endpoint `/economy/rewards/ad-reward` should enforce the cap server-side.

---

### Bug 22 — Game WebView Origin Check Uses Page URL, Not Message Sender Origin
**File:** `apps/expo/components/games/GameWebView.tsx`
**Severity:** Medium — insufficient defense-in-depth for postMessage bridge

`e.nativeEvent.url` in React Native WebView is the *current navigated URL* of the WebView, not the origin of the message sender. If JavaScript within the page sends a message and then the WebView's internal URL changes (e.g., due to a redirect or hash change between postMessage and the native handler firing), the origin check may incorrectly accept or reject messages. A more robust approach is to inject a JavaScript bridge that validates the message source in-page before posting to React Native, combined with the endpoint allowlist.

---

### Bug 23 — `SlugRedirect` `toInternalPath` Identity Causes Infinite Re-Resolve
**File:** `apps/expo/components/deeplink/SlugRedirect.tsx`
**Severity:** High — potential infinite API call loop

`toInternalPath` is listed in the `useEffect` dependency array. The callers of `SlugRedirect` (e.g., `app/r/[slug].tsx`, `app/u/[username].tsx`) pass arrow functions that are recreated on every render: `toInternalPath={(id) => '/rooms/' + id}`. Since arrow functions are new references on every render, the effect re-runs on every render, calling `/public/resolve` in an infinite loop until the component unmounts. The callers must wrap their `toInternalPath` prop in `useCallback`, or the hook must not include it in deps (using a ref instead).

---

### Bug 24 — `markNotifRead` Race Against Immediate Cache Invalidation
**File:** `apps/expo/app/notifications/index.tsx`
**Severity:** Low — brief UI flicker showing notification as still unread

When a notification is tapped, `void markNotifRead(item.id)` fires asynchronously, then `queryClient.invalidateQueries({ queryKey: ['notifications'] })` is called synchronously on the next line. The query refetches immediately while the PATCH to mark it read is still in flight. The server returns the old state (still unread), showing the notification as unread again briefly. Should either use optimistic update on the cache or await `markNotifRead` before invalidating.

---

### Bug 25 — Gift Notification Routes to Non-Existent Tab Path
**File:** `apps/expo/app/notifications/index.tsx`
**Severity:** Medium — tapping gift notifications crashes navigation

`getNotificationRoute` returns `'/(tabs)/economy/wallet'` for `gift` and `gift_received` notification types. However, the wallet tab appears to be registered at `'/(tabs)/wallet'` (based on the tab layout and the wallet tab screen file at `app/(tabs)/wallet.tsx`). Pushing to a non-existent route causes expo-router to show a 404 screen or throw an error.

---

### Bug 26 — Friend Toggle Uses Different API Pattern Than ContactsImporter
**File:** `apps/expo/app/profile/[userId].tsx`, `apps/expo/components/ContactsImporter.tsx`
**Severity:** Low — API contract inconsistency

`profile/[userId].tsx` calls `apiClient.post('/friends/${userId}')` (ID in URL path) while `ContactsImporter` calls `apiClient.post('/friends', { targetUserId: contact.userId })` (ID in body). If the backend only implements one pattern, one of these paths fails silently. Both should use the same endpoint contract.

---

### Bug 27 — Gift-Send Wallet Query Returns Zero Stars Balance
**File:** `apps/expo/app/economy/gift-send.tsx`
**Severity:** High — users cannot send star-currency gifts

The gift-send screen fetches wallet balance from `/economy/coins/balance`. This endpoint is named for coins and likely only returns `{ coins: number }`. The screen then reads `wallet?.stars ?? 0` for star balance — if the endpoint doesn't return `stars`, this is always 0. Users who switch to stars mode in the gift screen see "0 stars available" even with a full star balance and cannot send star-priced gifts. Should use a combined balance endpoint or a dedicated stars-balance endpoint.

---

### Bug 28 — Notification Type Toggles Fire Mutations Without Debounce
**File:** `apps/expo/app/settings/index.tsx`
**Severity:** Low-Medium — rapid toggling sends many concurrent PATCH requests

The `NOTIFICATION_TYPES` toggle rows each call `patchMutation.mutate({ notifications: { [key]: v } })` immediately on every `onValueChange`. The `ChatPushToggles` component correctly debounces at 400ms, but the main notification toggles do not. A user rapidly toggling multiple notification types sends parallel PATCH requests. If these race, the final server state is determined by whichever request completes last, which may not match the user's intended final state.

---

### Bug 29 — `handleConfirmDelete` Fails Silently on Invalid PIN
**File:** `apps/expo/app/settings/index.tsx`
**Severity:** Low-Medium — confusing UX when account deletion PIN is wrong format

If `deletePin` is empty or not exactly 4 digits, `handleConfirmDelete` returns early without showing any error message. The user taps "Delete My Account", nothing happens, and the modal stays open with no explanation. Should set an error state that's displayed in the modal.

---

### Bug 30 — Date-of-Birth Field Uses Wrong Keyboard Type on Android
**File:** `apps/expo/app/settings/index.tsx`
**Severity:** Low — inconsistent keyboard appearance on Android API 36

`keyboardType="numbers-and-punctuation"` for the DOB input maps to `TYPE_NUMBER` on Android but may show a software keyboard without a hyphen key on some Android OEM keyboards. On API 36, this keyboard type behavior can vary. A date-specific picker component or `keyboardType="numeric"` with a formatted text hint would be more reliable.

---

### Bug 31 — 2FA Setup Modal Has No Retry Path After Secret Fetch Failure
**File:** `apps/expo/app/settings/index.tsx` (TwoFactorSection)
**Severity:** Low-Medium — poor error recovery UX

When `handleOpenSetup` calls `GET /auth/2fa/setup` and it fails, the modal is closed and an `Alert` is shown. The user must then tap "Enable 2FA" again to retry. If the failure was transient (e.g., brief network drop), the modal should remain open and show a retry button inside it rather than closing and losing the user's context.

---

### Bug 32 — TOTP Lockout State Read Before `storeReady` Gate
**File:** `apps/expo/app/auth/two-factor.tsx`
**Severity:** Medium — lockout state silently lost on fast cold starts

The `lockedOut` and `totpAttemptsRef` initial values are read from `storage` (MMKV proxy) synchronously during the first render. If `initStore()` has not fully resolved at the time this screen renders (possible if the deep link navigates to 2FA before the root layout's `storeReady` gate has fired), the `storage` proxy throws, is caught, and `lockedOut` defaults to `false`. A user who was locked out for failed 2FA attempts can bypass the lockout by opening the app via a fresh deep link before `initStore()` settles.

---

### Bug 33 — `storage` Proxy and `getStorage()` Coexist Without Enforced Pattern
**File:** Multiple — `apps/expo/lib/offline/store.ts` (consumers)
**Severity:** Low — maintenance confusion and potential bugs in new code

The store module exports both a `storage` Proxy (throws on pre-init access) and a `getStorage()` function (also throws). Some screens use `storage.getBoolean(key)` directly, others use `getStorage().getString(key)`. Both work, but new developers may not know which to use. More critically, the `getItem`/`setItem`/`removeItem` helper functions use `getStorage()` while many callers bypass them and call `storage` directly — meaning the typed serialization is often skipped.

---

### Bug 34 — `pendingRecovery` Google Play Purchases Lost on App Restart
**File:** `apps/expo/lib/payments/googlePlay.ts`
**Severity:** High — users lose purchased coins/subs if app crashes mid-purchase

The `pendingRecovery` Map tracks purchases that were confirmed by Google Play but not yet verified server-side. This Map is in-memory only. If the app crashes, is killed by Android, or is restarted (which is common on low-memory Android devices), the recovery state is gone. On next launch, `getPurchaseHistory` is not called to resume these pending verifications, meaning the user's money is taken but their coins/subscription are never granted. The recovery state should be persisted to SecureStore.

---

### Bug 35 — Room Presence Heartbeat Continues After Background Navigation
**File:** `apps/expo/app/rooms/[roomId].tsx`
**Severity:** Medium — presence API hammered for backgrounded rooms

The 45-second presence heartbeat `setInterval` is cleared only on component unmount. On Android, if the user navigates away via the bottom tab bar (which keeps the stack alive), the room component may not unmount. The heartbeat continues firing, making API calls that return 403 (user is no longer "in" the room from the server's perspective). Should subscribe to `AppState` changes or use `expo-router`'s `useFocusEffect` to pause/resume the heartbeat.

---

### Bug 36 — Swipe Drawer React State and Reanimated Shared Value Can Desync
**File:** `apps/expo/components/layout/SwipeDrawer.tsx`
**Severity:** Low-Medium — visual glitch and gesture state inconsistency

`openDrawer()` and `closeDrawer()` set both the React `isOpen` state (synchronous) and start Reanimated spring animations (asynchronous). If the user rapidly swipes open and then swipes closed before the open animation finishes, `isDrawerOpen.value` is `true` while the animation is mid-play. The `onEnd` handler reads `isDrawerOpen.value` to decide open/close direction, which may be stale. Additionally, the backdrop `pointerEvents` is controlled by `isOpen` React state, so it may enable/disable out of sync with the actual visual position of the drawer.

---

### Bug 37 — E.164 Normalization Incorrectly Handles 10-Digit International Numbers
**File:** `apps/expo/components/ContactsImporter.tsx`
**Severity:** Low-Medium — contact cross-reference fails for non-Nigerian international contacts

The `toE164` function's final fallback (line 81): `if (stripped.length >= 10) return '+' + stripped` prepends `+` to any 10-digit number without a recognized prefix. A US number stored as `2125551234` (digits only) becomes `+2125551234` instead of `+12125551234`. The Nigerian local format catch (starting with `0`) is correct, but the catch-all for stripped international numbers without country code is wrong. This means US/UK contacts with 10-digit numbers stored without `+` or `00` prefix won't match their server-stored E.164 format.

---

### Bug 38 — Notifications Endpoint Fetches All Notifications With No Pagination
**File:** `apps/expo/app/notifications/index.tsx`
**Severity:** Medium — performance degrades for high-volume users

`fetchNotifications()` calls `GET /notifications` with no `limit` or `page` parameter. A user with thousands of notification records (active users accumulate these quickly from guild events, gifts, and login streaks) will receive a huge JSON payload, blocking the render thread. Should implement cursor-based or offset pagination with a FlatList `onEndReached` handler.

---

### Bug 39 — Language Rollback on PATCH Failure Clears All Pending Settings Edits
**File:** `apps/expo/app/settings/index.tsx`
**Severity:** Low-Medium — data loss of unsaved setting changes

In the `patchMutation.onError` handler, the `else` branch does `setSettings({})`, which clears ALL local state. This means if the user was typing a new display name and simultaneously triggered a language change that failed, both the display name edit and the language change are cleared. Only the failed field should be rolled back.

---

### Bug 40 — Gift Send Doesn't Refresh Balance After PIN Modal Delay
**File:** `apps/expo/app/economy/gift-send.tsx`
**Severity:** Medium — user can send a gift they can no longer afford

Between the initial send attempt (which checks client-side balance) and the PIN verification (which may take 10+ seconds), the user's balance could decrease (e.g., from another concurrent gift send from a different device). After PIN verification, `sendMutation.mutate(pendingSendParams.current)` is retried with the same parameters. The server will reject the transaction if insufficient funds, but the client shows no preemptive warning. More critically, if the wallet query is stale, the "available balance" display is wrong throughout the gift selection flow.

---

### Bug 41 — Inverted FlatList + Android Keyboard Push on API 36
**File:** `apps/expo/app/rooms/[roomId].tsx`, `apps/expo/app/messages/[conversationId].tsx`
**Severity:** Medium — keyboard obscures message input on Android API 36

React Native's inverted FlatList has a long-standing issue on Android where `softwareKeyboardLayoutMode` doesn't correctly resize the content area when the keyboard appears. On Android API 36 (target), the predictive keyboard also changes keyboard height dynamically. Without explicit `KeyboardAvoidingView` configuration with the correct `behavior="padding"` and a `keyboardVerticalOffset` calibrated per device, the message input may be partially or fully hidden under the keyboard.

---

### Bug 42 — Pidgin Suggestions Dictionary Contains Offensive Terms as Autocomplete
**File:** `apps/expo/lib/i18n/pidgin.ts`
**Severity:** Low-Medium — user harassment vector via autocomplete

The suggestions dictionary maps `'stupid'` → `['Mumu', 'Olodo']` and `'person'` → `['Person', 'Mumu']`. These derogatory terms are surfaced as autocomplete suggestions in the chat keyboard. A user typing a word beginning with "stu" would receive "Mumu" as the first suggestion, potentially causing offensive autocomplete completions to be sent unintentionally. These terms should be removed from the suggestion dictionary.

---

### Bug 43 — `mergeNewestFirst` Full Re-Sort on Every Delta Fetch
**File:** `apps/expo/lib/chat/delta.ts`
**Severity:** Low — unnecessary CPU on every poll cycle in active chats

`mergeNewestFirst` performs a Schwartzian transform sort over the *entire* message array every time new messages arrive. Since the existing list is already sorted newest-first and incoming deltas are a small slice, the sort is O((n+k) log(n+k)) where n is the existing count. In a room with 1000 messages fetched over a session, each 15-second delta poll sorts 1000+ items. The function should instead binary-search the insertion point for each incoming message.

---

### Bug 44 — `OfflineBanner` Assumes Online at Mount
**File:** `apps/expo/components/offline/OfflineBanner.tsx`
**Severity:** Low-Medium — offline banner invisible on cold start while offline

`const [offline, setOffline] = useState(false)` initializes to "online". `NetInfo.addEventListener` fires asynchronously with the current state. If the device is offline at mount (e.g., user opens the app in airplane mode), the banner doesn't appear until the first NetInfo state-change event arrives. Should call `NetInfo.fetch()` inside the effect to get the immediate state and initialize `offline` from it.

---

### Bug 45 — Gift-Send PIN Lockout Uses Flat Duration Without Exponential Backoff
**File:** `apps/expo/app/economy/gift-send.tsx`
**Severity:** Medium — weaker brute-force protection than 2FA lockout

The gift-send PIN lockout is a constant 15-minute duration regardless of how many lockout cycles the user has accumulated. The 2FA screen correctly implements exponential backoff (15min × 2^n, capped at 24h). The `GIFT_PIN_LOCKOUT_COUNT` key even exists in `STORE_KEYS` for this purpose but is never read or written in the gift-send screen. An attacker with physical access who waits out each 15-minute lockout cycle can make unlimited attempts at 5 attempts per 15 minutes indefinitely.

---

### Bug 46 — `GIFT_PIN_LOCKOUT_COUNT` Key Defined But Never Used
**File:** `apps/expo/lib/offline/store.ts`, `apps/expo/app/economy/gift-send.tsx`
**Severity:** Low — dead code and missing backoff feature

`STORE_KEYS.GIFT_PIN_LOCKOUT_COUNT = 'gift_pin_lockout_count'` is defined in the store registry but never referenced in `gift-send.tsx`. This confirms the exponential backoff for gift PIN lockout was planned but not implemented. The key should either be implemented (to address Bug 45) or removed from `STORE_KEYS` to avoid confusion.

---

### Bug 47 — FlatList Components Missing `accessibilityLabel` Props
**Files:** `apps/expo/app/notifications/index.tsx`, `apps/expo/app/rooms/[roomId].tsx`, `apps/expo/app/messages/[conversationId].tsx`
**Severity:** Low — poor TalkBack experience for screen reader users

`FlatList` components for notifications, chat messages, and room messages lack `accessibilityLabel`. Android TalkBack announces them as "List" with no context. Adding contextual labels like "Message list", "Notification list" improves the screen reader experience.

---

### Bug 48 — `onNavigationStateChange` `stopLoading()` Doesn't Block All Navigation Paths
**File:** `apps/expo/components/games/GameWebView.tsx`
**Severity:** Low-Medium — game WebView can navigate outside its origin in edge cases

`stopLoading()` is called in `onNavigationStateChange` when the URL leaves the game origin, but `onNavigationStateChange` fires *after* the navigation begins. Some redirect-based attacks (meta-refresh, window.location reassignment before the native event fires) may complete before `stopLoading` can cancel them. The more robust approach is to use `onShouldStartLoadWithRequest` (returning `false` for non-origin URLs), which intercepts at the request level before loading begins.

---

### Bug 49 — `ContactsImporter` Sends Duplicates Across Multiple Import Sessions
**File:** `apps/expo/components/ContactsImporter.tsx`
**Severity:** Low — server receives redundant data on re-import

`importContacts` deduplicates phone numbers within a single import run (`new Set(phoneNumbers)`). However, if the user taps "Import Contacts" multiple times within the same session (allowed by the UI after an error), the `invited` Set resets to empty, allowing re-sending of friend requests to contacts already added earlier in the session. The `invited` Set should persist across re-imports within the same session, or the button should be disabled once contacts have been added.

---

### Bug 50 — `isInternetReachable` Null Treated as Connected in `OfflineBanner`
**File:** `apps/expo/components/offline/OfflineBanner.tsx`
**Severity:** Low — marginal: banner misses the "unknown" network state

`state.isInternetReachable === false` (strict equality) means `null` (the default when NetInfo hasn't tested reachability yet — common on first load and after flight mode toggles) is treated as "connected". The `syncQueue.ts` correctly treats `null` as "unknown/potentially connected". The banner's conservative offline check is intentional but the comment should document this null-handling decision explicitly to avoid future "fixes" that break the logic.

---

### Bug 51 — TOTP Lockout Logic Duplicated in Two `catch` Blocks
**File:** `apps/expo/app/auth/two-factor.tsx`
**Severity:** Low-Medium — divergence risk on maintenance

The lockout increment-and-save logic (check attempt count, compute lock duration, save to MMKV, set state) appears in two separate `catch` blocks in `handleVerify`: once for `!data.success` (API-level failure) and again for HTTP 401/403 exceptions. Both blocks are structurally identical but copied separately. If the lockout duration formula changes, it must be updated in two places. Should extract a `handleFailedAttempt()` function.

---

### Bug 52 — Ad Reward Daily Cap Is Client-Side Only
**File:** `apps/expo/components/ads/RewardedAdButton.tsx`
**Severity:** Medium — daily cap bypassable by clearing MMKV or using modified client

The `AD_DAILY_CAP = 5` is enforced only in MMKV. A user who clears app data, uninstalls and reinstalls, or uses a modified client can watch unlimited rewarded ads in a single day. The server endpoint `/economy/rewards/ad-reward` should independently track and enforce the daily ad reward cap per user, regardless of what the client reports.

---

### Bug 53 — RTL Reload Fires Before Language Save Is Confirmed
**File:** `apps/expo/app/settings/index.tsx`
**Severity:** Low — RTL reload may apply even if the PATCH fails

When the user switches to Arabic, the code calls `set('language', lang.code)` (which fires `patchMutation.mutate()`), then immediately calls `I18nManager.forceRTL(true)` and `Updates.reloadAsync()`. The reload happens before the PATCH response arrives. If the server rejects the language change (e.g., validation error), the app reloads in Arabic/RTL even though the server still has the previous language saved. On the next app start, the language from MMKV (saved before the failed PATCH) and the language from the server will disagree.

---

### Bug 54 — SwipeDrawer Left-Edge Gesture Conflicts With Android API 36 Predictive Back
**File:** `apps/expo/components/layout/SwipeDrawer.tsx`
**Severity:** Medium — system gesture and app gesture compete on Android 36 target

Android API 33+ introduced predictive back gesture navigation (swipe from left or right edge). On Android API 36 (the app's target SDK), this gesture is enabled by default and uses the same left-edge swipe zone as the `SwipeDrawer`. The `EDGE_THRESHOLD = 40` was raised from 24 to 40 to clear Android's 30dp system gesture zone, but Android API 36 may use wider zones on some devices. The drawer gesture should use `GestureDetector` with `simultaneousWithExternalGesture` to properly coordinate with the system back gesture.

---

### Bug 55 — Notification Payload IDs Embedded in Routes Without Sanitization
**File:** `apps/expo/app/notifications/index.tsx`
**Severity:** Low-Medium — path injection if server returns malformed payload IDs

`getNotificationRoute` constructs routes like `/messages/${p.conversationId}` and `/guilds/${p.guildId}` directly from notification payload data. If the server (or a compromised server) sends a `conversationId` containing path characters like `../../admin`, the resulting route would be `/messages/../../admin`. expo-router's type system provides some protection, but explicit UUID validation on the IDs before constructing routes would provide defense-in-depth.

---

## Post-Fix Quality Projection

After all 55 bugs are fixed:

| Dimension | Current | Post-Fix |
|---|---|---|
| Security | 6.5 / 10 | 8.5 / 10 |
| Reliability | 6 / 10 | 8.5 / 10 |
| Performance | 6.5 / 10 | 8 / 10 |
| Correctness | 6 / 10 | 9 / 10 |
| Accessibility | 5 / 10 | 7.5 / 10 |
| Maintainability | 7 / 10 | 8.5 / 10 |
| **Overall** | **6.2 / 10** | **8.4 / 10** |
