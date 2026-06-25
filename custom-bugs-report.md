# Zobia Social — Expo App Bug Report

**Date:** June 25, 2026 — 12:00 PM
**Scope:** Expo/Android app (API level 36), forensic analysis of all relevant source files
**Status:** DO NOT FIX until plan is reviewed

---

## Code Quality Rating

**Current rating: 5/10**
The codebase has thoughtful architecture — React Query for server state, encrypted MMKV + SQLite for offline, proper ref patterns in some hooks, idempotency keys on message sends, server-side purchase verification before acknowledgment. However, it has three completely broken features (IAP, admin UI, guild navigation), a stuck-white-screen on first launch, several auth logic gaps, and pervasive dark mode failures. The offline sync, realtime channel hook, and payment flow skeleton are all solid foundations that are let down by integration bugs.

**Projected rating after all fixes: 8.5/10**
All critical and high-severity bugs resolved, dark mode consistency restored, IAP functional, security surface reduced.

---

## Complete Bug Index (one-line summary)

1. **BUG-CRIT-01** — No auth gate in root layout; unauthenticated users land on tabs instead of login screen (white screen root cause)
2. **BUG-CRIT-02** — `SplashScreen.hideAsync()` never called; splash timing entirely uncontrolled causing stuck white screen on slow devices
3. **BUG-CRIT-03** — `initStore()` called fire-and-forget; MMKV accessed before encryption key derivation completes; crash in storage-dependent components in release builds
4. **BUG-CRIT-04** — Wrong Android package name in `googlePlay.ts` (`com.zobia.app` vs `org.zobia.social`); ALL IAP purchases fail server-side verification
5. **BUG-CRIT-05** — `initGooglePlayBilling()` never called anywhere; IAP billing connection never established; entire IAP system non-functional
6. **BUG-HIGH-01** — `isAdmin` checked via `user?.is_admin` (snake_case) but `AuthUser` type uses `isAdmin` (camelCase); admin tab and admin drawer never visible
7. **BUG-HIGH-02** — Guild card navigates to `/guild/${id}` but route file is `app/guilds/[guildId].tsx`; navigation crashes with "no such route"
8. **BUG-HIGH-03** — Creator spotlight navigates to `/profile/${username}` but route expects a `userId`; wrong param causes profile 404
9. **BUG-HIGH-04** — Rewarded ad button reads auth token via `storage.getString("authToken")` (wrong key/wrong store); ad reward claims always unauthenticated
10. **BUG-HIGH-05** — Rewarded ad button has `"use client"` directive; Next.js-only, invalid in Expo/React Native
11. **BUG-HIGH-06** — Telegram login success does not check `onboardingCompleted`; new Telegram users bypass onboarding entirely
12. **BUG-HIGH-07** — Profile "Edit Profile" button has no `onPress` handler; button is non-functional dead UI
13. **BUG-HIGH-08** — Creator Dashboard shortcut shown to all users regardless of `isCreator` flag; exposes creator screens to non-creators
14. **BUG-HIGH-09** — Google auth URL fetch missing `Origin` header; server CSRF check may reject the request
15. **BUG-HIGH-10** — `welcome-drop.tsx` calls `getPendingReferralCode()` on mount which calls `getStorage()` with no error guard; throws if `initStore()` hasn't resolved, crashing the final onboarding screen for users who have a pending referral
16. **BUG-MED-01** — `refreshAccessToken` in `client.ts` has wrong generic type `<{ expiresIn: number }>` while data is cast to `{ accessToken?: string }`; also posts `null` body which some servers reject
17. **BUG-MED-02** — Home screen `pageTitle` uses hardcoded `colors.neutral[900]`; invisible in dark mode
18. **BUG-MED-03** — Messages screen title and section headers use hardcoded colors; dark mode incompatible
19. **BUG-MED-04** — Profile tab uses no `useColorScheme()`; entire screen has hardcoded light-mode colors throughout
20. **BUG-MED-05** — `rooms.tsx` `fetchRooms` useCallback includes `loading` as dependency; causes stale-closure pagination bug where `loadMore` silently no-ops
21. **BUG-MED-06** — `rooms.tsx` search bar uses `clearButtonMode="while-editing"`; iOS-only prop, no effect on Android
22. **BUG-MED-07** — `rooms.tsx` discovery tab labels are raw English strings, not run through `t()` i18n function
23. **BUG-MED-08** — `GameWebView` exposes JWT in WebView URL query param `?t=TOKEN`; token leaks into server logs, browser history, and HTTP Referer headers
24. **BUG-MED-09** — `ConfettiOverlay` calls `onDone` callback via direct closure capture; if parent re-renders while animation plays, the stale `onDone` fires
25. **BUG-MED-10** — `signIn()` validates refresh token against JWT regex; servers issuing opaque (non-JWT) refresh tokens would trigger a hard error blocking login
26. **BUG-MED-11** — `AnnouncementModal` "Got it" dismiss label is hardcoded English, not translated
27. **BUG-MIN-01** — `friends.tsx` loop variable `t` in `tabs.map((t) => ...)` shadows the `useTranslation()` `t` function; not broken today but a latent translation bug
28. **BUG-MIN-02** — `rooms.tsx` `eslint-disable` comment suppresses the legitimate `react-hooks/exhaustive-deps` warning caused by the `loading`-in-useCallback design; root cause should be fixed rather than suppressed
29. **BUG-MIN-03** — `eas.json` references `./google-service-account.json` for Play Store submission; no check that this file exists; EAS submit fails silently if the file is absent
30. **BUG-MIN-04** — `OfflineBanner` uses `pointerEvents` as a style prop (`pointerEvents: isVisible.value > 0 ? 'auto' : 'none'`); on older React Native versions this must be a View prop, not a style property; deprecated usage on RN 0.74

---

## Detailed Bug Analysis

---

### BUG-CRIT-01 — No auth gate in root layout; unauthenticated users land on tabs (white screen root cause)

**FILES:** `apps/expo/app/_layout.tsx`, `apps/expo/lib/auth/context.tsx`

**FIX:** In `RootLayoutNav`, read `isLoading` from `useAuth()` alongside `user`. While `isLoading` is true, render a full-screen `ActivityIndicator` (or keep the splash visible) to prevent content from flashing. Once loading completes, redirect unauthenticated users: if `!user && !isLoading`, call `router.replace('/auth/login')`. This gives expo-router a definite destination instead of landing everyone on `(tabs)` by default. All tab screens currently expect an authenticated user and fire API calls immediately on mount — without this gate, all those calls 401 simultaneously, React Query floods its cache with error states, and depending on timing, one of those error paths can leave the screen blank. The `isLoading: true` default in `AuthContext` is correct; it just needs to be used in the root layout.

---

### BUG-CRIT-02 — `SplashScreen.hideAsync()` never called; stuck white screen on slow devices

**FILES:** `apps/expo/app/_layout.tsx`

**FIX:** Call `SplashScreen.preventAutoHideAsync()` at the module level in `_layout.tsx` (outside the component), then call `SplashScreen.hideAsync()` once `isLoading` is false AND `initStore()` / `initOfflineDB()` have settled. The current code relies entirely on expo-router's internal auto-hide behavior. On slow or low-memory Android devices, if the async initialization takes longer than expo-router's internal timeout, the splash dismisses before anything is ready, leaving a white screen until the first render completes. With explicit control, the splash stays up until the app is actually ready to show content.

---

### BUG-CRIT-03 — `initStore()` called fire-and-forget; MMKV accessed before init completes; release-build crashes

**FILES:** `apps/expo/app/_layout.tsx` (line 189), `apps/expo/lib/offline/store.ts`, `apps/expo/components/announcements/AnnouncementBanner.tsx` (line 79), `apps/expo/components/announcements/AnnouncementModal.tsx` (line 82), `apps/expo/components/ads/RewardedAdButton.tsx` (line 39)

**FIX:** `initStore()` derives a 256-bit AES key from SecureStore asynchronously. It is called fire-and-forget in a `useEffect` in `RootLayoutNav`, meaning MMKV components mount and run in the same render pass before the key is ready. `RewardedAdButton` calls `storage.getString(AD_DATE_KEY)` synchronously inside a `useEffect` with no try/catch — if `initStore()` hasn't completed, `getStorage()` throws `'initStore() has not been called yet'`, which in React Native propagates as an unhandled error in a `useEffect` (not caught by ErrorBoundary). Fix: wait for `initStore()` to complete before rendering children. Gate the app render (or at minimum the storage-dependent components) behind a `storeReady` state flag that is only set after `initStore()` resolves. Add try/catch around `storage.*` calls in `RewardedAdButton.useEffect`.

---

### BUG-CRIT-04 — Wrong Android package name in `googlePlay.ts`; ALL IAP purchases fail

**FILES:** `apps/expo/lib/payments/googlePlay.ts` (line 48), `apps/expo/app.json`

**FIX:** Change `const APP_PACKAGE_NAME = 'com.zobia.app'` to `'org.zobia.social'` to match `app.json`'s `android.package`. The `verifyPurchaseServerSide` function sends `packageName` to the server, which uses it to query the Google Play Developer API. A mismatched package name causes every verification request to return a "package not found" error, making all coin purchases and subscriptions permanently fail without any user-facing explanation.

---

### BUG-CRIT-05 — `initGooglePlayBilling()` never called; IAP entirely non-functional

**FILES:** `apps/expo/lib/payments/googlePlay.ts`, `apps/expo/app/_layout.tsx`

**FIX:** Call `initGooglePlayBilling()` in `RootLayoutNav` once the user is authenticated (inside `useEffect` with `[user?.id]` dependency, guarded by `Platform.OS === 'android'`). Without this call, `initConnection()` never runs, the global purchase listeners are never registered, and all calls to `purchaseCoins()` or `purchaseSubscription()` silently never resolve (the purchase sheet may or may not open, but the result never comes back to the app). Also call `disconnectGooglePlayBilling()` in the cleanup function of that effect to release the billing connection on sign-out.

---

### BUG-HIGH-01 — `isAdmin` checked as `user?.is_admin` (snake_case) but `AuthUser.isAdmin` is camelCase; admin tab never visible

**FILES:** `apps/expo/app/(tabs)/_layout.tsx` (line 74), `apps/expo/components/layout/SwipeDrawer.tsx` (admin visibility check), `apps/expo/components/admin/AdminSwipeDrawer.tsx`

**FIX:** Replace all occurrences of `user?.is_admin` with `user?.isAdmin`. The `AuthUser` type definition (in `lib/auth/context.tsx` line 72) uses `isAdmin: boolean`. The snake_case access always returns `undefined`, which is falsy, so the admin tab is never rendered even for actual admin accounts. Same fix applies to `SwipeDrawer.tsx` where admin drawer items use the same broken check.

---

### BUG-HIGH-02 — Guild card navigation uses wrong route path

**FILES:** `apps/expo/app/(tabs)/index.tsx` (guild discovery card `router.push`)

**FIX:** Change `router.push(\`/guild/${guild.id}\`)` to `router.push(\`/guilds/${guild.id}\`)`. The route file is `app/guilds/[guildId].tsx` (note the plural `guilds`). The current path `/guild/...` has no matching route file, so expo-router throws a "no such route" navigation error when a user taps any guild discovery card on the home screen.

---

### BUG-HIGH-03 — Creator spotlight navigates to username instead of userId

**FILES:** `apps/expo/app/(tabs)/index.tsx` (creator spotlight section)

**FIX:** Change `router.push(\`/profile/${spotlight.creator.username}\`)` to `router.push(\`/profile/${spotlight.creator.id}\`)`. The dynamic route `app/profile/[userId].tsx` uses a `userId` parameter, not a username. Passing a username would result in a user lookup by ID that returns 404 or the wrong user.

---

### BUG-HIGH-04 — Rewarded ad button reads auth token from wrong store with wrong key

**FILES:** `apps/expo/components/ads/RewardedAdButton.tsx` (lines 72–79)

**FIX:** Replace the raw `fetch()` call and `storage.getString("authToken")` with `apiClient.post('/economy/rewards/ad-reward')`. The auth token is stored in SecureStore under the key `JWT_KEY = 'zobia_jwt'` (set by the Axios request interceptor in `lib/api/client.ts`). The MMKV store has no `"authToken"` key — it's used for other app data. The current code always passes no auth header, so the ad reward endpoint receives an unauthenticated request and returns a 401. Using `apiClient` instead of raw `fetch` eliminates this problem entirely, as the request interceptor handles token injection automatically.

---

### BUG-HIGH-05 — `"use client"` directive in Expo component

**FILES:** `apps/expo/components/ads/RewardedAdButton.tsx` (line 1)

**FIX:** Remove the `"use client"` directive from the top of the file. This is a Next.js React Server Components directive that has no meaning in React Native/Expo. It has no runtime effect here, but its presence means the file was likely ported from the web app and may have other web-specific assumptions that need to be verified (the auth token bug above is a consequence of this).

---

### BUG-HIGH-06 — Telegram login success does not check `onboardingCompleted`; new users bypass onboarding

**FILES:** `apps/expo/app/auth/login.tsx` (line 225 in `startTelegramPoll`)

**FIX:** After `signIn()` succeeds for Telegram, check whether the user needs onboarding, mirroring the Google OAuth callback logic. The `data` response from `/auth/telegram/status` should include an `onboardingCompleted` boolean (same as the mobile token exchange response). If `data.onboardingCompleted === false`, call `router.replace('/onboarding')` instead of `router.replace('/(tabs)')`. Without this, new Telegram users skip the username/city/avatar and vibe-quiz setup steps and land on the home screen with incomplete profiles.

---

### BUG-HIGH-07 — "Edit Profile" button on profile tab has no `onPress` handler

**FILES:** `apps/expo/app/(tabs)/profile.tsx` (line 186–193)

**FIX:** Add `onPress={() => router.push('/profile/edit')}` (or whatever the edit profile route is). The button is rendered and styled correctly but tapping it does nothing. This is a dead UI element that users will repeatedly tap without any response.

---

### BUG-HIGH-08 — Creator Dashboard shortcut shown to all users, not just creators

**FILES:** `apps/expo/app/(tabs)/profile.tsx` (lines 333–347)

**FIX:** Gate the Creator Dashboard `Pressable` behind `{user?.isCreator && (...)}`. Currently it renders for every authenticated user, and non-creators who tap it will navigate to a dashboard screen that shows no data (or an authorization error). The `AuthUser` type has `isCreator: boolean`; use it.

---

### BUG-HIGH-09 — Google auth URL fetch missing `Origin` header; CSRF check may reject request

**FILES:** `apps/expo/app/auth/login.tsx` (line 153)

**FIX:** Replace `await fetch(apiUrl)` with `await apiClient.get(\`/auth/google?platform=mobile&redirect=${encodeURIComponent(redirectUri)}\`)` which automatically adds the `Origin` header via the Axios request interceptor. Alternatively, add the header manually: `{ headers: { 'Origin': env.API_BASE_URL } }`. The server's CORS/CSRF middleware checks the `Origin` header; without it, the request may be rejected with a 403 depending on the server configuration.

---

### BUG-HIGH-10 — `welcome-drop.tsx` reads `getPendingReferralCode()` on mount without error guard; crashes if MMKV not initialized

**FILES:** `apps/expo/app/onboarding/welcome-drop.tsx`, `apps/expo/lib/deeplinks/referral.ts`

**FIX:** Wrap the `getPendingReferralCode()` call in `welcome-drop.tsx` inside a try/catch, or — better — fix the root cause by ensuring `initStore()` is always complete before any screen renders (see BUG-CRIT-03). `getPendingReferralCode()` calls `getItem()` → `getStorage()`. If `initStore()` hasn't resolved its async SecureStore key derivation, `getStorage()` throws. Since `welcome-drop.tsx` is the last step of onboarding, this crashes the app at the moment a referred user would most trigger the code path (they've been onboarded and reach the welcome drop screen before async init completes on a slow device).

---

### BUG-MED-01 — `refreshAccessToken` in `client.ts` has mismatched generic type and sends `null` body

**FILES:** `apps/expo/lib/api/client.ts` (`refreshAccessToken` function)

**FIX:** Change the `apiClient.post` generic type from `<{ expiresIn: number }>` to `<{ accessToken: string }>` to match what the code actually reads. Also replace the `null` body with an empty object `{}` — some server-side body parsers (e.g., express.json()) reject `null` as an invalid JSON body and return a 400, which would be mishandled as an auth failure and trigger a sign-out.

---

### BUG-MED-02 — Home screen title hard-codes light-mode color; invisible in dark mode

**FILES:** `apps/expo/app/(tabs)/index.tsx` (`pageTitle` style)

**FIX:** Replace `color: colors.neutral[900]` in the `pageTitle` StyleSheet with a theme-aware value. Either use `useColorScheme()` and pick the appropriate color, or use the `useTheme()` hook's `colors.text` token which already maps to the correct value for light and dark mode.

---

### BUG-MED-03 — Messages screen title and section headers use hardcoded light-mode colors

**FILES:** `apps/expo/app/(tabs)/messages.tsx` (styles `title` line 418, `sectionTitle` line 449)

**FIX:** The `title` style uses `colors.neutral[900]` and `sectionTitle` uses `colors.neutral[800]`. These are white-in-dark-mode failures. Apply the same `useColorScheme()` pattern used in `quests.tsx` and `friends.tsx` to derive `textPrimary` and apply it to these text elements.

---

### BUG-MED-04 — Profile tab screen has no dark mode support; all colors hardcoded

**FILES:** `apps/expo/app/(tabs)/profile.tsx` (styles: `topBarTitle`, `username`, `displayName`, `metaText`, `sectionTitle`, `trackBarName`, `guildName`, `walletTitle`, `walletSubtitle`, etc.)

**FIX:** Add `const scheme = useColorScheme(); const isDark = scheme === 'dark'` at the top of `ProfileScreen` and derive `textPrimary`, `textSecondary`, `cardBg`, `borderColor` from it, same as `quests.tsx` or `wallet.tsx`. All the named styles use raw hardcoded `colors.neutral[900]` / `colors.neutral[0]` values that are invisible in the opposite color scheme.

---

### BUG-MED-05 — `rooms.tsx` `fetchRooms` includes `loading` in `useCallback` deps; `loadMore` stale-closure pagination bug

**FILES:** `apps/expo/app/(tabs)/rooms.tsx` (lines 193, 239)

**FIX:** Remove `loading` from `fetchRooms`'s `useCallback` dependency array. The early-return guard `if (loading) return;` creates a stale closure: by the time `loadMore` fires via `onEndReached`, the `loading` captured in the closure may be `false` but the `fetchRooms` identity has already changed from a previous `loading=true` cycle, causing the `useCallback` memoization to reference a different function version. Use a `ref` to track loading state inside `fetchRooms` instead of putting it in the dependency array, or restructure to use a reducer pattern. The current `eslint-disable` comment on the `useEffect` is masking this by deliberately breaking the dependency chain.

---

### BUG-MED-06 — `rooms.tsx` search bar uses iOS-only `clearButtonMode`; no clear button on Android

**FILES:** `apps/expo/app/(tabs)/rooms.tsx` (line 344)

**FIX:** Remove `clearButtonMode="while-editing"` (iOS `UITextField` only) and replace with a visible clear button rendered as a sibling `Pressable` inside `searchInputWrapper`, shown when `searchQuery.length > 0`. This makes the clear affordance consistent across Android and iOS.

---

### BUG-MED-07 — Discovery tab labels in `rooms.tsx` are raw untranslated English strings

**FILES:** `apps/expo/app/(tabs)/rooms.tsx` (lines 62–65, `TABS` constant, rendered on line 372)

**FIX:** Move tab label resolution from the constant definition to the render function using `t()`. Since hooks can't be used at module level, either move the label strings to i18n keys and call `t(tab.label)` in the `renderItem`, or convert `TABS` from a constant to a hook-returning value: `function useTabs() { const {t} = useTranslation(); return [...] }`.

---

### BUG-MED-08 — JWT token exposed in WebView URL query parameter

**FILES:** `apps/expo/components/games/GameWebView.tsx` (lines 49, 51)

**FIX:** Remove the `?t=${token}` query parameter from the embed URL. Instead, inject the token only via `injectedJavaScriptBeforeContentLoaded` (already done via `window.__ZOBIA_TOKEN__`) and have the game embed read it from there rather than from the URL. URL query parameters appear in server access logs, are captured in Referer headers when the embed makes sub-requests, and can be captured by third-party scripts in the WebView. The token is already injected into the JS global; the URL parameter is redundant and insecure.

---

### BUG-MED-09 — `ConfettiOverlay` `onDone` closure is not ref-stabilized; may fire stale callback

**FILES:** `apps/expo/components/ui/ConfettiOverlay.tsx` (line 80)

**FIX:** Store `onDone` in a ref and call `onDoneRef.current()` in the `Animated.parallel` start callback, mirroring the pattern already used in `GameWebView` and `useRealtimeChannel`. Currently, if the parent re-renders and passes a new `onDone` function while the confetti animation is running, the `useEffect` dependency array causes the animation to restart (because `onDone` is in `[onDone, particles]`), which resets the confetti every re-render during the animation. Using a ref removes `onDone` from the dep array and eliminates the restart risk.

---

### BUG-MED-10 — `signIn()` validates refresh token as JWT format; blocks login for opaque-token servers

**FILES:** `apps/expo/lib/auth/context.tsx` (lines 276–278)

**FIX:** Remove the refresh token JWT format validation or make it conditional. The access token validation (verifying three dot-separated base64url segments) is appropriate for a JWT. But refresh tokens on many servers (Redis session IDs, opaque UUIDs, etc.) are NOT JWTs and would fail this regex, causing `signIn` to throw and block the user from logging in. If the server issues opaque refresh tokens, this validation must be relaxed or removed for that field.

---

### BUG-MED-11 — `AnnouncementModal` "Got it" dismiss button text is hardcoded English

**FILES:** `apps/expo/components/announcements/AnnouncementModal.tsx` (line 148)

**FIX:** Replace `'Got it'` with a translated string via `useTranslation()` — e.g., `t('announcements.dismiss', 'Got it')`. The component already imports `colors` and `apiClient` but not `useTranslation`. This button text will be in English regardless of the user's locale.

---

### BUG-MIN-01 — `friends.tsx` loop variable shadows i18n `t` function

**FILES:** `apps/expo/app/(tabs)/friends.tsx` (line 275: `tabs.map((t) => ...)`)

**FIX:** Rename the loop variable: `tabs.map((tabItem) => ...)` and update references inside the callback to `tabItem.id`, `tabItem.label`. This doesn't cause a runtime bug today because translations are resolved when building the `tabs` array (before the map), but the shadow makes the code confusing and would cause silent failures if a developer adds a `t('...')` call inside the map callback.

---

### BUG-MIN-02 — `rooms.tsx` `eslint-disable` suppresses a legitimate dependency warning masking BUG-MED-05

**FILES:** `apps/expo/app/(tabs)/rooms.tsx` (line 236)

**FIX:** Once BUG-MED-05 is fixed (removing `loading` from `fetchRooms`'s deps), the `fetchRooms` reference will be stable enough to add properly to the `useEffect` dependency array, and the `eslint-disable-next-line react-hooks/exhaustive-deps` comment can be removed. Never suppress exhaustive-deps warnings without a documented reason — they signal real stale-closure risks.

---

### BUG-MIN-03 — `eas.json` submit profile references `google-service-account.json` without existence check

**FILES:** `apps/expo/eas.json` (line 49)

**FIX:** Ensure `google-service-account.json` exists at the project root (or at the path specified in `eas.json`) before running `eas submit`. Add this file to `.gitignore` if it isn't already (it contains a private key). Consider using EAS Secrets to store the key contents as an environment variable instead of a local file, which is safer for CI/CD pipelines.

---

### BUG-MIN-04 — `OfflineBanner` uses `pointerEvents` as a style prop (deprecated on RN 0.74)

**FILES:** `apps/expo/components/offline/OfflineBanner.tsx` (line 70)

**FIX:** Move `pointerEvents` from the animated style object to a prop on the `Animated.View` component. In React Native 0.74, the `pointerEvents` style property is deprecated in favor of the `pointerEvents` prop on the View component. Since the value is animated (derived from `isVisible.value`), use a `useAnimatedProps` hook from Reanimated to bind it as an animated prop rather than an animated style property.

---

## Summary of Impact

| Severity | Count | Key Impact |
|---|---|---|
| Critical | 5 | White screen on launch, IAP entirely broken |
| High | 10 | Admin invisible, guild nav broken, ad rewards broken, Telegram onboarding skip |
| Medium | 11 | Dark mode failures on 3 screens, pagination bug, JWT leak, i18n gaps |
| Minor | 4 | Code quality, latent shadow bugs, build config |

---

*Report generated: June 25, 2026 — 12:00 PM*
*Analyst: Claude Code (forensic analysis of apps/expo/ source tree)*
