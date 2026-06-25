# Zobia Expo App — Bug Fix Plan
**Generated:** June 25, 2026 — 10:08 AM  
**Based on:** custom-bugs-report.md (same date)  
**Total issues:** 37  
**DO NOT begin any fix until this plan has been reviewed and approved.**

---

## Execution Strategy

Bugs are grouped into **5 phases** ordered by severity and dependency:

| Phase | Theme | Bugs | Risk |
|-------|-------|------|------|
| 1 | Critical auth / key regressions | 5 bugs | Low (isolated key string changes) |
| 2 | Critical payments & Play Store compliance | 4 bugs | High (billing flow refactor) |
| 3 | Critical security | 3 bugs | Medium |
| 4 | Broken navigation & API calls | 8 bugs | Low–Medium |
| 5 | UX, config & reliability | 17 bugs | Low |

Each phase can be developed on the same feature branch. **Do not ship Phase 2 to production without a full Play Store sandbox billing test.**

---

## Phase 1 — Critical Auth Key Regressions
*These are one-line string fixes that unblock 2FA, rewarded ads, and data export for all users. Fix first.*

### TASK-1.1 — Fix wrong MMKV key in RewardedAdButton (BUG-AUTH-01, BUG-UI-08, BUG-ENV-02)
**Files:** `apps/expo/components/ads/RewardedAdButton.tsx`

1. Remove the `"use client";` directive at the top of the file.
2. Delete the `const token = storage.getString('authToken')` line and remove the manual `Authorization` header construction.
3. Replace the raw `fetch(...)` call with `apiClient.post(...)` — the Axios interceptor attaches the JWT automatically.
4. Remove `const API_URL = process.env.EXPO_PUBLIC_API_URL ?? ''` — it is undefined on mobile. The `apiClient` base URL is already configured.
5. Test: trigger a rewarded ad, complete it, verify the reward POST reaches the server with a valid Authorization header.

---

### TASK-1.2 — Fix wrong MMKV key in settings/index.tsx (BUG-AUTH-02, BUG-AUTH-03, BUG-ENV-01, BUG-SEC-03, BUG-UI-06-settings)
**Files:** `apps/expo/app/settings/index.tsx`

1. Remove `const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? ''` from the top of the file.
2. In `TwoFactorSection`: replace `storage.getString('authToken')` with `apiClient.post/delete(...)` calls — remove the manual token retrieval and raw `fetch`.
3. In `PrivacyDataSection`: same — replace `storage.getString('authToken')` with `apiClient.post(...)` for the data export request.
4. In `handleDeleteAccount`: replace `Alert.prompt(...)` with a custom `Modal` containing a `TextInput` (user types "DELETE" to confirm) and two buttons: Cancel and Confirm. Wire the Confirm button to the delete API call via `apiClient`.
5. Verify the "Change Password" row — either implement it (navigate to a change-password screen, or call the appropriate API) or hide it until it is ready. Do not leave a dead placeholder `Alert.alert('TODO')` in production.
6. Test each settings section on a physical Android device.

---

### TASK-1.3 — Consolidate token refresh to eliminate race (BUG-AUTH-04)
**Files:** `apps/expo/lib/auth/context.tsx`, `apps/expo/lib/api/client.ts`

1. Extract the token refresh logic from `context.tsx`'s `silentRefresh()` into a shared `lib/auth/refresh.ts` module that exports a single `refreshAccessToken()` function (or confirm `client.ts`'s version is the canonical one).
2. In `context.tsx`, replace the independent `fetch`-based refresh with a call to the shared `refreshAccessToken()`.
3. Ensure the `refreshPromise` singleton guard in `client.ts` covers both callers — i.e., if `context.tsx`'s timer fires while `client.ts` is already mid-refresh, the timer call awaits the existing promise rather than starting a new one.
4. Test by simulating a 401 response while the periodic refresh timer fires simultaneously (use a mock or a Charles/Proxyman throttle rule).

---

### TASK-1.4 — Fix Telegram login onboarding bypass (BUG-AUTH-05)
**Files:** `apps/expo/app/auth/login.tsx`

1. After successful Telegram OAuth callback, read the user object returned by the auth API.
2. If `user.onboardingComplete === false` (or however the backend signals a new user), push to `/onboarding` instead of the home tab.
3. Mirror the exact logic used by the email/Google login paths.

---

## Phase 2 — Payments & Play Store Compliance
*These fixes are required before any Play Store submission. The coin-store Paystack redirect is a policy violation that can cause app removal.*

### TASK-2.1 — Fix APP_PACKAGE_NAME mismatch (BUG-PAY-01)
**Files:** `apps/expo/lib/payments/googlePlay.ts`

1. Change `APP_PACKAGE_NAME = 'com.zobia.app'` to `APP_PACKAGE_NAME = 'org.zobia.social'`.
2. Verify all server-side purchase verification calls now receive the correct package name.
3. Re-test purchase validation in Google Play sandbox.

---

### TASK-2.2 — Initialize Google Play Billing at app startup (BUG-PAY-02)
**Files:** `apps/expo/app/_layout.tsx`, `apps/expo/lib/payments/googlePlay.ts`

1. Import `initGooglePlayBilling` in `_layout.tsx`.
2. Call it during the app initialization sequence, alongside `initializeAds()` and `initOfflineDB()`.
3. Guard with `Platform.OS === 'android'` since billing is Android-only.
4. Remove the redundant `initGooglePlayBilling()` call from `subscription.tsx` (it will already be initialized, but add a guard there too in case of fast cold start, to avoid double-init errors — check if the library's `initConnection()` is idempotent).

---

### TASK-2.3 — Migrate coin purchases to Google Play Billing (BUG-PAY-03)
**Files:** `apps/expo/app/economy/store.tsx`

1. Remove the `Linking.openURL(...)` Paystack redirect for coin packages entirely.
2. Define coin product IDs in Google Play Console as consumable in-app products (e.g., `zobia_coins_100`, `zobia_coins_500`, etc.).
3. Implement the purchase flow using `react-native-iap`'s `requestPurchase()` for consumables, following the same pattern as subscription purchases in `subscription.tsx`.
4. On purchase success, call the backend to credit the coins (pass the Google Play purchase token for server-side verification).
5. Call `finishTransaction()` after the server confirms the credit to acknowledge the purchase to Google.
6. Test the full flow in Google Play sandbox: purchase → server credit → acknowledgement.

---

### TASK-2.4 — Fix Google Play Billing connection leak (BUG-PAY-04)
**Files:** `apps/expo/lib/payments/googlePlay.ts`, `apps/expo/app/_layout.tsx`

1. In `_layout.tsx`, add an `AppState` event listener for `'background'` / `'inactive'` transitions.
2. On app going to background (or on sign-out), call `disconnectGooglePlayBilling()`.
3. On app returning to foreground, if billing was disconnected, call `initGooglePlayBilling()` again.
4. Alternatively, if the library supports it, simply let the library manage the lifecycle and call `endConnection()` only on explicit sign-out / app close.

---

## Phase 3 — Security Fixes

### TASK-3.1 — Remove JWT from GameWebView URL (BUG-SEC-01)
**Files:** `apps/expo/components/games/GameWebView.tsx`

1. Remove the `?t=<JWT>` query parameter from the WebView source URL.
2. Implement a secure handshake: after the WebView fires its `onLoad` event, use `webViewRef.current.postMessage(JSON.stringify({ type: 'AUTH', token }))` to send the token over the JavaScript bridge.
3. On the game page side, listen for `window.addEventListener('message', ...)` and use the received token for authenticated API calls.
4. Alternatively, have the backend issue a short-lived (60-second) session code via `apiClient` before loading the WebView, pass the code in the URL, and have the game page exchange it for a full session server-side.

---

### TASK-3.2 — Restrict GameWebView origin whitelist (BUG-SEC-02)
**Files:** `apps/expo/components/games/GameWebView.tsx`

1. Replace `originWhitelist={['*']}` with an explicit list of allowed origins, e.g., `originWhitelist={['https://game.zobia.app', 'https://zobia.vercel.app']}`.
2. Add an `onShouldStartLoadWithRequest` handler that blocks any navigation to origins not in the whitelist, returning `false` for unknown origins.

---

### TASK-3.3 — Fix Alert.prompt on Android in delete-account flow (BUG-SEC-03)
*(Already covered in TASK-1.2 — ensure the Modal solution is implemented there.)*

---

## Phase 4 — Broken Navigation & API Calls

### TASK-4.1 — Fix admin tab camelCase/snake_case mismatch (BUG-ROUTE-01)
**Files:** `apps/expo/app/(tabs)/_layout.tsx`

1. Find the `is_admin` check in the tab layout.
2. Change it to `user.isAdmin` (matching the `AuthUser` TypeScript interface).
3. Verify the admin tab appears for admin accounts and is hidden for regular users.

---

### TASK-4.2 — Fix VALID_PUSH_ROUTES (BUG-ROUTE-02)
**Files:** `apps/expo/app/_layout.tsx`

1. Remove `/inbox` and `/inbox/[id]` from the `VALID_PUSH_ROUTES` array.
2. Add `/(tabs)/messages` and `/messages/[conversationId]` (and any other real routes that push notifications target).
3. Test by sending a test push notification targeting the messages route and verifying it navigates correctly.

---

### TASK-4.3 — Fix guild navigation route (BUG-ROUTE-03)
**Files:** `apps/expo/app/(tabs)/index.tsx`

1. Change `` router.push(`/guild/${guild.id}`) `` to `` router.push(`/guilds/${guild.id}`) ``.
2. Verify the guild detail screen loads correctly after tapping a guild card.

---

### TASK-4.4 — Fix Admin "User Area" navigation route (BUG-ROUTE-04)
**Files:** `apps/expo/app/(tabs)/admin.tsx`

1. Change `router.push('/home')` to `router.push('/(tabs)')`.
2. Verify the navigation lands on the main home tab.

---

### TASK-4.5 — Fix room message report endpoint (BUG-API-01)
**Files:** `apps/expo/app/rooms/[roomId].tsx`

1. Confirm the correct backend endpoint for reporting a message with the API team (e.g., `POST /messages/${messageId}/report` or `POST /rooms/${roomId}/messages/${messageId}/report`).
2. Update the Axios call accordingly.
3. Test the report flow: tap Report on a message, confirm the backend receives the correct message ID and creates a report record.

---

### TASK-4.6 — Fix rooms search to use name/search param (BUG-API-02)
**Files:** `apps/expo/app/(tabs)/rooms.tsx`

1. Confirm with the backend team which query parameter is used for room name search (e.g., `search`, `name`, or `q`).
2. Update the query param in the Axios call from `category` to the correct param name.
3. Ensure the category filter (if it exists as a separate UI element) still uses the `category` param.
4. Test by typing a room name in the search bar and verifying relevant rooms appear.

---

### TASK-4.7 — Fix HD Send toggle double API call (BUG-API-03)
**Files:** `apps/expo/app/settings/index.tsx`

1. Identify which of the two PATCH calls is the canonical one (`/users/me/settings` or `/settings`).
2. Remove the duplicate call. Keep only one.
3. Test by toggling the HD Send switch and checking the network tab for a single request.

---

### TASK-4.8 — Normalize contact phone numbers to E.164 (BUG-API-04)
**Files:** `apps/expo/app/onboarding/index.tsx`

1. Add `libphonenumber-js` to `apps/expo/package.json` dependencies.
2. When processing the contacts array, call `parsePhoneNumberFromString(rawNumber, deviceRegion)` and use `.format('E.164')` for numbers that parse successfully.
3. Skip (or log and skip) numbers that cannot be parsed.
4. Use `expo-localization`'s `getLocales()[0].regionCode` as the fallback region for numbers without a country code.
5. Test with a mix of domestic and international numbers to verify normalization.

---

## Phase 5 — UX, Configuration & Reliability

### TASK-5.1 — Add onPress to Profile "Edit Profile" button (BUG-UI-01)
**Files:** `apps/expo/app/(tabs)/profile.tsx`

1. Determine the correct route for profile editing (create `app/profile/edit.tsx` if it doesn't exist).
2. Add `onPress={() => router.push('/profile/edit')}` to the "Edit Profile" Pressable.
3. Implement the edit-profile screen if absent (fields: display name, bio, avatar upload).

---

### TASK-5.2 — Fix gifts FlatList refreshing prop (BUG-UI-02)
**Files:** `apps/expo/app/(tabs)/gifts.tsx`

1. Change `refreshing={isLoading}` to `refreshing={isRefetching}` on the FlatList.
2. Pull-to-refresh test: after initial load, pull down and verify the spinner appears and data reloads.

---

### TASK-5.3 — Add debounce to room GIF search (BUG-UI-03)
**Files:** `apps/expo/app/rooms/[roomId].tsx`

1. Add a `debounceTimerRef = useRef<ReturnType<typeof setTimeout>>(null)` at the top of the component.
2. In the GIF search `onChangeText` handler, clear the existing timer and set a new 350ms timer before calling the API.
3. This mirrors the pattern already in `messages/[conversationId].tsx`.

---

### TASK-5.4 — Fix KeyboardAvoidingView behavior on Android (BUG-UI-04)
**Files:** `apps/expo/app/rooms/[roomId].tsx`

1. Change `behavior='height'` to `behavior='padding'`.
2. Test message input keyboard behavior on Android: keyboard should push the input up without layout jumping.

---

### TASK-5.5 — Guard dailyLoginMutation to once per session (BUG-UI-05)
**Files:** `apps/expo/app/(tabs)/index.tsx`

1. Before calling `dailyLoginMutation.mutate()`, read `STORE_KEYS.LAST_SYNC_TIMESTAMP` (or add a new `DAILY_LOGIN_DATE` key) from MMKV.
2. If the stored date equals today's date (`new Date().toISOString().slice(0, 10)`), skip the mutation.
3. On mutation success, write today's date to that MMKV key.

---

### TASK-5.6 — Remove dead toast condition (BUG-UI-06)
**Files:** `apps/expo/app/(tabs)/index.tsx`

1. Find the `if (!visible && opacity === null)` condition.
2. Remove the dead branch (the `opacity === null` check) or replace with a proper boolean state variable.
3. Confirm toast show/hide behavior still works as intended.

---

### TASK-5.7 — Fix double moment confirm dialog trigger (BUG-UI-07)
**Files:** `apps/expo/app/messages/[conversationId].tsx`

1. Audit all event bindings on the "confirm moment" UI element.
2. Ensure only one event (e.g., `onPress`) triggers the confirm dialog.
3. Add a `useRef` boolean guard (`isConfirming`) that is set to `true` when the dialog opens and reset to `false` when dismissed, preventing re-entry.

---

### TASK-5.8 — Disable admin screen continuous polling when off-screen (BUG-UI-09)
**Files:** `apps/expo/app/(tabs)/admin.tsx`

1. Import `useIsFocused` from `@react-navigation/native`.
2. Add `const isFocused = useIsFocused()`.
3. Add `refetchIntervalInBackground: false` to the React Query options.
4. Add `enabled: isFocused` to ensure the query (and its interval) only runs when the tab is visible.

---

### TASK-5.9 — Fix ONBOARDING_COMPLETE race condition (BUG-ONBOARD-01)
**Files:** `apps/expo/app/onboarding/welcome-drop.tsx`

1. Move `setItem(STORE_KEYS.ONBOARDING_COMPLETE, true)` from before the API call to inside the `.then()` success callback.
2. Add error handling: if the API call fails, show an error toast and do not navigate away (or retry automatically up to 3 times with exponential backoff).
3. Only navigate to the home tab after both the server save succeeds and MMKV is updated.

---

### TASK-5.10 — Fix vibe-quiz i18n (BUG-ONBOARD-02)
**Files:** `apps/expo/app/onboarding/vibe-quiz.tsx`

1. Either: rename `questionKey` to `questionText` throughout (if English-only is acceptable for now and i18n is a future concern), OR
2. Replace all raw English strings in the question definitions with i18next translation keys (e.g., `'onboarding.quiz.q1'`), add those keys to all locale JSON files, and render with `t(question.questionKey)`.

---

### TASK-5.11 — Add POST_NOTIFICATIONS permission to app.json (BUG-PERM-01)
**Files:** `apps/expo/app.json`

1. Add `"android.permission.POST_NOTIFICATIONS"` to the `android.permissions` array.
2. Rebuild the Android binary (EAS Build) — manifest changes require a native rebuild, they cannot be OTA'd.
3. Test on an Android 13+ device: confirm the system notification permission prompt appears on first launch.

---

### TASK-5.12 — Set minSdkVersion in app.json (BUG-CFG-01)
**Files:** `apps/expo/app.json`

1. Audit all native dependencies for their minimum API level requirements:
   - `react-native-mmkv ^2.12.2` — requires API 21+
   - `react-native-reanimated ~3.10.0` — requires API 21+
   - `react-native-iap ^12.16.2` — requires API 21+
   - Most modern RN libraries: API 23+
2. Set `"minSdkVersion": 24` in `app.json`'s `android` block (Android 7.0 — a reasonable minimum that covers 99%+ of active Android devices while avoiding known RN compatibility issues below API 23).
3. Rebuild via EAS Build.

---

### TASK-5.13 — Add runtimeVersion policy to eas.json (BUG-CFG-02)
**Files:** `apps/expo/eas.json`

1. Add `"runtimeVersion": { "policy": "appVersion" }` to each build profile (`development`, `preview`, `production`).
2. Ensure `app.json` has a `"version"` field that is bumped on each native change.
3. Test by publishing an OTA update and verifying it is only delivered to builds with the matching runtime version.

---

### TASK-5.14 — Add mutex to SQLite encryption key generation (BUG-SQLITE-01)
**Files:** `apps/expo/lib/offline/sqlite.ts`

1. Add a module-level variable: `let _encKeyPromise: Promise<string> | null = null;`
2. Replace the body of `getOrCreateEncryptionKey()` with:
   ```
   if (!_encKeyPromise) _encKeyPromise = _doLoadOrCreate();
   return _encKeyPromise;
   ```
   where `_doLoadOrCreate` contains the original SecureStore read/generate/write logic.
3. This ensures all concurrent callers await the same Promise and only one key is ever generated.

---

### TASK-5.15 — Fix Friends tab variable shadowing (informational/minor)
**Files:** `apps/expo/app/(tabs)/friends.tsx`

1. The `t` translation function from `useTranslation()` is shadowed by `.map((t) => ...)` in a tab-rendering loop. Rename the map parameter to avoid confusion (e.g., `.map((tab) => ...)`).
2. This is harmless at runtime but causes confusing TypeScript behavior and could lead to a real bug if the translation function is accidentally called inside that map.

---

### TASK-5.16 — Fix Messages tab duplicate "New" button (informational/minor)
**Files:** `apps/expo/app/(tabs)/messages.tsx`

1. The "New" button appears in both the screen header and the section header. Decide on one location and remove the other to avoid visual duplication.

---

### TASK-5.17 — Migrate Friends tab to React Query (informational/improvement)
**Files:** `apps/expo/app/(tabs)/friends.tsx`

1. The Friends tab uses manual `useState` + imperative `fetch` instead of React Query like every other data-fetching screen. This means no caching, no background refresh, no deduplication.
2. Migrate to `useQuery` with an appropriate `queryKey` so the tab benefits from the same staleTime/retry/background-refetch config as the rest of the app.

---

## Recommended Fix Execution Order

```
Phase 1 (TASK-1.1 through 1.4) → immediate
Phase 2 (TASK-2.1 through 2.4) → before next Play Store submission
Phase 3 (TASK-3.1 through 3.3) → alongside or immediately after Phase 2
Phase 4 (TASK-4.1 through 4.8) → next sprint
Phase 5 (TASK-5.1 through 5.17) → rolling cleanup, prioritize 5.11 and 5.12 (need native rebuild)
```

Phases 1–3 can be submitted as a single hotfix build. Phase 4 items are individually isolated and can be PRed separately. Phase 5 configuration items (5.11, 5.12, 5.13) require an EAS Build to take effect.

---

*Fix plan prepared: June 25, 2026 — 10:08 AM*  
*Cross-reference: custom-bugs-report.md (same date) for full bug details and rationale*  
*Total tasks: 17 primary tasks (covering all 37 bugs) across 5 phases*
