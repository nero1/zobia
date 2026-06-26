# Zobia Expo App — Bug Fix Plan
**Generated: 06/26/2026 at 12:00 AM**

> **IMPORTANT**: This is a plan only. No code has been changed. All 72 bugs from `custom-bugs-report.md` are addressed below. Implement each fix only after reviewing and approving this plan.

---

## Summary

| Priority | Count | Category |
|----------|-------|----------|
| CRITICAL | 4 | App won't build/run; data corruption |
| HIGH | 28 | Security, payments, race conditions, crashes |
| MEDIUM | 25 | UX degradation, incorrect behavior, data errors |
| LOW | 15 | Polish, accessibility, minor correctness |
| **Total** | **72** | |

---

## PHASE 1 — CRITICAL (Fix before anything else)

These block app functionality entirely or cause guaranteed data corruption.

---

### TASK-01 · BUG-COMPAT-01 · Expo SDK / Android API 36 Incompatibility
**Priority:** CRITICAL  
**Effort:** Large (2–3 days, requires thorough regression testing)

**Files to change:**
- `apps/expo/package.json`
- `apps/expo/app.config.ts`
- `apps/expo/app.json` (if present)
- `apps/expo/patches/` (verify any patches remain compatible)

**Steps:**
1. Upgrade `expo` from `~51.0.0` → `~52.0.0` in `package.json`.
2. Upgrade `react-native` from `0.74.0` → `0.76.x` (the version Expo 52 pins).
3. Upgrade all peer-dependent Expo packages to their Expo 52 compatible versions:
   - `expo-auth-session` `~5.5.2` → `~6.x`
   - `expo-constants` `~16.0.0` → `~17.x`
   - `expo-contacts` `~13.0.5` → `~14.x`
   - `expo-crypto` `~13.0.0` → `~14.x`
   - `expo-dev-client` `~4.0.0` → `~5.x`
   - `expo-device` `~6.0.2` → `~7.x`
   - `expo-file-system` `~16.0.0` → `~18.x`
   - `expo-image` `~1.12.0` → `~2.x`
   - `expo-linking` `~6.3.0` → `~7.x`
   - `expo-localization` `~15.0.0` → `~16.x`
   - `expo-notifications` `~0.28.0` → `~0.29.x`
   - `expo-router` `~3.5.0` → `~4.x`
   - `expo-secure-store` `~13.0.0` → `~14.x`
   - `expo-sqlite` `~14.0.0` → `~15.x`
   - `expo-status-bar` `~1.12.0` → `~2.x`
   - `expo-updates` `~0.25.0` → `~0.26.x`
   - `expo-web-browser` `~13.0.3` → `~14.x`
   - `react-native-reanimated` `~3.10.0` → `~3.16.x`
   - `react-native-gesture-handler` `~2.16.0` → `~2.20.x`
   - `react-native-safe-area-context` `4.10.1` → `4.12.x`
   - `react-native-screens` `3.31.1` → `3.35.x`
4. Check `react-native-mmkv`, `react-native-iap`, `react-native-google-mobile-ads`, and `react-native-qrcode-svg` for Expo 52 / RN 0.76 compatibility; upgrade if needed.
5. In `app.config.ts`, add `android.targetSdkVersion: 36` and `android.compileSdkVersion: 36` under the `android` key.
6. Run `npx expo install --check` and resolve any remaining version conflicts.
7. Review and re-test any `patches/` applied via `patch-package` for compatibility.
8. Run full build (`expo run:android`) on a device/emulator with Android API 36 and smoke-test every screen.

---

### TASK-02 · BUG-CRASH-01 · TrackBar t() Crash in profile.tsx
**Priority:** CRITICAL  
**Effort:** Small (30 min)

**Files to change:**
- `apps/expo/app/(tabs)/profile.tsx`

**Steps:**
1. Locate the `TrackBar` sub-component (or inline component) inside `profile.tsx` that calls `t('...')`.
2. Either:
   - (a) Move the `t()` call into the parent component where `useTranslation()` is already in scope and pass the translated string as a prop to `TrackBar`, **or**
   - (b) Add `const { t } = useTranslation();` at the top of `TrackBar` if it is a proper React function component (hooks are legal there).
3. Confirm no other inline helper functions inside `profile.tsx` call `t()` without hook access.

---

### TASK-03 · BUG-PAY-05 · Admin Revenue Displayed Raw Kobo (100× inflated)
**Priority:** CRITICAL  
**Effort:** Small (15 min)

**Files to change:**
- `apps/expo/app/(tabs)/admin.tsx`

**Steps:**
1. Find the line `₦${stats.revenueToday.toLocaleString()}` (and any similar `revenueWeek`, `revenueMonth`, `revenueTotal` if present).
2. Replace raw kobo values with the `koboToNairaStr()` utility from `apps/expo/lib/utils/currency.ts`.
   - Example: `koboToNairaStr(stats.revenueToday)` already adds `₦` and formats to 2dp with comma separators — remove the manually prepended `₦`.
3. Apply the same fix to every monetary stat displayed in the admin screen.
4. Verify with a test value (e.g., `100` kobo → `₦1.00`).

---

### TASK-04 · BUG-SEC-01 · onUnauthenticated Skips signOut() — Cross-Account Data Leakage
**Priority:** CRITICAL  
**Effort:** Small (30 min)

**Files to change:**
- `apps/expo/lib/auth/context.tsx`

**Steps:**
1. In `onUnauthenticated`, call the full `signOut()` function (which clears MMKV, SQLite queue, React Query cache, and Ably connection) **before** navigating to the login screen.
2. Ensure the navigation call (`router.replace('/auth/login')` or equivalent) happens **after** `await signOut()` resolves.
3. Add a try/catch around `signOut()` so that even if cleanup throws, the navigation to login still occurs.
4. Write a manual test: log in as User A, kill and reopen the app while token is expired, verify no User A data appears before/during User B login.

---

## PHASE 2 — HIGH PRIORITY

Fix these immediately after Phase 1 is stable.

---

### TASK-05 · BUG-SEC-02 · AbortSignal.timeout() Not Available on Android/Hermes
**Priority:** HIGH  
**Effort:** Small (1 hour)

**Files to change:**
- `apps/expo/lib/api/client.ts`

**Steps:**
1. Remove all calls to `AbortSignal.timeout(ms)`.
2. Replace with a manual pattern:
   ```
   const controller = new AbortController();
   const timeoutId = setTimeout(() => controller.abort(new Error('timeout')), ms);
   // after fetch: clearTimeout(timeoutId)
   ```
3. Create a small helper `createTimeoutSignal(ms: number): { signal: AbortSignal; clear: () => void }` in `lib/api/` to avoid duplicating this pattern.
4. Verify the helper is used consistently across all fetch call sites.

---

### TASK-06 · BUG-RACE-01 · Multiple 401 Responses Trigger Concurrent Token Refresh
**Priority:** HIGH  
**Effort:** Medium (2–3 hours)

**Files to change:**
- `apps/expo/lib/api/client.ts`

**Steps:**
1. Introduce a module-level refresh lock:
   ```ts
   let refreshPromise: Promise<string> | null = null;
   ```
2. In the 401 interceptor, if `refreshPromise` is already set, `await refreshPromise` instead of calling the refresh function again.
3. If `refreshPromise` is null, set it to the refresh call, `await` it, then set it back to `null` in a `finally` block.
4. Ensure all queued requests get the new token and are retried once refresh succeeds.
5. If refresh fails, reject all queued requests and call `onUnauthenticated()`.

---

### TASK-07 · BUG-NET-01 · PUT Requests Retried Despite Being Non-Idempotent in Practice
**Priority:** HIGH  
**Effort:** Small (1 hour)

**Files to change:**
- `apps/expo/lib/api/apiFetch.ts`

**Steps:**
1. Review which PUT endpoints are truly idempotent (update user profile, update settings) vs. which have side effects.
2. Remove automatic retry for PUT by default; instead expose a `retryOnPut: boolean` option (default `false`) and only set it to `true` for known-idempotent endpoints.
3. Fix the final-retry-returns-response bug: ensure the last retry either throws on non-2xx or the caller handles the returned response — the current code silently returns a failed response on the last attempt.

---

### TASK-08 · BUG-RACE-02 · syncPendingMessages Has No Concurrency Guard
**Priority:** HIGH  
**Effort:** Small (1 hour)

**Files to change:**
- `apps/expo/lib/offline/syncQueue.ts`

**Steps:**
1. Add a module-level boolean flag `let syncing = false`.
2. At the top of `syncPendingMessages`: if `syncing` is `true`, return early.
3. Set `syncing = true` at start, `syncing = false` in `finally`.
4. Ensure the flag is reset even if an exception is thrown.

---

### TASK-09 · BUG-RACE-03 · loadOrCreateEncryptionKey Has No Mutex (SQLite Store)
**Priority:** HIGH  
**Effort:** Small (1 hour)

**Files to change:**
- `apps/expo/lib/offline/store.ts`

**Steps:**
1. Add a module-level `Promise` sentinel:
   ```ts
   let keyInitPromise: Promise<string> | null = null;
   ```
2. Wrap the `loadOrCreateEncryptionKey` body: if `keyInitPromise` is set, return it; otherwise set it, run the async body, then clear on completion in `finally`.
3. All concurrent callers will await the same promise, getting the same key without racing.

---

### TASK-10 · BUG-SEC-03 · TOTP Lockout State Stored Only in MMKV (Bypassable)
**Priority:** HIGH  
**Effort:** Medium (half-day on client + server coordination)

**Files to change:**
- `apps/expo/app/auth/two-factor.tsx`

**Steps:**
1. On the client side: keep MMKV lockout as a UX hint only (prevents accidental hammering).
2. Implement server-side rate limiting: after N failed TOTP attempts, the server must lock the pre-auth token and return a specific error code (e.g., `429 TOO_MANY_TOTP_ATTEMPTS`).
3. The client should display the server's lockout response and remaining countdown, rather than trusting its own timer.
4. Also fix the current bug where network errors increment the failure counter — only count `400`/`401` responses with an explicit "invalid code" body as failures.
5. Validate that `preAuthCode` is a non-empty string before using it in the API request.

---

### TASK-11 · BUG-SEC-04 · GameWebView originWhitelist Contains 'about:blank'
**Priority:** HIGH  
**Effort:** Small (30 min)

**Files to change:**
- `apps/expo/components/games/GameWebView.tsx`

**Steps:**
1. Remove `'about:blank'` from `originWhitelist`.
2. Replace `${gameOrigin}/*` with just `${gameOrigin}` — the WebView `originWhitelist` prop matches origin prefixes, not glob paths, so the `/*` suffix is redundant and can cause confusion.
3. Test that the game still loads and postMessage round-trips work correctly.

---

### TASK-12 · BUG-SEC-05 · Admin Screen Has No is_admin Guard
**Priority:** HIGH  
**Effort:** Small (30 min)

**Files to change:**
- `apps/expo/app/(tabs)/admin.tsx`

**Steps:**
1. At the top of the component (after `useAuth()`), add: `if (!user?.is_admin) return <Redirect href="/(tabs)" />;` (or redirect to home).
2. Ensure all `useQuery`/`useMutation` hooks in the admin screen are either skipped when not admin, or that the API server enforces its own admin check (belt-and-suspenders).
3. Do not render any admin UI until `user` is loaded and `is_admin` is confirmed.

---

### TASK-13 · BUG-PAY-01 · Google Play Billing initialised=true Set Before initConnection Resolves
**Priority:** HIGH  
**Effort:** Small (45 min)

**Files to change:**
- `apps/expo/lib/payments/googlePlay.ts`

**Steps:**
1. Move the `initialised = true` assignment to **after** the `await initConnection()` call resolves successfully.
2. Add error handling: if `initConnection()` throws, keep `initialised = false` so that subsequent calls retry.
3. Also add a `finally` block to clear any in-progress sentinel so callers aren't permanently locked out after a transient failure.

---

### TASK-14 · BUG-PAY-02 · Purchase Tokens Stored in MMKV, Not SecureStore
**Priority:** HIGH  
**Effort:** Small (1 hour)

**Files to change:**
- `apps/expo/lib/payments/googlePlay.ts`

**Steps:**
1. Replace MMKV reads/writes for purchase token storage with `expo-secure-store` (`SecureStore.setItemAsync` / `SecureStore.getItemAsync`).
2. Use a namespaced key like `zobia_pending_purchase_<orderId>` to allow storing multiple pending purchases simultaneously.
3. On app start, read all pending purchase keys from SecureStore and attempt to reconcile them with the server (acknowledgement/consumption flow).

---

### TASK-15 · BUG-PAY-03 · No Purchase Restoration Flow
**Priority:** HIGH  
**Effort:** Medium (2–3 hours)

**Files to change:**
- `apps/expo/lib/payments/googlePlay.ts`
- `apps/expo/app/economy/store.tsx` (add UI trigger)

**Steps:**
1. Implement `restorePurchases()` using `getAvailablePurchases()` from `react-native-iap`.
2. For each unacknowledged/unconsumed purchase returned, re-send the `purchaseToken` to the server for crediting and then call `finishTransaction()`.
3. Add a "Restore Purchases" button in the store UI that calls this function.
4. Call `restorePurchases()` automatically on app start (after `initConnection()`) and on returning to the store screen after a connectivity restoration.

---

### TASK-16 · BUG-PAY-04 · Google Play Billing Timeout Refs Never Initialized
**Priority:** HIGH  
**Effort:** Small (30 min)

**Files to change:**
- `apps/expo/lib/payments/googlePlay.ts`

**Steps:**
1. Declare timeout ref variables with proper initial `null` values.
2. In every `clearTimeout()` call, guard with `if (ref !== null)` before clearing.
3. Ensure all timer refs are cleared in the `endConnection()` / cleanup path.

---

### TASK-17 · BUG-RACE-04 · Realtime Channel Reconnects on 'failed' (Unrecoverable) State
**Priority:** HIGH  
**Effort:** Small (1 hour)

**Files to change:**
- `apps/expo/lib/realtime/useRealtimeChannel.ts`

**Steps:**
1. In the reconnection logic, check the channel state before calling `connect()`.
2. If the state is `'failed'`, do NOT call `connect()` directly — instead call `channel.detach()` and then `channel.attach()` to reset the channel, or create a new Ably client instance.
3. Add a max-reconnect-attempts counter with exponential backoff; after N failures, show the user a "Connection lost — tap to retry" message rather than silently looping.

---

### TASK-18 · BUG-RACE-05 · dailyLoginMutation Fires After Unmount (tabs/index.tsx)
**Priority:** HIGH  
**Effort:** Small (30 min)

**Files to change:**
- `apps/expo/app/(tabs)/index.tsx`

**Steps:**
1. Add an `isMounted` ref (`useRef(true)`) and set it to `false` in a `useEffect` cleanup.
2. Before calling `dailyLoginMutation.mutate()` (or within the mutation's `onSuccess`/`onError`), check `if (!isMounted.current) return`.
3. Alternatively, use React Query's `enabled` option tied to mount state to prevent the mutation from running after navigation away.

---

### TASK-19 · BUG-RACE-06 · GIF Send Bypasses Offline Queue (rooms/[roomId].tsx)
**Priority:** HIGH  
**Effort:** Medium (2 hours)

**Files to change:**
- `apps/expo/app/rooms/[roomId].tsx`

**Steps:**
1. Route GIF sends through the same offline SQLite queue used for text messages.
2. The queue entry should include a `type: 'gif'` field and the GIF URL as content.
3. The sync worker already handles sending messages — extend it to handle the `gif` type and construct the correct API payload.
4. This ensures GIFs are reliably delivered even on intermittent connections.

---

### TASK-20 · BUG-RACE-07 · 2-Second Polling Thundering Herd in rooms/[roomId].tsx
**Priority:** HIGH  
**Effort:** Medium (2 hours)

**Files to change:**
- `apps/expo/app/rooms/[roomId].tsx`

**Steps:**
1. Remove the 2-second `setInterval` poll entirely.
2. Use the existing Ably real-time channel for live message delivery instead.
3. Fall back to a longer poll interval (30–60 seconds) only when the Ably connection is in a degraded state.
4. The existing delta-fetch (`lib/chat/delta.ts`) can be used as the catch-up mechanism when reconnecting.

---

### TASK-21 · BUG-RACE-08 · Ads Global State Race on Concurrent Preload
**Priority:** HIGH  
**Effort:** Small (1 hour)

**Files to change:**
- `apps/expo/lib/ads/admob.ts`

**Steps:**
1. Add a `preloading` boolean guard: if a preload is already in flight, return early.
2. After an ad is consumed (shown), set `preloading = false` and immediately trigger a new preload.
3. Ensure the global `rewardedAd` instance is replaced atomically — set the new instance only after it is fully loaded.

---

### TASK-22 · BUG-MEM-01 · prevMessageIdsRef Set Grows Unbounded
**Priority:** HIGH  
**Effort:** Small (30 min)

**Files to change:**
- `apps/expo/app/rooms/[roomId].tsx`

**Steps:**
1. In the effect/callback that adds IDs to `prevMessageIdsRef.current` (a `Set`), cap the set size.
2. Implement a sliding window: when size exceeds N (e.g., 1000), delete the oldest entries. Since `Set` preserves insertion order, iterate and delete from the front until under the limit.
3. Alternatively, replace with a simple "last seen cursor" timestamp instead of a full ID set.

---

### TASK-23 · BUG-NET-02 · Deeplinks Missing encodeURIComponent for Path Components
**Priority:** HIGH  
**Effort:** Small (45 min)

**Files to change:**
- `apps/expo/lib/deeplinks/routes.ts`

**Steps:**
1. Wrap all dynamic path segments in `encodeURIComponent()` before interpolating into the URL.
2. For query parameters, use `URLSearchParams` to construct the query string.
3. Write a test with special characters (spaces, `&`, `=`, non-ASCII) in room names or usernames to verify correct encoding.

---

### TASK-24 · BUG-DATA-01 · WEB_BASE_URL Missing from app.config.ts extra Block
**Priority:** HIGH  
**Effort:** Small (15 min)

**Files to change:**
- `apps/expo/app.config.ts`

**Steps:**
1. Add `WEB_BASE_URL: process.env.WEB_BASE_URL` to the `extra` object in `app.config.ts`.
2. Add `REALTIME_PROVIDER: process.env.REALTIME_PROVIDER` to the same `extra` block.
3. Ensure `process.env.WEB_BASE_URL` is set in all EAS build profiles (`.env`, EAS secrets, or `eas.json` `env` block).
4. Verify `lib/env.ts` reads from `Constants.expoConfig?.extra?.WEB_BASE_URL` — confirm the key names match exactly.

---

### TASK-25 · BUG-DATA-02 · Missing android.targetSdkVersion / compileSdkVersion in app.config.ts
**Priority:** HIGH  
**Effort:** Small (15 min)

**Files to change:**
- `apps/expo/app.config.ts`

**Steps:**
1. Under the `android` key, add:
   ```ts
   targetSdkVersion: 36,
   compileSdkVersion: 36,
   ```
2. Confirm `minSdkVersion` is set appropriately (24+ recommended for RN 0.76).

---

### TASK-26 · BUG-DATA-03 · Missing EAS projectId in app.config.ts
**Priority:** HIGH  
**Effort:** Small (15 min)

**Files to change:**
- `apps/expo/app.config.ts`

**Steps:**
1. Add `extra: { eas: { projectId: '<your-eas-project-id>' } }` (merged with existing extra entries).
2. Alternatively, use `eas.json` if preferred — ensure the project ID is present so EAS Update and push notifications work correctly.

---

### TASK-27 · BUG-I18N-01 · Guild Screen Entirely Hardcoded English
**Priority:** HIGH  
**Effort:** Medium (2–3 hours)

**Files to change:**
- `apps/expo/app/(tabs)/guild.tsx`
- All locale JSON files under `apps/expo/lib/i18n/locales/`

**Steps:**
1. Add `const { t } = useTranslation();` at the top of the `Guild` component.
2. Extract every hardcoded English string to translation keys, e.g.:
   - `"Find Your Crew"` → `t('guild.findYourCrew')`
   - `"Discover Guilds"` → `t('guild.discoverGuilds')`
   - `"Create Guild"` → `t('guild.createGuild')`
   - `"Treasury"` → `t('guild.treasury')`
   - `"Tier Progress"` → `t('guild.tierProgress')`
   - `"Join War"` → `t('guild.joinWar')`
   - `"View Full Guild"` → `t('guild.viewFullGuild')`
   - `"Members"` → `t('guild.members')`
   - `"My XP"` → `t('guild.myXp')`
   - `"Active War"` → `t('guild.activeWar')`
   - `"Ended"` → `t('guild.ended')`
3. Add all new keys to every locale file (en first, then translate or use English fallback for others).

---

### TASK-28 · BUG-PAY-06 · Store Screen PIN Error Increments on Network Failure
**Priority:** HIGH  
**Effort:** Small (30 min)

**Files to change:**
- `apps/expo/app/economy/store.tsx`

**Steps:**
1. In the PIN validation callback, distinguish between a server-confirmed "wrong PIN" error (HTTP 400/401 with explicit body) and a network/server error (timeout, 5xx, no response).
2. Only increment the failure counter for confirmed wrong-PIN responses.
3. For network errors, show a "Connection error — try again" message without penalizing the PIN counter.

---

### TASK-29 · BUG-PAY-07 · Gift Send Screen PIN Attempts Reset on PIN_REQUIRED
**Priority:** HIGH  
**Effort:** Small (30 min)

**Files to change:**
- `apps/expo/app/economy/gift-send.tsx`

**Steps:**
1. When the server returns `PIN_REQUIRED`, do NOT reset the attempt counter.
2. The attempt counter should only reset on successful authentication or explicit user logout.
3. Persist the counter in MMKV with a TTL (e.g., 15 minutes) so it survives accidental screen dismissal.

---

## PHASE 3 — MEDIUM PRIORITY

Fix after Phase 2. These cause degraded UX, incorrect rendering, or data integrity issues that affect users but don't constitute full failures.

---

### TASK-30 · BUG-UI-01–04 · Android API 36 Keyboard Offset = 0 (4 screens)
**Priority:** MEDIUM  
**Effort:** Medium (3 hours total)

**Files to change:**
- `apps/expo/app/(tabs)/index.tsx`
- `apps/expo/app/rooms/[roomId].tsx`
- `apps/expo/app/messages/[conversationId].tsx`
- `apps/expo/app/messages/group/[groupId].tsx`

**Steps:**
1. On Android API 36, the system handles edge-to-edge insets differently. Replace static `keyboardVerticalOffset={0}` with a dynamic value:
   ```ts
   import { useSafeAreaInsets } from 'react-native-safe-area-context';
   const insets = useSafeAreaInsets();
   // keyboardVerticalOffset = insets.top + statusBarHeight
   ```
2. Use `Platform.OS === 'android'` guard to apply only on Android.
3. Test on an Android API 36 emulator or device to confirm the input field is not occluded by the keyboard.

---

### TASK-31 · BUG-PERF-01 · Room Search Fires on Every Keystroke (No Debounce)
**Priority:** MEDIUM  
**Effort:** Small (30 min)

**Files to change:**
- `apps/expo/app/(tabs)/rooms.tsx`

**Steps:**
1. Add a debounce of 300–500ms before firing the search API call.
2. Use `useRef` with `setTimeout`/`clearTimeout`, or a simple `useDebouncedValue` hook.
3. Cancel the in-flight request when a new keystroke arrives (via `AbortController`).

---

### TASK-32 · BUG-PERF-02 · delta.ts mergeNewestFirst Calls Date.parse() Twice Per Comparison
**Priority:** MEDIUM  
**Effort:** Small (15 min)

**Files to change:**
- `apps/expo/lib/chat/delta.ts`

**Steps:**
1. Before sorting, map the array to `[timestamp, item]` pairs (Schwartzian transform):
   ```ts
   const sorted = arr
     .map(item => [Date.parse(item.created_at), item] as const)
     .sort(([a], [b]) => b - a)
     .map(([, item]) => item);
   ```
2. This parses each date exactly once regardless of array size.

---

### TASK-33 · BUG-PERF-03 · toBase64Url O(n²) String Concatenation
**Priority:** MEDIUM  
**Effort:** Small (15 min)

**Files to change:**
- `apps/expo/lib/offline/sqlite.ts`

**Steps:**
1. Replace the loop that concatenates characters one-by-one with `Array.from(bytes).map(...).join('')`.
2. Or use `String.fromCharCode(...bytes)` with a spread if the byte array is reasonably sized.
3. This changes O(n²) string copies to O(n) allocation.

---

### TASK-34 · BUG-PERF-04 · CoinBalance refetchInterval Fires in Background
**Priority:** MEDIUM  
**Effort:** Small (30 min)

**Files to change:**
- `apps/expo/components/economy/CoinBalance.tsx`

**Steps:**
1. Pass `refetchIntervalInBackground: false` to the `useQuery` call (React Query option).
2. This halts polling when the app is backgrounded, resuming when the app comes back to the foreground.

---

### TASK-35 · BUG-PERF-05 · Contact Import No Country-Code Normalization (E.164)
**Priority:** MEDIUM  
**Effort:** Medium (2 hours)

**Files to change:**
- `apps/expo/components/ContactsImporter.tsx`

**Steps:**
1. After stripping spaces/dashes/parens, attempt to normalize each number to E.164 format.
2. Use the device locale or a user-supplied default country code (from onboarding) to resolve local numbers.
3. Consider using a lightweight phone number parsing library (e.g., `google-libphonenumber`) or a server-side normalization step.
4. Flag numbers that cannot be normalized rather than silently sending malformed strings.

---

### TASK-36 · BUG-MEM-02 · Telegram Login Poll Continues After Unmount
**Priority:** MEDIUM  
**Effort:** Small (30 min)

**Files to change:**
- `apps/expo/app/auth/login.tsx`

**Steps:**
1. Store the Telegram poll `intervalId` (or `timeoutId`) in a `useRef`.
2. In the `useEffect` cleanup function, call `clearInterval(ref.current)` / `clearTimeout(ref.current)`.
3. Before each poll callback fires, check an `isMounted` ref and return early if `false`.

---

### TASK-37 · BUG-MEM-03 · API Requests in welcome-drop.tsx Have No Cancellation
**Priority:** MEDIUM  
**Effort:** Small (30 min)

**Files to change:**
- `apps/expo/app/onboarding/welcome-drop.tsx`

**Steps:**
1. Create an `AbortController` inside the `useEffect` that fires the API call.
2. Pass `controller.signal` to the fetch/axios call.
3. Return `() => controller.abort()` as the effect cleanup.

---

### TASK-38 · BUG-MEM-04 · usePinnedRooms API Call Has No AbortController
**Priority:** MEDIUM  
**Effort:** Small (20 min)

**Files to change:**
- `apps/expo/app/(tabs)/rooms.tsx`

**Steps:**
1. In the `usePinnedRooms` hook (or wherever the pinned rooms fetch is defined), pass an `AbortSignal` from the React Query `queryFn`'s first argument:
   ```ts
   queryFn: ({ signal }) => apiFetch('/rooms/pinned', { signal }),
   ```
2. React Query automatically aborts in-flight requests when the component unmounts or the query is cancelled.

---

### TASK-39 · BUG-MEM-05 · handleRefresh Awaits invalidateQueries Instead of Actual Refetch
**Priority:** MEDIUM  
**Effort:** Small (20 min)

**Files to change:**
- `apps/expo/app/(tabs)/index.tsx`

**Steps:**
1. Replace `await queryClient.invalidateQueries(...)` in `handleRefresh` with `await queryClient.refetchQueries(...)`.
2. `invalidateQueries` marks data stale but doesn't guarantee the fetch completes synchronously — `refetchQueries` waits for the actual network request to resolve before the pull-to-refresh spinner is dismissed.

---

### TASK-40 · BUG-I18N-02 · RTL Language Switch Requires App Reload with No Feedback
**Priority:** MEDIUM  
**Effort:** Small (1 hour)

**Files to change:**
- `apps/expo/lib/i18n/rtl.ts`
- `apps/expo/app/settings/index.tsx`

**Steps:**
1. After changing the language to/from an RTL locale, call `await Updates.reloadAsync()` to apply the layout direction change.
2. Before reloading, show a brief toast/alert: "Language changed. Restarting app..." so the user isn't confused by the sudden reload.
3. If `expo-updates` is not available in dev mode, degrade gracefully (show a message asking user to restart manually).

---

### TASK-41 · BUG-I18N-03 · Quest Reward Amounts Hardcoded in Translation Call
**Priority:** MEDIUM  
**Effort:** Small (30 min)

**Files to change:**
- `apps/expo/app/(tabs)/quests.tsx`

**Steps:**
1. Remove the hardcoded `{ coins: '1,000', xp: '2,000' }` from the `t()` call for member quest rewards.
2. Use the actual server-returned reward values: `t('quest.memberReward', { coins: quest.reward.coins, xp: quest.reward.xp })`.
3. Format coins/XP values using `koboToNairaStr` or a number formatter as appropriate.

---

### TASK-42 · BUG-I18N-04 · Rooms Screen Empty State Hardcoded English
**Priority:** MEDIUM  
**Effort:** Small (30 min)

**Files to change:**
- `apps/expo/app/(tabs)/rooms.tsx`

**Steps:**
1. Add `const { t } = useTranslation();` if not already present.
2. Replace hardcoded English empty state strings with `t('rooms.emptyState')`, `t('rooms.noResults')`, etc.
3. Add corresponding keys to all locale files.

---

### TASK-43 · BUG-UX-01 · handleHighlightConfirm Uses First Search Result, Not Selected
**Priority:** MEDIUM  
**Effort:** Small (45 min)

**Files to change:**
- `apps/expo/app/rooms/[roomId].tsx`

**Steps:**
1. Track the user's explicitly selected message in a `selectedHighlightId` state variable.
2. In `handleHighlightConfirm`, use `selectedHighlightId` rather than `results[0]` or similar.
3. Disable the confirm button until a message is explicitly selected.

---

### TASK-44 · BUG-UX-02 · Login Screen Has No Rate Limiting
**Priority:** MEDIUM  
**Effort:** Small (1 hour)

**Files to change:**
- `apps/expo/app/auth/login.tsx`

**Steps:**
1. Track login attempt count and last attempt timestamp in component state (or MMKV for persistence across sessions).
2. After 5 failed attempts within 15 minutes, disable the submit button and show a lockout countdown.
3. This is a client-side UX improvement; the server should still enforce its own rate limiting.

---

### TASK-45 · BUG-UX-03 · Rooms Create Screen Uses Date.now() as Module ID (Collision Risk)
**Priority:** MEDIUM  
**Effort:** Small (30 min)

**Files to change:**
- `apps/expo/app/rooms/create.tsx`

**Steps:**
1. Replace `Date.now()` as a temporary/local ID with `expo-crypto`'s `randomUUID()`.
2. This avoids the (small but real) risk of two rooms created in the same millisecond getting the same local ID.

---

### TASK-46 · BUG-UX-04 · Rooms Create Screen Sends NaN Price to Server
**Priority:** MEDIUM  
**Effort:** Small (30 min)

**Files to change:**
- `apps/expo/app/rooms/create.tsx`

**Steps:**
1. Parse the price input with `parseFloat` or `parseInt` and validate before submitting.
2. If the parsed value is `NaN` or negative, show a validation error and prevent form submission.
3. Use `Decimal.js` to handle the conversion from display naira to kobo (multiply by 100, floor to integer).

---

### TASK-47 · BUG-UX-05 · Notification Settings Fires Concurrent PATCH Requests
**Priority:** MEDIUM  
**Effort:** Small (1 hour)

**Files to change:**
- `apps/expo/app/settings/index.tsx`

**Steps:**
1. Debounce the notification toggle: after a toggle, wait 500ms before sending the PATCH, and cancel any pending request when a new toggle fires.
2. Alternatively, queue the most recent state and send only once the user stops toggling.
3. Use optimistic updates in React Query so the UI is immediately responsive.

---

### TASK-48 · BUG-UX-06 · Language Change Has No Rollback on API Failure
**Priority:** MEDIUM  
**Effort:** Small (45 min)

**Files to change:**
- `apps/expo/app/settings/index.tsx`

**Steps:**
1. Before applying the new language, store the current language in a local variable.
2. If the API call to persist the preference fails, call `i18n.changeLanguage(previousLanguage)` and update MMKV back to the previous value.
3. Show an error toast: "Failed to save language preference."

---

### TASK-49 · BUG-UX-07 · PIN Length Not Validated Before Server Call
**Priority:** MEDIUM  
**Effort:** Small (20 min)

**Files to change:**
- `apps/expo/app/settings/index.tsx`

**Steps:**
1. Before calling the set-PIN API, check that the PIN meets the required length (e.g., exactly 6 digits).
2. Disable the submit/confirm button until the PIN length condition is met.
3. Show inline validation feedback ("PIN must be 6 digits").

---

### TASK-50 · BUG-UX-08 · Share.share url Parameter Android-Incompatible
**Priority:** MEDIUM  
**Effort:** Small (20 min)

**Files to change:**
- `apps/expo/app/settings/index.tsx`

**Steps:**
1. On Android, `Share.share` requires `{ message: url }` not `{ url: url }`.
2. Use `Platform.OS === 'android'` to construct the correct payload:
   ```ts
   Share.share(Platform.OS === 'android' ? { message: shareUrl } : { url: shareUrl });
   ```

---

### TASK-51 · BUG-UX-09 · Wallet Screen Uses Wrong Endpoint for Stars Tab
**Priority:** MEDIUM  
**Effort:** Small (15 min)

**Files to change:**
- `apps/expo/app/(tabs)/wallet.tsx`
- `apps/expo/app/economy/wallet.tsx`

**Steps:**
1. Identify the correct Stars balance / history endpoint from the API contract.
2. Update both wallet screens to use the correct endpoint for the Stars tab.
3. Verify the response schema matches the Stars data shape expected by the UI.

---

### TASK-52 · BUG-UX-10 · Friends Screen Uses useColorScheme() Instead of useTheme()
**Priority:** MEDIUM  
**Effort:** Small (15 min)

**Files to change:**
- `apps/expo/app/(tabs)/friends.tsx`

**Steps:**
1. Replace `const colorScheme = useColorScheme()` with `const { colors } = useTheme()`.
2. Replace all `colorScheme === 'dark' ? '#...' : '#...'` inline ternaries with `colors.xxx` tokens.
3. This ensures the friends screen respects the user's explicit theme preference (light/dark/system), not just the device system setting.

---

### TASK-53 · BUG-UX-11 · pidginSuggestions Not Cleared After Send (messages/[conversationId].tsx)
**Priority:** MEDIUM  
**Effort:** Small (15 min)

**Files to change:**
- `apps/expo/app/messages/[conversationId].tsx`

**Steps:**
1. After a message is sent successfully, call `setPidginSuggestions([])` (or equivalent state setter) to clear the suggestions bar.
2. Also clear on input blur if no message was sent.

---

### TASK-54 · BUG-UX-12 · GIF Picker Has No Cache in messages/[conversationId].tsx
**Priority:** MEDIUM  
**Effort:** Small (45 min)

**Files to change:**
- `apps/expo/app/messages/[conversationId].tsx`

**Steps:**
1. Cache GIF search results in a `useRef` keyed by search term.
2. On repeated identical searches, serve from cache (with a short TTL, e.g., 5 minutes) before making a new API call.
3. Optionally integrate with React Query's `queryKey` system for automatic stale-while-revalidate behavior.

---

### TASK-55 · BUG-UX-13 · Group Messages Screen Fetches Same Endpoint Twice
**Priority:** MEDIUM  
**Effort:** Small (30 min)

**Files to change:**
- `apps/expo/app/messages/group/[groupId].tsx`

**Steps:**
1. Identify the duplicated fetch (likely two `useQuery` hooks with the same key or same URL).
2. Consolidate into a single query and share the data via props or context.
3. Ensure React Query's cache deduplication is working: both hooks should use the same `queryKey` so only one network request fires.

---

### TASK-56 · BUG-UX-14 · Gifts Tab Fetches Fixed 40 Gifts with No Pagination
**Priority:** MEDIUM  
**Effort:** Medium (2 hours)

**Files to change:**
- `apps/expo/app/(tabs)/gifts.tsx`

**Steps:**
1. Implement cursor-based pagination using `useInfiniteQuery` from React Query.
2. Add a "Load more" button or infinite scroll trigger at the bottom of the gifts list.
3. Remove the fixed `?limit=40` and replace with `?limit=20&after=<cursor>` per page.

---

### TASK-57 · BUG-UX-15 · Friends Tab Fetches All Friends with No Pagination
**Priority:** MEDIUM  
**Effort:** Medium (2 hours)

**Files to change:**
- `apps/expo/app/(tabs)/friends.tsx`

**Steps:**
1. Implement `useInfiniteQuery` with cursor-based pagination for the friends list.
2. Support paginated results for all three sub-lists: existing friends, incoming requests, outgoing requests.
3. Add infinite scroll or "Load more" support.

---

### TASK-58 · BUG-UX-16 · AdminSwipeDrawer Uses setTimeout Hack Instead of Animation Callback
**Priority:** MEDIUM  
**Effort:** Small (30 min)

**Files to change:**
- `apps/expo/components/admin/AdminSwipeDrawer.tsx`

**Steps:**
1. Find the 50ms `setTimeout` before `navigate()`.
2. Replace with the animation completion callback:
   ```ts
   Animated.timing(drawerAnim, { ... }).start(() => {
     navigate('/admin/...');
   });
   ```
3. This eliminates the race between animation and navigation, and removes the fragile timing assumption.

---

### TASK-59 · BUG-UX-17 · AnnouncementBanner Dismissal Permanent Instead of Session-Only
**Priority:** MEDIUM  
**Effort:** Small (20 min)

**Files to change:**
- `apps/expo/components/announcements/AnnouncementBanner.tsx`

**Steps:**
1. Decide on the intended behavior:
   - **Option A** (session-only): Store dismissal in a `useRef` or React state; the banner re-appears on next app launch.
   - **Option B** (permanent, one-time per banner version): Store in MMKV with the banner's version or hash as the key — this IS the correct approach for "show once" banners.
   - **Option C** (per-banner with expiry TTL): Store in MMKV with a timestamp; re-show after N days.
2. Update the comment to accurately describe the actual behavior so future devs aren't confused.
3. If truly session-only is the intent, remove the MMKV write and use React state instead.

---

### TASK-60 · BUG-DATA-04 · Onboarding City Field Mandatory — Blocks Non-Urban Users
**Priority:** MEDIUM  
**Effort:** Small (30 min)

**Files to change:**
- `apps/expo/app/onboarding/index.tsx`

**Steps:**
1. Make the city field optional in the form validation schema (remove the `required` constraint).
2. Update the server schema to accept a null/empty city value.
3. Default to an empty string or `null` if city is not provided.

---

### TASK-61 · BUG-DATA-05 · Onboarding Phone No Country Code Normalization
**Priority:** MEDIUM  
**Effort:** Medium (1 hour)

**Files to change:**
- `apps/expo/app/onboarding/index.tsx`

**Steps:**
1. Add a country code picker (dial code selector) alongside the phone number input.
2. Combine the selected dial code with the entered number to produce a full E.164 number before sending to the server.
3. Store the last-used country code in MMKV for pre-filling on future edits.
4. See also TASK-35 (ContactsImporter normalization) — use the same normalization logic.

---

### TASK-62 · BUG-DATA-06 · lib/env.ts REALTIME_PROVIDER Dual-Source With No Production Default
**Priority:** MEDIUM  
**Effort:** Small (15 min)

**Files to change:**
- `apps/expo/lib/env.ts`
- `apps/expo/app.config.ts`

**Steps:**
1. Add `REALTIME_PROVIDER` to the `extra` block in `app.config.ts` (covered by TASK-24).
2. In `lib/env.ts`, read `REALTIME_PROVIDER` exclusively from `Constants.expoConfig?.extra?.REALTIME_PROVIDER`.
3. In production EAS builds, ensure `REALTIME_PROVIDER=ably` is set as an EAS secret/env var.

---

### TASK-63 · BUG-DATA-07 · Wallet Offset Pagination (Should Be Cursor-Based)
**Priority:** MEDIUM  
**Effort:** Medium (2 hours)

**Files to change:**
- `apps/expo/app/(tabs)/wallet.tsx`
- `apps/expo/app/economy/wallet.tsx`

**Steps:**
1. Verify whether the wallet transaction history API supports cursor-based pagination.
2. If yes, switch both wallet screens from offset-based to cursor-based pagination (`useInfiniteQuery` with `after` cursor).
3. If the API only supports offset, add a note for the backend to implement cursor pagination, and add a comment in the code acknowledging the current limitation.

---

### TASK-64 · BUG-NET-03 · No Exponential Backoff on Ably Reconnect
**Priority:** MEDIUM  
**Effort:** Small (1 hour)

**Files to change:**
- `apps/expo/lib/realtime/useRealtimeChannel.ts`

**Steps:**
1. Implement exponential backoff for reconnection: start at 1s, double on each failure, cap at 60s.
2. Reset the backoff counter when a connection is successfully established.
3. After a configurable number of retries (e.g., 10), surface a "Disconnected" UI indicator and stop automatic reconnection (let the user trigger manually).

---

## PHASE 4 — LOW PRIORITY

Polish, accessibility, and minor correctness. Fix after all higher-priority items are addressed.

---

### TASK-65 · BUG-MISC-01 · SplashScreen.hideAsync Called Before All Async Init Complete
**Priority:** LOW  
**Effort:** Small (30 min)

**Files to change:**
- `apps/expo/app/_layout.tsx`

**Steps:**
1. Audit all async initialization paths (auth, i18n, theme, etc.).
2. Create a single `isReady` state that only becomes `true` when ALL async initializations have completed.
3. Call `SplashScreen.hideAsync()` only after `isReady` is `true`.
4. Wrap in a try/catch — if `hideAsync` has already been called, it throws; ignore that specific error.

---

### TASK-66 · BUG-MISC-02 · VALID_PUSH_ROUTES Regex Lowercase-Only (Misses Mixed-Case Paths)
**Priority:** LOW  
**Effort:** Small (15 min)

**Files to change:**
- `apps/expo/app/_layout.tsx`

**Steps:**
1. Add the `i` flag to the VALID_PUSH_ROUTES regex: `/^(\/rooms\/|\/messages\/).../i`.
2. Or normalize incoming paths to lowercase before testing against the regex.
3. Ensure the regex is comprehensive — list all valid push notification routes explicitly.

---

### TASK-67 · BUG-MISC-03 · router Identity in useEffect deps Array (Stale Closure)
**Priority:** LOW  
**Effort:** Small (15 min)

**Files to change:**
- `apps/expo/app/_layout.tsx`

**Steps:**
1. Remove `router` from the `useEffect` dependency array if `router` from `expo-router` is a stable reference (it is — same instance across renders).
2. Or if using a `useCallback`/`useMemo` that captures `router`, confirm the reference is stable to avoid unnecessary re-runs.

---

### TASK-68 · BUG-PERF-06 · formatCoins Precision Loss in economy/wallet.tsx
**Priority:** LOW  
**Effort:** Small (20 min)

**Files to change:**
- `apps/expo/app/economy/wallet.tsx`

**Steps:**
1. Use `Decimal.js` for all coin/star formatting: `new Decimal(amount).toFixed(2)` instead of native floating-point arithmetic.
2. Ensure `koboToNairaStr` is used for naira values and a separate `formatCoins` using Decimal is used for coin values.

---

### TASK-69 · BUG-UX-18 · PackCard Description Not Rendered in store.tsx
**Priority:** LOW  
**Effort:** Small (20 min)

**Files to change:**
- `apps/expo/app/economy/store.tsx`

**Steps:**
1. Find the `PackCard` component or inline render in `store.tsx`.
2. Add the `description` field to the rendered output (e.g., below the pack title).
3. Apply appropriate text styling (muted color, smaller font size) using `colors.textMuted` from the theme.

---

### TASK-70 · BUG-UX-19 · Store PIN No Auto-Submit on 6th Digit
**Priority:** LOW  
**Effort:** Small (30 min)

**Files to change:**
- `apps/expo/app/economy/store.tsx`

**Steps:**
1. After the user enters the final PIN digit (when `pin.length === PIN_LENGTH - 1` and a new digit is entered), automatically call the submit handler.
2. This is standard UX for PIN entry and avoids requiring a separate "Confirm" button press.

---

### TASK-71 · BUG-MISC-04 · MessageBubble senderUsername Prop Accepted But Not Rendered
**Priority:** LOW  
**Effort:** Small (10 min)

**Files to change:**
- `apps/expo/components/rooms/MessageBubble.tsx`

**Steps:**
1. Either render `senderUsername` in the bubble UI (e.g., as a small label above the message text for group chats), **or**
2. Remove the prop from the component interface if it is genuinely unused.
3. Don't leave dead props — they create confusion and TypeScript won't catch unused prop passing.

---

### TASK-72 · BUG-MISC-05 · SQLite getPermanentlyFailedMessages Redundant OR Condition
**Priority:** LOW  
**Effort:** Small (10 min)

**Files to change:**
- `apps/expo/lib/offline/sqlite.ts`

**Steps:**
1. Find the SQL query in `getPermanentlyFailedMessages` that has a redundant `OR` clause.
2. Simplify the `WHERE` condition to remove the duplicate/tautological part.
3. This is a correctness and readability fix — no functional impact if the logic is equivalent.

---

## Implementation Order Recommendation

```
PHASE 1  (Days 1–4, unblock everything)
  TASK-01  SDK upgrade + Android API 36 targeting
  TASK-02  TrackBar crash
  TASK-03  Admin revenue kobo/naira
  TASK-04  signOut on onUnauthenticated

PHASE 2  (Days 5–12, security + payment + race conditions)
  TASK-05  AbortSignal.timeout polyfill
  TASK-06  Concurrent token refresh lock
  TASK-07  PUT retry safety
  TASK-08  syncPendingMessages lock
  TASK-09  loadOrCreateEncryptionKey mutex
  TASK-10  TOTP server-side lockout
  TASK-11  GameWebView originWhitelist
  TASK-12  Admin is_admin guard
  TASK-13  Billing init flag timing
  TASK-14  Purchase tokens → SecureStore
  TASK-15  Purchase restoration flow
  TASK-16  Billing timeout refs
  TASK-17  Realtime failed-state reconnect
  TASK-18  dailyLoginMutation unmount
  TASK-19  GIF through offline queue
  TASK-20  Replace 2s poll with Ably
  TASK-21  Ads global state race
  TASK-22  prevMessageIdsRef cap
  TASK-23  Deeplink encodeURIComponent
  TASK-24  WEB_BASE_URL in extra
  TASK-25  targetSdkVersion/compileSdkVersion
  TASK-26  EAS projectId
  TASK-27  Guild screen i18n
  TASK-28  Store PIN network error count
  TASK-29  Gift send PIN reset

PHASE 3  (Days 13–20, UX + correctness)
  TASK-30  Android API 36 keyboard offsets (4 screens)
  TASK-31  Room search debounce
  TASK-32  delta.ts Date.parse twice
  TASK-33  toBase64Url O(n²)
  TASK-34  CoinBalance background poll
  TASK-35  Contact E.164 normalization
  TASK-36  Telegram poll cleanup
  TASK-37  welcome-drop cancellation
  TASK-38  usePinnedRooms AbortController
  TASK-39  handleRefresh refetchQueries
  TASK-40  RTL reload + feedback
  TASK-41  Quest reward amounts from server
  TASK-42  Rooms empty state i18n
  TASK-43  handleHighlightConfirm selection
  TASK-44  Login rate limiting
  TASK-45  Room create randomUUID
  TASK-46  Room create NaN price guard
  TASK-47  Notification settings debounce
  TASK-48  Language change rollback
  TASK-49  PIN length validation
  TASK-50  Share.share Android compat
  TASK-51  Wallet stars endpoint
  TASK-52  Friends useTheme
  TASK-53  pidginSuggestions clear
  TASK-54  GIF cache
  TASK-55  Group messages dedupe fetch
  TASK-56  Gifts cursor pagination
  TASK-57  Friends cursor pagination
  TASK-58  AdminSwipeDrawer animation cb
  TASK-59  AnnouncementBanner dismissal
  TASK-60  Onboarding city optional
  TASK-61  Onboarding phone E.164
  TASK-62  REALTIME_PROVIDER single source
  TASK-63  Wallet cursor pagination
  TASK-64  Ably reconnect backoff

PHASE 4  (Days 21–24, polish)
  TASK-65  SplashScreen.hideAsync timing
  TASK-66  VALID_PUSH_ROUTES case-insensitive
  TASK-67  router in useEffect deps
  TASK-68  formatCoins Decimal.js
  TASK-69  PackCard description render
  TASK-70  Store PIN auto-submit
  TASK-71  MessageBubble dead prop
  TASK-72  SQLite redundant OR clause
```

---

## Testing Checklist (After All Fixes Applied)

- [ ] Full build on Android API 36 emulator (`expo run:android`)
- [ ] TrackBar renders without crash in profile screen
- [ ] Admin revenue displays correct naira values (not 100× inflated)
- [ ] Log out / token expiry flow clears all user data before login screen
- [ ] Concurrent 401 responses trigger only one token refresh
- [ ] TOTP lockout persists across app restarts (server-enforced)
- [ ] Google Play purchase survives app kill (restore on restart)
- [ ] Offline messages queue and sync on reconnect (including GIFs)
- [ ] Room chat uses Ably real-time, not 2-second poll
- [ ] Room search debounced (no per-keystroke calls)
- [ ] Keyboard does not occlude input on Android API 36 in all 4 chat screens
- [ ] Arabic RTL layout correct; language switch triggers reload
- [ ] Guild screen fully translated in all 9 locales
- [ ] Deeplinks with special characters in room/user names work correctly
- [ ] Friends and gifts lists paginate correctly
- [ ] AdminSwipeDrawer navigates after animation completes (not 50ms later)
- [ ] Share sheet works on Android (message param, not url)
- [ ] Contact import normalizes phone numbers to E.164
- [ ] Announcement banner behavior matches code comment

---

*06/26/2026 at 12:00 AM — Zobia Expo App Bug Fix Plan / 72 tasks across 4 phases / CRITICAL: 4 · HIGH: 28 · MEDIUM: 25 · LOW: 15*
