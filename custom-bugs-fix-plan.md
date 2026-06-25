# Zobia Social — Expo Bug Fix Plan

**Generated:** 2026-06-25 08:56 PM  
**Reference:** custom-bugs-report.md (same date)  
**Status:** PLAN ONLY — do not begin implementation until this plan is reviewed and approved.

---

## Overview

This plan organises all 60 bugs from the forensic report into fix phases ordered by risk and dependency. Each task identifies the bug code(s), the files to change, what to do, and the acceptance criteria. Fix the bugs in phase order within each phase fixes can be parallelised unless noted otherwise.

---

## Phase 1 — Critical / Blocking (Fix First)

These bugs either expose a security vulnerability, cause the app to be non-functional in production, or represent legal compliance violations.

---

### TASK-001 · Fix admin payout authentication (BUG-023, BUG-024)

**Priority:** P0 — Critical auth bypass  
**Files:** `apps/expo/app/admin/payouts.tsx`

**Steps:**
1. Remove the `storage.getString('authToken')` call and the manual `Authorization` header construction entirely.
2. Remove the raw `fetch()` calls for approve, reject, and release.
3. Replace every payout API call with `apiClient.post()` / `apiClient.patch()` using the same endpoint paths. `apiClient` already injects the correct Bearer token from expo-secure-store automatically.
4. Remove any local token variable that was derived from the MMKV read.

**Acceptance:** Approving, rejecting, and releasing a payout in the admin screen returns a 2xx response when the admin is authenticated; the request header contains a valid JWT (verify in a proxy tool). Tapping any payout action while unauthenticated redirects to sign-in.

---

### TASK-002 · Fix production AdMob App IDs (BUG-001)

**Priority:** P0 — App crashes on launch in production  
**Files:** `apps/expo/eas.json`, EAS Secrets dashboard

**Steps:**
1. Log in to the AdMob console and copy the Android and iOS App IDs.
2. Add them as EAS Secrets (`ADMOB_APP_ID_ANDROID`, `ADMOB_APP_ID_IOS`) rather than committing them to source control.
3. Update `eas.json` `production.env` to reference the secrets (EAS automatically injects secrets into the build environment; remove the empty string placeholders).
4. Confirm `app.config.js` maps `process.env.ADMOB_APP_ID_ANDROID` into `expo.plugins["react-native-google-mobile-ads"].androidAppId`.
5. Run a production build and verify no native AdMob initialisation crash on first launch.

**Acceptance:** A production build launches on a physical Android device without a native exception from the Google Mobile Ads SDK.

---

### TASK-003 · Correct onboarding privacy disclosure (BUG-058)

**Priority:** P0 — Legal / regulatory compliance (GDPR, CCPA, Play Store policy)  
**Files:** `apps/expo/app/onboarding/index.tsx`, translation JSON files for all 9 locales

**Steps:**
1. Find the contacts permission screen text.
2. Replace any statement that implies contacts are not sent to servers with accurate language: e.g., "We send hashed versions of your contacts' phone numbers to our servers to suggest friends. Raw contact data is never stored."
3. Add a link to the privacy policy URL.
4. Update all 9 locale translation strings to match the corrected copy.

**Acceptance:** The contacts permission screen accurately describes data handling. Legal review sign-off recommended before shipping.

---

### TASK-004 · Fix push notification route allowlist and deep link consistency (BUG-002, BUG-059)

**Priority:** P0 — Push notification taps are broken in production  
**Files:** `apps/expo/app/_layout.tsx`, `apps/expo/lib/deeplinks/routes.ts`

**Steps:**
1. Decide on the canonical URL shape for DM threads. Recommended: keep the existing expo-router file at `app/messages/[conversationId].tsx`, giving path `/messages/:conversationId`.
2. Update `ROUTES.MESSAGE_THREAD` in `deeplinks/routes.ts` to `(id) => \`/messages/${id}\`` (remove any `/dm/` infix if it was in the route helper).
3. Update the push notification `VALID_PUSH_ROUTES` allowlist in `_layout.tsx` to `/^\/messages\/[0-9a-f-]{36}$/` (DM), `/^\/rooms\/[0-9a-f-]{36}$/` (rooms), `/^\/messages\/group\/[0-9a-f-]{36}$/` (group), and any other tappable notification targets.
4. Ensure the backend push payload `url` field matches the exact path shape used in the allowlist.
5. Test by sending a test push notification and verifying the tap routes to the correct screen.

**Acceptance:** Tapping a DM push notification opens the correct conversation. Tapping a room notification opens the room. All other routes are blocked.

---

### TASK-005 · Fix auth startup — clear stale user on refresh failure (BUG-005)

**Priority:** P1 — User appears authenticated when session is dead  
**Files:** `apps/expo/lib/auth/context.tsx`

**Steps:**
1. In the startup `useEffect`, locate the token refresh `catch` block.
2. Add calls to `SecureStore.deleteItemAsync('access_token')` and `SecureStore.deleteItemAsync('refresh_token')` inside the catch block.
3. Set `user` state to `null` before setting `isLoading` to `false`.
4. Ensure the app navigates to the sign-in screen after this cleanup.

**Acceptance:** After simulating a failed refresh (e.g., delete tokens from SecureStore then cold-launch), the app lands on the sign-in screen, not the home tab.

---

### TASK-006 · Fix onboarding age verification (BUG-056, BUG-057)

**Priority:** P1 — Underage users can register; legal compliance  
**Files:** `apps/expo/app/onboarding/index.tsx`

**Steps:**
1. Remove the module-level `const CURRENT_YEAR = new Date().getFullYear()`.
2. Collect full birthdate: year, month, day (if not already collected, ensure all three fields are present in the onboarding form).
3. In the validation function, compute `const eighteenthBirthday = new Date(birthYear + 18, birthMonth - 1, birthDay)` and check `new Date() >= eighteenthBirthday`. Perform this computation inside the validation function, not at module load time.
4. Show a clear error if the user is under 18.

**Acceptance:** A simulated birthdate of yesterday minus 18 years is accepted. A birthdate of today minus 18 years plus 1 day is rejected.

---

## Phase 2 — High Severity (Security & Financial Integrity)

---

### TASK-007 · Clear MMKV store on sign-out (BUG-010)

**Priority:** P1  
**Files:** `apps/expo/lib/auth/context.tsx`, `apps/expo/lib/offline/store.ts`

**Steps:**
1. In `signOut()`, after deleting SecureStore tokens, call `clearStore()` from `lib/offline/store.ts`.
2. Ensure `clearStore()` is called before navigating to the sign-in screen.
3. Verify that draft messages, cached feed, user prefs, and pending referral are all cleared.

**Acceptance:** After sign-out, querying MMKV for any well-known key returns `undefined`. On the next sign-in with a different account, no previous user's data is visible.

---

### TASK-008 · Replace all raw kobo-to-naira divisions with Decimal.js (BUG-015, BUG-026, BUG-032, BUG-042)

**Priority:** P1  
**Files:** `apps/expo/app/admin/payouts.tsx`, `apps/expo/app/creator/dashboard.tsx`, `apps/expo/app/(tabs)/wallet.tsx`, `apps/expo/lib/utils/currency.ts`

**Steps:**
1. In `admin/payouts.tsx`, remove the local `koboToNaira` function and replace its usages with `koboToNairaStr` imported from `lib/utils/currency.ts`.
2. In `creator/dashboard.tsx`, remove the local `formatKobo` function and replace with `koboToNairaStr`.
3. In `tabs/wallet.tsx`, replace `koboToNairaInt` usages in display contexts with `koboToNairaStr`.
4. Document `koboToNairaInt` as appropriate only for integer-amount scenarios and add a JSDoc note.
5. Search the entire codebase for `/ 100` and `* 100` patterns in financial contexts and replace all with Decimal.js operations.

**Acceptance:** All monetary display values match exactly two decimal places and are free of floating-point artefacts. Unit-test representative kobo values (e.g., 1, 99, 100001) against expected naira display strings.

---

### TASK-009 · Add PIN/TOTP rate limiting and lockout (BUG-033, BUG-045, BUG-047)

**Priority:** P1  
**Files:** `apps/expo/app/creator/dashboard.tsx`, `apps/expo/app/economy/gift-send.tsx`, `apps/expo/app/auth/two-factor.tsx`

**Steps:**
1. Create a shared `usePinAttempts(featureKey: string)` hook that manages an attempt counter and lockout expiry stored in SecureStore.
2. After each wrong PIN / wrong TOTP code, increment the counter and compute lockout duration: 30 s after 3 failures, 5 min after 5, 30 min after 10.
3. On component mount, check whether the feature is currently locked out and show the remaining lockout duration.
4. After 10 total failures, call `signOut()` and clear the counter.
5. Clear the counter on successful verification.
6. Apply the hook to all three screens.

**Acceptance:** After 3 wrong PINs, the submit button is disabled for 30 s with a visible countdown. After 10 failures, the user is signed out.

---

### TASK-010 · Sanitize and size-cap GameWebView API proxy body (BUG-030)

**Priority:** P1  
**Files:** `apps/expo/components/games/GameWebView.tsx`

**Steps:**
1. After receiving the `API_REQUEST` postMessage, serialize `body` to JSON and check its length: if `JSON.stringify(body).length > 8192`, reject the request and post an error back to the WebView.
2. If the game endpoints are well-known, add a per-endpoint Zod schema map and validate `body` against the relevant schema before forwarding.
3. Log rejected requests for monitoring.

**Acceptance:** A WebView that posts a 100 KB body receives an error response; the request is not forwarded to the backend.

---

### TASK-011 · Validate stored user JSON with Zod on startup (BUG-006)

**Priority:** P1  
**Files:** `apps/expo/lib/auth/context.tsx`

**Steps:**
1. Define a Zod schema (`UserSchema`) matching the `User` type.
2. Replace `JSON.parse(storedUser) as User` with `UserSchema.safeParse(JSON.parse(storedUser))`.
3. If `safeParse` returns `success: false`, treat it as a corrupted record: delete the stored user from SecureStore, clear tokens, and route to sign-in.

**Acceptance:** Manually writing a corrupt JSON string to SecureStore as the user key results in a graceful sign-out, not a crash.

---

### TASK-012 · Fix IAP session maps leaking across sign-out (BUG-014)

**Priority:** P1  
**Files:** `apps/expo/lib/payments/googlePlay.ts`, `apps/expo/lib/auth/context.tsx`

**Steps:**
1. In `disconnectGooglePlayBilling()`, add `purchaseResolvers.clear()`, `activePurchaseSessions.clear()`, `pendingRecovery.clear()` before removing the purchase update listener.
2. Ensure `disconnectGooglePlayBilling()` is called in the `signOut()` flow.

**Acceptance:** After sign-out and sign-in as a different user, a simulated pending purchase from the first user does not fire a callback in the second user's session.

---

### TASK-013 · Fix gift-send PIN error messages leaking account state (BUG-046)

**Priority:** P2  
**Files:** `apps/expo/app/economy/gift-send.tsx`

**Steps:**
1. Change all error messages in the PIN verification modal to a single generic string: "Verification failed. Please try again."
2. Remove the distinct "Incorrect PIN" vs "Verification failed" branching.

**Acceptance:** Wrong PIN and network error both display the same message.

---

## Phase 3 — Medium Severity (Reliability & Correctness)

---

### TASK-014 · Fix Ably client lifecycle (BUG-012, BUG-013)

**Priority:** P2  
**Files:** `apps/expo/lib/realtime/useRealtimeChannel.ts`

**Steps:**
1. Move the Ably client instantiation into a `useRef` so it persists across re-renders.
2. Only create a new client when `authToken` changes (use a separate `useEffect` with `[authToken]` dependency).
3. In the effect cleanup function, call `channelRef.current?.unsubscribe()` then `clientRef.current?.close()`.
4. Subscribe to channel state events `['detached', 'suspended', 'failed']` and set `connected(false)` in each handler.
5. Subscribe to connection state events `['disconnected', 'suspended', 'failed']` and set `connected(false)`.

**Acceptance:** After simulating a network drop (airplane mode), the polling interval reverts from 30 s to 3 s. After network recovery, Ably reconnects and polling returns to 30 s. No duplicate Ably clients exist in memory during a session.

---

### TASK-015 · Fix offline queue message ID generation (BUG-009)

**Priority:** P2  
**Files:** `apps/expo/lib/offline/sqlite.ts`

**Steps:**
1. Replace `` `offline_${Date.now()}_${Math.random().toString(36).slice(2)}` `` with `crypto.randomUUID()`.
2. Remove the `offline_` prefix or keep it as a storage-internal marker — it is fine to prefix a UUID, e.g., `` `offline_${crypto.randomUUID()}` ``.

**Acceptance:** Rapid-fire queueing of 1,000 messages in a loop produces no duplicate IDs (verify by checking for PRIMARY KEY violations in SQLite).

---

### TASK-016 · Add jitter to push registration retry and apiFetch backoff (BUG-003, BUG-008)

**Priority:** P2  
**Files:** `apps/expo/app/_layout.tsx`, `apps/expo/lib/api/apiFetch.ts`

**Steps:**
1. In `_layout.tsx` push registration retry loop: add full jitter — replace `delay` with `Math.random() * delay` and ensure delay starts at 1 s, doubles each attempt, and is capped at 30 s.
2. In `apiFetch.ts`: change `Math.random() * baseDelay` to `baseDelay / 2 + Math.random() * (baseDelay / 2)` (equal jitter), guaranteeing minimum delay of `baseDelay / 2`. Cap total delay at 30 s.

**Acceptance:** Under artificial failure injection (mock the token fetch to always fail), 100 simultaneous registration attempts spread out across a 30 s window rather than spiking simultaneously.

---

### TASK-017 · Gate referral capture behind storeReady (BUG-004)

**Priority:** P2  
**Files:** `apps/expo/app/_layout.tsx`, `apps/expo/lib/deeplinks/referral.ts`

**Steps:**
1. In `_layout.tsx`, check that `useReferralCaptureFromLink()` is only called or only writes after the `storeReady` state is `true`.
2. If the hook is called early (before storeReady), buffer the referral code in a local ref and write it to MMKV in a `useEffect` that fires once `storeReady` becomes true.

**Acceptance:** On cold launch with a referral deep-link, the referral code is correctly persisted to MMKV. Verify by querying `STORE_KEYS.PENDING_REFERRAL` after launch.

---

### TASK-018 · Fix i18n MMKV — use shared encrypted store (BUG-011)

**Priority:** P2  
**Files:** `apps/expo/lib/i18n/index.ts`

**Steps:**
1. Remove the direct `new MMKV({ id: 'zobia_prefs' })` instantiation.
2. For the first-render language selection (which must be synchronous), read from the shared `_storage` reference directly via `_storage?.getString(STORE_KEYS.USER_PREFERENCES)` — or use a default language until `initStore()` resolves.
3. After `initStore()` resolves, write language preference through `setItem(STORE_KEYS.USER_PREFERENCES, prefs)`.
4. Delete the unencrypted `zobia_prefs` MMKV file on first launch after the update (migration step).

**Acceptance:** No second MMKV file `zobia_prefs` is created on disk. Language preference is readable after a reinstall (stored encrypted in main store).

---

### TASK-019 · Fix DM send optimistic update / query invalidation race (BUG-054, BUG-055)

**Priority:** P2  
**Files:** `apps/expo/app/messages/[conversationId].tsx`

**Steps:**
1. Memoize `combinedMessages` with `useMemo([serverMessages, pendingMessages])`.
2. In `sendMutation`, implement the full TanStack Query optimistic update pattern: `onMutate` → snapshot + inject optimistic message into query cache via `queryClient.setQueryData`; `onError` → roll back to snapshot; `onSettled` → invalidate query (so background refetch reconciles server truth).
3. Remove the immediate `invalidateQueries` call from `onSuccess`.

**Acceptance:** Sending a message shows no flicker. Message appears immediately on send, persists through the server response, and is confirmed (e.g., read-receipt or server ID) without re-ordering.

---

### TASK-020 · Fix daily login and ad cap date keying (BUG-040, BUG-044)

**Priority:** P2  
**Files:** `apps/expo/app/(tabs)/index.tsx`, `apps/expo/components/ads/RewardedAdButton.tsx`

**Steps:**
1. Replace `new Date().toDateString()` in both files with `new Date().toISOString().slice(0, 10)` which always returns `YYYY-MM-DD` in UTC, independent of device locale and timezone.
2. If using local-time "day" is specifically required (user should get their reward at local midnight), use `new Date().toLocaleDateString('en-CA')` which always produces `YYYY-MM-DD` in ISO-like format using the local timezone.

**Acceptance:** On a device set to a non-English locale (e.g., German), the daily reward fires exactly once per calendar day and the ad cap is enforced correctly.

---

### TASK-021 · Fix daily login MMKV error guard (BUG-041)

**Priority:** P2  
**Files:** `apps/expo/app/(tabs)/index.tsx`

**Steps:**
1. Wrap the daily-login date read in a `try/catch`.
2. Only fire `dailyLoginMutation.mutate()` inside the `try` block, after a successful read that shows today's reward has not been claimed.
3. On catch, log the error but do not fire the mutation.

**Acceptance:** If `getItem` throws (mock it to throw in a test), `dailyLoginMutation.mutate()` is not called.

---

### TASK-022 · Fix rewarded ad EARNED_REWARD race (BUG-016)

**Priority:** P2  
**Files:** `apps/expo/lib/ads/admob.ts`

**Steps:**
1. Declare a `let rewardEarned = false` boolean before setting up event listeners.
2. In the `EARNED_REWARD` listener, set `rewardEarned = true` and store the reward details in a local variable.
3. In the `CLOSED` listener, check `if (rewardEarned)` and resolve with the earned reward; otherwise resolve with `null` (or reject if a reward was expected).
4. Remove the 150 ms `setTimeout` entirely.

**Acceptance:** Ad watched to completion resolves with the reward. Ad dismissed without watching resolves with null. No timing-dependent behaviour.

---

### TASK-023 · Fix FloatingNotificationProvider fetch cleanup (BUG-048)

**Priority:** P2  
**Files:** `apps/expo/components/providers/FloatingNotificationProvider.tsx`

**Steps:**
1. Create `const controller = new AbortController()` inside the `useEffect`.
2. Pass `{ signal: controller.signal }` to `apiClient.get('/config/rewards-ui', { signal: controller.signal })`.
3. Return `() => controller.abort()` as the effect cleanup.
4. In the `.catch()`, ignore `AbortError` (check `err.name === 'CanceledError'` for Axios abort signals).

**Acceptance:** Rapidly mounting and unmounting the provider does not trigger React "setState on unmounted component" warnings.

---

### TASK-024 · Fix admin error handling (BUG-018, BUG-020, BUG-022)

**Priority:** P2  
**Files:** `apps/expo/app/admin/index.tsx`, `apps/expo/app/admin/users.tsx`, `apps/expo/app/admin/moderation.tsx`

**Steps:**
1. In `admin/index.tsx`: add `const [statsError, setStatsError] = useState<string|null>(null)` and set it in `loadStats()` catch with `translateApiError(err)`. Render the error state as a banner above the stats grid.
2. In `admin/users.tsx`: same pattern — add error state and render an error banner.
3. In `admin/moderation.tsx`: replace `Alert.alert('Error', 'Action failed')` with `Alert.alert('Error', translateApiError(err))`.

**Acceptance:** When the API returns 500, the admin screens display a human-readable error message rather than empty/zero content.

---

### TASK-025 · Add pagination to admin moderation (BUG-021)

**Priority:** P2  
**Files:** `apps/expo/app/admin/moderation.tsx`

**Steps:**
1. Add a cursor ref (`cursorRef`) and append cursor to the API call: `?cursor=${cursor}&limit=30`.
2. On response, update the cursor from the last item's `id`.
3. Add `FlatList onEndReached` to trigger loading the next page.
4. Show a loading indicator at the bottom while fetching.

**Acceptance:** Scrolling to the bottom of a moderation queue with more than 30 items loads the next batch.

---

### TASK-026 · Fix admin payouts pagination (BUG-025)

**Priority:** P2  
**Files:** `apps/expo/app/admin/payouts.tsx`

**Steps:**
1. Replace `?page=N&limit=20` offset pagination with cursor-based: `?after=${lastId}&limit=20`.
2. Track `lastId` from the last item in each response.
3. Implement `FlatList onEndReached` to load the next page.

**Acceptance:** Loading more payouts while a new payout is approved mid-scroll does not duplicate or skip items.

---

### TASK-027 · Fix admin payouts financial display (BUG-026)

**Priority:** P2  
**Files:** `apps/expo/app/admin/payouts.tsx`  
*(Covered partly by TASK-008 — ensure this file is included.)*

Steps and acceptance are the same as TASK-008.

---

### TASK-028 · Remove manual Origin headers from fetch calls (BUG-007, BUG-060)

**Priority:** P2  
**Files:** `apps/expo/lib/auth/context.tsx`, `apps/expo/app/auth/two-factor.tsx`

**Steps:**
1. Remove `headers: { ..., Origin: '...' }` from both sign-out and 2FA fetch calls.
2. Migrate both calls to `apiClient.post()` for consistent token injection, base URL, and error handling.
3. For sign-out, if a 401 during the revoke call is acceptable (session already invalid), add `validateStatus: (s) => s < 500` to suppress the 401 from triggering a refresh loop.

**Acceptance:** Sign-out and 2FA submission do not set a manual Origin header. Both calls use apiClient.

---

### TASK-029 · Fix profile report success alert ordering (BUG-031)

**Priority:** P2  
**Files:** `apps/expo/app/profile/[userId].tsx`

**Steps:**
1. Move `Alert.alert('Reported', ...)` to inside the `await reportUser()` success path (after the await resolves without throwing).
2. Add a catch that shows `Alert.alert('Error', translateApiError(err))`.

**Acceptance:** Cancelling the network call (mock a 500 response) shows an error alert, not a success alert.

---

### TASK-030 · Fix guild chat idempotency and keyboard offset (BUG-028, BUG-029)

**Priority:** P2  
**Files:** `apps/expo/app/guilds/[guildId]/chat.tsx`

**Steps:**
1. At the start of the send handler, generate `const idempotencyKey = crypto.randomUUID()` and include it in the POST body.
2. Apply `keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}` and `behavior={Platform.OS === 'ios' ? 'padding' : 'height'}`.

**Acceptance:** Sending the same message twice in rapid succession creates two server messages. On Android, the keyboard does not obscure the input field.

---

### TASK-031 · Fix room screen issues (BUG-049, BUG-050, BUG-051, BUG-052)

**Priority:** P2  
**Files:** `apps/expo/app/rooms/[roomId].tsx`

**Steps:**
1. BUG-049: In `handleGifSelect()`, generate and include an idempotency key in the POST body.
2. BUG-050: Implement the `onReactionPress` handler: call `apiClient.post(\`/rooms/${roomId}/messages/${messageId}/reactions\`, { emoji })` and update the relevant message in the query cache optimistically.
3. BUG-051: Replace the inline `members.find()` lookup with a `useMemo`-derived `Map<username, userId>` that is stable across renders.
4. BUG-052: Apply `Platform.OS` guard for `keyboardVerticalOffset` (same pattern as TASK-030).

**Acceptance:** GIF messages cannot be duplicated by double-tap. Tapping a reaction emoji sends the reaction to the backend. Keyboard does not overlap input on Android.

---

### TASK-032 · Fix DM screen idempotency and memoization (BUG-053, BUG-054, BUG-055)

**Priority:** P2  
**Files:** `apps/expo/app/messages/[conversationId].tsx`

Steps are covered by TASK-019 (optimistic update) plus:
1. Generate and include idempotency key in `handleSendMoment()`.
2. Memoize `combinedMessages` (covered in TASK-019).

**Acceptance:** Moment/snap sends cannot be duplicated. Combined messages array is stable under typing.

---

### TASK-033 · Fix group chat O(n) metadata fetch and dedup key (BUG-036, BUG-037)

**Priority:** P2  
**Files:** `apps/expo/app/messages/group/[groupId].tsx`

**Steps:**
1. Replace `GET /groups` + client-side `find()` with `GET /groups/${groupId}` directly.
2. Replace the `${senderUserId}|${content}` deduplication key with the message's `idempotencyKey`.

**Acceptance:** Group chat screen makes exactly one group metadata API call on mount. Sending "ok" twice creates two visible messages.

---

### TASK-034 · Add pagination to notifications screen (BUG-038)

**Priority:** P2  
**Files:** `apps/expo/app/notifications/index.tsx`

**Steps:**
1. Add cursor-based pagination with `?after=<lastId>&limit=20`.
2. Implement `FlatList onEndReached` to load more.
3. Show loading indicator while fetching next page.

**Acceptance:** A user with 100 notifications sees the first 20 on load and can scroll to load more.

---

### TASK-035 · Fix guild member list pagination (BUG-027)

**Priority:** P2  
**Files:** `apps/expo/app/guilds/[guildId].tsx`

**Steps:**
1. Fetch only the first 20 members on screen load (`?limit=20`).
2. Add a "Load more" button or `FlatList onEndReached` for subsequent pages.
3. Keep the war history in a separate paginated query.

**Acceptance:** Guild detail screen loads in under 1 s for a guild with 500 members.

---

## Phase 4 — Low Severity (Code Quality, i18n, UX Polish)

---

### TASK-036 · Add i18n to admin screens (BUG-019)

**Priority:** P3  
**Files:** `apps/expo/app/admin/index.tsx`, `apps/expo/app/admin/users.tsx`, `apps/expo/app/admin/moderation.tsx`, `apps/expo/app/admin/payouts.tsx`, `apps/expo/app/admin/financial.tsx`, all locale JSON files

**Steps:**
1. Add a `admin.*` namespace to all 9 locale JSON files.
2. Replace all hardcoded English strings in admin screens with `t('admin.keyName')`.

---

### TASK-037 · Fix wallet and creator currency symbol i18n (BUG-043)

**Priority:** P3  
**Files:** `apps/expo/app/(tabs)/wallet.tsx`, `apps/expo/app/creator/dashboard.tsx`

**Steps:**
1. Replace hardcoded `₦` symbols with the currency string from `koboToNairaStr` (which already includes ₦) or use `Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' })`.

---

### TASK-038 · Fix TRC20 address validation (BUG-034)

**Priority:** P3  
**Files:** `apps/expo/app/creator/wallet.tsx`

**Steps:**
1. Add a regex pattern prop to the TRC20 input: `/^T[1-9A-HJ-NP-Za-km-z]{33}$/`.
2. Disable the Submit button and show an inline error if the regex does not match.

---

### TASK-039 · Verify /settings/pin route exists (BUG-035)

**Priority:** P3  
**Files:** `apps/expo/app/settings/`, `apps/expo/app/creator/wallet.tsx`

**Steps:**
1. Check whether `apps/expo/app/settings/pin.tsx` (or `settings/pin/index.tsx`) exists.
2. If it does not, create a minimal PIN setup screen or redirect to the correct existing screen.
3. Audit all `router.push()` calls in the codebase against the actual file-based route tree.

---

### TASK-040 · Fix messageCache silent error swallowing (BUG-017)

**Priority:** P3  
**Files:** `apps/expo/lib/chat/messageCache.ts`

**Steps:**
1. In the `writeCachedMessages` catch block, replace the silent swallow with `console.error('[messageCache] write failed', err)`.
2. Optionally integrate with a crash-reporting SDK (e.g., Sentry) if one is present.

---

### TASK-041 · Stagger home screen queries to reduce thundering herd (BUG-039)

**Priority:** P3  
**Files:** `apps/expo/app/(tabs)/index.tsx`

**Steps:**
1. Identify the two or three most critical queries (user profile, friends list) and ensure they have no `enabled` dependency.
2. Add `enabled: !!userProfile` to lower-priority queries (leaderboard, creator spotlight, guild discovery) so they only fire after the primary data lands.
3. Add `staleTime: 60_000` (60 s) to all queries that don't need real-time freshness so tab-focus does not re-trigger them.

---

### TASK-042 · Fix ONBOARDING_COMPLETE CURRENT_YEAR stale reference (BUG-057)

**Priority:** P3  
*(Covered by TASK-006 — moving the date computation inside the validation function resolves both BUG-056 and BUG-057.)*

---

### TASK-043 · Harden sign-out to call disconnectGooglePlayBilling (TASK-012 dependency reminder)

**Priority:** P2  
**Files:** `apps/expo/lib/auth/context.tsx`

*(This is a dependency reminder: TASK-012 clears the maps inside `disconnectGooglePlayBilling`, but this task ensures the function is actually called during sign-out. Verify the call is present after TASK-012 is applied.)*

---

## Phase 5 — Regression & Integration Testing

After all phases are applied:

1. **Auth flows:** Sign in, silent refresh, sign out, sign in as different user — verify no stale data, no auth bypass.
2. **Admin payout:** Verify approve/reject/release calls return 200 with a valid JWT; verify 401 when not admin.
3. **Push notifications:** Send a test push for DM, room, and group; verify tap routes to correct screen.
4. **Offline queue:** Queue 10 messages while offline, restore connectivity, verify all 10 send exactly once (no duplicates), verify content is decrypted correctly.
5. **Financial math:** Audit all monetary display fields for correctness using values with fractional kobo.
6. **Age gate:** Attempt registration with a birthdate exactly 17 years 364 days ago; verify rejection.
7. **PIN lockout:** Enter wrong PIN 3 times; verify 30 s lockout. Enter wrong PIN 10 times across the lockout; verify sign-out.
8. **Ably reconnect:** Toggle airplane mode mid-session; verify polling drops to 3 s and recovers to 30 s on reconnect.
9. **Daily login:** Set device locale to German; trigger daily login twice in one day; verify it fires only once.
10. **Accessibility:** Run TalkBack (Android) through the main user flows; verify all interactive elements have accessible labels.

---

## Effort Estimate

| Phase | Tasks | Estimated Eng-Days |
|---|---|---|
| Phase 1 — Critical | 6 tasks | 2–3 days |
| Phase 2 — High | 14 tasks | 4–6 days |
| Phase 3 — Medium | 14 tasks | 5–7 days |
| Phase 4 — Low | 8 tasks | 2–3 days |
| Phase 5 — Testing | — | 2–3 days |
| **Total** | **42 tasks** | **15–22 engineering-days** |

---

*Plan generated: 2026-06-25 08:56 PM*  
*Zobia Social — Expo Bug Fix Plan*
