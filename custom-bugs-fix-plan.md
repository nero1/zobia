# Zobia Expo App — Bug Fix Plan

**Generated:** 2026-06-26 10:02 UTC  
**Scope:** All 38 bugs identified in `custom-bugs-report.md`  
**Status:** PLAN ONLY — no fixes applied. DO NOT implement until this plan is reviewed and approved.

---

## Overview

This plan is organized into four phases matching severity. Within each phase, tasks are listed in implementation order — dependencies between fixes are noted. Each task references the bug ID from the report and specifies exact files, line numbers, and the code change required.

| Phase | Severity | Bugs | Estimated effort |
|-------|----------|------|-----------------|
| 1 | 🔴 CRITICAL | BUG-001, 002, 003, 004 | ~4–6 h |
| 2 | 🟠 HIGH | BUG-005 – 013 | ~6–8 h |
| 3 | 🟡 MEDIUM | BUG-014 – 028 | ~8–10 h |
| 4 | 🟢 LOW | BUG-029 – 038 | ~4–5 h |

**Total estimated effort: ~22–29 developer-hours**  
**Recommended execution order:** strictly Phase 1 → 2 → 3 → 4.  
BUG-002 and BUG-009 share the same root cause and must be fixed together.  
BUG-003 should be fixed before BUG-012 (both touch PIN lockout keys).  
BUG-004 and BUG-031 should be fixed in the same commit (same file, related policy).

---

## Phase 1 — Critical Bugs (fix first, blocks testing everything else)

---

### TASK-001 · Fix Google OAuth deep-link callback validation (BUG-001)

**File:** `apps/expo/app/auth/login.tsx`  
**Lines to change:** ~84–93

**Problem:** `new URL('zobia://auth/callback').origin` returns the string `'null'` in React Native's JS engine — not the API base URL origin. The origin comparison fails silently for every Google OAuth attempt on Android. Also the pathname check expects `/api/auth/callback` but the actual callback path is `/auth/callback`.

**Steps:**
1. Locate the `handleDeepLink` function in `login.tsx`.
2. Find the block that sets `isValidCallback` via an `origin` + `pathname` comparison.
3. Replace the entire validation block with a scheme + path based check that handles both the `zobia://` custom scheme and universal links:

```ts
// BEFORE (broken):
const parsedUrl = new URL(url);
const expectedOrigin = new URL(env.API_BASE_URL).origin;
isValidCallback = parsedUrl.origin === expectedOrigin &&
                  parsedUrl.pathname.startsWith('/api/auth/callback');

// AFTER:
let isValidCallback = false;
try {
  const parsed = new URL(url);
  const isCustomScheme =
    parsed.protocol === 'zobia:' || parsed.protocol === 'exp+zobia-social:';
  const isUniversalLink =
    parsed.origin === new URL(env.API_BASE_URL).origin;
  const hasAuthPath =
    parsed.pathname === '/auth/callback' ||
    parsed.pathname.startsWith('/api/auth/callback');
  isValidCallback = (isCustomScheme || isUniversalLink) && hasAuthPath;
} catch {
  isValidCallback = false;
}
```

4. Verify the `exchangingRef` guard (idempotency) remains intact immediately above — do not remove it.
5. Test: trigger a Google login flow on Android; confirm the `exchangingRef` guard fires and `code` is exchanged.

---

### TASK-002 · Fix Android keyboard avoidance app-wide (BUG-002 + BUG-009)

**Files:**
- `apps/expo/app.json`
- `apps/expo/app/messages/[conversationId].tsx` (~line 756)
- `apps/expo/app/rooms/[roomId].tsx` (all `KeyboardAvoidingView` usages)
- Any other screen with a `KeyboardAvoidingView` and `behavior` conditioned on iOS

**Problem:** `softwareKeyboardLayoutMode: "adjustNothing"` tells Android not to resize the window on keyboard show. Every screen then uses `behavior={Platform.OS === 'ios' ? 'padding' : undefined}` — `undefined` is a no-op. The keyboard overlaps every chat input on Android, which is the primary platform.

**Steps:**

1. **`app.json`:** Change:
   ```json
   // BEFORE:
   "softwareKeyboardLayoutMode": "adjustNothing"

   // AFTER:
   "softwareKeyboardLayoutMode": "adjustResize"
   ```
   (Or remove the key entirely; the default is `adjustResize`.)

2. **`messages/[conversationId].tsx` (~line 756):** Change `KeyboardAvoidingView` props:
   ```tsx
   // BEFORE:
   <KeyboardAvoidingView
     behavior={Platform.OS === 'ios' ? 'padding' : undefined}
     keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
   >

   // AFTER:
   <KeyboardAvoidingView
     behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
     keyboardVerticalOffset={Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 88}
   >
   ```
   Ensure `StatusBar` is imported from `react-native`.

3. **`rooms/[roomId].tsx`:** Find every `KeyboardAvoidingView` and apply the same change as step 2. Also fix `keyboardOffset=0` on Android if it exists.

4. **Search for any other `KeyboardAvoidingView` components** across the codebase:
   ```
   grep -r "KeyboardAvoidingView" apps/expo/app
   ```
   Apply the same fix to each one found.

5. **After changing `app.json`**, a full `eas build` is required (native config change). A JS-only OTA push is not sufficient.

---

### TASK-003 · Fix PIN screen undefined constants — compile error / security bypass (BUG-003)

**File:** `apps/expo/app/settings/pin.tsx`  
**Lines:** ~31–32 (declaration) + ~151, 154, 179, 182 (usage)

**Problem:** Constants declared as `PIN_PIN_MAX_ATTEMPTS` and `PIN_PIN_LOCKOUT_MS` (double "PIN" prefix) but used as `PIN_MAX_ATTEMPTS` and `PIN_LOCKOUT_MS` (single prefix). The used names are not declared anywhere. TypeScript strict mode will refuse to compile; in a permissive build the lockout never fires, allowing unlimited PIN brute-force.

**Steps:**
1. Find the two constant declarations near the top of `pin.tsx`.
2. Rename them by removing one "PIN" from each:
   ```ts
   // BEFORE:
   const PIN_PIN_MAX_ATTEMPTS = 5;
   const PIN_PIN_LOCKOUT_MS = 60_000;

   // AFTER:
   const PIN_MAX_ATTEMPTS = 5;
   const PIN_LOCKOUT_MS = 60_000;
   ```
3. Run `npx tsc --noEmit` in `apps/expo/` to confirm the compile error is resolved.
4. Manually verify the lockout logic: enter a wrong PIN 5 times and confirm the screen enters locked state for 60 seconds.

> **Note:** Also see TASK-012 which adds `STORE_KEYS` entries for the PIN lockout MMKV keys — coordinate the two tasks so pin.tsx uses the new constants in both commits.

---

### TASK-004 · Unify EAS runtimeVersion policy (BUG-004 + BUG-031)

**Files:**
- `apps/expo/app.json`
- `apps/expo/eas.json`

**Problem (BUG-004):** `app.json` uses `"policy": "sdkVersion"` but `eas.json` development/preview/staging profiles override it with `"policy": "appVersion"`. These produce different runtime version strings; OTA updates from one build profile are silently incompatible with clients from another.

**Problem (BUG-031):** `sdkVersion` policy assigns the same runtime version to all builds of the same Expo SDK, even if native module versions differ — OTA updates can be delivered to incompatible native shells.

**Steps:**
1. **`app.json`:** Update the `runtimeVersion` field:
   ```json
   // BEFORE:
   "runtimeVersion": { "policy": "sdkVersion" }

   // AFTER:
   "runtimeVersion": { "policy": "fingerprint" }
   ```

2. **`eas.json`:** Remove `runtimeVersion` overrides from all non-production profiles (development, preview, staging) so they all inherit from `app.json`:
   ```json
   // BEFORE (development profile example):
   "development": {
     "runtimeVersion": { "policy": "appVersion" },
     ...
   }

   // AFTER:
   "development": {
     // runtimeVersion line removed — inherits "fingerprint" from app.json
     ...
   }
   ```
   Repeat for `preview` and `staging` profiles.

3. **Important:** After this change, all previously distributed builds (development APKs, TestFlight builds) will require a new native build before they can receive OTA updates. Notify the team before merging.

---

## Phase 2 — High Severity Bugs

---

### TASK-005 · Fix 2FA TOTP lockout race condition on first render (BUG-005)

**File:** `apps/expo/app/auth/two-factor.tsx`

**Problem:** `totpAttemptsRef.current` starts at `0` on mount; MMKV hydration happens in a `useEffect` which fires asynchronously. A fast user can submit one code before the effect fires, getting a free attempt past a lockout.

**Steps:**
1. Find `const totpAttemptsRef = useRef<number>(0)` (or equivalent).
2. Replace with a synchronous initializer that reads from MMKV at declaration time:
   ```ts
   // BEFORE:
   const totpAttemptsRef = useRef<number>(0);

   // AFTER:
   const totpAttemptsRef = useRef<number>(
     (() => {
       try { return storage.getNumber(STORE_KEYS.TOTP_FAILED_ATTEMPTS) ?? 0; } catch { return 0; }
     })()
   );
   ```
3. Find the `lockedUntil` state initialization and make it synchronous:
   ```ts
   // BEFORE:
   const [lockedUntil, setLockedUntil] = useState<number>(0);
   // with useEffect that reads from MMKV...

   // AFTER:
   const [lockedUntil, setLockedUntil] = useState<number>(() => {
     try { return storage.getNumber(STORE_KEYS.TOTP_LOCKED_UNTIL) ?? 0; } catch { return 0; }
   });
   ```
4. If a `useEffect` existed solely to hydrate these values from MMKV, remove it.
5. Confirm `STORE_KEYS.TOTP_FAILED_ATTEMPTS` and `STORE_KEYS.TOTP_LOCKED_UNTIL` exist in `lib/offline/store.ts`; add them if missing.

---

### TASK-006 · Fix IAP coin pack product matching by productId not coinAmount (BUG-006)

**Files:**
- `apps/expo/lib/payments/googlePlay.ts`
- `apps/expo/app/economy/store.tsx`

**Problem:** The purchase listener resolves which coin pack was purchased by matching `coinAmount` — if two products have the same coin count at different prices, the wrong resolver fires.

**Steps:**
1. **`googlePlay.ts`:** Find the `activePurchaseSessions` Map. Change the key from `coinAmount` (number) to `productId` (string):
   ```ts
   // BEFORE:
   activePurchaseSessions.set(pack.coinAmount, resolver);

   // AFTER:
   activePurchaseSessions.set(pack.productId, resolver);
   ```
2. In the purchase listener (`purchaseUpdatedListener` callback), change the resolver lookup:
   ```ts
   // BEFORE:
   const resolver = purchaseResolvers.get(serverProduct.coinAmount);

   // AFTER:
   const resolver = purchaseResolvers.get(purchase.productId);
   ```
   (Also update `purchaseResolvers` Map accordingly if it uses the same key scheme.)
3. **`store.tsx`:** Update `handleBuyPack` to pass `productId` when registering the session:
   ```ts
   // BEFORE:
   activePurchaseSessions.set(pack.coinAmount, ...);

   // AFTER:
   activePurchaseSessions.set(pack.productId, ...);
   ```
4. Ensure the `pendingRecovery` cleanup paths use `productId` too.
5. Test with two different products to confirm the correct resolver fires.

---

### TASK-007 · Add LIMIT to SQLite offline queue fetch (BUG-007)

**File:** `apps/expo/lib/offline/sqlite.ts`  
**Lines:** ~238–242

**Problem:** `getPendingMessages()` fetches all pending rows with no `LIMIT`, risking OOM on large queues.

**Steps:**
1. Find the SQL string in `getPendingMessages()`:
   ```ts
   // BEFORE:
   `SELECT ... FROM offline_messages WHERE sync_status = 'pending' ORDER BY created_at ASC`

   // AFTER:
   `SELECT ... FROM offline_messages WHERE sync_status = 'pending' ORDER BY created_at ASC LIMIT 100`
   ```
2. In `syncQueue.ts`, after processing the batch, check if the returned batch was full (100 items) and if so, schedule another sync iteration immediately rather than waiting for the next NetInfo event. This ensures large queues are drained in successive passes without blocking.

---

### TASK-008 · Add cleanup for permanently-failed SQLite messages (BUG-008)

**File:** `apps/expo/lib/offline/sqlite.ts`

**Problem:** Rows with `sync_status = 'permanent_failure'` accumulate indefinitely.

**Steps:**
1. Add a new export function at the bottom of `sqlite.ts`:
   ```ts
   export async function purgePermanentlyFailedMessages(
     olderThanMs = 7 * 24 * 60 * 60 * 1000
   ): Promise<void> {
     const cutoff = Date.now() - olderThanMs;
     await getDB().runAsync(
       `DELETE FROM offline_messages WHERE sync_status = 'permanent_failure' AND created_at < ?`,
       [cutoff]
     );
   }
   ```
2. In `syncQueue.ts`, call `purgePermanentlyFailedMessages()` at the end of a successful `syncPendingMessages()` run (not on every call, only when the sync completes without itself erroring):
   ```ts
   // End of syncPendingMessages:
   await purgePermanentlyFailedMessages();
   ```
3. Optionally expose a "clear failed messages" button in the settings screen for user-initiated cleanup.

---

### TASK-009 · Note: BUG-009 is fixed as part of TASK-002

BUG-009 (DM/Group chat `KeyboardAvoidingView behavior={undefined}` on Android) shares the same root cause as BUG-002. The fix in TASK-002 step 2 directly resolves BUG-009. No separate task required.

---

### TASK-010 · Wire AppState foreground event to reconnect Ably (BUG-010)

**File:** `apps/expo/lib/realtime/useRealtimeChannel.ts`  
**Lines:** ~38–120

**Problem:** If the Ably WebSocket enters `suspended` state (extended backoff), it won't reconnect until the app is restarted. The hook doesn't wire AppState foreground events to trigger reconnection.

**Steps:**
1. Inside the `useEffect` (after `ablyClient = client` is assigned), add an AppState change listener:
   ```ts
   import { AppState } from 'react-native';

   // Inside the async IIFE, after ablyClient = client:
   const appStateSubscription = AppState.addEventListener('change', (nextState) => {
     if (
       nextState === 'active' &&
       ablyClient &&
       ablyClient.connection.state !== 'connected' &&
       ablyClient.connection.state !== 'connecting'
     ) {
       ablyClient.connect();
     }
   });
   ```
2. Update the `cleanup` closure to also remove the AppState listener:
   ```ts
   cleanup = () => {
     appStateSubscription.remove();
     ch.unsubscribe();
     client.close();
   };
   ```
3. Also update the early `cancelled` path to remove the listener:
   ```ts
   if (cancelled) {
     appStateSubscription.remove();
     ch.unsubscribe();
     client.close();
     return;
   }
   ```
4. Ensure `AppState` is imported from `react-native` at the top of the file.

---

### TASK-011 · Clean up GIF picker debounce timer on modal unmount (BUG-011)

**File:** `apps/expo/app/messages/[conversationId].tsx`  
**Lines:** ~328, ~343–349

**Problem:** `debounceRef.current = setTimeout(...)` is never cleared when the GIF picker modal unmounts. Fires into stale state.

**Steps:**
1. Locate the `GifPickerModal` component (or the modal content block within `[conversationId].tsx`).
2. Add a cleanup `useEffect` that clears the debounce timer on unmount:
   ```ts
   useEffect(() => {
     return () => {
       if (debounceRef.current) {
         clearTimeout(debounceRef.current);
         debounceRef.current = null;
       }
     };
   }, []); // empty dep — run only on mount/unmount
   ```
3. If `debounceRef` is defined inside the main screen component and passed down, verify the cleanup fires when the modal is dismissed (not just when the entire screen unmounts). If needed, move the ref and cleanup into the `GifPickerModal` component scope.

---

### TASK-012 · Register PIN lockout MMKV keys in STORE_KEYS (BUG-012)

**Files:**
- `apps/expo/lib/offline/store.ts`
- `apps/expo/app/economy/store.tsx`
- `apps/expo/app/settings/pin.tsx` (coordinate with TASK-003)

**Problem:** `store.tsx` uses raw strings `'store_pin_failed_attempts'` and `'store_pin_locked_until'` that bypass `STORE_KEYS` — they won't be cleared on sign-out and aren't auditable.

**Steps:**
1. **`lib/offline/store.ts`:** Add to the `STORE_KEYS` constant:
   ```ts
   STORE_PIN_FAILED_ATTEMPTS: 'store_pin_failed_attempts',
   STORE_PIN_LOCKED_UNTIL: 'store_pin_locked_until',
   ```
2. **`apps/expo/app/economy/store.tsx`:** Replace every raw string:
   ```ts
   // BEFORE:
   storage.getNumber('store_pin_failed_attempts')
   storage.set('store_pin_locked_until', ...)

   // AFTER:
   storage.getNumber(STORE_KEYS.STORE_PIN_FAILED_ATTEMPTS)
   storage.set(STORE_KEYS.STORE_PIN_LOCKED_UNTIL, ...)
   ```
   (Import `STORE_KEYS` from `lib/offline/store` if not already imported.)
3. **`apps/expo/app/settings/pin.tsx`:** If `pin.tsx` also uses similar raw PIN lockout keys, update them to use `STORE_KEYS` entries.
4. **Verify `clearStore()`** in `lib/offline/store.ts` iterates `STORE_KEYS` or calls `storage.clearAll()` — if it enumerates keys manually, the new entries must be added there too.

---

### TASK-013 · Validate auth user JSON before setting state (BUG-013)

**File:** `apps/expo/lib/auth/context.tsx`

**Problem:** `setUser(JSON.parse(userJson) as AuthUser)` — no type guard; malformed JSON throws, partial objects silently cast.

**Steps:**
1. Find the `onUserUpdated` event handler in `AuthProvider`.
2. Replace the raw parse+cast:
   ```ts
   // BEFORE:
   const handler = (userJson: string) => {
     setUser(JSON.parse(userJson) as AuthUser);
   };

   // AFTER:
   const handler = (userJson: string) => {
     try {
       const parsed = JSON.parse(userJson);
       if (
         parsed &&
         typeof parsed === 'object' &&
         typeof parsed.id === 'string' &&
         typeof parsed.username === 'string'
       ) {
         setUser(parsed as AuthUser);
       } else {
         console.warn('[auth] onUserUpdated: unexpected shape', parsed);
       }
     } catch {
       console.warn('[auth] onUserUpdated: malformed user JSON');
     }
   };
   ```
   Adjust the shape checks to match the `AuthUser` interface's required fields (at minimum `id` and one identifier field).
3. Optionally use the existing Zod schema for `AuthUser` if one exists in the codebase:
   ```ts
   const result = AuthUserSchema.safeParse(JSON.parse(userJson));
   if (result.success) setUser(result.data);
   ```

---

## Phase 3 — Medium Severity Bugs

---

### TASK-014 · Register `daily_login_last_date` in STORE_KEYS (BUG-014)

**Files:**
- `apps/expo/lib/offline/store.ts`
- `apps/expo/app/(tabs)/index.tsx` (~lines 909–934)

**Steps:**
1. Add to `STORE_KEYS` in `store.ts`:
   ```ts
   DAILY_LOGIN_LAST_DATE: 'daily_login_last_date',
   ```
2. In `index.tsx`, replace:
   ```ts
   // BEFORE:
   storage.getString('daily_login_last_date')
   storage.set('daily_login_last_date', today)

   // AFTER:
   storage.getString(STORE_KEYS.DAILY_LOGIN_LAST_DATE)
   storage.set(STORE_KEYS.DAILY_LOGIN_LAST_DATE, today)
   ```

---

### TASK-015 · Add realtime updates to messages tab conversation list (BUG-015)

**File:** `apps/expo/app/(tabs)/messages.tsx` (~lines 261–285)

**Problem:** Conversation list has `staleTime: 30_000` and no realtime subscription — badge counts and last-message previews can be 30 s stale.

**Options (choose one — option A is recommended):**

**Option A — Realtime subscription (preferred):**
1. Import `useRealtimeChannel` from `lib/realtime/useRealtimeChannel`.
2. Get the current user ID from `useAuth()`.
3. Subscribe to `user:{userId}:inbox` channel:
   ```ts
   const { data: user } = useAuth();
   useRealtimeChannel(
     user ? `user:${user.id}:inbox` : null,
     (event) => {
       if (event === 'new_message' || event === 'read_receipt') {
         queryClient.invalidateQueries({ queryKey: ['dm-list'] });
       }
     }
   );
   ```
4. Confirm the backend publishes `new_message` events to this channel.

**Option B — Reduced stale time (simpler fallback):**
1. Change `staleTime: 30_000` → `staleTime: 5_000`.
2. Add `refetchOnWindowFocus: true` to the query options.

---

### TASK-016 · Add pagination to wallet transaction history (BUG-016)

**File:** `apps/expo/app/economy/wallet.tsx`

**Problem:** Only 30 transactions fetched; no way to see older history.

**Steps:**
1. Convert the transactions fetch to use `useInfiniteQuery` from `@tanstack/react-query`:
   ```ts
   const {
     data,
     fetchNextPage,
     hasNextPage,
     isFetchingNextPage,
   } = useInfiniteQuery({
     queryKey: ['wallet-transactions'],
     queryFn: ({ pageParam }) =>
       apiClient
         .get<WalletData>(`/economy/coins/balance?limit=30${pageParam ? `&before=${pageParam}` : ''}`)
         .then(r => r.data),
     getNextPageParam: (lastPage) =>
       lastPage.transactions.length === 30
         ? lastPage.transactions[lastPage.transactions.length - 1].id
         : undefined,
     initialPageParam: undefined,
   });
   ```
2. Change the `FlatList` (or `ScrollView`) to use `data.pages.flatMap(p => p.transactions)`.
3. Add `onEndReached={() => { if (hasNextPage && !isFetchingNextPage) fetchNextPage(); }}` to the `FlatList`.
4. Add a loading indicator when `isFetchingNextPage` is true.
5. If the backend doesn't yet support cursor pagination, work with the backend team to add it; as an interim, increase the limit to 100.

---

### TASK-017 · Fix ConfettiOverlay fixed dimensions (BUG-017)

**File:** `apps/expo/components/ui/ConfettiOverlay.tsx`  
**Lines:** ~4–5

**Steps:**
1. Remove the module-level `Dimensions.get('window')` call.
2. Add `useWindowDimensions` import:
   ```ts
   import { useWindowDimensions } from 'react-native';
   ```
3. Inside the component function body, replace with:
   ```ts
   const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = useWindowDimensions();
   ```
4. Ensure `SCREEN_WIDTH` and `SCREEN_HEIGHT` are not used in any static style object created outside the component — move those style calculations inside the component or use them inline.

---

### TASK-018 · Fix variable shadowing of `t` in FloatingNotificationProvider (BUG-018)

**File:** `apps/expo/components/providers/FloatingNotificationProvider.tsx`  
**Lines:** ~194, 213, 301, 310

**Steps:**
1. Search for all occurrences of `.filter(t =>` inside this file.
2. Rename the filter parameter from `t` to `id` in each:
   ```ts
   // BEFORE:
   realtimeTimerIds.current = realtimeTimerIds.current.filter(t => t !== tid);

   // AFTER:
   realtimeTimerIds.current = realtimeTimerIds.current.filter(id => id !== tid);
   ```
3. Repeat for any other `.filter(t =>` or `.map(t =>` callbacks in this file that shadow the `t` translation function.
4. Run `npx eslint apps/expo/components/providers/FloatingNotificationProvider.tsx --rule '{"no-shadow": "error"}'` to confirm no shadows remain.

---

### TASK-019 · Add IAP purchase confirmation dialog (BUG-019)

**File:** `apps/expo/app/economy/store.tsx`  
(in `handleBuyPack` or `purchaseCoinPack` function)

**Steps:**
1. Find where `initiatePurchase(pack)` is called after PIN verification succeeds.
2. Wrap it in an `Alert.alert` confirmation:
   ```ts
   import { Alert } from 'react-native';

   // Before calling initiatePurchase:
   Alert.alert(
     t('store.confirmTitle', { coins: pack.coinAmount }),
     t('store.confirmBody', { price: pack.priceLabel }),
     [
       { text: t('common.cancel'), style: 'cancel' },
       {
         text: t('store.buyNow'),
         onPress: () => void initiatePurchase(pack),
       },
     ]
   );
   ```
3. Add the i18n keys `store.confirmTitle`, `store.confirmBody`, and `store.buyNow` to all locale files in `apps/expo/locales/` (en, fr, ar, ha, sw, am, zu, pt, pidgin).

---

### TASK-020 · Add GDPR/UMP consent flow for AdMob (BUG-020)

**File:** `apps/expo/lib/ads/admob.ts`

**Problem:** `mobileAds().initialize()` is called without checking GDPR consent — violates EU law and Google policies for EEA users.

**Steps:**
1. Import UMP consent helpers from `react-native-google-mobile-ads` v13+:
   ```ts
   import { AdsConsent, AdsConsentStatus } from 'react-native-google-mobile-ads';
   ```
2. Create an `initializeAds()` async function that gates initialization on consent:
   ```ts
   export async function initializeAds(): Promise<void> {
     const consentInfo = await AdsConsent.requestInfoUpdate();
     if (consentInfo.isConsentFormAvailable) {
       await AdsConsent.loadAndShowConsentFormIfRequired();
     }
     const { status } = await AdsConsent.getConsentInfo();
     // Initialize ads regardless of consent status — SDK will serve
     // non-personalized ads if consent was denied.
     await mobileAds().initialize();
   }
   ```
3. Replace the existing `mobileAds().initialize()` call with `initializeAds()`.
4. Ensure `initializeAds()` is called early in the app lifecycle (e.g., in `_layout.tsx` or `App.tsx`), after the user profile is known.
5. Add `testDeviceIdentifiers` for development builds to avoid accidental policy violations during testing.

---

### TASK-021 · Fix rewarded ad daily cap to use local midnight (BUG-021)

**File:** `apps/expo/components/ads/RewardedAdButton.tsx`

**Steps:**
1. Find the `today` variable computed with `.toISOString().slice(0, 10)`.
2. Replace with a local-date computation:
   ```ts
   // BEFORE:
   const today = new Date().toISOString().slice(0, 10); // UTC

   // AFTER:
   const now = new Date();
   const today = [
     now.getFullYear(),
     String(now.getMonth() + 1).padStart(2, '0'),
     String(now.getDate()).padStart(2, '0'),
   ].join('-'); // local date
   ```
3. If the stored cap date was previously in UTC and users have existing data, the change is backwards-compatible (old UTC date will not match new local date, effectively resetting the cap once — acceptable).

---

### TASK-022 · Fix admin overview showing zeros after error (BUG-022)

**File:** `apps/expo/app/admin/index.tsx`  
**Lines:** ~51–60

**Steps:**
1. Add an `error` state variable:
   ```ts
   const [error, setError] = useState<string | null>(null);
   ```
2. In `loadStats()`, set `error` on failure and clear it on success:
   ```ts
   try {
     const data = await fetchAdminStats();
     setStats(data);
     setError(null);
   } catch (e) {
     setError(e instanceof Error ? e.message : 'Failed to load stats');
   }
   ```
3. In the render, add an early return for the error state (above the stats render):
   ```tsx
   if (error) {
     return (
       <View style={styles.center}>
         <Text style={styles.errorText}>{error}</Text>
         <TouchableOpacity onPress={loadStats} style={styles.retryButton}>
           <Text>Retry</Text>
         </TouchableOpacity>
       </View>
     );
   }
   ```
4. Remove the `Alert.alert` error approach (or keep it as a secondary notification, but don't leave the zeros visible after dismissal).

---

### TASK-023 · Guard `JSON.parse(vibeAnswersParam)` in welcome-drop (BUG-023)

**File:** `apps/expo/app/onboarding/welcome-drop.tsx`

**Steps:**
1. Find the `JSON.parse(vibeAnswersParam)` call.
2. Wrap in try-catch with a safe fallback:
   ```ts
   // BEFORE:
   const vibeAnswers = JSON.parse(vibeAnswersParam);

   // AFTER:
   let vibeAnswers: unknown = [];
   try {
     if (vibeAnswersParam) {
       vibeAnswers = JSON.parse(vibeAnswersParam);
     }
   } catch {
     // Malformed URL param — proceed with empty answers; API will handle gracefully.
   }
   ```

---

### TASK-024 · Show error and retry on onboarding API failure (BUG-024)

**File:** `apps/expo/app/onboarding/welcome-drop.tsx`  
(in `completeOnboarding` or equivalent function)

**Steps:**
1. Add an `error` state:
   ```ts
   const [submitError, setSubmitError] = useState<string | null>(null);
   ```
2. In the completion handler, show an error on failure and only navigate + set MMKV on success:
   ```ts
   // BEFORE (failure silently swallowed):
   try {
     await apiClient.post('/onboarding/complete', payload);
   } catch {}
   storage.set(STORE_KEYS.ONBOARDING_COMPLETE, true);
   router.replace('/(tabs)');

   // AFTER:
   try {
     await apiClient.post('/onboarding/complete', payload);
     storage.set(STORE_KEYS.ONBOARDING_COMPLETE, true);
     router.replace('/(tabs)');
   } catch {
     setSubmitError(t('onboarding.completeError'));
   }
   ```
3. Render `submitError` in the UI with a "Try Again" button that re-calls the completion function.
4. Add i18n key `onboarding.completeError` to all locale files.

---

### TASK-025 · Decouple `/users/me` fetch from token refresh path (BUG-025)

**File:** `apps/expo/lib/api/client.ts`  
(inside `refreshAccessToken`)

**Problem:** Token refresh also calls `/users/me`, adding latency on the critical path for every blocked API call.

**Steps:**
1. Find the `/users/me` API call inside `refreshAccessToken`.
2. Remove it from the token refresh function. The refresh should only:
   - Call the refresh token endpoint
   - Store the new access and refresh tokens in SecureStore
   - Return the new access token
3. Move the user profile sync to a separate call that is triggered after successful login/token refresh but does not block the queued request retry:
   ```ts
   // After refreshAccessToken resolves (in the response interceptor):
   queryClient.invalidateQueries({ queryKey: ['users', 'me'] });
   // This triggers a background refetch without blocking the original request.
   ```
4. Ensure the `queryClient` reference is accessible in the axios interceptor (pass it via closure when setting up the interceptor).

---

### TASK-026 · Document `google-services.json` requirement (BUG-026)

**Files:**
- `apps/expo/README.md` (create if missing) or root `README.md`
- Optionally: EAS Secrets setup

**Steps:**

**Option A — Documentation only (quick):**
1. Add a "Local Setup" section to the relevant README:
   ```md
   ## Local Setup

   ### Firebase / Push Notifications
   `google-services.json` is not committed to the repo. To build locally or via EAS:
   1. Go to the Firebase Console → Project Settings → Your Android App
   2. Download `google-services.json`
   3. Place it at `apps/expo/google-services.json`
   4. Do NOT commit this file (it is gitignored).
   ```

**Option B — EAS Secrets (recommended for CI/CD):**
1. Add `google-services.json` as an EAS secret:
   ```sh
   eas secret:create --scope project --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json
   ```
2. In `eas.json`, reference the secret:
   ```json
   "env": {
     "GOOGLE_SERVICES_FILE": "/path/from/secret"
   }
   ```
3. Update `app.json` to reference the env variable.

---

### TASK-027 · Reduce MMKV chat cache TTL / handle server-side deletions (BUG-027)

**File:** `apps/expo/lib/chat/messageCache.ts`

**Problem:** Deleted messages remain in MMKV cache for up to 24 hours.

**Steps:**
1. Reduce the cache TTL from 24 hours to 2–4 hours (balances freshness vs. re-fetch cost):
   ```ts
   // BEFORE:
   const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

   // AFTER:
   const CACHE_TTL_MS = 2 * 60 * 60 * 1000;
   ```
2. After each delta fetch (`?after=lastTimestamp`) returns results, prune the cache to remove any message IDs that are no longer in the server's response for that time window. This requires the server to return tombstones or the client to compare IDs in the overlap window.
3. If the backend can return a `deleted_ids` array in the delta response, filter those from the cache on each merge:
   ```ts
   if (deltaResponse.deleted_ids?.length) {
     const cached = getCachedMessages(conversationId);
     const filtered = cached.filter(m => !deltaResponse.deleted_ids.includes(m.id));
     setCachedMessages(conversationId, filtered);
   }
   ```
4. If the backend cannot return tombstones yet, the TTL reduction in step 1 alone is an acceptable interim fix.

---

### TASK-028 · Invalidate room query when countdown reaches zero (BUG-028)

**File:** `apps/expo/app/rooms/[roomId].tsx`  
(countdown timer / `timeLeft` state)

**Steps:**
1. Add a `useRef` to track the previous `timeLeft` value:
   ```ts
   const prevTimeLeftRef = useRef(timeLeft);
   ```
2. Add a `useEffect` that fires a query invalidation on the `0` transition:
   ```ts
   useEffect(() => {
     if (prevTimeLeftRef.current > 0 && timeLeft === 0) {
       queryClient.invalidateQueries({ queryKey: ['room', roomId] });
     }
     prevTimeLeftRef.current = timeLeft;
   }, [timeLeft, roomId, queryClient]);
   ```
3. Ensure `queryClient` is available via `useQueryClient()` in this component.
4. Test: observe that room state transitions to "live" on the client within one polling cycle after the timer hits 0.

---

## Phase 4 — Low Severity Bugs

---

### TASK-029 · Improve MMKV proxy error message (BUG-029)

**File:** `apps/expo/lib/offline/store.ts`

**Steps:**
1. Find the Proxy `get` trap that throws when `_store` is not initialized.
2. Include the accessed key in the error:
   ```ts
   // BEFORE:
   throw new Error('Store not initialized — call initStore() first');

   // AFTER:
   throw new Error(
     `[MMKV] Store not ready (accessed: "${String(prop)}"). Ensure initStore() is called in app bootstrap before this component mounts.`
   );
   ```

---

### TASK-030 · Downgrade targetSdkVersion to 34 for Expo SDK 51 compatibility (BUG-030)

**File:** `apps/expo/app.json`

**Problem:** Expo SDK 51 is certified for Android API 34; API 36 may trigger runtime behavior changes that the SDK's native modules haven't been tested against.

**Steps:**
1. In `app.json`, update the Android SDK version fields:
   ```json
   // BEFORE:
   "compileSdkVersion": 36,
   "targetSdkVersion": 36

   // AFTER:
   "compileSdkVersion": 35,
   "targetSdkVersion": 34
   ```
2. Leave `minSdkVersion` unchanged.
3. When upgrading to Expo SDK 53+ (which targets API 35/36), revert this change.
4. A full native rebuild is required.

> **Note:** BUG-031 (OTA fingerprint policy) is addressed in TASK-004.

---

### TASK-031 · Note: BUG-031 is fixed in TASK-004 (Phase 1)

The `fingerprint` OTA policy fix in TASK-004 also resolves BUG-031. No separate task.

---

### TASK-032 · Add client-side admin route guard (BUG-032)

**File:** `apps/expo/app/admin/_layout.tsx`

**Steps:**
1. Add an `isAdmin` check at the top of the admin layout component:
   ```tsx
   import { Redirect } from 'expo-router';
   import { useAuth } from '@/lib/auth/context';

   export default function AdminLayout() {
     const { user } = useAuth();
     if (!user?.isAdmin) {
       return <Redirect href="/(tabs)" />;
     }
     // ... rest of layout
   }
   ```
2. This guard is a UX improvement only — API-level 403 enforcement is the security layer. The client-side guard prevents confusing empty/error screens for non-admin deep-link attempts.

---

### TASK-033 · Only PATCH settings if value changed (BUG-033)

**File:** `apps/expo/app/settings/index.tsx`  
**Lines:** ~779, 791, 801

**Steps:**
1. For each `TextInput` that calls `patchMutation.mutate` in its `onEndEditing` handler, add an original-value ref:
   ```ts
   const originalDisplayNameRef = useRef(data?.displayName ?? '');
   ```
2. Update the handler to compare before patching:
   ```tsx
   onEndEditing={() => {
     if (merged.displayName !== originalDisplayNameRef.current) {
       patchMutation.mutate({ displayName: merged.displayName });
     }
   }}
   ```
3. Reset the ref when `data` changes (e.g., after a successful mutation):
   ```ts
   useEffect(() => {
     if (data?.displayName !== undefined) {
       originalDisplayNameRef.current = data.displayName;
     }
   }, [data?.displayName]);
   ```
4. Apply the same pattern to all other patched fields (bio, username, etc.) in this screen.

---

### TASK-034 · Fix pidgin suggestion word boundary replacement (BUG-034)

**File:** `apps/expo/app/messages/[conversationId].tsx`  
**Lines:** ~830–836

**Steps:**
1. Find the suggestion chip `onPress` handler that calls `split(' ')` and replaces `words[words.length - 1]`.
2. Add a `trimEnd()` before splitting to eliminate trailing space confusion:
   ```ts
   // BEFORE:
   const words = prev.split(' ');
   words[words.length - 1] = s;
   return words.join(' ') + ' ';

   // AFTER:
   const trimmed = prev.trimEnd();
   const words = trimmed.split(' ');
   words[words.length - 1] = s;
   return words.join(' ') + ' ';
   ```
3. Additionally, only show suggestions when the cursor is mid-word (no trailing space in the raw input). Add a check:
   ```ts
   const showSuggestions = inputText.length > 0 && !inputText.endsWith(' ');
   ```

---

### TASK-035 · Treat `isInternetReachable === null` as unknown, not offline (BUG-035)

**File:** `apps/expo/lib/offline/syncQueue.ts`  
**Lines:** ~37–39

**Steps:**
1. Find the connectivity guard at the start of `syncPendingMessages()`:
   ```ts
   // BEFORE:
   if (!state.isConnected || !state.isInternetReachable) { return; }

   // AFTER:
   if (!state.isConnected) return; // null = no info yet, treat as potentially offline
   if (state.isInternetReachable === false) return; // explicit false = definitely offline
   // null = still checking — proceed optimistically
   ```

---

### TASK-036 · Retry Ably authCallback after silent JWT refresh on 401 (BUG-036)

**File:** `apps/expo/lib/realtime/useRealtimeChannel.ts`  
**Lines:** ~62–74

**Steps:**
1. Import `refreshAccessToken` from `lib/auth/context` or `lib/api/client`:
   ```ts
   import { refreshAccessToken } from '@/lib/auth/context';
   ```
2. In the `authCallback` catch block, attempt a refresh before failing:
   ```ts
   } catch (err) {
     const axiosErr = err as import('axios').AxiosError;
     if (axiosErr?.response?.status === 401) {
       try {
         await refreshAccessToken();
         const { data } = await apiClient.get(
           `/realtime/ably-token?channel=${encodeURIComponent(channel)}`
         );
         callback(null, data);
         return;
       } catch {
         // refresh also failed — fall through to error path
       }
     }
     callback(err, null);
   }
   ```

---

### TASK-037 · Remove `onSubmitEditing` from multiline chat TextInput (BUG-037)

**File:** `apps/expo/app/messages/[conversationId].tsx`  
**Lines:** ~892–895

**Steps:**
1. Find the multiline message `TextInput` with `onSubmitEditing={handleSend}`.
2. Remove the `onSubmitEditing` prop:
   ```tsx
   // BEFORE:
   <TextInput
     multiline
     returnKeyType="send"
     onSubmitEditing={handleSend}
     ...
   />

   // AFTER:
   <TextInput
     multiline
     // returnKeyType and onSubmitEditing removed — send button is the only trigger
     ...
   />
   ```
3. Confirm the send button still calls `handleSend` correctly.
4. If users expect an explicit send key option, a future enhancement could add a settings toggle for "Enter sends" vs "Enter inserts newline" — do not implement now.

---

### TASK-038 · Clear SQLite offline queue on sign-out (BUG-038)

**Files:**
- `apps/expo/lib/offline/sqlite.ts`
- `apps/expo/lib/offline/store.ts` (or `lib/auth/context.tsx` sign-out handler)

**Steps:**
1. **`sqlite.ts`:** Add a `clearOfflineQueue()` export:
   ```ts
   export async function clearOfflineQueue(): Promise<void> {
     await getDB().runAsync('DELETE FROM offline_messages');
   }
   ```
2. **Sign-out path** (either `clearStore()` in `store.ts` or the sign-out handler in `auth/context.tsx`): call `clearOfflineQueue()`:
   ```ts
   import { clearOfflineQueue } from '@/lib/offline/sqlite';

   export async function signOut(): Promise<void> {
     await clearOfflineQueue(); // clear pending messages before clearing auth state
     clearStore();
     // ... rest of sign-out
   }
   ```
   Note: `clearOfflineQueue` is async; ensure the sign-out path awaits it.
3. If sign-out is triggered from multiple places, centralise it through a single `signOut()` function in `auth/context.tsx` to avoid missing the cleanup.

---

## Test Checklist

After applying all fixes, verify the following before shipping:

### Phase 1 smoke tests (must pass before merging)
- [ ] Google OAuth login completes on Android (custom scheme callback is accepted)
- [ ] Opening a DM chat on Android shows the keyboard without covering the input bar
- [ ] Setting/changing a PIN without lockout allows 5 attempts then locks for 60 s
- [ ] OTA update pushed from staging is NOT delivered to a production client (confirms policy isolation)
- [ ] `npx tsc --noEmit` passes with zero errors in `apps/expo/`

### Phase 2 smoke tests
- [ ] 2FA screen shows locked state immediately on mount after a previous lockout
- [ ] Purchasing two different coin packs (if available in test environment) credits the correct amount for each
- [ ] Sending 101 messages offline doesn't cause OOM — queue fetch returns ≤100 at a time
- [ ] Permanently-failed messages older than 7 days are deleted after sync
- [ ] Dismissing the GIF picker mid-search doesn't produce "setState on unmounted" warnings
- [ ] MMKV `clearStore()` on sign-out clears PIN lockout counters

### Phase 3 smoke tests
- [ ] Conversation list badge updates within 5 s of a new message arriving
- [ ] Wallet shows "Load More" / scroll-to-load for accounts with >30 transactions
- [ ] Confetti overlay particles fill the screen correctly after a 90° rotation
- [ ] Purchasing a coin pack shows a confirmation dialog before billing flow starts
- [ ] App built in EU region serves non-personalized ads only (or consent form shown)
- [ ] Rewarded ad cap resets at local midnight for a UTC+12 test device
- [ ] Admin page shows Retry button (not zeros) after a simulated 500 error
- [ ] Welcome-drop screen doesn't crash when `vibeAnswersParam` is malformed or absent
- [ ] Onboarding completion shows error state (not silent loop) when API returns 5xx

### Phase 4 smoke tests
- [ ] MMKV early-access error includes the key name in the message
- [ ] Android API 34 target builds and runs without permission regressions
- [ ] Deep-linking to `zobia://admin` as a non-admin user redirects to tabs
- [ ] Settings screen does NOT fire a PATCH request when blurring a field without changing it
- [ ] Typing `"hello world "` then tapping a Pidgin suggestion produces `"hello world <suggestion>"` (not `"hello <suggestion>"`)
- [ ] First sync after cold launch processes pending messages (null `isInternetReachable` not treated as offline)
- [ ] Long background period followed by foreground does NOT leave Ably in permanent failed state
- [ ] Pressing Enter in the DM chat text input inserts a newline (does not send)
- [ ] Sign out then sign in as a different account does not retry previous user's queued messages

---

## Commit Strategy

Suggested grouping to keep diffs reviewable:

| Commit | Tasks |
|--------|-------|
| `fix: critical auth, keyboard, PIN, OTA` | TASK-001, 002, 003, 004 |
| `fix: IAP product matching and confirmation` | TASK-006, 019 |
| `fix: offline queue limits and cleanup` | TASK-007, 008, 038 |
| `fix: 2FA lockout race condition` | TASK-005 |
| `fix: realtime reconnection and auth retry` | TASK-010, 036 |
| `fix: MMKV key registry hygiene` | TASK-012, 013, 014, 029 |
| `fix: GIF picker debounce cleanup` | TASK-011 |
| `fix: wallet pagination` | TASK-016 |
| `fix: screen dimensions and confetti` | TASK-017 |
| `fix: settings patch on change only` | TASK-033 |
| `fix: GDPR UMP consent for AdMob` | TASK-020 |
| `fix: admin UX and guard` | TASK-022, 032 |
| `fix: onboarding robustness` | TASK-023, 024 |
| `fix: miscellaneous medium bugs` | TASK-015, 018, 021, 025, 026, 027, 028 |
| `fix: low severity bugs` | TASK-030, 034, 035, 037 |

---

*Plan generated: 2026-06-26 10:02 UTC*  
*38 bugs across 4 phases — DO NOT apply any fix until this plan is reviewed and approved*
