# Zobia Expo App — Bug Fix Plan

**Generated:** June 25, 2026 — 12:00 PM  
**Based on:** `custom-bugs-report.md` (50 bugs)  
**Target platform:** Android API 36 (compileSdkVersion 36, targetSdkVersion 36, minSdkVersion 24)  
**Instruction:** Review this plan before applying any fix. DO NOT apply fixes until approved.

---

## Execution Strategy

Fix in four passes, strictly ordered by impact:

| Pass | Priority | Bugs | Rationale |
|------|----------|------|-----------|
| 1 | CRITICAL | BUG-01, BUG-02, BUG-03, BUG-04, BUG-05 | App-breaking: admin is dead, onboarding crashes, purchases can be silently dropped |
| 2 | HIGH | BUG-06–08, BUG-10, BUG-11, BUG-12–15, BUG-21, BUG-22, BUG-28, BUG-41, BUG-50 | Data integrity, financial accuracy, payment integrity, major UX failures |
| 3 | MEDIUM | BUG-09, BUG-16, BUG-17, BUG-18, BUG-19, BUG-20, BUG-23, BUG-24, BUG-25, BUG-27, BUG-29, BUG-30, BUG-31, BUG-33, BUG-34, BUG-35, BUG-36, BUG-37, BUG-38, BUG-39, BUG-40, BUG-42, BUG-43, BUG-46, BUG-47 | Security hardening, memory, UX, configuration, missing plugins |
| 4 | LOW | BUG-26, BUG-32, BUG-44, BUG-45, BUG-48, BUG-49 | Polish, minor correctness, minor memory |

---

## Pass 1 — CRITICAL (Fix first, nothing else should be deployed until these are done)

---

### FIX-01 — Rebuild all admin screens to use `apiClient` and SecureStore for JWT

**Bugs fixed:** BUG-01 (JWT from wrong store), BUG-02 (raw fetch), BUG-03 (raw process.env)

**Files to change:**
- `apps/expo/app/admin/index.tsx`
- `apps/expo/app/admin/users.tsx`
- `apps/expo/app/admin/financial.tsx`
- `apps/expo/app/admin/moderation.tsx`
- (any other files under `apps/expo/app/admin/`)

**Step-by-step:**

1. **Remove all raw `fetch()` calls** in every admin screen.  
   Replace every:
   ```ts
   const token = storage.getString("authToken");
   const res = await fetch(`${API_BASE}/api/admin/...`, {
     headers: token ? { Authorization: `Bearer ${token}` } : {},
   });
   ```
   with:
   ```ts
   const { data } = await apiClient.get('/admin/...');
   // apiClient already injects the Authorization header, handles 401→refresh, and has a 15s timeout
   ```

2. **Remove `const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";`** from the top of every admin screen. The `apiClient` base URL is already configured from `env.API_BASE_URL`.

3. **Remove `import { storage } from '@/lib/offline/store';`** from admin screens. It is not needed once raw fetch is replaced with `apiClient`.

4. **Migrate data-fetching logic to React Query:**
   ```ts
   // Example for admin/index.tsx overview stats
   const { data: overview, isLoading, error } = useQuery({
     queryKey: ['admin', 'overview'],
     queryFn: () => apiClient.get('/admin/overview').then(r => r.data),
     staleTime: 60_000,
   });
   ```

5. **Migrate admin mutations (suspend user, approve payout, reject report) to `useMutation`:**
   ```ts
   const suspendMutation = useMutation({
     mutationFn: ({ userId, reason }: { userId: string; reason: string }) =>
       apiClient.post(`/admin/users/${userId}/suspend`, { reason }),
     onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'users'] }),
     onError: (err) => showToast(translateApiError(t, err)),
   });
   ```

6. **Verify `apiClient` import path** in each admin file: `import { apiClient } from '@/lib/api/client';`

7. **Clean up residual raw-auth patterns**: search admin directory for any remaining `Authorization:` header manual construction and remove them.

**Tests:** After this fix, open the admin section as an admin user in a dev build. Verify overview stats load, user list loads with search, payout list loads, and a test suspension correctly calls the API (confirm in network logs).

---

### FIX-04 — Fix `CURRENT_YEAR` ReferenceError in onboarding birth year field

**Bug fixed:** BUG-04

**File:** `apps/expo/app/onboarding/index.tsx`

**Step-by-step:**

1. Locate the `validateBirthYear` function. Inside it, `const CURRENT_YEAR = new Date().getFullYear();` is currently defined.

2. Move that constant to **module level** (top of the file, outside any function/component) or to a position **within the `OnboardingStep1` component body** (before the function definition), so it is in scope for the JSX:
   ```ts
   // At module level (top of file, before component definition):
   const CURRENT_YEAR = new Date().getFullYear();
   
   function validateBirthYear(value: string): string | undefined {
     // CURRENT_YEAR is now in scope from the outer module level
     if (!value) return t('onboarding.birthYearRequired');
     const year = parseInt(value, 10);
     if (isNaN(year) || year < CURRENT_YEAR - 120 || year > CURRENT_YEAR - 13) {
       return t('onboarding.birthYearInvalid');
     }
   }
   ```

3. Confirm the placeholder in JSX references `CURRENT_YEAR` correctly:
   ```jsx
   placeholder={`e.g. ${CURRENT_YEAR - 20}`}
   ```

4. Remove any duplicate `const CURRENT_YEAR` inside `validateBirthYear`.

**Tests:** Open the app as a new user (no account). Navigate to the onboarding flow. Confirm step 1 renders without a crash. Verify the year placeholder shows the correct year.

---

### FIX-05 — Guard `disconnectGooglePlayBilling()` from dropping in-flight purchases on app background

**Bug fixed:** BUG-05

**Files:**
- `apps/expo/lib/payments/googlePlay.ts`
- `apps/expo/app/_layout.tsx`

**Step-by-step:**

1. In `googlePlay.ts`, create a separate `endBillingConnection()` function that **only** calls `endConnection()` without clearing the resolver/session maps:
   ```ts
   export async function endBillingConnection(): Promise<void> {
     try {
       await endConnection();
     } catch {
       // ignore
     }
   }
   ```

2. Rename the current `disconnectGooglePlayBilling()` to `clearBillingState()` (or keep the name but change its body). In the body, **remove** the `purchaseResolvers.clear()` and `activePurchaseSessions.clear()` calls from the background handler. These maps should only be cleared on explicit failure or when the app fully terminates (not backgrounds):
   ```ts
   export function disconnectGooglePlayBilling(): void {
     // Only close the IPC connection — do NOT clear pending resolver maps here.
     // In-flight purchases may complete after the connection closes; we keep their
     // resolvers alive so the purchase listener can still resolve them on next init.
     endBillingConnection().catch(() => {});
   }
   ```

3. In `_layout.tsx`, locate the `AppState` change handler. In the `background` branch, call `endBillingConnection()` only (not `disconnectGooglePlayBilling()` that clears maps). On `active` (foreground return), call `initGooglePlayBilling()` as before to re-open the connection:
   ```ts
   if (nextState === 'background') {
     await endBillingConnection();
   } else if (nextState === 'active') {
     await initGooglePlayBilling();
   }
   ```

4. Add a cleanup in the purchase update listener for **timed-out** sessions: after the `setTimeout` fires (5-min timeout), the session is rejected and _then_ removed from the map. This is already correct — do not change the timeout cleanup logic.

5. Keep `purchaseResolvers.clear()` and `activePurchaseSessions.clear()` calls only in the terminal case (app is shutting down / `change` → `inactive` on iOS, which precedes terminate).

**Tests:** In a test build, start a coin purchase, immediately background the app (switch to another app), return within a few seconds, and confirm the purchase either completes successfully or times out with the "purchase timed out" error — it must not silently disappear.

---

## Pass 2 — HIGH (Deploy as second priority after CRITICAL fixes)

---

### FIX-06-07-08 — Add idempotency keys to DM, Room, and Group online send paths

**Bugs fixed:** BUG-06 (DM), BUG-07 (Room), BUG-08 (Group)

**Files:**
- `apps/expo/app/messages/[conversationId].tsx` (DM)
- `apps/expo/app/rooms/[roomId].tsx` (Room)
- `apps/expo/app/messages/group/[groupId].tsx` (Group)

**Step-by-step:**

1. Add `import { randomUUID } from 'expo-crypto';` to each of the three files (if not already present).

2. In **each send handler**, generate the idempotency key **before** the API call and include it in both the optimistic message and the request payload:

   **DM (`messages/[conversationId].tsx`):**
   ```ts
   const idempotencyKey = randomUUID();
   // add idempotencyKey to the optimistic message object (for dedup in prevMessageIdsRef if applicable)
   await apiClient.post(`/messages/dm/${conversationId}`, {
     content,
     messageType,
     idempotencyKey,
   });
   ```

   **Room (`rooms/[roomId].tsx`):**
   ```ts
   const idempotencyKey = randomUUID();
   await apiClient.post(`/rooms/${roomId}/messages`, {
     content,
     messageType,
     idempotencyKey,
   });
   ```

   **Group (`messages/group/[groupId].tsx`):**
   ```ts
   const idempotencyKey = randomUUID();
   await apiClient.post(`/messages/group/${groupId}`, {
     content,
     idempotencyKey,
   });
   ```

3. Where the offline queue `queueMessage()` is also called (on send failure), ensure the **same `idempotencyKey`** is passed to `queueMessage` so the backend deduplicates the eventual sync delivery as the same message:
   ```ts
   await queueMessage(conversationId, content, messageType, 'dm', idempotencyKey);
   //                                                                ^^^ same key as the failed online send
   ```

4. Confirm `queueMessage` in `lib/offline/sqlite.ts` already accepts and stores `idempotencyKey` (it does, per the summary).

**Backend note:** The backend `/messages/dm/:id`, `/rooms/:id/messages`, and `/messages/group/:id` POST endpoints must implement `ON CONFLICT (idempotency_key) DO NOTHING` (or equivalent) for deduplication to work. Confirm this with the backend team if not already done.

---

### FIX-10 — Fix infinite pagination reset loop in admin users screen

**Bug fixed:** BUG-10

**File:** `apps/expo/app/admin/users.tsx`

**Step-by-step:**

1. Convert `cursor` from `useState` to a `useRef` inside `loadUsers`, so cursor changes don't trigger `useCallback` recreation:

   ```ts
   const cursorRef = useRef<string | null>(null);
   
   const loadUsers = useCallback(async (reset = false) => {
     if (loading) return;
     setLoading(true);
     try {
       const params = new URLSearchParams({ search, limit: '20' });
       if (!reset && cursorRef.current) params.set('cursor', cursorRef.current);
       const { data } = await apiClient.get(`/admin/users?${params}`);
       if (reset) setUsers(data.items);
       else setUsers(prev => [...prev, ...data.items]);
       cursorRef.current = data.nextCursor ?? null;
       setHasMore(!!data.nextCursor);
     } catch (err) {
       showToast(translateApiError(t, err));
     } finally {
       setLoading(false);
     }
   }, [search]);  // ← cursor REMOVED from deps; search stays
   
   // This useEffect only re-fires when search changes (not on every page load)
   useEffect(() => {
     cursorRef.current = null;  // reset cursor when search changes
     void loadUsers(true);
   }, [loadUsers]);
   ```

2. Remove the `cursor` `useState` declaration if `cursorRef` fully replaces it. Keep `setHasMore` for the "load more" button visibility.

3. The "Load More" button's `onPress` should call `loadUsers(false)` (not reset) — confirm this is unchanged.

**Note:** Once BUG-01/02/03 are fixed (FIX-01), this file will be using `apiClient` instead of raw `fetch`. FIX-10 should be applied to the already-refactored file from FIX-01.

---

### FIX-11 — Add jitter to `apiFetch.ts` exponential backoff

**Bug fixed:** BUG-11

**File:** `apps/expo/lib/api/apiFetch.ts`

**Step-by-step:**

1. Locate the retry delay computation in `apiFetch.ts`. It currently reads:
   ```ts
   const delay = 500 * Math.pow(2, attempt);
   ```

2. Replace with full jitter (simplest, industry-standard approach):
   ```ts
   const baseDelay = 500 * Math.pow(2, attempt);
   const delay = Math.random() * baseDelay;
   // This spreads retries uniformly in [0, baseDelay], eliminating synchronized waves.
   ```

3. Optionally cap the delay at 30 seconds to prevent indefinitely long waits:
   ```ts
   const MAX_DELAY_MS = 30_000;
   const baseDelay = Math.min(500 * Math.pow(2, attempt), MAX_DELAY_MS);
   const delay = Math.random() * baseDelay;
   ```

No other changes to the retry logic are required.

---

### FIX-12-15 — Replace plain JS division with Decimal.js for all kobo-to-naira conversions

**Bugs fixed:** BUG-12, BUG-13, BUG-14, BUG-15

**Files:**
- `apps/expo/app/(tabs)/wallet.tsx`
- `apps/expo/app/economy/store.tsx`
- `apps/expo/app/admin/financial.tsx`

**Step-by-step:**

1. Create (or confirm the existence of) a shared utility in `apps/expo/lib/utils/currency.ts`:
   ```ts
   import Decimal from 'decimal.js';
   
   /** Convert integer kobo to a formatted Naira string. Example: 150050 → "₦1,500.50" */
   export function koboToNairaStr(kobo: number): string {
     return '₦' + new Decimal(kobo).div(100).toFixed(2)
       .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
   }
   
   /** Convert integer kobo to a Decimal for further arithmetic. */
   export function koboToDecimal(kobo: number): Decimal {
     return new Decimal(kobo).div(100);
   }
   
   /** For display as an integer Naira amount (truncated, not rounded — use sparingly). */
   export function koboToNairaInt(kobo: number): number {
     return new Decimal(kobo).div(100).floor().toNumber();
   }
   ```

2. **`apps/expo/app/(tabs)/wallet.tsx` line ~80:**
   Replace:
   ```ts
   const incomeMonth = Math.floor((earningsData?.month?.netKobo ?? 0) / 100);
   ```
   With:
   ```ts
   import { koboToNairaStr, koboToNairaInt } from '@/lib/utils/currency';
   const incomeMonth = koboToNairaInt(earningsData?.month?.netKobo ?? 0);
   ```

3. **`apps/expo/app/(tabs)/wallet.tsx` line ~172:**
   Replace:
   ```ts
   ((p.gross_kobo ?? 0) / 100).toLocaleString()
   ```
   With:
   ```ts
   koboToNairaStr(p.gross_kobo ?? 0)
   ```

4. **`apps/expo/app/economy/store.tsx` line ~128:**
   Replace:
   ```ts
   const amount = kobo / 100;
   ```
   With:
   ```ts
   import { koboToNairaStr } from '@/lib/utils/currency';
   const amountStr = koboToNairaStr(kobo);
   ```
   Adjust any downstream display to use `amountStr`.

5. **`apps/expo/app/admin/financial.tsx` lines ~28, ~55 (and any other occurrences):**
   Replace all `(kobo / 100).toLocaleString(...)` patterns with `koboToNairaStr(kobo)`.

6. Search the whole `apps/expo/` directory for remaining `/ 100` patterns in financial contexts:
   ```
   grep -n "/ 100" apps/expo/app
   ```
   Fix any remaining occurrences that operate on kobo values.

---

### FIX-21 — Populate real AdMob IDs in `eas.json` production profile

**Bug fixed:** BUG-21

**File:** `apps/expo/eas.json`

**Step-by-step:**

1. Obtain the real AdMob Android App ID from the Google AdMob console (format: `ca-app-pub-XXXXXXXXXXXXXXXX~XXXXXXXXXX`).
2. Obtain the real AdMob iOS App ID from the Google AdMob console.
3. In `eas.json`, under the `"production"` build profile's `"env"` block, replace the empty strings:
   ```json
   "ADMOB_APP_ID_ANDROID": "ca-app-pub-YOUR_REAL_ID~XXXXXXXXXX",
   "ADMOB_APP_ID_IOS": "ca-app-pub-YOUR_REAL_ID~XXXXXXXXXX"
   ```
4. Alternatively, store these IDs as **EAS Secrets** (preferred for security) and reference them as `$ADMOB_APP_ID_ANDROID` in `eas.json`. EAS Build will substitute secrets at build time.
5. Confirm `app.config.ts` correctly reads `process.env.ADMOB_APP_ID_ANDROID` and uses it in the `react-native-google-mobile-ads` plugin config, and only falls back to test IDs if the env var is falsy.
6. After the fix, do a production build and verify in the AdMob console that real ad requests are appearing (not test requests).

---

### FIX-22 — Implement DM reaction long-press (or disable inactive gesture)

**Bug fixed:** BUG-22

**File:** `apps/expo/app/messages/[conversationId].tsx`

**Two options (choose one):**

**Option A — Implement reaction picker (full fix):**
1. Create a `ReactionPickerModal` component (or reuse an existing modal pattern from rooms screen if reactions work there).
2. In `handleLongPress(messageId: string)`, open the modal: `setReactionPickerMessageId(messageId)`.
3. The modal should allow selecting an emoji reaction and then call:
   ```ts
   await apiClient.post(`/messages/dm/${conversationId}/messages/${messageId}/react`, { emoji });
   ```
4. On success, invalidate the messages query.

**Option B — Disable the no-op (minimal fix, removes confusing hint):**
1. Remove `onLongPress={handleLongPress}` from the MessageBubble invocation in the DM conversation screen.
2. Remove the empty `handleLongPress` function.
3. If the reaction strip "add" button (+) is rendered by MessageBubble based on `onLongPress` being defined, it will disappear automatically.

Option A is strongly preferred as it completes promised functionality.

---

### FIX-28 — Show user feedback when message is queued to SQLite offline queue

**Bug fixed:** BUG-28

**Files:**
- `apps/expo/app/messages/[conversationId].tsx`
- `apps/expo/app/rooms/[roomId].tsx`

**Step-by-step:**

1. In the `sendMutation.onError` handler (both files), after calling `queueMessage(...)`, add a toast notification:
   ```ts
   onError: async (err, variables) => {
     // Roll back optimistic update (existing code)
     // Queue to SQLite (existing code)
     await queueMessage(conversationId, variables.content, variables.messageType, 'dm', variables.idempotencyKey);
     
     // NEW: notify user the message is queued
     showToast(t('chat.messagedQueued'));  // "Message queued — will send when back online"
   }
   ```

2. Add the i18n key `chat.messagedQueued` to all locale files (`apps/expo/lib/i18n/locales/`).

3. Optionally, show a pending indicator on queued messages in the chat list. The SQLite-queued message can be surfaced in the UI with a clock icon. This requires reading pending messages from `getPendingMessages()` and merging them into the displayed list — this is a larger change and can be a follow-up ticket if needed.

---

### FIX-41 — Fix `app.json` extra config literal string substitution

**Bug fixed:** BUG-41

**Files:**
- `apps/expo/app.json`
- `apps/expo/app.config.ts`

**Step-by-step:**

1. In `app.json`, the `extra` block currently has:
   ```json
   "extra": {
     "APP_ENV": "$APP_ENV",
     "API_BASE_URL": "$API_BASE_URL"
   }
   ```
   These literal strings are NOT substituted by EAS Build in a static `app.json`. Remove them from `app.json`.

2. In `app.config.ts` (which IS a JS/TS file evaluated at build time, so `process.env` works), add the `extra` config:
   ```ts
   extra: {
     eas: { projectId: '...' },  // keep existing eas block
     APP_ENV: process.env.APP_ENV ?? 'development',
     API_BASE_URL: process.env.API_BASE_URL ?? 'https://zobia.vercel.app',
     // any other extra fields that were in app.json
   },
   ```

3. Verify `lib/env.ts` reads `Constants.expoConfig?.extra?.APP_ENV` and `Constants.expoConfig?.extra?.API_BASE_URL`. These will now receive the actual runtime values.

4. Run a dev build and log `Constants.expoConfig.extra` to confirm the values are no longer literal `"$APP_ENV"` strings.

---

### FIX-50 — Add `flushFailedPurchasesCachedAsPendingAndroid` to subscription purchase init

**Bug fixed:** BUG-50

**File:** `apps/expo/lib/payments/googlePlay.ts`

**Step-by-step:**

1. Locate `initGooglePlayBilling()`. After `await initConnection()` is called and before the purchase update listeners are registered, add:
   ```ts
   try {
     await flushFailedPurchasesCachedAsPendingAndroid();
   } catch {
     // non-fatal — stale pending transactions will be retried by Play Billing
   }
   ```
   This single call covers all product types (consumable, non-consumable, subscription) at init time, which is the correct placement per `react-native-iap` docs.

2. Verify that `flushFailedPurchasesCachedAsPendingAndroid` is already imported from `react-native-iap`.

3. Do not add a second call inside `purchaseSubscription()` itself — the init-time call is sufficient.

---

## Pass 3 — MEDIUM (After CRITICAL and HIGH passes are deployed and tested)

---

### FIX-09 — Bound `prevMessageIdsRef` Set size in rooms screen

**Bug fixed:** BUG-09

**File:** `apps/expo/app/rooms/[roomId].tsx`

**Step-by-step:**

1. Locate `prevMessageIdsRef`. After merging new messages and adding IDs, trim the set:
   ```ts
   const MAX_DEDUP_SIZE = 500;
   incomingIds.forEach(id => prevMessageIdsRef.current.add(id));
   
   if (prevMessageIdsRef.current.size > MAX_DEDUP_SIZE) {
     // Keep only the most recent MAX_DEDUP_SIZE IDs (last inserted = most recent in insertion order)
     const entries = [...prevMessageIdsRef.current];
     prevMessageIdsRef.current = new Set(entries.slice(-MAX_DEDUP_SIZE));
   }
   ```

---

### FIX-16 — Add concurrent-load guard to `loadInterstitialAd`

**Bug fixed:** BUG-16

**File:** `apps/expo/lib/ads/admob.ts`

**Step-by-step:**

1. Add a module-level guard flag (mirroring the existing `adLoading` guard for rewarded ads):
   ```ts
   let interstitialLoading = false;
   ```

2. At the start of `loadInterstitialAd`:
   ```ts
   export function loadInterstitialAd(): void {
     if (interstitialLoading || interstitialLoaded) return;
     interstitialLoading = true;
     // ...existing ad creation and listener setup...
   }
   ```

3. Set `interstitialLoading = false` in the ad loaded callback and in the ad failed-to-load callback.

---

### FIX-17 — Use ref guard (not state) for `RewardedAdButton` tap protection

**Bug fixed:** BUG-17

**File:** `apps/expo/components/ads/RewardedAdButton.tsx`

**Step-by-step:**

1. Add a ref for synchronous locking:
   ```ts
   const pendingRef = useRef(false);
   ```

2. In the `onPress` handler, check and set the ref synchronously before any async work:
   ```ts
   const handlePress = async () => {
     if (pendingRef.current) return;
     pendingRef.current = true;
     setLoading(true);
     try {
       await showRewardedAd();
     } finally {
       pendingRef.current = false;
       setLoading(false);
     }
   };
   ```

3. The `disabled` prop on the button can remain tied to `loading` for visual feedback, but the ref prevents double-invocations even before the state update renders.

---

### FIX-18 — Document client-side admin gate limitation; verify backend DB check

**Bug fixed:** BUG-18, BUG-46 (client-side admin check)

**Files:**
- `apps/expo/components/layout/SwipeDrawer.tsx`
- `apps/expo/app/(tabs)/_layout.tsx`

**Step-by-step:**

1. The client-side `user?.isAdmin === true` checks in `SwipeDrawer` and the tab layout are acceptable for **UI hiding only**. Add a brief comment:
   ```ts
   {/* UI-only gate — security is enforced on the backend for every admin API call */}
   {user?.isAdmin && <AdminNavItem />}
   ```

2. **Backend action required:** Confirm that every admin endpoint (`/api/admin/*`) independently verifies `is_admin = true` in the users table, not by trusting the JWT `isAdmin` claim. If the backend reads only from the JWT claim, this must be fixed server-side.

3. **Optional enhancement:** On first admin section entry, call `apiClient.get('/admin/verify')`. If it returns 403, hide the admin UI immediately (for revoked admins who still have a valid token with the `isAdmin` claim).

---

### FIX-19 — Fix legal URLs to use the correct domain

**Bug fixed:** BUG-19

**Files:**
- `apps/expo/app/auth/login.tsx`
- `apps/expo/app/settings/index.tsx`

**Step-by-step:**

1. In both files, replace hardcoded `https://zobia.app/terms` with the correct URL. Options:
   - Use the deployed domain: `https://zobia.vercel.app/terms` (same as `env.API_BASE_URL`)
   - Or define a constant `const LEGAL_BASE = env.API_BASE_URL;` and use `${LEGAL_BASE}/terms`, `${LEGAL_BASE}/privacy`

2. Change every occurrence of:
   - `https://zobia.app/terms` → `${env.API_BASE_URL}/terms`
   - `https://zobia.app/privacy` → `${env.API_BASE_URL}/privacy`

3. Ensure `env` is imported from `@/lib/env` in each file.

---

### FIX-20 — Add `expo-notifications` to `app.json` plugins

**Bug fixed:** BUG-20

**File:** `apps/expo/app.json`

**Step-by-step:**

1. In the `plugins` array of `app.json`, add:
   ```json
   [
     "expo-notifications",
     {
       "icon": "./assets/notification-icon.png",
       "color": "#ffffff",
       "sounds": ["./assets/sounds/notification.wav"]
     }
   ]
   ```
   Adjust `icon`, `color`, and `sounds` paths to match actual asset locations. If no custom icon/sound exist yet, a minimal entry suffices:
   ```json
   "expo-notifications"
   ```

2. Run `expo prebuild` to confirm no plugin conflicts arise.

---

### FIX-23 — Cache sticker packs with React Query in DM screen

**Bug fixed:** BUG-23

**File:** `apps/expo/app/messages/[conversationId].tsx`

**Step-by-step:**

1. Extract the sticker pack fetch into a `useQuery` hook:
   ```ts
   const { data: stickerPacks } = useQuery({
     queryKey: ['sticker-packs'],
     queryFn: () => apiClient.get('/stickers/packs').then(r => r.data.items ?? []),
     staleTime: 30 * 60 * 1000,  // 30 minutes — sticker packs rarely change
     gcTime: 60 * 60 * 1000,     // keep in cache for 1 hour
   });
   ```

2. Remove the existing `useEffect` + `useState` pattern that fetches sticker packs on `visible` change.

3. The sticker picker modal receives `stickerPacks` directly as a prop (always available from cache after first load).

---

### FIX-24 — Add TTL to chat message cache

**Bug fixed:** BUG-24

**File:** `apps/expo/lib/chat/messageCache.ts`

**Step-by-step:**

1. Modify `writeCachedMessages` to wrap the stored value with a timestamp:
   ```ts
   const CACHE_TTL_MS = 24 * 60 * 60 * 1000;  // 24 hours
   
   export function writeCachedMessages(conversationId: string, messages: Message[]): void {
     const payload = {
       messages: messages.slice(-50),
       cachedAt: Date.now(),
     };
     storage.set(`msg_cache_${conversationId}`, JSON.stringify(payload));
   }
   ```

2. Modify `readCachedMessages` to check the TTL:
   ```ts
   export function readCachedMessages(conversationId: string): Message[] | null {
     const raw = storage.getString(`msg_cache_${conversationId}`);
     if (!raw) return null;
     try {
       const { messages, cachedAt } = JSON.parse(raw);
       if (Date.now() - cachedAt > CACHE_TTL_MS) return null;  // stale — force fresh fetch
       return messages;
     } catch {
       return null;
     }
   }
   ```

---

### FIX-25 — Add `softwareKeyboardLayoutMode` to `app.json`

**Bug fixed:** BUG-25

**File:** `apps/expo/app.json`

**Step-by-step:**

1. In the `android` section of `app.json`, add:
   ```json
   "softwareKeyboardLayoutMode": "pan"
   ```

This is a single-line config change. After rebuilding, `KeyboardAvoidingView` will behave more predictably in chat screens.

---

### FIX-27 — Use dynamic keyboard offset in DM screen

**Bug fixed:** BUG-27

**File:** `apps/expo/app/messages/[conversationId].tsx`

**Step-by-step:**

1. Import `useSafeAreaInsets` from `react-native-safe-area-context`.
2. Import `useNavigation` and `useHeaderHeight` from `@react-navigation/elements` (or use the header height returned by Expo Router's native stack).
3. Replace the hardcoded offset:
   ```ts
   const insets = useSafeAreaInsets();
   const headerHeight = useHeaderHeight();  // from @react-navigation/elements
   
   <KeyboardAvoidingView
     behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
     keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight + insets.top : 0}
   >
   ```

Note: After BUG-25 is fixed (`softwareKeyboardLayoutMode: 'pan'`), the Android `behavior='height'` + `keyboardVerticalOffset=0` should behave correctly. The iOS change is the main value here.

---

### FIX-29 — Sanitize `activeFrameId` before URL construction in Avatar

**Bug fixed:** BUG-29

**File:** `apps/expo/components/ui/Avatar.tsx`

**Step-by-step:**

1. Before constructing `frameUri`, validate `activeFrameId`:
   ```ts
   const SAFE_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
   
   const frameUri =
     activeFrameId && SAFE_ID_RE.test(activeFrameId)
       ? `${env.API_BASE_URL}/cosmetics/frames/${activeFrameId}.png`
       : null;
   ```

2. If `activeFrameId` fails the check, log a warning in dev:
   ```ts
   if (activeFrameId && !SAFE_ID_RE.test(activeFrameId)) {
     if (__DEV__) console.warn(`[Avatar] Suspicious frameId rejected: ${activeFrameId}`);
   }
   ```

---

### FIX-30 — Fix `GameWebView` `originWhitelist` to use glob pattern

**Bug fixed:** BUG-30

**File:** `apps/expo/components/games/GameWebView.tsx`

**Step-by-step:**

1. Locate line ~114:
   ```jsx
   originWhitelist={[gameOrigin, 'about:blank']}
   ```

2. Replace with glob patterns:
   ```jsx
   originWhitelist={[`${gameOrigin}/*`, `${gameOrigin}`, 'about:blank']}
   ```
   This allows both the exact origin and all sub-paths.

---

### FIX-31 — Add dedicated group metadata endpoint and stop O(N) scan

**Bug fixed:** BUG-31

**Files:**
- `apps/expo/app/messages/group/[groupId].tsx`
- (Backend: requires a new GET `/messages/group/:groupId` endpoint)

**Step-by-step:**

1. **Backend action required:** Add a `GET /messages/group/:groupId` endpoint that returns `{ id, name, memberCount, avatarUrl }` for a single group.

2. In the frontend, replace `fetchGroupMeta`:
   ```ts
   const { data: groupMeta } = useQuery({
     queryKey: ['group-meta', groupId],
     queryFn: () => apiClient.get(`/messages/group/${groupId}/meta`).then(r => r.data),
     staleTime: 5 * 60 * 1000,
   });
   ```

3. Remove the `items.find()` O(N) scan.

---

### FIX-33 — Add `maxLength` to admin reason modal text input

**Bug fixed:** BUG-33

**File:** `apps/expo/app/admin/users.tsx`

**Step-by-step:**

1. Find the `ReasonModal` `TextInput` component (line ~95).
2. Add `maxLength={500}`:
   ```jsx
   <TextInput
     value={reason}
     onChangeText={setReason}
     multiline
     numberOfLines={4}
     maxLength={500}
     placeholder={t('admin.reasonPlaceholder')}
   />
   ```
3. Optionally show a character counter: `{reason.length}/500`.

---

### FIX-34 — Fix `maxLength` on delete account PIN input in settings

**Bug fixed:** BUG-34

**File:** `apps/expo/app/settings/index.tsx`

**Step-by-step:**

1. Find the delete account PIN `TextInput` (line ~1098).
2. Change `maxLength={8}` to `maxLength={4}`.

---

### FIX-35 — Migrate 2FA status fetch to React Query in settings

**Bug fixed:** BUG-35

**File:** `apps/expo/app/settings/index.tsx`

**Step-by-step:**

1. In `TwoFactorSection`, replace the `useEffect` + `apiClient.get` pattern with:
   ```ts
   const { data: userData } = useQuery({
     queryKey: ['user-me'],
     queryFn: () => apiClient.get('/users/me').then(r => r.data),
     staleTime: 5 * 60 * 1000,
   });
   const totpEnabled = userData?.user?.totp_enabled ?? false;
   ```

2. Remove `const [totpEnabled, setTotpEnabled] = useState(false)` if replaced by the derived value above.

3. The rest of the TOTP enable/disable mutation flow is unchanged.

---

### FIX-36 — Export user data as a file instead of text string

**Bug fixed:** BUG-36

**File:** `apps/expo/app/settings/index.tsx`

**Step-by-step:**

1. Import `expo-file-system`:
   ```ts
   import * as FileSystem from 'expo-file-system';
   ```

2. Replace the `Share.share({ message: ... })` call:
   ```ts
   const res = await apiClient.get('/users/me/export');
   const json = JSON.stringify(res.data, null, 2);
   const fileUri = `${FileSystem.cacheDirectory}zobia_export_${Date.now()}.json`;
   await FileSystem.writeAsStringAsync(fileUri, json, { encoding: FileSystem.EncodingType.UTF8 });
   await Share.share({ url: fileUri, title: t('settings.dataExportTitle') });
   ```

3. This creates a temp file in the app's cache directory and shares the file URL, which avoids Android text-size limits.

---

### FIX-37 — Add `expo-contacts` to `app.json` plugins

**Bug fixed:** BUG-37

**File:** `apps/expo/app.json`

**Step-by-step:**

1. In the `plugins` array, add:
   ```json
   "expo-contacts"
   ```
   Or with iOS description override:
   ```json
   ["expo-contacts", { "contactsPermission": "Zobia uses your contacts to help you find friends." }]
   ```

2. Rebuild with EAS to apply the native config.

---

### FIX-38 — Create a staging EAS build profile pointing to a staging API

**Bug fixed:** BUG-38

**File:** `apps/expo/eas.json`

**Step-by-step:**

1. In `eas.json`, change the `development` and `preview` profiles to point to a staging backend:
   ```json
   "development": {
     "env": {
       "API_BASE_URL": "https://zobia-staging.vercel.app",
       ...
     }
   },
   "preview": {
     "env": {
       "API_BASE_URL": "https://zobia-staging.vercel.app",
       ...
     }
   }
   ```

2. Deploy a staging instance of the backend API on Vercel (new Vercel project: `zobia-staging`). Wire it to a staging database (separate from production).

3. This prevents test builds from touching production data, push notification tokens, and payment systems.

**Note:** This is a full DevOps change, not just a code change. It requires setting up a staging Vercel deployment and database. Prioritize at infrastructure level.

---

### FIX-39 — Show user-facing message on push notification registration failure

**Bug fixed:** BUG-39

**File:** `apps/expo/app/_layout.tsx`

**Step-by-step:**

1. After the 3rd retry of push token registration fails, show an in-app alert or toast:
   ```ts
   if (attempt >= MAX_ATTEMPTS) {
     // Exhausted all retries
     showToast(t('notifications.registrationFailed'));
     // Optionally: set a flag in MMKV so settings can show "Push notifications are not set up"
     storage.set(STORE_KEYS.PUSH_REGISTRATION_FAILED, true);
     return;
   }
   ```

2. Add `t('notifications.registrationFailed')` to all locale files: `"Push notifications couldn't be set up. Go to Settings to retry."`

3. In the settings screen (notifications section), check the `PUSH_REGISTRATION_FAILED` MMKV flag and show a retry button that calls the push registration function again.

---

### FIX-40 — Move contacts API call to after onboarding is complete

**Bug fixed:** BUG-40

**File:** `apps/expo/app/onboarding/index.tsx`

**Step-by-step:**

1. Find the `contacts-check` API call in the onboarding step 1 handler.
2. Move it (or defer it via a flag) to the `onSuccess` callback of the final onboarding submission (step 3), when the account is guaranteed to exist:
   ```ts
   const onOnboardingComplete = async () => {
     // Submit profile (step 3) — existing code
     await submitProfile({ ... });
     
     // NOW safe to check contacts (account exists)
     if (pendingContactNumbers.length > 0) {
       try {
         await apiClient.post('/friends/contacts-check', { phoneNumbers: pendingContactNumbers });
       } catch {
         // non-fatal — contacts can be synced later
       }
     }
   };
   ```

3. Store the contacts in a `pendingContactNumbers` ref/state during step 1 (after permission + read), but defer the API call.

---

### FIX-42 — Gate home screen MMKV read on `storeReady`

**Bug fixed:** BUG-42

**File:** `apps/expo/app/(tabs)/index.tsx`

**Step-by-step:**

1. The `storeReady` state is managed in `_layout.tsx` and propagated via context (or can be added to a context). Confirm how `storeReady` is exposed.
2. In the home screen, wrap the `daily_login_last_date` MMKV read in a guard:
   ```ts
   useEffect(() => {
     if (!storeReady) return;  // wait for MMKV to initialize
     const lastDate = storage.getString(STORE_KEYS.DAILY_LOGIN_LAST_DATE);
     // ...existing daily login logic...
   }, [storeReady]);
   ```

3. This ensures MMKV reads never happen before `initStore()` completes.

---

### FIX-43 — Document QueryClient dependency in admin screens (no code change needed if root wraps)

**Bug fixed:** BUG-43

**File:** `apps/expo/app/admin/_layout.tsx`

**Step-by-step:**

1. After FIX-01 migrates admin screens to React Query, add a comment in `admin/_layout.tsx` noting the implicit dependency:
   ```ts
   // Note: Admin screens use React Query hooks. This layout must remain mounted
   // inside the root QueryClientProvider from app/_layout.tsx.
   ```

2. No code change required as long as the root layout provides `QueryClientProvider` (which it does). This is documentation-only.

---

### FIX-46 — Add SQLite offline queue fallback for group chat send failures

**Bug fixed:** BUG-46

**File:** `apps/expo/app/messages/group/[groupId].tsx`

**Step-by-step:**

1. Confirm `queueMessage` is already imported in this file (it is, per the summary).

2. In `sendMutation.onError`, call `queueMessage` with type `'group'`:
   ```ts
   onError: async (_err, variables) => {
     await queueMessage(groupId, variables.content, 'text', 'group', variables.idempotencyKey);
     showToast(t('chat.messageQueued'));
   }
   ```

3. The `syncQueue.ts` already routes group messages to `/messages/group/${conversationId}` via the `conversationType === 'group'` branch (confirmed in the code). The existing routing handles this.

---

### FIX-47 — Tighten push notification route allowlist regexes

**Bug fixed:** BUG-47

**File:** `apps/expo/app/_layout.tsx`

**Step-by-step:**

1. Review every regex in `VALID_PUSH_ROUTES` against the actual routes in `apps/expo/app/`. 

2. Replace any overly broad patterns (e.g. `/^\/[a-z]/`) with exact or narrow matches:
   ```ts
   const VALID_PUSH_ROUTES: RegExp[] = [
     /^\/messages\/dm\/[0-9a-f-]{36}$/,      // DM conversation (UUID)
     /^\/messages\/group\/[0-9a-f-]{36}$/,   // Group conversation (UUID)
     /^\/rooms\/[0-9a-f-]{36}$/,             // Room (UUID)
     /^\/profile\/[0-9a-f-]{36}$/,           // User profile (UUID)
     /^\/(tabs)\/(home|wallet|profile)$/,     // Tab screens
     // etc. — one entry per valid notification destination
   ];
   ```

3. Any `route` string from a push payload that doesn't match a regex should be rejected with a logged warning.

---

## Pass 4 — LOW (Final polish pass)

---

### FIX-26 — Memoize `isNewUser` calculation in home screen

**Bug fixed:** BUG-26

**File:** `apps/expo/app/(tabs)/index.tsx`

```ts
const isNewUser = useMemo(
  () => user?.joinedAt
    ? Date.now() - new Date(user.joinedAt).getTime() < 7 * 24 * 60 * 60 * 1000
    : false,
  [user?.joinedAt],
);
```

---

### FIX-32 — Trim fired timer IDs from `FloatingNotificationProvider`

**Bug fixed:** BUG-32

**File:** `apps/expo/components/providers/FloatingNotificationProvider.tsx`

**Step-by-step:**

1. When scheduling a timer, capture its ID and remove it after it fires:
   ```ts
   const timerId = setTimeout(() => {
     showNotification(notification);
     // Remove this timer's ID from the tracking array after it fires
     realtimeTimerIds.current = realtimeTimerIds.current.filter(id => id !== timerId);
   }, delay);
   realtimeTimerIds.current.push(timerId);
   ```

---

### FIX-44 — Replace regex HTML stripper with proper parser in `AnnouncementBanner`

**Bug fixed:** BUG-44

**File:** `apps/expo/components/announcements/AnnouncementBanner.tsx`

**Step-by-step:**

**Option A (lightweight):** Replace the regex with a two-pass approach that also decodes HTML entities:
```ts
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>?/gm, '')           // remove tags (improved pattern)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, '')              // remove numeric character refs
    .trim();
}
```

**Option B (robust):** Add `htmlparser2` or `html-entities` package and use a proper parser. This is overkill unless announcements can contain complex HTML.

Option A is sufficient if announcements are admin-entered (trusted source).

---

### FIX-45 — Verify i18n locale file format matches `compatibilityJSON: 'v4'`

**Bug fixed:** BUG-45

**File:** `apps/expo/lib/i18n/index.ts` + locale JSON files

**Step-by-step:**

1. Review locale files in `apps/expo/lib/i18n/locales/` (or equivalent path).
2. Confirm they use i18next v4 JSON format (flat namespace keys with `{{interpolation}}`).
3. If the files use v3 format (nested objects), either update the locale files to v4, or change `compatibilityJSON` to `'v3'` to match.
4. Run the app and navigate to at least 3 translated screens to verify no missing-key warnings in the console.

---

### FIX-48 — Pass `_tokenParams` through to Ably auth endpoint

**Bug fixed:** BUG-48

**File:** `apps/expo/lib/realtime/useRealtimeChannel.ts`

**Step-by-step:**

1. Locate the `authCallback` function.
2. Pass `tokenParams` to the backend auth endpoint so the backend can consider capability hints:
   ```ts
   authCallback: async (tokenParams, callback) => {
     try {
       const res = await apiClient.post('/realtime/auth', { tokenParams });
       callback(null, res.data);
     } catch (err) {
       callback(err as Error, null);
     }
   }
   ```

3. The backend Ably auth endpoint should use `tokenParams.capability` if provided, otherwise default to the channel's configured capability.

---

### FIX-49 — Replace route-param answer passing with navigation state in vibe-quiz

**Bug fixed:** BUG-49

**File:** `apps/expo/app/onboarding/vibe-quiz.tsx`

**Step-by-step:**

1. Instead of `router.push({ pathname, params: { answers: JSON.stringify(answers) } })`, store answers in MMKV (onboarding key) or in a React context:
   ```ts
   storage.set('onboarding_quiz_answers', JSON.stringify(answers));
   router.push('/onboarding/complete');
   ```

2. The next screen reads from MMKV and clears the key after submission.

This eliminates URL length concerns entirely.

---

## Summary Checklist

| Fix | Bugs | Priority | Files | Status |
|-----|------|----------|-------|--------|
| FIX-01 | BUG-01, 02, 03 | CRITICAL | `admin/*.tsx` | ☐ |
| FIX-04 | BUG-04 | CRITICAL | `onboarding/index.tsx` | ☐ |
| FIX-05 | BUG-05 | CRITICAL | `googlePlay.ts`, `_layout.tsx` | ☐ |
| FIX-06-07-08 | BUG-06, 07, 08 | HIGH | `[conversationId].tsx`, `[roomId].tsx`, `[groupId].tsx` | ☐ |
| FIX-10 | BUG-10 | HIGH | `admin/users.tsx` | ☐ |
| FIX-11 | BUG-11 | HIGH | `lib/api/apiFetch.ts` | ☐ |
| FIX-12-15 | BUG-12, 13, 14, 15 | HIGH | `wallet.tsx`, `store.tsx`, `financial.tsx` | ☐ |
| FIX-21 | BUG-21 | HIGH | `eas.json` | ☐ |
| FIX-22 | BUG-22 | HIGH | `[conversationId].tsx` | ☐ |
| FIX-28 | BUG-28 | HIGH | `[conversationId].tsx`, `[roomId].tsx` | ☐ |
| FIX-41 | BUG-41 | HIGH | `app.json`, `app.config.ts` | ☐ |
| FIX-50 | BUG-50 | HIGH | `googlePlay.ts` | ☐ |
| FIX-09 | BUG-09 | MEDIUM | `[roomId].tsx` | ☐ |
| FIX-16 | BUG-16 | MEDIUM | `lib/ads/admob.ts` | ☐ |
| FIX-17 | BUG-17 | MEDIUM | `RewardedAdButton.tsx` | ☐ |
| FIX-18 | BUG-18 | MEDIUM | `SwipeDrawer.tsx`, `_layout.tsx` | ☐ |
| FIX-19 | BUG-19 | MEDIUM | `login.tsx`, `settings/index.tsx` | ☐ |
| FIX-20 | BUG-20 | MEDIUM | `app.json` | ☐ |
| FIX-23 | BUG-23 | MEDIUM | `[conversationId].tsx` | ☐ |
| FIX-24 | BUG-24 | MEDIUM | `lib/chat/messageCache.ts` | ☐ |
| FIX-25 | BUG-25 | MEDIUM | `app.json` | ☐ |
| FIX-27 | BUG-27 | MEDIUM | `[conversationId].tsx` | ☐ |
| FIX-29 | BUG-29 | MEDIUM | `Avatar.tsx` | ☐ |
| FIX-30 | BUG-30 | MEDIUM | `GameWebView.tsx` | ☐ |
| FIX-31 | BUG-31 | MEDIUM | `group/[groupId].tsx` (+ backend) | ☐ |
| FIX-33 | BUG-33 | MEDIUM | `admin/users.tsx` | ☐ |
| FIX-34 | BUG-34 | MEDIUM | `settings/index.tsx` | ☐ |
| FIX-35 | BUG-35 | MEDIUM | `settings/index.tsx` | ☐ |
| FIX-36 | BUG-36 | MEDIUM | `settings/index.tsx` | ☐ |
| FIX-37 | BUG-37 | MEDIUM | `app.json` | ☐ |
| FIX-38 | BUG-38 | MEDIUM | `eas.json` (+ DevOps) | ☐ |
| FIX-39 | BUG-39 | MEDIUM | `_layout.tsx` | ☐ |
| FIX-40 | BUG-40 | MEDIUM | `onboarding/index.tsx` | ☐ |
| FIX-42 | BUG-42 | MEDIUM | `(tabs)/index.tsx` | ☐ |
| FIX-43 | BUG-43 | MEDIUM | `admin/_layout.tsx` (docs) | ☐ |
| FIX-46 | BUG-46 | MEDIUM | `group/[groupId].tsx` | ☐ |
| FIX-47 | BUG-47 | MEDIUM | `_layout.tsx` | ☐ |
| FIX-26 | BUG-26 | LOW | `(tabs)/index.tsx` | ☐ |
| FIX-32 | BUG-32 | LOW | `FloatingNotificationProvider.tsx` | ☐ |
| FIX-44 | BUG-44 | LOW | `AnnouncementBanner.tsx` | ☐ |
| FIX-45 | BUG-45 | LOW | `lib/i18n/index.ts` | ☐ |
| FIX-48 | BUG-48 | LOW | `useRealtimeChannel.ts` | ☐ |
| FIX-49 | BUG-49 | LOW | `onboarding/vibe-quiz.tsx` | ☐ |

---

## Dependencies and Ordering Notes

- **FIX-01 must precede FIX-10**: The admin pagination fix should be applied to the already-refactored React Query version, not the raw-fetch version.
- **FIX-41 must precede any EAS build changes**: `app.json`→`app.config.ts` migration is foundational; `eas.json` staging changes (FIX-38) should be done after.
- **FIX-25 is a prerequisite for FIX-27**: `softwareKeyboardLayoutMode: 'pan'` is the most impactful fix for Android keyboard issues; the dynamic offset (FIX-27) is secondary.
- **FIX-06-07-08 should be deployed atomically**: All three send paths should get idempotency keys in the same release to ensure consistent deduplication behavior.
- **BUG-31 (FIX-31) requires backend work**: A new API endpoint must ship before the frontend change, or the frontend falls back gracefully on 404.
- **BUG-38 (FIX-38) is a prerequisite for any production payments testing**: Without staging, every dev test of payments hits real Google Play Billing and real users.

---

*Plan generated: June 25, 2026 — 12:00 PM*
