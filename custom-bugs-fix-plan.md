# Zobia Expo App — Bug Fix Plan

**Generated:** June 26, 2026 08:23 AM  
**Reference:** See `custom-bugs-report.md` for full forensic analysis and pre/post ratings  
**Rule:** Fix in priority order (CRITICAL → HIGH → MEDIUM → LOW). Do NOT fix any bug until the report is reviewed.

---

## Phase 1 — CRITICAL (Fix First, These Block Production Safety)

### Task C-1 · Add `displayName` to token-refresh user object

**Files to change:**
- `apps/expo/lib/api/client.ts`

**Exact change:** In `refreshAccessToken()`, inside the `meRes.ok` block where `updatedUser` is built (~line 168), add the missing field:
```ts
displayName: (me.displayName ?? me.display_name ?? '') as string,
```
Place it after `username` in the object literal.

**Acceptance criteria:** After a forced token rotation (e.g., manually expire the token in SecureStore), every screen that renders `user.displayName` still shows the correct name.

---

### Task C-2 · Declare `total` state in admin payouts screen

**Files to change:**
- `apps/expo/app/admin/payouts.tsx`

**Steps:**
1. Add state: `const [total, setTotal] = useState(0);` (with other state declarations near the top of `AdminPayoutsScreen`).
2. In `loadPayouts()`, after `setPayouts(...)`, add: `if (reset) setTotal(data.totalCount ?? fetched.length);` (use whichever field the `/admin/payouts` API returns for the total count — check the API contract).
3. In the tab-change `useEffect`, add `setTotal(0);` alongside `setPayouts([])`.

**Acceptance criteria:** Admin payouts screen renders without crashing; header shows the correct count.

---

### Task C-3 · Replace MMKV token reads in admin refunds with `apiClient`

**Files to change:**
- `apps/expo/app/admin/refunds.tsx`

**Steps:**
1. Remove the `import { storage } from '@/lib/offline/store';` line.
2. Add `import { apiClient } from '@/lib/api/client';`.
3. Replace `loadRefunds()` raw `fetch` call with `apiClient.get(...)`.
4. Replace `handleIssueRefund()` raw `fetch` call with `apiClient.post(...)`.
5. Remove `const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? '';` (no longer needed).
6. Update response parsing to use the Axios `{ data }` shape (same pattern as `admin/payouts.tsx`).

**Acceptance criteria:** Admin refunds screen loads data and successfully issues refunds when authenticated as admin.

---

### Task C-4 · Defer cold-start notification navigation until nav tree is ready

**Files to change:**
- `apps/expo/app/_layout.tsx`

**Steps:**
1. Add a ref at the top of `RootLayoutNav`: `const pendingNotifAction = useRef<string | null>(null);`
2. In the startup `useEffect`, replace:
   ```ts
   try { router.push(action as Parameters<typeof router.push>[0]); } catch {}
   ```
   with:
   ```ts
   pendingNotifAction.current = action;
   ```
3. Add a new `useEffect` that fires once auth and store are ready:
   ```ts
   useEffect(() => {
     if (isLoading || !storeReady || !user) return;
     const action = pendingNotifAction.current;
     if (!action) return;
     pendingNotifAction.current = null;
     if (VALID_PUSH_ROUTES.some((re) => re.test(action))) {
       try { router.push(action as Parameters<typeof router.push>[0]); } catch {}
     }
   }, [isLoading, storeReady, user, router]);
   ```

**Acceptance criteria:** Tapping a push notification that cold-starts the app navigates to the correct screen after auth resolves.

---

## Phase 2 — HIGH (Fix Before App Store Submission)

### Task H-1 · Deploy Android `assetlinks.json`

**Files to create/change:**
- `apps/web/public/.well-known/assetlinks.json` (new file)

**Steps:**
1. In Google Play Console → App Integrity → App Signing, copy the SHA-256 certificate fingerprint for the production signing key.
2. Create `apps/web/public/.well-known/assetlinks.json`:
   ```json
   [{
     "relation": ["delegate_permission/common.handle_all_urls"],
     "target": {
       "namespace": "android_app",
       "package_name": "org.zobia.social",
       "sha256_cert_fingerprints": ["<PRODUCTION_SHA256_HERE>"]
     }
   }]
   ```
3. Ensure the Next.js / Vercel deployment serves this file with `Content-Type: application/json` and no cache headers that would prevent Android from fetching it during verification.
4. Verify with: `adb shell pm get-app-links --user 0 org.zobia.social` — expect `VERIFIED`.

**Acceptance criteria:** Universal links (profile URLs, room invites, OAuth callbacks) open directly in the app on Android without a browser hop.

---

### Task H-2 · Fix Play Billing subscription upgrade to use purchase token

**Files to change:**
- `apps/expo/lib/payments/googlePlay.ts`

**Steps:**
1. Add a persistent storage map for active subscription purchase tokens. A good place is an MMKV key or the existing `subscriptionOfferTokens` Map pattern:
   ```ts
   // In googlePlay.ts (module-level)
   const activeSubscriptionTokens = new Map<string, string>(); // productId → purchaseToken
   ```
   Persist this to MMKV so it survives app restarts: `STORE_KEYS.ACTIVE_SUB_TOKENS` (add to store.ts).
2. In the `purchaseUpdatedListener` callback, when a subscription purchase succeeds and is verified, store the purchase token:
   ```ts
   if (isSubscription && verifyResult !== null && purchaseToken) {
     activeSubscriptionTokens.set(productId, purchaseToken);
     // Also persist to MMKV
   }
   ```
3. In `purchaseSubscription()`, replace:
   ```ts
   replaceSku: oldProductId,
   prorationMode: 2,
   ```
   with:
   ```ts
   purchaseTokenAndroid: activeSubscriptionTokens.get(oldProductId) ?? await getStoredSubToken(oldProductId),
   ```
   The react-native-iap v12 field for subscription replacement on Android is `purchaseTokenAndroid` (check the library's TypeScript types for the exact field name in your version; it may be nested in `subscriptionUpdateParams`).
4. Remove the `oldProductId` parameter from the function signature; replace with `oldPurchaseToken?: string`.
5. Update the call site in `store.tsx` to pass the stored purchase token instead of the old product ID.

**Acceptance criteria:** Upgrading from Plus → Pro on an active subscription creates a single prorated subscription change without creating a parallel subscription.

---

### Task H-3 · Add production AdMob ad unit IDs to EAS config

**Files to change:**
- `apps/expo/eas.json`

**Steps:**
1. In the Google AdMob Console, create ad units for: Rewarded (Android), Banner (Android), Interstitial (Android). Note the unit IDs.
2. Add the IDs as EAS secrets: `eas secret:create --name EXPO_PUBLIC_ADMOB_REWARDED_ANDROID --value ca-app-pub-xxx~yyy`  (repeat for each unit).
3. In `eas.json` production `android.env`, add:
   ```json
   "EXPO_PUBLIC_ADMOB_REWARDED_ANDROID": "$EXPO_PUBLIC_ADMOB_REWARDED_ANDROID",
   "EXPO_PUBLIC_ADMOB_BANNER_ANDROID": "$EXPO_PUBLIC_ADMOB_BANNER_ANDROID",
   "EXPO_PUBLIC_ADMOB_INTERSTITIAL_ANDROID": "$EXPO_PUBLIC_ADMOB_INTERSTITIAL_ANDROID"
   ```

**Acceptance criteria:** A production build's rewarded/banner/interstitial ads serve real ads (not Google test ads). Confirm by checking AdMob console impressions after a test install of the production build.

---

### Task H-4 · Fix `apiFetch` to use in-memory token cache and handle 401

**Files to change:**
- `apps/expo/lib/api/apiFetch.ts`
- `apps/expo/lib/api/client.ts`

**Steps:**
1. In `client.ts`, export a getter: `export function getCachedToken(): string | null { return _cachedToken; }`
2. In `apiFetch.ts`, import it: `import { JWT_KEY, getCachedToken, refreshAccessToken, setCachedToken } from '@/lib/api/client';`
3. Replace the `SecureStore.getItemAsync(JWT_KEY)` call:
   ```ts
   const token = getCachedToken() ?? await SecureStore.getItemAsync(JWT_KEY).catch(() => null);
   if (token && !getCachedToken()) setCachedToken(token);
   ```
4. After the retry loop, add 401 handling: if the final response is 401, call `refreshAccessToken()`, update the `Authorization` header, and issue one more request.

**Acceptance criteria:** `apiFetch` no longer incurs SecureStore disk reads on repeated calls; 401 responses trigger token refresh and request retry.

---

### Task H-5 · Remove stale `setUser(parsedUser)` after token refresh in auth restore

**Files to change:**
- `apps/expo/lib/auth/context.tsx`

**Steps:**
1. In the startup restore `useEffect`, remove the `setUser(parsedUser)` call from the `if (newAccessToken)` branch.
2. The `notifyUserUpdated` path (called inside `refreshAccessToken()`) already calls `setUser(updatedUser)`. Rely on that.
3. Fallback: if `notifyUserUpdated` does not fire (the `/users/me` fetch failed), re-read from SecureStore after the refresh:
   ```ts
   const newAccessToken = await refreshAccessToken();
   if (newAccessToken) {
     setCachedToken(newAccessToken);
     setToken(newAccessToken);
     // Re-read the updated user from SecureStore (set by refreshAccessToken → notifyUserUpdated)
     const freshUserStr = await SecureStore.getItemAsync('zobia_user');
     const freshUser = freshUserStr ? JSON.parse(freshUserStr) as AuthUser : parsedUser;
     setUser(freshUser);
   }
   ```

**Acceptance criteria:** After a forced token rotation on app start, `user.displayName` (and all other fields including `isAdmin`, `plan`) reflect the server-fresh values, not the old cached values.

---

## Phase 3 — MEDIUM (Fix Before Beta / Broader Rollout)

### Task M-1 · Fix Ably client orphan on rapid channel change

**File:** `apps/expo/lib/realtime/useRealtimeChannel.ts`

**Steps:**
1. Move `let client: ReturnType<typeof Ably.Realtime> | null = null` outside the async IIFE but inside the `useEffect`, so it's a `let` in the effect's closure scope.
2. In the `if (cancelled)` block (line 90), call:
   ```ts
   if (cancelled) {
     ch?.unsubscribe();
     client?.close();
     return;
   }
   ```
   This ensures cleanup happens even if the effect cleanup ran during init.
3. Update `cleanup` to use the captured `client` reference:
   ```ts
   cleanup = () => { ch.unsubscribe(); client?.close(); };
   ```

---

### Task M-2 · Persist 2FA TOTP attempt counter in MMKV

**File:** `apps/expo/app/auth/two-factor.tsx`

**Steps:**
1. Add constants: `TOTP_ATTEMPTS_KEY`, `TOTP_LOCKED_UNTIL_KEY`.
2. On mount, read stored values: `storage.getNumber(TOTP_ATTEMPTS_KEY) ?? 0`.
3. On each failed attempt, increment and write to MMKV.
4. On lockout, write `Date.now() + LOCKOUT_MS` to `TOTP_LOCKED_UNTIL_KEY`.
5. On mount, check if locked and still within lockout window.
6. On successful login, clear both keys.

---

### Task M-3 · Verify user auth before live notification navigation

**File:** `apps/expo/app/_layout.tsx`

**Steps:**
Add a `userRef` alongside `isLoadingRef`, updated in a similar `useEffect`. In the `addNotificationResponseReceivedListener` callback, add:
```ts
if (isLoadingRef.current || !userRef.current) return;
```

---

### Task M-4 · Persist PIN lockout in `gift-send.tsx`

**File:** `apps/expo/app/economy/gift-send.tsx`

**Steps:**
Copy the MMKV-based PIN state pattern from `store.tsx`:
1. Define constants: `GIFT_PIN_ATTEMPTS_KEY`, `GIFT_PIN_LOCKED_UNTIL_KEY`.
2. Initialize state from MMKV in `useState(() => storage.getNumber(...) ?? 0)`.
3. Sync state to MMKV in `useEffect` on state changes.
4. Check `pinLockedUntil` on modal open and on each submit attempt.

---

### Task M-5 · Persist PIN lockout in `creator/dashboard.tsx`

**File:** `apps/expo/app/creator/dashboard.tsx`

**Steps:** Identical pattern to M-4, using `PAYOUT_PIN_ATTEMPTS_KEY` and `PAYOUT_PIN_LOCKED_UNTIL_KEY`.

---

### Task M-6 · Replace date-of-birth URL params with onboarding context/draft

**Files to change:**
- `apps/expo/app/onboarding/index.tsx`
- `apps/expo/app/onboarding/vibe-quiz.tsx` (and any subsequent step that reads the params)
- `apps/expo/lib/offline/store.ts`

**Steps:**
1. Add `ONBOARDING_DRAFT: 'onboarding_draft'` to `STORE_KEYS`.
2. In `handleNext()` in `index.tsx`, write the registration data to MMKV instead of passing as params:
   ```ts
   setItem(STORE_KEYS.ONBOARDING_DRAFT, { username, emoji, city, birthYear, birthMonth, birthDay });
   router.push('/onboarding/vibe-quiz');
   ```
3. In `vibe-quiz.tsx` and later steps, read from MMKV: `getItem(STORE_KEYS.ONBOARDING_DRAFT, null)`.
4. Clear the draft on successful registration completion or onboarding cancellation.

---

### Task M-7 · Add global conversation count limit to message cache

**File:** `apps/expo/lib/chat/messageCache.ts`

**Steps:**
1. Maintain a `chatcache_index` key in MMKV that stores an array of `{ key: string, cachedAt: number }` entries.
2. In `writeCachedMessages()`, add the entry to the index (or update its `cachedAt`).
3. If the index exceeds `MAX_CONVERSATIONS = 50`, find and delete the entry with the oldest `cachedAt`.
4. Use a single MMKV read/write for the index per `writeCachedMessages` call.

---

### Task M-8 · Add error state to `admin/financial.tsx`

**File:** `apps/expo/app/admin/financial.tsx`

**Steps:**
1. Add `const [error, setError] = useState(false)`.
2. In `loadData()`, if both `statsRes` and `payoutsRes` are null, call `setError(true)`.
3. Render a fallback UI when `error` is true: an error message and a "Retry" button that calls `void loadData()`.
4. Reset `setError(false)` at the start of `loadData()`.

---

### Task M-9 · Add exponential lockout escalation in `store.tsx` PIN

**File:** `apps/expo/app/economy/store.tsx`

**Steps:**
1. Add a `PIN_LOCKOUT_COUNT_KEY` to track how many times the lockout has triggered.
2. Compute lockout duration: `Math.min(30_000 * Math.pow(5, lockoutCount), 30 * 60 * 1000)` (30s → 2.5min → 12.5min → 30min cap).
3. On lockout: increment and persist the lockout count; do NOT reset `pinFailedAttempts` to 0 — instead set it to `PIN_MAX_ATTEMPTS` so the lockout state persists correctly after the timeout.
4. Clear lockout count only after a successful PIN verification.
5. Mirror this escalation in M-4 and M-5.

---

### Task M-10 · Add user auth check to live notification listener

**File:** `apps/expo/app/_layout.tsx`

**Steps:** (See M-3 above — combine into one change.)

---

## Phase 4 — LOW (Polish / Hardening)

### Task L-1 · Replace O(n) Set eviction in room screen

**File:** `apps/expo/app/rooms/[roomId].tsx`

Replace `prevMessageIdsRef.current` (a `Set<string>`) with an array-based circular buffer or a `Map<string, number>` with an insertion counter. When size ≥ 500, find the entry with the smallest counter and delete it. Or use a simple approach: store a ring buffer of 500 IDs in an array; replace with a Set intersection check on each new message.

---

### Task L-2 · Migrate i18n language preference to encrypted MMKV store

**File:** `apps/expo/lib/i18n/index.ts`

1. Add `LANGUAGE_PREF: 'lang_pref'` to `STORE_KEYS` in `store.ts`.
2. Replace reads/writes to `zobia_prefs` MMKV with `getItem(STORE_KEYS.LANGUAGE_PREF, 'en')` / `setItem(STORE_KEYS.LANGUAGE_PREF, lang)`.
3. Remove the `new MMKV({ id: 'zobia_prefs' })` instance.
4. Ensure `initStore()` is awaited before `lib/i18n/index.ts` reads preferences (already gated via `storeReady` in `_layout.tsx`).

---

### Task L-3 · Add per-screen-group error boundaries

**Files to change:**
- `apps/expo/app/(tabs)/_layout.tsx`
- `apps/expo/app/rooms/[roomId].tsx`
- `apps/expo/app/messages/[conversationId].tsx`
- (Other high-traffic screens)

Wrap screen content in a local `ErrorBoundary` component:
```tsx
import { ErrorBoundary } from 'expo-router';
<ErrorBoundary>{children}</ErrorBoundary>
```
Or create a custom `ScreenErrorBoundary` component with localised error text and a screen-level retry that calls `router.replace(router.current)`.

---

### Task L-4 · Reduce stale `isAdmin` window with background user refresh

**File:** `apps/expo/lib/auth/context.tsx` (or `app/_layout.tsx`)

In the AppState `active` listener that already handles token refresh, also invalidate the `['user', 'me']` React Query cache so the latest roles are fetched on foreground. The `onUserUpdated` callback will update `user.isAdmin` when the token refresh succeeds.

---

### Task L-5 · Fix `validateBirthYear` max year constraint

**File:** `apps/expo/app/onboarding/index.tsx`

Change:
```ts
if (isNaN(yr) || yr < 1900 || yr > currentYear) return ...
```
to:
```ts
const maxBirthYear = currentYear - MINIMUM_AGE;
if (isNaN(yr) || yr < 1900 || yr > maxBirthYear)
  return `Enter a year between 1900 and ${maxBirthYear}`;
```

---

### Task L-6 · Fix non-NGN currency formatting in `store.tsx`

**File:** `apps/expo/app/economy/store.tsx`

In `formatKobo()`, replace:
```ts
const formatted = (kobo / 100).toLocaleString('en-NG');
```
with:
```ts
import { koboToDecimal } from '@/lib/utils/currency';
const formatted = koboToDecimal(kobo).toFixed(2);
```

---

### Task L-7 · Handle contacts upload result in onboarding

**File:** `apps/expo/app/onboarding/index.tsx`

In `handleFindFriends()`, await the API call and gate `setContactsStatus('done')` on success:
```ts
try {
  await apiClient.post('/friends/contacts-check', { phoneNumbers: numbers });
  setContactsStatus('done');
} catch {
  setContactsStatus('unavailable'); // or a specific 'upload_failed' state
}
```

---

### Task L-8 · Log warning when EAS `projectId` is absent for push tokens

**File:** `apps/expo/app/_layout.tsx`

```ts
if (!projectId) {
  console.warn('[push] Constants.expoConfig.extra.eas.projectId is not set — push token registration may fail in EAS production builds');
}
```
Also ensure `app.json` includes:
```json
{
  "expo": {
    "extra": {
      "eas": { "projectId": "<your-eas-project-id>" }
    }
  }
}
```

---

## Suggested Implementation Order

```
Phase 1  →  C-3 (unblocks admin refunds)
            C-2 (fixes crash)
            C-1 (fixes displayName)
            H-5 (pairs with C-1)
            C-4 (fixes notification UX)

Phase 2  →  H-1 (requires web deploy + Play Console)
            H-3 (requires AdMob unit creation)
            H-4 (self-contained file change)
            H-2 (requires Play Billing token storage design)

Phase 3  →  M-4, M-5 (quick, consistent with M-9 pattern)
            M-9 (extend existing MMKV lockout)
            M-6 (onboarding context refactor)
            M-2 (2FA persistence)
            M-1 (Ably cleanup)
            M-3 + M-10 (combine into one change in _layout.tsx)
            M-7, M-8 (independent small changes)

Phase 4  →  L-5, L-6, L-7 (small, independent)
            L-2 (requires careful migration of existing prefs)
            L-1, L-3, L-4, L-8 (polish)
```

---

*Plan generated: June 26, 2026 08:23 AM*
