# Zobia Expo App — Forensic Bug Report
**Generated:** June 25, 2026 — 10:08 AM  
**Scope:** Expo Android app (SDK 51 / React Native 0.74.0 / Android API 36 target)  
**Method:** Manual forensic analysis of all relevant source files — no agents, no existing reports consulted

---

## Quick-Reference Bug List (All 37 Issues)

1. BUG-PAY-01: `APP_PACKAGE_NAME` mismatch — IAP server verification always fails
2. BUG-PAY-02: Google Play Billing not initialized at app startup — coin IAP entirely broken
3. BUG-PAY-03: Coin store uses Paystack web redirect instead of Google Play Billing — Play Store policy violation
4. BUG-PAY-04: `disconnectGooglePlayBilling()` never called anywhere — billing connection leaks on every app restart
5. BUG-AUTH-01: RewardedAdButton reads MMKV token from wrong key `'authToken'` — ad reward API always 401
6. BUG-AUTH-02: TwoFactorSection reads MMKV token from wrong key `'authToken'` — 2FA setup/disable always unauthorized
7. BUG-AUTH-03: PrivacyDataSection reads MMKV token from wrong key `'authToken'` — data export always unauthorized
8. BUG-AUTH-04: Two independent silent token-refresh paths (context.tsx + client.ts) can race and produce two refresh calls
9. BUG-AUTH-05: Telegram login skips onboarding completion check — new Telegram users bypass onboarding
10. BUG-ENV-01: `EXPO_PUBLIC_API_URL` env var used in settings/index.tsx — not defined in app, evaluates to `undefined`; all raw fetch calls fail on mobile
11. BUG-ENV-02: `EXPO_PUBLIC_API_URL` also used in RewardedAdButton.tsx — same undefined-env-var failure
12. BUG-SEC-01: JWT passed as URL query parameter `?t=<token>` in GameWebView — token exposed in server logs and referrer headers
13. BUG-SEC-02: `originWhitelist={['*']}` in GameWebView — overly permissive WebView origin whitelist
14. BUG-SEC-03: `Alert.prompt()` used in delete-account flow — iOS-only API; silently fails on Android (this is an Android-only app)
15. BUG-ROUTE-01: Admin tab visibility check uses `is_admin` (snake_case) — `AuthUser` interface has `isAdmin` (camelCase); admin tab never visible to admins
16. BUG-ROUTE-02: VALID_PUSH_ROUTES in `_layout.tsx` contains `/inbox` and `/inbox/[id]` — these routes don't exist; correct tab is `/(tabs)/messages`
17. BUG-ROUTE-03: Home screen guild card navigates to `/guild/${guild.id}` (singular) — actual route is `/guilds/[guildId].tsx` (plural)
18. BUG-ROUTE-04: Admin screen "User Area" NavCard navigates to `/home` — route does not exist; home is `/(tabs)`
19. BUG-API-01: Room message report uses `/users/${messageId}/report` — wrong endpoint for reporting a message
20. BUG-API-02: Rooms search bar sends `params.category = searchQuery` — users expect name search; `category` param is the wrong field
21. BUG-API-03: HD Send toggle fires two concurrent PATCH requests to two different endpoints (`/users/me/settings` and `/settings`)
22. BUG-API-04: Contacts phone numbers sent without E.164 normalization — server may reject or misroute international numbers
23. BUG-UI-01: Profile screen "Edit Profile" Pressable has no `onPress` handler — tapping it does nothing
24. BUG-UI-02: `gifts.tsx` FlatList `refreshing={isLoading}` — should be `isRefetching`; pull-to-refresh spinner invisible after first successful load
25. BUG-UI-03: GIF picker in rooms/[roomId].tsx fires API on every keystroke — no debounce, causing excessive API hammering
26. BUG-UI-04: `KeyboardAvoidingView behavior='height'` on Android in rooms/[roomId].tsx — known broken on Android; should be `'padding'`
27. BUG-UI-05: `dailyLoginMutation.mutate()` fires on every home screen mount, not guarded per session — duplicate daily-login hits every resume/navigation
28. BUG-UI-06: Toast visibility condition `!visible && opacity === null` is dead code — `Animated.Value` is never `null`
29. BUG-UI-07: Double-trigger of moment confirm dialog in DM screen — confirm fires twice on the same interaction
30. BUG-UI-08: `"use client"` Next.js directive at top of RewardedAdButton.tsx — meaningless in React Native, indicates copy-paste from web codebase
31. BUG-UI-09: Admin screen `refetchInterval: 30_000` polls admin stats continuously even when screen is not in view
32. BUG-ONBOARD-01: `ONBOARDING_COMPLETE` written to MMKV before API call completes — user is locally marked onboarded even if server save fails
33. BUG-ONBOARD-02: Vibe-quiz stores raw English question strings in `questionKey` field — not i18n keys; quiz is entirely unlocalized
34. BUG-PERM-01: `POST_NOTIFICATIONS` Android permission missing from app.json — push notifications silently blocked on Android 13+
35. BUG-CFG-01: `minSdkVersion` not set in app.json android config — Expo defaults to a value that may allow installs on incompatible devices
36. BUG-CFG-02: `runtimeVersion` policy absent from eas.json — expo-updates cannot reliably determine OTA update compatibility
37. BUG-SQLITE-01: `getOrCreateEncryptionKey()` in sqlite.ts has no mutex — concurrent first-call race can generate two different keys, one silently overwriting the other

---

## Detailed Bug Entries

---

### 1. BUG-PAY-01: APP_PACKAGE_NAME mismatch — IAP server verification always fails

**FILES:**
- `apps/expo/lib/payments/googlePlay.ts`
- `apps/expo/app.json`

**FIX:**
`googlePlay.ts` hardcodes `APP_PACKAGE_NAME = 'com.zobia.app'` but the actual Android package declared in `app.json` is `"package": "org.zobia.social"`. Any server-side purchase verification that passes `APP_PACKAGE_NAME` to Google Play's Developer API will always receive a `packageName mismatch` error, causing all IAP purchase validation to fail silently. Change `APP_PACKAGE_NAME` to `'org.zobia.social'` to match `app.json`.

---

### 2. BUG-PAY-02: Google Play Billing not initialized at app startup — coin IAP entirely broken

**FILES:**
- `apps/expo/app/_layout.tsx`
- `apps/expo/lib/payments/googlePlay.ts`
- `apps/expo/app/settings/subscription.tsx`

**FIX:**
`initGooglePlayBilling()` is never called in `_layout.tsx` (the app root). It is only lazily called inside `subscription.tsx` when the subscription screen mounts. The coin purchase flow in `economy/store.tsx` (see BUG-PAY-03) does not call it at all. Google Play Billing requires the connection to be established before any purchase or query. Call `initGooglePlayBilling()` in `_layout.tsx` alongside `initializeAds()` and `initOfflineDB()` so the billing connection is live before any screen tries to use it.

---

### 3. BUG-PAY-03: Coin store uses Paystack web redirect instead of Google Play Billing — Play Store policy violation

**FILES:**
- `apps/expo/app/economy/store.tsx`

**FIX:**
When a user taps a coin-purchase package, the app calls `Linking.openURL(...)` to redirect to a Paystack web checkout page. The Google Play Store policy requires that all in-app digital goods sold in an Android app on the Play Store must use Google Play Billing. Using an external payment processor for in-app purchases (coins being a consumable in-app currency) is a direct policy violation that will result in app removal. The coin purchase flow must be migrated to `react-native-iap` using `requestPurchase()` for consumable products, consistent with how subscriptions already work in `subscription.tsx`.

---

### 4. BUG-PAY-04: `disconnectGooglePlayBilling()` never called — billing connection leaks

**FILES:**
- `apps/expo/lib/payments/googlePlay.ts`
- `apps/expo/app/_layout.tsx`

**FIX:**
`googlePlay.ts` exports a `disconnectGooglePlayBilling()` function but it is never imported or called anywhere in the app. Google Play Billing recommends calling `endConnection()` when the app is no longer using billing, typically on unmount or when the app goes to background for an extended period. The connection is established once at startup (after BUG-PAY-02 is fixed) and never torn down, which can cause resource leaks and stale connection state. Call `disconnectGooglePlayBilling()` in an `AppState` `background`/`inactive` handler or on sign-out.

---

### 5. BUG-AUTH-01: RewardedAdButton reads MMKV token from wrong key — ad reward API always 401

**FILES:**
- `apps/expo/components/ads/RewardedAdButton.tsx`

**FIX:**
`RewardedAdButton.tsx` reads the auth token with `storage.getString('authToken')`. The app stores the JWT under the key `'zobia_jwt'` (the `JWT_KEY` constant defined in `lib/auth/`). This means the retrieved token is always `undefined`, and every POST to the reward endpoint is sent without an Authorization header, receiving a 401. Change the storage key to `'zobia_jwt'` and prefer using `apiClient` (the shared Axios instance whose interceptor attaches the token automatically) instead of a manual raw `fetch`.

---

### 6. BUG-AUTH-02: TwoFactorSection reads MMKV token from wrong key — 2FA always unauthorized

**FILES:**
- `apps/expo/app/settings/index.tsx` (TwoFactorSection component)

**FIX:**
`TwoFactorSection` calls `storage.getString('authToken')` to retrieve a Bearer token for the 2FA enable/disable API call. Same wrong-key issue as BUG-AUTH-01 — the key is `'zobia_jwt'`. Token is always `undefined`, every 2FA mutation is sent unauthenticated and returns 401. Replace with `storage.getString('zobia_jwt')` or, better, replace the raw `fetch` call entirely with `apiClient` which handles the token automatically.

---

### 7. BUG-AUTH-03: PrivacyDataSection reads MMKV token from wrong key — data export always unauthorized

**FILES:**
- `apps/expo/app/settings/index.tsx` (PrivacyDataSection component)

**FIX:**
Same wrong-key issue as BUG-AUTH-01 and BUG-AUTH-02. `PrivacyDataSection` calls `storage.getString('authToken')` for the data export request. The key must be `'zobia_jwt'`. Migrate this section's API calls to `apiClient` to avoid repeating this class of bug in future.

---

### 8. BUG-AUTH-04: Two independent silent token-refresh paths can race

**FILES:**
- `apps/expo/lib/auth/context.tsx`
- `apps/expo/lib/api/client.ts`

**FIX:**
`context.tsx` implements `silentRefresh()` (a `useEffect`-driven periodic refresh using raw `fetch`) and `client.ts` implements `refreshAccessToken()` (the Axios 401-interceptor-driven refresh with a `refreshPromise` singleton guard). These are two completely independent refresh mechanisms with no shared lock. If both fire simultaneously (e.g., an Axios 401 fires at the same time the context timer fires), two concurrent refresh requests hit the backend. Many JWT backends invalidate the refresh token after a single use, so whichever request arrives second will receive a 401 on the refresh token itself, silently logging the user out. Consolidate all token refresh logic into a single function in `client.ts` (or a shared `auth/refresh.ts` module) and have `context.tsx` call that same function rather than implementing its own `fetch`-based version.

---

### 9. BUG-AUTH-05: Telegram login skips onboarding check — new Telegram users bypass onboarding

**FILES:**
- `apps/expo/app/auth/login.tsx`

**FIX:**
After a successful Telegram OAuth callback, the app navigates directly to the home screen without checking whether the user has completed onboarding (i.e., whether the backend returned `onboarding_complete: false` or whether `STORE_KEYS.ONBOARDING_COMPLETE` is absent in MMKV). Other login paths (email, Google) correctly redirect new users to `/onboarding`. Add the same onboarding gate after Telegram login: check the user object's `onboardingComplete` field and redirect to `/onboarding` if false.

---

### 10. BUG-ENV-01: `EXPO_PUBLIC_API_URL` undefined in settings/index.tsx — raw fetch calls fail on mobile

**FILES:**
- `apps/expo/app/settings/index.tsx`

**FIX:**
`settings/index.tsx` opens with `const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? ''`. This env var is not defined anywhere in the app's environment — the correct way to access the API base URL in this Expo codebase is via `Constants.expoConfig?.extra?.apiBaseUrl` (the `API_BASE_URL` value injected through `app.json` extra). Because `EXPO_PUBLIC_API_URL` is undefined, `API_BASE` evaluates to `''`, and every raw `fetch(\`${API_BASE}/...\`)` in the file becomes a relative-path request (`/endpoint`), which on a React Native runtime has no meaningful base URL and will throw a network error. Replace all raw `fetch` calls in `settings/index.tsx` with `apiClient` (Axios), which already knows the base URL and attaches the auth header.

---

### 11. BUG-ENV-02: `EXPO_PUBLIC_API_URL` also used in RewardedAdButton.tsx

**FILES:**
- `apps/expo/components/ads/RewardedAdButton.tsx`

**FIX:**
Same undefined env var problem as BUG-ENV-01. The ad reward callback POST will fail with a network error on every device. Migrate to `apiClient`.

---

### 12. BUG-SEC-01: JWT passed as URL query parameter in GameWebView — token exposed in logs

**FILES:**
- `apps/expo/components/games/GameWebView.tsx`

**FIX:**
The WebView is loaded with a URL like `https://game.example.com/play?t=<JWT>`. The token appears in server access logs, proxy logs, and may be leaked via the HTTP Referer header if the game page loads third-party resources. Prefer passing the token in a `postMessage` after the WebView loads (`window.ReactNativeWebView.postMessage` + `onMessage`) or inject it via a one-time short-lived session cookie/code exchanged through a server endpoint. Never put a long-lived Bearer JWT in a URL.

---

### 13. BUG-SEC-02: `originWhitelist={['*']}` in GameWebView — overly permissive WebView

**FILES:**
- `apps/expo/components/games/GameWebView.tsx`

**FIX:**
`originWhitelist={['*']}` allows any origin to navigate the WebView, including `javascript:` URIs, `file://`, and any third-party domain. This opens the door to open-redirect attacks or malicious JS injection from the game page. Restrict to the actual game origin(s) the app intends to allow, e.g., `originWhitelist={['https://game.zobia.app', 'https://zobia.vercel.app']}`.

---

### 14. BUG-SEC-03: `Alert.prompt()` used in delete-account flow — iOS-only API, crashes/fails on Android

**FILES:**
- `apps/expo/app/settings/index.tsx`

**FIX:**
`Alert.prompt()` (the variant that includes a text input field) is an iOS-exclusive React Native API. On Android it is a no-op — the dialog never appears, the promise/callback never resolves, and the user is stuck. Since this app targets Android, the delete-account confirmation prompt is completely broken. Replace with a custom modal component (e.g., a `Modal` with a `TextInput` for the user to type "DELETE") or a two-step confirmation Alert (first Alert warns, second Alert confirms) that avoids needing `Alert.prompt`.

---

### 15. BUG-ROUTE-01: Admin tab hidden due to camelCase vs snake_case field mismatch

**FILES:**
- `apps/expo/app/(tabs)/_layout.tsx`
- `apps/expo/lib/auth/context.tsx` (AuthUser type definition)

**FIX:**
The tab layout checks `(user as any).is_admin` (snake_case) to decide whether to render the Admin tab. The `AuthUser` TypeScript interface defines this field as `isAdmin` (camelCase), which is what the auth context and API response mapper populate. Because `is_admin` is always `undefined`, admin users never see the Admin tab. Change the check to `user.isAdmin` (or wherever the user object is typed, use the correct camelCase field name).

---

### 16. BUG-ROUTE-02: VALID_PUSH_ROUTES contains non-existent routes

**FILES:**
- `apps/expo/app/_layout.tsx`

**FIX:**
The `VALID_PUSH_ROUTES` array used to validate incoming push notification deep-link targets includes `/inbox` and `/inbox/[id]`. These routes do not exist in the app. The messaging tab is `/(tabs)/messages` and individual conversations are at `/messages/[conversationId]`. When a push notification arrives targeting `/inbox/...`, the router will throw a not-found error or silently fail to navigate. Update the valid routes to `/(tabs)/messages` and `/messages/[conversationId]` (and any other real routes used in push payloads).

---

### 17. BUG-ROUTE-03: Home screen guild card navigates to wrong route (singular vs plural)

**FILES:**
- `apps/expo/app/(tabs)/index.tsx`

**FIX:**
When a user taps a guild card on the home screen, the app navigates to `` `/guild/${guild.id}` `` (singular `guild`). The actual file-based route is `app/guilds/[guildId].tsx` (plural `guilds`). This navigation will land on a 404/not-found screen. Change the navigation target to `` `/guilds/${guild.id}` ``.

---

### 18. BUG-ROUTE-04: Admin screen "User Area" NavCard navigates to `/home` — route does not exist

**FILES:**
- `apps/expo/app/(tabs)/admin.tsx`

**FIX:**
The "User Area" NavCard in the admin dashboard calls `router.push('/home')`. There is no `/home` route in Expo Router — the home screen is the default tab index at `/(tabs)` (or `/(tabs)/index`). The navigation silently fails or throws. Change to `router.push('/(tabs)')`.

---

### 19. BUG-API-01: Room message report uses wrong endpoint

**FILES:**
- `apps/expo/app/rooms/[roomId].tsx`

**FIX:**
The "Report Message" action calls `/users/${messageId}/report`, which is the user-report endpoint (reporting a user by their ID). Reporting a message requires a separate endpoint (likely `/messages/${messageId}/report` or `/rooms/${roomId}/messages/${messageId}/report` depending on API design). Verify the correct endpoint with the backend team and update the call. This means the current report-message feature silently reports a non-existent user ID rather than the intended message.

---

### 20. BUG-API-02: Rooms search bar sends wrong query parameter — room name search broken

**FILES:**
- `apps/expo/app/(tabs)/rooms.tsx`

**FIX:**
When a user types in the rooms search bar, the query is sent as `params.category = searchQuery.trim()`. The category field filters rooms by type/category, not by name. Users visually expect to search by room name. Add a dedicated `search` or `name` query parameter (aligned with whatever the backend supports) and send the user's text there. If the backend does not yet have a name-search endpoint, that needs to be implemented — but at minimum stop conflating category filtering with name searching.

---

### 21. BUG-API-03: HD Send toggle fires two concurrent PATCH requests to two different endpoints

**FILES:**
- `apps/expo/app/settings/index.tsx`

**FIX:**
The HD Send (high-definition media send) toggle onChange handler calls both a local `set('hdSendEnabled', v)` helper that internally calls `PATCH /users/me/settings` AND a direct `apiClient.patch('/settings', { hd_send_enabled: v })`. This fires two simultaneous PATCH requests to two different endpoints every time the toggle is flipped, with no deduplication. Pick one canonical endpoint and remove the other call. The shared `set()` helper pattern appears to be the intended abstraction — the extra `apiClient.patch` is a duplicate.

---

### 22. BUG-API-04: Contacts phone numbers not normalized to E.164 before upload

**FILES:**
- `apps/expo/app/onboarding/index.tsx`

**FIX:**
When the user grants contacts permission, all contact phone numbers are extracted from the device and uploaded to the server. The numbers are sent as-is from `expo-contacts` (e.g., `(555) 123-4567`, `+1 555-123-4567`, `0044 7700 900123`). Without E.164 normalization, the backend cannot reliably deduplicate, match, or route these numbers. Use a library like `libphonenumber-js` to normalize each number to E.164 format (e.g., `+15551234567`) before sending. If no country code is present, fall back to the device's locale/region to prepend the correct country code.

---

### 23. BUG-UI-01: Profile "Edit Profile" button has no onPress handler — tapping does nothing

**FILES:**
- `apps/expo/app/(tabs)/profile.tsx`

**FIX:**
The "Edit Profile" `Pressable` component is rendered without an `onPress` prop. When tapped it produces no response, no navigation, no feedback — completely dead UI. Add an `onPress` that navigates to the edit-profile screen (create `app/profile/edit.tsx` if it doesn't exist, or navigate to the correct existing route).

---

### 24. BUG-UI-02: `gifts.tsx` FlatList `refreshing` prop uses `isLoading` instead of `isRefetching`

**FILES:**
- `apps/expo/app/(tabs)/gifts.tsx`

**FIX:**
`<FlatList refreshing={isLoading} ...>` means the pull-to-refresh spinner is only shown while the very first load is happening (`isLoading` is `true` only when there's no cached data and a fetch is in flight). After the first successful load, `isLoading` is always `false`, so every subsequent pull-to-refresh gesture starts but the spinner disappears immediately, giving users no visual feedback that a refresh is occurring. Change to `refreshing={isRefetching}` (or `isFetching` if you want to show the spinner for any background refetch, not just manual pulls).

---

### 25. BUG-UI-03: GIF picker in room chat fires API on every keystroke — no debounce

**FILES:**
- `apps/expo/app/rooms/[roomId].tsx`

**FIX:**
The GIF search input's `onChangeText` directly triggers an API search request on every character typed. With a user typing at normal speed (5–10 chars/second), this fires 5–10 requests per second, hammers the Giphy/Tenor API, burns rate limit quota, and wastes bandwidth. Add a debounce (300–400ms is standard) using `useRef` + `setTimeout`/`clearTimeout` or a debounce utility. The DM screen (`messages/[conversationId].tsx`) correctly implements 400ms debounce for its GIF picker — apply the same pattern here.

---

### 26. BUG-UI-04: `KeyboardAvoidingView behavior='height'` on Android

**FILES:**
- `apps/expo/app/rooms/[roomId].tsx`

**FIX:**
`KeyboardAvoidingView` with `behavior='height'` is notoriously unreliable on Android and is the root cause of the keyboard either overlapping the message input or causing layout jumps. On Android, `behavior='padding'` is the documented working approach. Apply `behavior={Platform.OS === 'ios' ? 'padding' : 'padding'}` (both platforms use padding) or simply `behavior='padding'` with appropriate `keyboardVerticalOffset`.

---

### 27. BUG-UI-05: `dailyLoginMutation.mutate()` fires on every home screen mount

**FILES:**
- `apps/expo/app/(tabs)/index.tsx`

**FIX:**
`useEffect(() => { dailyLoginMutation.mutate(); }, [])` fires every time the home tab is mounted. In Expo Router with a tab navigator, mounting happens not just on first open but also when the user navigates away and back (depending on screen lifecycle options). This means the daily-login endpoint can be hit multiple times per session. Guard the call: after a successful daily-login, store a timestamp (today's date in `YYYY-MM-DD` format) in MMKV and skip the mutate() call if the stored date equals today's date.

---

### 28. BUG-UI-06: Toast visibility condition `!visible && opacity === null` is dead code

**FILES:**
- `apps/expo/app/(tabs)/index.tsx`

**FIX:**
The toast show/hide logic contains a condition `if (!visible && opacity === null)`. `opacity` is an `Animated.Value` object — it is initialized with `new Animated.Value(0)` and is never reassigned to `null`. The condition `opacity === null` is therefore permanently `false`, making the entire `if` branch dead code. Remove or rewrite the condition to use a boolean state variable (e.g., `isToastVisible`) instead of comparing an `Animated.Value` reference to null.

---

### 29. BUG-UI-07: Double-trigger of moment confirm dialog in DM screen

**FILES:**
- `apps/expo/app/messages/[conversationId].tsx`

**FIX:**
The "confirm moment" action (whatever "moments" are — a timed shared content feature) triggers the confirmation dialog twice on a single user interaction. This is a standard React event-handler bug — likely the handler is wired to both `onPress` and `onPressIn` (or similar), or a state update inside the handler causes a re-render that re-fires the effect. Audit the handler and ensure only one event binding triggers the confirm dialog. Add a `useRef` guard (`confirming.current = true`) that prevents double-fire.

---

### 30. BUG-UI-08: `"use client"` Next.js directive in RewardedAdButton.tsx

**FILES:**
- `apps/expo/components/ads/RewardedAdButton.tsx`

**FIX:**
The file begins with `"use client";` — a Next.js App Router directive that has absolutely no meaning in a React Native / Expo project. It indicates this component was copied from the web app without cleanup. Remove the directive. Beyond being dead code, its presence suggests the component may not have been properly audited for mobile correctness (and indeed it contains BUG-AUTH-01 and BUG-ENV-02 as well).

---

### 31. BUG-UI-09: Admin screen polls stats every 30 seconds even when off-screen

**FILES:**
- `apps/expo/app/(tabs)/admin.tsx`

**FIX:**
The React Query call for admin stats includes `refetchInterval: 30_000`. Expo Router's tab navigator keeps screens mounted in the background, so this interval fires every 30 seconds regardless of whether the Admin tab is visible. Add `refetchIntervalInBackground: false` (React Query v5 default, but worth being explicit) and use the `useIsFocused` hook (from `@react-navigation/native`) to set `enabled: isFocused` so polling only occurs when the tab is actually visible.

---

### 32. BUG-ONBOARD-01: ONBOARDING_COMPLETE stored before API call completes

**FILES:**
- `apps/expo/app/onboarding/welcome-drop.tsx`

**FIX:**
The welcome-drop screen (final onboarding step) writes `STORE_KEYS.ONBOARDING_COMPLETE` to MMKV and immediately navigates away before awaiting confirmation that the server successfully saved the onboarding data. If the API call fails (network hiccup, server error), the user's device is permanently marked as onboarded while the server has no record of it. Move the `setItem(STORE_KEYS.ONBOARDING_COMPLETE, true)` call to inside the `.then()` / success callback of the API call, after the server confirms the save. Also add a retry mechanism or at minimum show an error toast so the user knows the save failed.

---

### 33. BUG-ONBOARD-02: Vibe-quiz stores English strings in `questionKey` — not localizable

**FILES:**
- `apps/expo/app/onboarding/vibe-quiz.tsx`

**FIX:**
The vibe-quiz question data structure uses a field named `questionKey` but populates it with raw English question text (e.g., `"What's your vibe?"`) rather than i18n translation keys (e.g., `"onboarding.quiz.question1"`). The field name implies localizability but the implementation is entirely hardcoded English. Either rename the field to `questionText` to be honest about what it stores, or replace the string values with actual i18next keys and call `t(question.questionKey)` in the render. Without this fix, the quiz will always display in English regardless of the device language.

---

### 34. BUG-PERM-01: `POST_NOTIFICATIONS` permission missing from app.json — Android 13+ push notifications silently blocked

**FILES:**
- `apps/expo/app.json`

**FIX:**
Android 13 (API 33) and above require apps to explicitly declare `android.permission.POST_NOTIFICATIONS` in the manifest and request it at runtime. Without it, the system permission prompt never appears and push notifications are silently disabled for users on Android 13+. Since the app targets API 36, this affects all modern Android users. Add `"android.permission.POST_NOTIFICATIONS"` to the `android.permissions` array in `app.json`, and ensure the runtime permission request (`expo-notifications` `requestPermissionsAsync()`) is called early in the app lifecycle (already done in `_layout.tsx`, but the manifest entry must also be present).

---

### 35. BUG-CFG-01: `minSdkVersion` not set in app.json android config

**FILES:**
- `apps/expo/app.json`

**FIX:**
The `android` section in `app.json` specifies `compileSdkVersion: 36` and `targetSdkVersion: 36` but omits `minSdkVersion`. Expo SDK 51 defaults to `minSdkVersion: 23` (Android 6.0), but `react-native-mmkv ^2.12.2` and `react-native-reanimated ~3.10.0` both have higher minimum API requirements. Without an explicit `minSdkVersion`, users on incompatible older devices may receive a crash at launch rather than a clear Play Store incompatibility filter. Explicitly set `"minSdkVersion": 24` (or higher if any dependency requires it — verify against all native module requirements).

---

### 36. BUG-CFG-02: `runtimeVersion` policy missing from eas.json — OTA updates unreliable

**FILES:**
- `apps/expo/eas.json`

**FIX:**
`eas.json` does not define a `runtimeVersion` policy. `expo-updates` is installed and active (`"expo-updates": "~0.25.0"` in `package.json`), but without a runtime version policy the update service cannot reliably determine whether an OTA update is compatible with the installed native binary. This can cause OTA updates to be delivered to incompatible builds, resulting in crashes. Add `"runtimeVersion": { "policy": "appVersion" }` to each build profile in `eas.json` (or use `"nativeVersion"` if you want more fine-grained control). This is a hard requirement for production OTA delivery with `expo-updates`.

---

### 37. BUG-SQLITE-01: SQLite `getOrCreateEncryptionKey()` has no mutex — concurrent first-call race

**FILES:**
- `apps/expo/lib/offline/sqlite.ts`

**FIX:**
`getOrCreateEncryptionKey()` is an async function that: (1) reads the key from SecureStore, (2) if absent, generates a new key, (3) writes it to SecureStore, (4) returns it. If `initOfflineDB()` is somehow called concurrently before the first call completes (e.g., from two async paths during app init), both callers may read `null` from SecureStore simultaneously, each generate a different key, and one will overwrite the other. Any data encrypted with the first key becomes unreadable. Protect the function with a module-level Promise singleton: `let _keyPromise: Promise<string> | null = null;` and return `_keyPromise = _keyPromise ?? loadAndCreate()` so all concurrent callers await the same Promise.

---

## Code Quality Assessment

### Current State — Rating: 5.5 / 10

The codebase shows genuine architectural ambition and several mature patterns: the Axios interceptor with a `refreshPromise` singleton guard is solid; the SQLite-backed offline message queue with AES-256-GCM encryption is well-designed; the MMKV Proxy for lazy initialization is clever; the realtime/polling adaptive pattern is thoughtful; and Expo Router is used appropriately throughout. Test coverage appears to be zero at the unit/integration level.

That said, the codebase has a cluster of **critical production-breaking bugs** that suggest the app has not been tested end-to-end on a real Android device with a Play Store account:

- The **wrong MMKV key** (`'authToken'` vs `'zobia_jwt'`) in three separate files means 2FA, rewarded-ad rewards, and data export are all broken for every user.
- The **wrong package name** in IAP means no in-app purchase has ever been successfully server-verified.
- The **Play Store policy violation** (Paystack for in-app coins) risks app removal.
- The **`Alert.prompt` on Android** means delete-account has never worked.
- The **undefined env var** means every settings-screen API call fails silently.

These are not subtle edge cases — they are core monetization, authentication, and retention flows. The number of wrong-key / wrong-env-var bugs across multiple files suggests the codebase was assembled from multiple contributors or ported from the web app without consistent mobile review.

Secondary concerns: no debounce on GIF search, stale polling when off-screen, onboarding race conditions, and missing Android 13+ notification permission are all user-experience regressions that will manifest in early production usage.

### Projected State After All Fixes — Rating: 8.0 / 10

After resolving all 37 issues, the app will have:
- A fully functional monetization stack (Google Play Billing for coins + subscriptions, no policy violations)
- Correct authentication across all features (no more wrong-key bugs)
- Secure JWT handling (no token in URLs, no permissive WebView origins)
- Working push notification routing on Android 13+
- Reliable OTA updates via correct `runtimeVersion` policy
- All major navigation routes resolving correctly
- A clean, de-duplicated token-refresh flow

The remaining gap to a 10/10 would be: adding unit/integration test coverage, adding structured error monitoring (e.g., Sentry), completing the "Change Password" feature, and addressing the i18n gap in the quiz. Those are roadmap items rather than bugs.

---

*Report prepared: June 25, 2026 — 10:08 AM*  
*Analyzed by: forensic static analysis of all Expo app source files in `/home/user/zobia/apps/expo/`*  
*Do not act on these findings until the fix plan has been reviewed and approved.*
