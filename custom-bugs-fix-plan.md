# Zobia Social — Expo App Bug Fix Plan

**Date:** June 25, 2026 — 12:00 PM
**Based on:** custom-bugs-report.md (forensic analysis, same date)
**Execution order:** Critical → High → Medium → Minor
**Rule:** Fix one group before moving to the next; re-test smoke paths after each group.

---

## Pre-Work Checklist

- [ ] Confirm current branch is clean (`git status`)
- [ ] Run a fresh Android debug build on an emulator (API 36) and record the current failure baseline (stuck white screen)
- [ ] Keep the bug report open alongside this plan; each task references a bug ID from that report

---

## Group 1 — CRITICAL (fix first, in order)

These five bugs cause immediate breakage: a stuck white screen on launch and a completely non-functional IAP system. They must be fixed in the order listed because later fixes depend on earlier ones (e.g., `storeReady` flag needed by BUG-CRIT-03 must exist before BUG-CRIT-05 adds another `useEffect`).

---

### TASK-C01 — Control SplashScreen lifecycle explicitly
**Refs:** BUG-CRIT-02
**Files to edit:** `apps/expo/app/_layout.tsx`

Steps:
1. At module level (top of file, before the component), add `SplashScreen.preventAutoHideAsync()` wrapped in a try/catch (it throws if called too late).
2. Introduce a `appReady` state flag that starts as `false`.
3. Set `appReady = true` only after ALL async initializations in the `useEffect` have settled (store init, DB init, ads init, auth check).
4. In a `useEffect` that depends on `[appReady]`, call `SplashScreen.hideAsync()` when `appReady` is `true`.
5. Do **not** render the `Stack` navigator until `appReady` is `true` — render `null` or a plain `View` instead.

Verify: On a slow emulator with throttled CPU, the splash screen should hold until the `useEffect` chain completes, then dismiss once.

---

### TASK-C02 — Add auth gate to root layout
**Refs:** BUG-CRIT-01
**Files to edit:** `apps/expo/app/_layout.tsx`

Steps:
1. In `RootLayoutNav`, destructure `{ user, isLoading }` from `useAuth()`.
2. If `isLoading` is `true`, return `null` (the splash is still showing at this point from TASK-C01).
3. Add a `useEffect` that runs whenever `[user, isLoading]` changes: if `!isLoading && !user`, call `router.replace('/auth/login')`.
4. Ensure this redirect fires before any tab screen mounts, so no API call fires unauthenticated.

Verify: Force-clear SecureStore on the emulator (or fresh install), launch app. Should redirect to login with no white screen and no 401 floods in Logcat.

---

### TASK-C03 — Fix MMKV init race condition; gate renders on `storeReady`
**Refs:** BUG-CRIT-03
**Files to edit:** `apps/expo/app/_layout.tsx`, `apps/expo/components/ads/RewardedAdButton.tsx`

Steps:
1. In `_layout.tsx`, add a `storeReady` boolean state (starts `false`).
2. In the `useEffect` that calls `initStore()`, `await` it properly and set `storeReady = true` in the `.then()` / after the `await`. (If `initStore()` throws, log the error; `storeReady` stays `false` and the app should show an error state or retry.)
3. Pass `storeReady` as a prop or via a new context so that storage-dependent components know when they can safely call `getStorage()`. The simplest approach: do not render children at all until `storeReady && appReady` from TASK-C01.
4. In `RewardedAdButton.tsx`, add a try/catch around the `storage.getString(AD_DATE_KEY)` call in the `useEffect` so that even if `getStorage()` throws, the component degrades gracefully (just skips the ad date check) instead of crashing.

Verify: In Logcat, confirm `initStore()` resolves before any MMKV read. Confirm no `'initStore() has not been called yet'` error appears.

---

### TASK-C04 — Fix IAP package name mismatch
**Refs:** BUG-CRIT-04
**Files to edit:** `apps/expo/lib/payments/googlePlay.ts`

Steps:
1. On line 48, change `const APP_PACKAGE_NAME = 'com.zobia.app'` to `const APP_PACKAGE_NAME = 'org.zobia.social'`.
2. Cross-check `app.json` field `android.package` to confirm the new value matches exactly.
3. No other files need changing for this fix.

Verify: In your backend logs, verify the `packageName` field in purchase verification requests now reads `org.zobia.social`.

---

### TASK-C05 — Wire up IAP billing initialization
**Refs:** BUG-CRIT-05
**Files to edit:** `apps/expo/app/_layout.tsx`, `apps/expo/lib/payments/googlePlay.ts`

Steps:
1. In `_layout.tsx`, inside `RootLayoutNav`, add a `useEffect` with `[user?.id]` as the dependency array.
2. In that effect, guard with `if (!user || Platform.OS !== 'android') return;`.
3. Call `initGooglePlayBilling()` and await it (or handle the returned Promise with `.catch`).
4. Return a cleanup function that calls `disconnectGooglePlayBilling()`.
5. Confirm `initGooglePlayBilling()` sets up the purchase update listener and error listener (it should already be written correctly — this task is purely about calling it).

Verify: Tap a coin purchase button; confirm the Google Play billing sheet appears. Check Logcat for `[billing] connected` log from `initGooglePlayBilling`.

---

## Group 2 — HIGH (fix after all criticals pass)

Run a smoke test after Group 1: fresh install → login → tabs load → no crash. Only then proceed.

---

### TASK-H01 — Fix `isAdmin` snake_case → camelCase across all admin checks
**Refs:** BUG-HIGH-01
**Files to edit:** `apps/expo/app/(tabs)/_layout.tsx`, `apps/expo/components/layout/SwipeDrawer.tsx`, `apps/expo/components/admin/AdminSwipeDrawer.tsx`

Steps:
1. Search all three files for `is_admin` and replace every occurrence with `isAdmin`.
2. Do the same search repo-wide to catch any other files that may have copied the pattern: `grep -r "is_admin" apps/expo/`.
3. No type changes needed — `AuthUser.isAdmin` already exists.

Verify: Log in as an admin account. Confirm the admin tab and admin drawer items appear.

---

### TASK-H02 — Fix guild navigation path (singular → plural)
**Refs:** BUG-HIGH-02
**Files to edit:** `apps/expo/app/(tabs)/index.tsx`

Steps:
1. Find `router.push(\`/guild/${guild.id}\`)` and change `/guild/` to `/guilds/`.
2. Confirm the target file `app/guilds/[guildId].tsx` exists and the param name is `guildId`.
3. If the param name in the route file is different (e.g., `id`), adjust the URL accordingly — expo-router derives the param name from the filename brackets.

Verify: Tap a guild card on the home screen; confirm navigation to the guild detail screen.

---

### TASK-H03 — Fix creator spotlight navigation (username → userId)
**Refs:** BUG-HIGH-03
**Files to edit:** `apps/expo/app/(tabs)/index.tsx`

Steps:
1. Find `router.push(\`/profile/${spotlight.creator.username}\`)` and change `.username` to `.id` (or whatever the creator object's user ID field is called — check the API response type).
2. Confirm `app/profile/[userId].tsx` uses `userId` as the param, and that this param is used for an API lookup by ID.

Verify: Tap a creator spotlight card; confirm the correct profile loads.

---

### TASK-H04 — Fix rewarded ad auth token retrieval and HTTP client
**Refs:** BUG-HIGH-04
**Files to edit:** `apps/expo/components/ads/RewardedAdButton.tsx`

Steps:
1. Remove the `storage.getString("authToken")` call and the raw `fetch()` call entirely.
2. Replace the reward claim HTTP call with `await apiClient.post('/economy/rewards/ad-reward', { adUnit: adUnitId })` (adjust endpoint and payload to match your API).
3. The `apiClient` request interceptor will attach the correct JWT from SecureStore automatically.
4. Wrap the `apiClient.post` in a try/catch and surface any error to the user (toast or alert).

Verify: Watch a rewarded ad to completion; confirm a 200 response from `/economy/rewards/ad-reward` in the network logs (not a 401).

---

### TASK-H05 — Remove `"use client"` directive from Expo component
**Refs:** BUG-HIGH-05
**Files to edit:** `apps/expo/components/ads/RewardedAdButton.tsx`

Steps:
1. Delete line 1: `"use client";` (or `'use client';`).
2. Scan the rest of the file for any other Next.js-specific patterns (`useRouter` from `next/navigation`, `Image` from `next/image`, etc.) and replace or remove them.

Verify: TypeScript build (`npx tsc --noEmit`) in `apps/expo/` shows no new errors.

---

### TASK-H06 — Add onboarding gate to Telegram login success path
**Refs:** BUG-HIGH-06
**Files to edit:** `apps/expo/app/auth/login.tsx`

Steps:
1. Find the `startTelegramPoll` success branch where `router.replace('/(tabs)')` is called.
2. Before that redirect, read `data.onboardingCompleted` from the Telegram status API response.
3. If `data.onboardingCompleted === false`, call `router.replace('/onboarding')` instead.
4. This mirrors the Google OAuth callback pattern already in the file — copy that conditional structure exactly.

Verify: Use a fresh Telegram account to log in; confirm onboarding screens appear.

---

### TASK-H07 — Add `onPress` handler to "Edit Profile" button
**Refs:** BUG-HIGH-07
**Files to edit:** `apps/expo/app/(tabs)/profile.tsx`

Steps:
1. Find the "Edit Profile" `Pressable` (lines 186–193 in the report).
2. Add `onPress={() => router.push('/profile/edit')}` — confirm the route path by checking the file that exists under `app/profile/edit.tsx` or `app/profile/edit/index.tsx`.
3. If the route does not exist yet, navigate to the closest equivalent (e.g., a settings screen with profile editing).

Verify: Tap "Edit Profile" in the profile tab; confirm navigation occurs.

---

### TASK-H08 — Gate Creator Dashboard shortcut behind `isCreator` flag
**Refs:** BUG-HIGH-08
**Files to edit:** `apps/expo/app/(tabs)/profile.tsx`

Steps:
1. Find the Creator Dashboard `Pressable` block (lines 333–347 in the report).
2. Wrap the entire block with `{user?.isCreator && ( ... )}`.
3. No other changes needed.

Verify: Log in as a non-creator; confirm the Creator Dashboard block is absent. Log in as a creator; confirm it appears.

---

### TASK-H09 — Add `Origin` header to Google auth URL fetch
**Refs:** BUG-HIGH-09
**Files to edit:** `apps/expo/app/auth/login.tsx`

Steps:
1. Find `await fetch(apiUrl)` in `handleGoogleLogin`.
2. Replace it with `await apiClient.get(\`/auth/google?platform=mobile&redirect=${encodeURIComponent(redirectUri)}\`)` so the Axios interceptor adds the `Origin` header automatically.
3. Update the destructuring of the response to use `data.url` or whatever the property name is (Axios wraps the body in `.data`).

Verify: Tap "Sign in with Google" on a real device; confirm the browser auth sheet opens (no 403 in logs).

---

### TASK-H10 — Guard `getPendingReferralCode()` in `welcome-drop.tsx`
**Refs:** BUG-HIGH-10
**Files to edit:** `apps/expo/app/onboarding/welcome-drop.tsx`

Steps:
1. Wrap the `getPendingReferralCode()` call (and any subsequent `storage` access) in a try/catch.
2. On catch, log the error and proceed as if there is no pending referral — do not crash.
3. This is a belt-and-suspenders fix on top of TASK-C03; it ensures this specific crash path is safe even if the broader init sequencing changes.

Verify: Open the app on a slow emulator with CPU throttling; proceed through onboarding to the welcome-drop screen. Confirm no crash.

---

## Group 3 — MEDIUM (fix after all criticals and highs pass)

Run a full feature smoke test after Group 2: login both paths, navigate all tabs, send a message. Only then proceed.

---

### TASK-M01 — Fix `refreshAccessToken` generic type and null body
**Refs:** BUG-MED-01
**Files to edit:** `apps/expo/lib/api/client.ts`

Steps:
1. Change `apiClient.post<{ expiresIn: number }>(...)` to `apiClient.post<{ accessToken: string }>(...)`.
2. Change the request body from `null` to `{}` (empty object).
3. Ensure the `accessToken` read (`res.data.accessToken`) is still correct after the type change.

---

### TASK-M02 — Fix home screen dark mode: `pageTitle` color
**Refs:** BUG-MED-02
**Files to edit:** `apps/expo/app/(tabs)/index.tsx`

Steps:
1. Add `const scheme = useColorScheme();` at the top of the screen component.
2. In the `pageTitle` StyleSheet entry (or inline style), replace `color: colors.neutral[900]` with a conditional: `color: scheme === 'dark' ? colors.neutral[0] : colors.neutral[900]` — or use the `useTheme()` hook's `colors.text` token if it exists in the project.

---

### TASK-M03 — Fix messages screen dark mode: `title` and `sectionTitle`
**Refs:** BUG-MED-03
**Files to edit:** `apps/expo/app/(tabs)/messages.tsx`

Steps:
1. Add `useColorScheme()` to the component.
2. Replace hardcoded `colors.neutral[900]` in `title` with a theme-aware value.
3. Replace hardcoded `colors.neutral[800]` in `sectionTitle` with a theme-aware value.
4. Check all other text styles in this file for the same pattern while you're in there.

---

### TASK-M04 — Fix profile screen dark mode: all hardcoded colors
**Refs:** BUG-MED-04
**Files to edit:** `apps/expo/app/(tabs)/profile.tsx`

Steps:
1. Add `const scheme = useColorScheme(); const isDark = scheme === 'dark';` near the top of `ProfileScreen`.
2. Audit every `StyleSheet.create()` entry for `colors.neutral[900]`, `colors.neutral[0]`, `colors.neutral[100]`, `colors.neutral[800]` and replace with theme-aware variants.
3. Cross-check against `quests.tsx` or `wallet.tsx` (whichever has the most complete dark mode implementation) and adopt the same variable naming pattern to keep consistency.

---

### TASK-M05 — Fix `fetchRooms` stale-closure pagination bug
**Refs:** BUG-MED-05
**Files to edit:** `apps/expo/app/(tabs)/rooms.tsx`

Steps:
1. Replace the `loading` state variable used inside `fetchRooms` with a ref: `const loadingRef = useRef(false)`.
2. Set `loadingRef.current = true` when loading starts and `loadingRef.current = false` when it ends.
3. Change the early-return guard from `if (loading) return;` to `if (loadingRef.current) return;`.
4. Remove `loading` from the `useCallback` dependency array.
5. The `eslint-disable` comment on the `useEffect` can now be removed (see TASK-MIN02).

---

### TASK-M06 — Fix Android-incompatible `clearButtonMode` on search input
**Refs:** BUG-MED-06
**Files to edit:** `apps/expo/app/(tabs)/rooms.tsx`

Steps:
1. Remove the `clearButtonMode="while-editing"` prop from the `TextInput`.
2. Wrap the `TextInput` in a `View` (the existing `searchInputWrapper` or a new one).
3. Add a sibling `Pressable` that renders a clear icon (e.g., `✕`), visible only when `searchQuery.length > 0`, with `onPress={() => setSearchQuery('')}`.

---

### TASK-M07 — Translate discovery tab labels in `rooms.tsx`
**Refs:** BUG-MED-07
**Files to edit:** `apps/expo/app/(tabs)/rooms.tsx`

Steps:
1. Move the tab label strings to i18n translation files (all 9 locales including Arabic).
2. Replace the `TABS` constant's string labels with i18n keys (e.g., `'rooms.tabs.discover'`).
3. In the render function where tab labels are displayed, call `t(tab.labelKey)` instead of using `tab.label` directly.
4. Alternatively, convert `TABS` to a function that uses `useTranslation` — either approach is acceptable.

---

### TASK-M08 — Remove JWT from WebView URL query parameter
**Refs:** BUG-MED-08
**Files to edit:** `apps/expo/components/games/GameWebView.tsx`

Steps:
1. Remove the `?t=${token}` segment from the embed URL construction.
2. Confirm the game embed already reads `window.__ZOBIA_TOKEN__` from the `injectedJavaScriptBeforeContentLoaded` prop (it should — check this).
3. If the game embed requires a different delivery mechanism, use `postMessage` instead of the URL.
4. Test that the game still loads correctly without the URL param.

---

### TASK-M09 — Stabilize `ConfettiOverlay` `onDone` callback via ref
**Refs:** BUG-MED-09
**Files to edit:** `apps/expo/components/ui/ConfettiOverlay.tsx`

Steps:
1. Add `const onDoneRef = useRef(onDone);`.
2. Add a `useEffect` that updates `onDoneRef.current = onDone;` whenever `onDone` changes.
3. In the `Animated.parallel` start callback, call `onDoneRef.current?.()` instead of `onDone()`.
4. Remove `onDone` from the main `useEffect`'s dependency array (only `particles` and a stable trigger should remain).

---

### TASK-M10 — Remove or relax refresh token JWT format validation
**Refs:** BUG-MED-10
**Files to edit:** `apps/expo/lib/auth/context.tsx`

Steps:
1. Find `signIn()` lines 276–278 where the refresh token is validated against the JWT regex.
2. Remove that validation block (or comment it out with a note explaining why).
3. If you control the backend and it definitively always issues JWT refresh tokens, you may keep the validation, but add a clear comment documenting this coupling so a future backend change does not silently break logins.

---

### TASK-M11 — Translate `AnnouncementModal` dismiss button text
**Refs:** BUG-MED-11
**Files to edit:** `apps/expo/components/announcements/AnnouncementModal.tsx`

Steps:
1. Add `const { t } = useTranslation();` to the component (import `useTranslation` from `react-i18next`).
2. Add an i18n key `announcements.dismiss` with value `Got it` to all locale files.
3. Replace the hardcoded `'Got it'` string with `t('announcements.dismiss')`.

---

## Group 4 — MINOR (fix last)

Do these as a final cleanup pass. None of these cause crashes or incorrect behavior in production.

---

### TASK-MIN01 — Rename `friends.tsx` loop variable to avoid shadowing `t`
**Refs:** BUG-MIN-01
**Files to edit:** `apps/expo/app/(tabs)/friends.tsx`

Steps:
1. Find `tabs.map((t) => ...)` on line 275.
2. Rename the parameter to `tabItem` and update all usages inside the callback.

---

### TASK-MIN02 — Remove `eslint-disable` suppressing `react-hooks/exhaustive-deps` in `rooms.tsx`
**Refs:** BUG-MIN-02
**Files to edit:** `apps/expo/app/(tabs)/rooms.tsx`

Steps:
1. After TASK-M05 is complete (the actual root cause is fixed), delete the `// eslint-disable-next-line react-hooks/exhaustive-deps` comment on the `useEffect`.
2. Add `fetchRooms` properly to the `useEffect` dependency array.
3. Run `npm run lint` and confirm no remaining exhaustive-deps warnings in this file.

---

### TASK-MIN03 — Secure `eas.json` Google service account key handling
**Refs:** BUG-MIN-03
**Files to edit:** `apps/expo/eas.json`, `.gitignore`

Steps:
1. Confirm `google-service-account.json` is listed in `.gitignore` (it contains a private key and must never be committed).
2. For CI/CD, consider migrating to EAS Secrets: store the JSON contents as an EAS Secret named `GOOGLE_SERVICE_ACCOUNT_JSON` and reference it from `eas.json` using `"serviceAccountKeyPath": "/run/secrets/GOOGLE_SERVICE_ACCOUNT_JSON"` or the equivalent EAS Secrets mechanism.
3. Document in the team README how to obtain and place this file for local `eas submit` runs.

---

### TASK-MIN04 — Fix deprecated `pointerEvents` style usage in `OfflineBanner`
**Refs:** BUG-MIN-04
**Files to edit:** `apps/expo/components/offline/OfflineBanner.tsx`

Steps:
1. Remove `pointerEvents` from the animated style object.
2. Use `useAnimatedProps` from `react-native-reanimated` to create an animated prop that sets `pointerEvents` on the `Animated.View` as a **prop**, not a style property.
3. Confirm the banner becomes non-interactive when hidden (this is the original intent of the `pointerEvents: 'none'` usage).

---

## Post-Fix Verification Checklist

Run after all four groups are complete:

- [ ] Fresh install on Android API 36 emulator — no white screen, splash dismisses correctly
- [ ] Unauthenticated launch → redirected to login screen
- [ ] Email login → tabs load, no 401 errors in Logcat
- [ ] Telegram login (new account) → onboarding screens appear
- [ ] Google OAuth login → tabs load
- [ ] Admin account login → admin tab and drawer items visible
- [ ] Non-admin, non-creator account → no Creator Dashboard shortcut on profile tab
- [ ] Creator account → Creator Dashboard shortcut visible
- [ ] Tap guild card on home → guild detail screen loads (not "no such route")
- [ ] Tap creator spotlight → correct creator profile loads
- [ ] Watch rewarded ad to completion → reward credited (200 from reward endpoint, not 401)
- [ ] Tap a coin purchase → Google Play billing sheet appears
- [ ] Complete a coin purchase → server verification succeeds (check backend logs for `org.zobia.social`)
- [ ] Toggle system dark mode → home screen, messages screen, profile screen all render correctly
- [ ] Send a message offline → reconnect → message syncs without crash
- [ ] Navigate through all 9 locale settings — rooms discovery tab labels are translated, announcement modal dismiss button is translated
- [ ] `npm run typecheck` in `apps/expo/` — zero errors
- [ ] `npm run lint` in `apps/expo/` — zero `react-hooks/exhaustive-deps` suppressions remaining for fixed files

---

*Fix plan generated: June 25, 2026 — 12:00 PM*
*Source: custom-bugs-report.md (same date) — 30 bugs, 4 severity levels*
*All tasks are ready to execute in order. DO NOT begin until this plan is reviewed and approved.*
