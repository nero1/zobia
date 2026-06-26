# Zobia Social — Expo Mobile App: Bug Fix Plan

> **Status:** PLAN ONLY — no code has been changed. Review and approve before implementation begins.
> **Bugs covered:** All 55 from `custom-bugs-report.md`
> **Target:** Android API 36, Expo SDK 51, React Native 0.74

---

## Priority Tier Definitions

| Tier | Label | Meaning |
|---|---|---|
| P0 | Critical | Feature/data broken or money lost; fix before any release |
| P1 | High | Major functional regression or security hole; fix in same sprint |
| P2 | Medium | Noticeable UX or reliability failure; fix in next sprint |
| P3 | Low-Medium | Edge case, performance, or minor security hardening |
| P4 | Low | Code hygiene, accessibility polish, very minor issues |

## Effort Scale

| Label | Estimate | Description |
|---|---|---|
| XS | < 30 min | One-liner or two-line change |
| S | 30–90 min | Single function/component change |
| M | 2–4 hr | Multiple related files, needs test |
| L | 4–8 hr | Cross-cutting change or significant refactor |
| XL | > 1 day | Architecture change, needs careful rollout |

---

## Master Summary Table

| Bug | Title | Priority | Effort | Phase |
|---|---|---|---|---|
| 1 | Stars transaction history wrong endpoint | P0 | S | 1 |
| 34 | `pendingRecovery` lost on app restart | P0 | M | 1 |
| 2 | Duplicate PIN verification logic | P1 | M | 1 |
| 4 | `endBillingConnection` stale `_initPromise` | P1 | XS | 1 |
| 23 | `SlugRedirect` infinite re-resolve loop | P1 | S | 1 |
| 27 | Gift-send zero stars balance | P1 | S | 1 |
| 3 | Non-NGN floating-point currency display | P2 | XS | 2 |
| 5 | EAS Project ID placeholder in builds | P2 | S | 2 |
| 6 | Google service account path hardcoded | P2 | S | 2 |
| 7 | `EAS_PROJECT_ID` missing dev/preview profiles | P2 | XS | 2 |
| 9 | `myUserId` defaults to empty string | P2 | S | 2 |
| 11 | Duplicate session-expired modals | P2 | S | 2 |
| 12 | `VALID_PUSH_ROUTES` silently drops valid routes | P2 | S | 2 |
| 13 | Telegram bot name missing from dev builds | P2 | XS | 2 |
| 14 | RTL reload no-op in Expo Go | P2 | S | 2 |
| 17 | Gift button missing `creatorId` null check | P2 | XS | 2 |
| 21 | Rewarded ad cap bypassable via React state race | P2 | S | 2 |
| 22 | GameWebView origin check uses wrong property | P2 | S | 2 |
| 25 | Gift notification routes to wrong tab path | P2 | XS | 2 |
| 28 | Notification type toggles not debounced | P2 | S | 2 |
| 29 | `handleConfirmDelete` fails silently | P2 | XS | 2 |
| 30 | DOB field uses wrong keyboard type on Android | P2 | XS | 2 |
| 31 | 2FA setup modal has no retry path | P2 | S | 2 |
| 32 | TOTP lockout read before `storeReady` gate | P2 | S | 2 |
| 35 | Presence heartbeat continues while backgrounded | P2 | S | 2 |
| 38 | Notifications endpoint has no pagination | P2 | M | 2 |
| 40 | Gift-send balance not refreshed after PIN delay | P2 | S | 2 |
| 41 | Inverted FlatList keyboard push on Android 36 | P2 | M | 2 |
| 45 | Gift PIN lockout no exponential backoff | P2 | M | 2 |
| 48 | `onNavigationStateChange` can't block all nav | P2 | S | 2 |
| 52 | Ad reward daily cap client-side only | P2 | M | 2 |
| 53 | RTL reload fires before save confirmed | P2 | S | 2 |
| 54 | SwipeDrawer conflicts with Android 36 back gesture | P2 | M | 2 |
| 8 | MMKV LRU index not updated on key collision | P3 | S | 3 |
| 10 | O(n) message ID eviction in room screen | P3 | S | 3 |
| 15 | PIN attempt constants decoupled | P3 | XS | 3 |
| 16 | Missing `accessibilityHint` on interactive elements | P3 | M | 3 |
| 18 | AdMob interstitial cleared non-atomically | P3 | S | 3 |
| 19 | Pidgin `endsWith` autocomplete condition wrong | P3 | XS | 3 |
| 20 | Announcement dismiss key collision | P3 | XS | 3 |
| 24 | `markNotifRead` race against cache invalidation | P3 | S | 3 |
| 26 | Friend toggle uses different API pattern | P3 | XS | 3 |
| 33 | `storage` proxy and `getStorage()` coexist | P3 | S | 3 |
| 36 | SwipeDrawer React state and Reanimated desync | P3 | S | 3 |
| 37 | E.164 wrong for 10-digit non-zero-prefixed numbers | P3 | S | 3 |
| 39 | Language rollback clears all pending edits | P3 | XS | 3 |
| 43 | `mergeNewestFirst` full re-sort on every delta | P3 | M | 3 |
| 44 | `OfflineBanner` assumes online at mount | P3 | S | 3 |
| 49 | Contacts importer re-import resets `invited` Set | P3 | XS | 3 |
| 50 | `isInternetReachable` null treated as connected | P3 | XS | 3 |
| 51 | TOTP lockout logic duplicated in two catch blocks | P3 | S | 3 |
| 55 | Notification payload IDs not sanitized | P3 | S | 3 |
| 42 | Pidgin dictionary includes offensive terms | P4 | XS | 4 |
| 46 | `GIFT_PIN_LOCKOUT_COUNT` defined but unused | P4 | XS | 4 |
| 47 | FlatList components missing `accessibilityLabel` | P4 | S | 4 |

---

## Phase 1 — Critical & High (P0/P1): Fix Before Next Release

### Bug 1 — Stars Transaction History Wrong Endpoint
**File:** `apps/expo/app/economy/wallet.tsx`
**Priority:** P0 | **Effort:** S

**Fix:**
Find `fetchTransactionPage` (or equivalent) where the function fetches transaction history for the stars tab. Change the API route from `/economy/stars/balance` (or whichever balance endpoint is currently called) to the correct transactions endpoint — confirm the backend route name with the API contract (likely `/economy/stars/transactions`). Pass `page` or cursor as a query parameter. Verify the response shape matches the transaction list renderer (`TransactionItem` or equivalent component). Add a `?type=stars` discriminator if the backend uses a unified `/economy/transactions` endpoint.

**Test:** Navigate to wallet screen → Stars tab → verify transaction list renders real history items (not balance data).

---

### Bug 34 — `pendingRecovery` Google Play Purchases Lost on App Restart
**File:** `apps/expo/lib/payments/googlePlay.ts`
**Priority:** P0 | **Effort:** M

**Fix:**
Replace the in-memory `pendingRecovery` Map with SecureStore-backed persistence:
1. On each `pendingRecovery.set(purchaseToken, params)`, immediately serialize and write the entire map to `SecureStore` under key `google_play_pending_recovery` (JSON-stringify; the value is small).
2. On each `pendingRecovery.delete(purchaseToken)` (successful verification), re-serialize and write the updated map.
3. In `initGooglePlayBilling()`, after connection is established, call `SecureStore.getItemAsync('google_play_pending_recovery')`, parse the JSON, repopulate the Map, and immediately iterate each entry calling the server verification route.
4. Keep a 72-hour expiry on pending entries: store `{ params, timestamp }` and skip entries older than 72 hours on restore.

**Test:** Initiate a purchase, kill the app immediately after Google Play confirms (before server verification), relaunch — verify coins/subscription are granted.

---

### Bug 2 — Duplicate PIN Verification Logic in Store Screen
**File:** `apps/expo/app/economy/store.tsx`
**Priority:** P1 | **Effort:** M

**Fix:**
Extract a single `verifyPin(pin: string): Promise<void>` function inside the component (or a custom hook `usePinVerification`). This function handles:
- Attempt counting and lockout check
- API call to the PIN verification endpoint with consistent parameters
- Lockout save to MMKV on failure
- Success callback

Delete the `submitPin()` function body and the `onChangeText` auto-submit handler's verification logic. Both locations call `verifyPin(pin)` instead. Ensure the parameter object passed to the API endpoint is identical between both call sites before deleting the duplication.

**Test:** Test PIN success and failure flows from both auto-submit (typing 4 digits) and manual submit (tapping button). Confirm lockout triggers correctly from both paths.

---

### Bug 4 — `endBillingConnection` Leaves Stale `_initPromise`
**File:** `apps/expo/lib/payments/googlePlay.ts`
**Priority:** P1 | **Effort:** XS

**Fix:**
In `endBillingConnection()`, add `_initPromise = null;` immediately after `initialised = false;`. This ensures that the next call to `initGooglePlayBilling()` bypasses the `if (_initPromise) return _initPromise` guard and creates a fresh connection.

```typescript
export async function endBillingConnection(): Promise<void> {
  initialised = false;
  _initPromise = null; // Add this line
  await RNIap.endConnection();
}
```

**Test:** Sign out, sign back in, attempt a purchase — verify billing initializes cleanly without reusing the old connection.

---

### Bug 23 — `SlugRedirect` Infinite Re-Resolve Loop
**Files:** `apps/expo/components/deeplink/SlugRedirect.tsx`, all callers (`apps/expo/app/r/[slug].tsx`, `apps/expo/app/u/[username].tsx`, etc.)
**Priority:** P1 | **Effort:** S

**Fix (option A — fix callers, preferred):**
Wrap every inline `toInternalPath` arrow function passed to `<SlugRedirect>` in `useCallback` with an empty or stable dependency array:
```typescript
const toInternalPath = useCallback((id: string) => `/rooms/${id}`, []);
```

**Fix (option B — fix the component, safer for future callers):**
Inside `SlugRedirect.tsx`, capture `toInternalPath` in a ref:
```typescript
const toInternalPathRef = useRef(toInternalPath);
useEffect(() => { toInternalPathRef.current = toInternalPath; });
```
Then use `toInternalPathRef.current` inside the effect, and remove `toInternalPath` from the effect's dependency array (replace with an empty `[]` or use an ESLint suppression comment explaining the ref pattern).

Apply option A to all existing callers and option B to the component for safety.

**Test:** Navigate to a `/r/[slug]` deep link and verify the resolve API is called exactly once, not in a loop (check network inspector for repeated calls).

---

### Bug 27 — Gift-Send Wallet Query Returns Zero Stars Balance
**File:** `apps/expo/app/economy/gift-send.tsx`
**Priority:** P1 | **Effort:** S

**Fix:**
Change the wallet query endpoint from `/economy/coins/balance` to whichever unified balance endpoint the backend exposes that returns both coins and stars (check the backend API — likely `/economy/balance` or `/economy/wallet/balance`). Confirm the response includes `{ coins: number; stars: number }`. If no such unified endpoint exists, add a second parallel query using `Promise.all` or a second `useQuery` for `/economy/stars/balance` and merge the results. Update the `wallet?.stars ?? 0` reference to correctly read from the response.

**Test:** Load gift-send screen with stars on the account — verify star balance matches the actual balance.

---

## Phase 2 — Medium Priority (P2): Fix in Next Sprint

### Bug 3 — Non-NGN Currency Costs Use Floating-Point Division
**File:** `apps/expo/app/economy/store.tsx`
**Priority:** P2 | **Effort:** XS

**Fix:**
Find every instance of `cost / 100` (or similar raw division for non-NGN price display). Replace with:
```typescript
new Decimal(cost).div(100).toFixed(2)
```
`Decimal` is already imported. Wrap in the same display formatter used for NGN amounts where possible.

---

### Bug 5 — EAS Project ID Placeholder in Release Builds
**File:** `apps/expo/app.config.ts`
**Priority:** P2 | **Effort:** S

**Fix:**
Change the fallback from a silent placeholder string to an error throw in production:
```typescript
const easProjectId = process.env.EAS_PROJECT_ID;
if (!easProjectId && process.env.APP_VARIANT === 'production') {
  throw new Error('EAS_PROJECT_ID environment variable is required for production builds');
}
const projectId = easProjectId ?? 'dev-placeholder';
```
This surfaces the misconfiguration at build time rather than silently producing a broken binary.

---

### Bug 6 — Google Service Account Path Hardcoded in `eas.json`
**File:** `apps/expo/eas.json`
**Priority:** P2 | **Effort:** S

**Fix:**
1. Add `google-service-account.json` to `.gitignore` if not already present.
2. Store the file's contents as an EAS secret: `eas secret:create --name GOOGLE_SERVICE_ACCOUNT_KEY --value "$(cat google-service-account.json)"`.
3. In `eas.json`, change `googleServiceAccountKeyPath` to reference the secret via a build env script, or move to EAS Submit's `serviceAccountKeyPath` pointing to a path that is only populated in CI from the secret.
4. Document in `README.md` that the file must be placed locally (and excluded from git) for local Submit commands.

---

### Bug 7 — `EAS_PROJECT_ID` Missing From Dev/Preview Build Profiles
**File:** `apps/expo/eas.json`
**Priority:** P2 | **Effort:** XS

**Fix:**
Add `EAS_PROJECT_ID` to the `env` block of `development` and `preview` profiles:
```json
"development": {
  "env": {
    "EAS_PROJECT_ID": "your-actual-eas-project-id",
    "APP_VARIANT": "development"
  }
}
```
The actual project ID is the same for all profiles — it's the EAS project UUID, not a variant-specific value.

---

### Bug 9 — `myUserId` Defaults to Empty String
**File:** `apps/expo/app/messages/[conversationId].tsx`
**Priority:** P2 | **Effort:** S

**Fix:**
Use a sentinel value that can never match a real UUID:
```typescript
const myUserId = user?.id ?? '__unauthenticated__';
```
Or, more robustly, render a loading skeleton instead of the message list until `user` is available:
```typescript
if (!user) return <ConversationSkeleton />;
const myUserId = user.id;
```
The second approach is cleaner and prevents any optimistic messages from being sent before auth resolves.

---

### Bug 11 — Duplicate Session-Expired Modals From 5-Second Reset
**File:** `apps/expo/lib/api/client.ts`
**Priority:** P2 | **Effort:** S

**Fix:**
Remove the `setTimeout(() => { _notifiedUnauthenticated = false; }, 5000)` timer entirely. Instead, reset `_notifiedUnauthenticated` only in the auth context's `signOut()` or `signIn()` success handler:
```typescript
// In authContext signIn success:
resetUnauthenticatedFlag(); // exported from client.ts
```
Export a `resetUnauthenticatedFlag()` function from `client.ts` that sets `_notifiedUnauthenticated = false`. This guarantees the flag is only cleared once the user has re-authenticated, not arbitrarily after 5 seconds.

---

### Bug 12 — `VALID_PUSH_ROUTES` Silently Drops Valid Routes
**File:** `apps/expo/app/_layout.tsx`
**Priority:** P2 | **Effort:** S

**Fix:**
Two parts:
1. **Immediate:** Audit the backend's push notification route catalog and ensure all sent routes are in `VALID_PUSH_ROUTES`. Add any missing entries (e.g., `/notifications`, `/guilds/:id`).
2. **Structural:** Add a `__DEV__` warning log when a route is dropped so the issue is caught in development:
```typescript
if (!isValidRoute(route)) {
  if (__DEV__) console.warn('[PushNav] Dropped unknown route:', route);
  return;
}
```
This prevents silent failures when new notification types are added on the backend.

---

### Bug 13 — Telegram Bot Name Missing From Dev/Preview Profiles
**File:** `apps/expo/eas.json`
**Priority:** P2 | **Effort:** XS

**Fix:**
Add `EXPO_PUBLIC_TELEGRAM_BOT_NAME` (or whichever env key `app.config.ts` reads) to the `development` and `preview` profile `env` blocks. Use the staging/test bot name for dev profiles:
```json
"development": {
  "env": {
    "EXPO_PUBLIC_TELEGRAM_BOT_NAME": "ZobiaStagingBot"
  }
}
```

---

### Bug 14 — RTL Reload No-Op in Expo Go and Dev Client
**File:** `apps/expo/lib/i18n/index.ts`, `apps/expo/app/settings/index.tsx`
**Priority:** P2 | **Effort:** S

**Fix:**
Wrap the `Updates.reloadAsync()` call:
```typescript
import * as Updates from 'expo-updates';

if (Updates.isAvailable) {
  await Updates.reloadAsync();
} else if (__DEV__) {
  Alert.alert(
    'RTL Change Pending',
    'Restart the dev server to apply the RTL layout change.',
  );
}
```
`Updates.isAvailable` is `false` in Expo Go and development builds, preventing the silent no-op and instead giving developers actionable feedback.

---

### Bug 17 — Gift Button Missing `creatorId` Null Check
**File:** `apps/expo/app/rooms/[roomId].tsx`
**Priority:** P2 | **Effort:** XS

**Fix:**
Wrap the Gift button rendering in a null check:
```typescript
{room.creatorId != null && (
  <GiftButton recipientId={room.creatorId} />
)}
```
If the button should still appear but be disabled for creator-less rooms, add `disabled={!room.creatorId}` with an appropriate `accessibilityHint`.

---

### Bug 21 — Rewarded Ad Daily Cap Bypassable via React State Race
**File:** `apps/expo/components/ads/RewardedAdButton.tsx`
**Priority:** P2 | **Effort:** S

**Fix (client-side part):**
Replace the direct state read with a functional update and a ref for the check:
```typescript
const adsWatchedRef = useRef(adsWatched);
useEffect(() => { adsWatchedRef.current = adsWatched; }, [adsWatched]);

// Before showing ad:
if (adsWatchedRef.current >= AD_DAILY_CAP) { /* block */ return; }

// On reward granted:
setAdsWatched(prev => {
  const next = prev + 1;
  adsWatchedRef.current = next;
  // write to MMKV
  return next;
});
```
See also Bug 52 for the server-side enforcement requirement.

---

### Bug 22 — GameWebView Origin Check Uses Page URL Not Message Sender Origin
**File:** `apps/expo/components/games/GameWebView.tsx`
**Priority:** P2 | **Effort:** S

**Fix:**
Use `onShouldStartLoadWithRequest` for navigation blocking (also fixes Bug 48). For the postMessage origin validation, inject a JavaScript shim via `injectedJavaScriptBeforeContentLoaded` that re-posts messages with origin metadata:
```javascript
// Injected JS
window._originalPostMessage = window.ReactNativeWebView.postMessage;
window.ReactNativeWebView.postMessage = function(data) {
  window._originalPostMessage(JSON.stringify({ __origin: window.location.origin, data }));
};
```
Then in the native `onMessage` handler, parse the outer wrapper and verify `__origin` against the expected game origin before processing `data`. Remove the `e.nativeEvent.url` check.

---

### Bug 25 — Gift Notification Routes to Wrong Tab Path
**File:** `apps/expo/app/notifications/index.tsx`
**Priority:** P2 | **Effort:** XS

**Fix:**
Change the route string in `getNotificationRoute` from `'/(tabs)/economy/wallet'` to `'/(tabs)/wallet'`:
```typescript
case 'gift':
case 'gift_received':
  return '/(tabs)/wallet';
```
Verify the correct path by checking `apps/expo/app/(tabs)/wallet.tsx` exists and matches this route.

---

### Bug 28 — Notification Type Toggles Not Debounced
**File:** `apps/expo/app/settings/index.tsx`
**Priority:** P2 | **Effort:** S

**Fix:**
Extract the notification toggle logic into a debounced handler using the same 400ms pattern as `ChatPushToggles`:
```typescript
const debouncedNotifPatch = useDebouncedCallback(
  (key: string, value: boolean) => {
    patchMutation.mutate({ notifications: { [key]: value } });
  },
  400,
);
```
Replace `patchMutation.mutate(...)` calls in the `NOTIFICATION_TYPES` toggle rows with `debouncedNotifPatch(key, v)`. If `useDebouncedCallback` is not already imported, add it from `@tanstack/query-core` utils or implement with `useCallback` + `useRef`.

---

### Bug 29 — `handleConfirmDelete` Fails Silently on Invalid PIN
**File:** `apps/expo/app/settings/index.tsx`
**Priority:** P2 | **Effort:** XS

**Fix:**
```typescript
if (!deletePin || deletePin.length !== 4) {
  setDeletePinError('Please enter your 4-digit PIN'); // add this state
  return;
}
```
Add a `deletePinError` state string and render it as an error label inside the delete confirmation modal below the PIN input.

---

### Bug 30 — DOB Field Uses Wrong Keyboard Type on Android
**File:** `apps/expo/app/settings/index.tsx`
**Priority:** P2 | **Effort:** XS

**Fix:**
Replace `keyboardType="numbers-and-punctuation"` with a proper date picker. Use `@react-native-community/datetimepicker` (already compatible with Expo) or a simple three-field approach (day/month/year) with `keyboardType="numeric"` on each. The current text input approach is fragile on Android OEM keyboards regardless of keyboard type. If a date picker is out of scope for now, switch to `keyboardType="numeric"` and add a `placeholder="YYYY-MM-DD"` hint.

---

### Bug 31 — 2FA Setup Modal Has No Retry Path
**File:** `apps/expo/app/settings/index.tsx` (TwoFactorSection)
**Priority:** P2 | **Effort:** S

**Fix:**
1. Keep the 2FA setup modal open on fetch failure (do not call `setShow2faModal(false)` in the error handler).
2. Add an `error` state inside the modal and display it with a "Retry" button:
```typescript
const [setupError, setSetupError] = useState<string | null>(null);

// In catch block:
setSetupError('Could not load 2FA setup. Please try again.');

// In modal JSX:
{setupError && (
  <>
    <Text style={...}>{setupError}</Text>
    <Button title="Retry" onPress={handleOpenSetup} />
  </>
)}
```

---

### Bug 32 — TOTP Lockout Read Before `storeReady` Gate
**File:** `apps/expo/app/auth/two-factor.tsx`
**Priority:** P2 | **Effort:** S

**Fix:**
Defer all MMKV reads until `storeReady` is confirmed. Options:
1. If the root layout already exposes a `storeReady` flag via context (which it should, given the `storage` proxy pattern), consume it here:
```typescript
const { storeReady } = useAppContext(); // or however it's exposed
const [lockedOut, setLockedOut] = useState(false);
useEffect(() => {
  if (!storeReady) return;
  const count = storage.getNumber(STORE_KEYS.TOTP_LOCKOUT_COUNT) ?? 0;
  // ... init lockout state
}, [storeReady]);
```
2. Show a loading skeleton until `storeReady` is true.

Ensure `totpAttemptsRef.current` is also initialized inside this effect, not at the `useRef(...)` initialization call site.

---

### Bug 35 — Presence Heartbeat Continues While Backgrounded
**File:** `apps/expo/app/rooms/[roomId].tsx`
**Priority:** P2 | **Effort:** S

**Fix:**
Replace the bare `setInterval` with a focus-aware interval using `useFocusEffect` from `expo-router`:
```typescript
useFocusEffect(
  useCallback(() => {
    sendPresence(); // send immediately on focus
    const interval = setInterval(sendPresence, 45_000);
    return () => clearInterval(interval); // clear on blur/unmount
  }, [roomId]),
);
```
`useFocusEffect` runs the setup when the screen gains focus and runs the cleanup when it loses focus (e.g., tab navigation) or unmounts. Remove the existing `useEffect`-based interval.

---

### Bug 38 — Notifications Endpoint Has No Pagination
**File:** `apps/expo/app/notifications/index.tsx`
**Priority:** P2 | **Effort:** M

**Fix:**
1. Change `fetchNotifications()` to accept a cursor or page parameter: `GET /notifications?limit=30&cursor=<cursor>`.
2. Use `useInfiniteQuery` from TanStack Query instead of `useQuery`:
```typescript
const { data, fetchNextPage, hasNextPage } = useInfiniteQuery({
  queryKey: ['notifications'],
  queryFn: ({ pageParam }) => fetchNotifications(pageParam),
  getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  initialPageParam: undefined,
});
```
3. On the FlatList, add `onEndReached={() => hasNextPage && fetchNextPage()}` with `onEndReachedThreshold={0.3}`.
4. Flatten pages: `data?.pages.flatMap(p => p.items) ?? []`.

---

### Bug 40 — Gift-Send Balance Not Refreshed After PIN Delay
**File:** `apps/expo/app/economy/gift-send.tsx`
**Priority:** P2 | **Effort:** S

**Fix:**
After PIN verification succeeds (before calling `sendMutation.mutate`), invalidate and await the wallet query refetch:
```typescript
await queryClient.invalidateQueries({ queryKey: ['wallet', 'balance'] });
// Then re-check balance against gift cost:
const freshBalance = queryClient.getQueryData<WalletBalance>(['wallet', 'balance']);
if ((freshBalance?.coins ?? 0) < gift.cost) {
  showInsufficientFundsAlert();
  return;
}
sendMutation.mutate(pendingSendParams.current);
```
This prevents sending a gift the user can no longer afford after the PIN delay.

---

### Bug 41 — Inverted FlatList Keyboard Push on Android API 36
**Files:** `apps/expo/app/rooms/[roomId].tsx`, `apps/expo/app/messages/[conversationId].tsx`
**Priority:** P2 | **Effort:** M

**Fix:**
Wrap the message list + input in `KeyboardAvoidingView` with the correct behavior for Android:
```typescript
<KeyboardAvoidingView
  behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
  keyboardVerticalOffset={headerHeight + insets.top}
  style={{ flex: 1 }}
>
  <FlatList inverted ... />
  <MessageInput ... />
</KeyboardAvoidingView>
```
On Android API 36, also add `android:windowSoftInputMode="adjustResize"` in `AndroidManifest.xml` (or configure it in `app.config.ts` under `android.softwareKeyboardLayoutMode: 'resize'`). Test with both predictive text keyboard (which changes height dynamically) and the standard keyboard.

---

### Bug 45 & 46 — Gift PIN Flat Lockout / `GIFT_PIN_LOCKOUT_COUNT` Unused
**File:** `apps/expo/app/economy/gift-send.tsx`, `apps/expo/lib/offline/store.ts`
**Priority:** P2 | **Effort:** M

**Fix (covers both bugs 45 and 46):**
Implement the same exponential backoff pattern as `two-factor.tsx` in the gift-send PIN lockout:
```typescript
// On PIN failure:
const count = (storage.getNumber(STORE_KEYS.GIFT_PIN_LOCKOUT_COUNT) ?? 0) + 1;
storage.set(STORE_KEYS.GIFT_PIN_LOCKOUT_COUNT, count);
const durationMs = Math.min(15 * 60 * 1000 * Math.pow(2, count - 1), 24 * 60 * 60 * 1000);
storage.set(STORE_KEYS.GIFT_PIN_LOCKOUT_UNTIL, Date.now() + durationMs);

// On lockout expiry (successful send or manual reset):
storage.delete(STORE_KEYS.GIFT_PIN_LOCKOUT_COUNT);
```
Read `STORE_KEYS.GIFT_PIN_LOCKOUT_COUNT` on screen mount to restore backoff state across sessions. This simultaneously fixes Bug 46 (unused key) by actually using it.

---

### Bug 48 — `onNavigationStateChange` Can't Block All Navigation
**File:** `apps/expo/components/games/GameWebView.tsx`
**Priority:** P2 | **Effort:** S

**Fix:**
Replace `onNavigationStateChange` with `onShouldStartLoadWithRequest`:
```typescript
onShouldStartLoadWithRequest={(request) => {
  const url = new URL(request.url);
  if (url.origin !== GAME_ORIGIN) {
    // Open external links in device browser, block the WebView from navigating
    Linking.openURL(request.url);
    return false;
  }
  return true;
}}
```
Remove the `onNavigationStateChange` + `stopLoading()` pattern. `onShouldStartLoadWithRequest` intercepts before loading begins, preventing redirect-based bypasses.

---

### Bug 52 — Ad Reward Daily Cap Client-Side Only
**Files:** `apps/expo/components/ads/RewardedAdButton.tsx` (client), backend `/economy/rewards/ad-reward` (server)
**Priority:** P2 | **Effort:** M

**Fix:**
The server endpoint `/economy/rewards/ad-reward` must independently track ad watches per user per day:
- Server: add a `daily_ad_watches` table (or Redis counter with TTL) keyed by `user_id + date`. On each `POST /economy/rewards/ad-reward`, increment and reject with `429` if count >= 5.
- Client: handle `429` from the endpoint as "cap reached" and disable the button for the rest of the day (update MMKV to match).
- The client-side MMKV cap remains as a UX optimization (prevents showing an ad that will be rejected) but is no longer the only enforcement.

---

### Bug 53 — RTL Reload Fires Before Save Is Confirmed
**File:** `apps/expo/app/settings/index.tsx`
**Priority:** P2 | **Effort:** S

**Fix:**
Move `I18nManager.forceRTL()` and `Updates.reloadAsync()` into the mutation's `onSuccess` callback:
```typescript
patchMutation.mutate(
  { language: lang.code },
  {
    onSuccess: async () => {
      storage.set(STORE_KEYS.LANGUAGE, lang.code);
      if (lang.isRTL !== I18nManager.isRTL) {
        I18nManager.forceRTL(lang.isRTL);
        if (Updates.isAvailable) await Updates.reloadAsync();
      }
    },
    onError: () => {
      // rollback only the language field, not all settings
      setSettings(prev => ({ ...prev, language: previousLanguage }));
    },
  },
);
```
Only reload if the server confirmed the change.

---

### Bug 54 — SwipeDrawer Left-Edge Gesture Conflicts With Android 36 Predictive Back
**File:** `apps/expo/components/layout/SwipeDrawer.tsx`
**Priority:** P2 | **Effort:** M

**Fix:**
Use RNGH v2's `simultaneousHandlers` and register the drawer gesture to be aware of the system back gesture:
```typescript
import { GestureDetector, Gesture, GestureHandlerRootView } from 'react-native-gesture-handler';

const panGesture = Gesture.Pan()
  .activeOffsetX(40) // keep existing threshold
  .hitSlop({ left: 0, width: 40 }) // only activate from very edge
  .runOnJS(true)
  .onUpdate(handlePanUpdate)
  .onEnd(handlePanEnd);
```
Additionally, set `android:windowSoftInputMode` and check if React Navigation's `gestureEnabled` on the containing stack navigator can be configured to hand off the gesture. Test on a physical Android 13+ device with system gestures enabled, as the exact behavior varies by manufacturer.

---

## Phase 3 — Low-Medium Priority (P3): Fix in Following Sprint

### Bug 8 — MMKV LRU Index Not Updated on Key Collision
**File:** `apps/expo/lib/chat/messageCache.ts`
**Priority:** P3 | **Effort:** S

**Fix:**
In `put()`, before appending to the index, remove the key if it already exists to ensure correct LRU ordering:
```typescript
const index = getIndex();
const existingPos = index.indexOf(key);
if (existingPos !== -1) index.splice(existingPos, 1);
index.push(key);
if (index.length > MAX_CONVERSATIONS) {
  const evicted = index.shift();
  storage.delete(msgKey(evicted));
}
saveIndex(index);
```

---

### Bug 10 — O(n) Message ID Eviction in Room Screen
**File:** `apps/expo/app/rooms/[roomId].tsx`
**Priority:** P3 | **Effort:** S

**Fix:**
Replace the Set-based approach with a Map that maintains insertion order (JavaScript Maps iterate in insertion order):
```typescript
const prevMessageIdsRef = useRef<Map<string, true>>(new Map());
// On new messages:
ids.forEach(id => prevMessageIdsRef.current.set(id, true));
// Evict oldest when over limit (e.g., 500):
const entries = prevMessageIdsRef.current;
while (entries.size > MAX_IDS) {
  const firstKey = entries.keys().next().value;
  entries.delete(firstKey); // O(1)
}
```

---

### Bug 15 — PIN Attempt Constants Decoupled
**Files:** `apps/expo/app/economy/store.tsx`, `apps/expo/lib/hooks/usePinRateLimit.ts`
**Priority:** P3 | **Effort:** XS

**Fix:**
Export the constant from `usePinRateLimit.ts`:
```typescript
export const PIN_MAX_ATTEMPTS = 5;
```
Import and use it in `store.tsx`:
```typescript
import { PIN_MAX_ATTEMPTS } from '@/lib/hooks/usePinRateLimit';
```
Delete the local `PIN_MAX_ATTEMPTS = 5` declaration in `store.tsx`.

---

### Bug 16 — Missing `accessibilityHint` on Interactive Elements
**Files:** `apps/expo/app/rooms/[roomId].tsx`, `apps/expo/app/messages/[conversationId].tsx`, `apps/expo/app/economy/store.tsx`, and others
**Priority:** P3 | **Effort:** M

**Fix:**
Audit all `Pressable` and `TouchableOpacity` components with `accessibilityRole="button"` and add `accessibilityHint` strings describing the action outcome. Priority targets:
- Gift tier tabs: `accessibilityHint="Shows gifts in this price tier"`
- GIF picker button: `accessibilityHint="Opens GIF search keyboard"`
- Reaction picker: `accessibilityHint="Opens emoji reaction picker"`
- Send button: `accessibilityHint="Sends your message"`
- Like/reaction buttons: `accessibilityHint="Adds this reaction to the message"`

Add these incrementally; they are additive and non-breaking.

---

### Bug 18 — AdMob Interstitial Cleared Non-Atomically
**File:** `apps/expo/lib/ads/admob.ts`
**Priority:** P3 | **Effort:** S

**Fix:**
In `showInterstitialAd()`, clear both flags atomically before calling `.show()`:
```typescript
const ad = interstitialAd;
interstitialAd = null;
adLoaded = false;
await ad.show();
```
Also ensure the CLOSED event handler no longer tries to null `interstitialAd` (since it's already null). Load the next ad in the CLOSED handler regardless of which path closed it.

---

### Bug 19 — Pidgin Autocomplete `endsWith` Condition Wrong
**File:** `apps/expo/lib/i18n/pidgin.ts`
**Priority:** P3 | **Effort:** XS

**Fix:**
Replace the OR condition with the correct prefix match:
```typescript
// Before:
if (key.startsWith(lower) || lower.endsWith(key)) {
// After:
if (key.startsWith(lower)) {
```
The `lower.endsWith(key)` clause was almost certainly a copy-paste error — no autocomplete feature should trigger on word endings.

---

### Bug 20 — Announcement Dismiss Key Collision
**File:** `apps/expo/components/announcements/AnnouncementModal.tsx`
**Priority:** P3 | **Effort:** XS

**Fix:**
Change the session key construction to use the modal's `id` field, and use `version` only as a secondary discriminator. If `modal.id` is guaranteed unique:
```typescript
const getSessionKey = (modal: AnnouncementModal) =>
  `announcement_dismissed_${modal.id}_${modal.version ?? 'v1'}`;
```
Remove the content-slice fallback entirely — if `id` is null, log an error and show the modal regardless (don't suppress it based on unreliable content hashing).

---

### Bug 24 — `markNotifRead` Race Against Cache Invalidation
**File:** `apps/expo/app/notifications/index.tsx`
**Priority:** P3 | **Effort:** S

**Fix:**
Use optimistic update in React Query instead of fire-and-forget + immediate invalidation:
```typescript
const markRead = useMutation({
  mutationFn: (id: string) => apiClient.patch(`/notifications/${id}/read`),
  onMutate: async (id) => {
    await queryClient.cancelQueries({ queryKey: ['notifications'] });
    const prev = queryClient.getQueryData<Notification[]>(['notifications']);
    queryClient.setQueryData<Notification[]>(['notifications'], old =>
      old?.map(n => n.id === id ? { ...n, read: true } : n) ?? []
    );
    return { prev };
  },
  onError: (_err, _id, ctx) => {
    if (ctx?.prev) queryClient.setQueryData(['notifications'], ctx.prev);
  },
  onSettled: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
});
```

---

### Bug 26 — Friend Toggle Uses Different API Pattern
**Files:** `apps/expo/app/profile/[userId].tsx`, `apps/expo/components/ContactsImporter.tsx`
**Priority:** P3 | **Effort:** XS

**Fix:**
Decide on one pattern (check with the backend team). If the correct pattern is `POST /friends` with body `{ targetUserId }`:
- Update `profile/[userId].tsx` from `apiClient.post('/friends/${userId}')` to `apiClient.post('/friends', { targetUserId: userId })`.

If the correct pattern is `POST /friends/:userId`:
- Update `ContactsImporter.tsx` to match.

---

### Bug 33 — `storage` Proxy and `getStorage()` Coexist
**File:** `apps/expo/lib/offline/store.ts` and consumers
**Priority:** P3 | **Effort:** S

**Fix:**
Standardize on one access pattern. Recommendation: keep `getStorage()` for explicit use; deprecate the `storage` Proxy export by adding a JSDoc `@deprecated` tag and a runtime `console.warn` in development:
```typescript
export const storage = new Proxy({} as MMKV, {
  get(_target, prop) {
    if (__DEV__) console.warn('[store] Use getStorage() instead of storage proxy directly');
    const store = _storage;
    if (!store) throw new Error(...);
    return store[prop as keyof MMKV];
  },
});
```
This flags all existing direct `storage.xxx` usages in dev without breaking them, guiding migration over time. Gradually migrate callers to use the typed helper functions in `store.ts`.

---

### Bug 36 — SwipeDrawer React State and Reanimated Desync
**File:** `apps/expo/components/layout/SwipeDrawer.tsx`
**Priority:** P3 | **Effort:** S

**Fix:**
Make `isOpen` React state the single source of truth, driven only by the Reanimated animation's `onEnd` callback — not set eagerly in `openDrawer()`/`closeDrawer()`. The backdrop `pointerEvents` and any React-driven UI changes should read from `isOpen`, which only changes after the animation physically completes:
```typescript
translateX.value = withSpring(targetX, {}, (finished) => {
  if (finished) {
    runOnJS(setIsOpen)(targetX === 0);
  }
});
```
Remove the eager `setIsOpen` call from `openDrawer`/`closeDrawer`.

---

### Bug 37 — E.164 Wrong for 10-Digit Non-Zero-Prefixed Numbers
**File:** `apps/expo/components/ContactsImporter.tsx`
**Priority:** P3 | **Effort:** S

**Fix:**
Remove the overly broad catch-all in `toE164`:
```typescript
// Remove or tighten this:
if (stripped.length >= 10) return '+' + stripped;
```
Replace with country-specific handling. For the app's primary market (Nigeria), 10-digit numbers without a prefix are local numbers starting with a carrier digit (080x, 070x, etc.) — these should get `+234` prefix after stripping the leading 0. For other lengths/formats, log a warning and return `null` (filter out unrecognizable numbers rather than silently generating wrong E.164). Update the cross-reference call to skip `null` entries.

---

### Bug 39 — Language Rollback Clears All Pending Settings Edits
**File:** `apps/expo/app/settings/index.tsx`
**Priority:** P3 | **Effort:** XS

**Fix:**
In the `onError` handler, only roll back the specific field that failed:
```typescript
onError: (_err, variables) => {
  // Roll back only the field(s) in variables, not all of settings
  if (variables.language) {
    setSettings(prev => ({ ...prev, language: previousLanguageRef.current }));
  } else if (variables.displayName) {
    setSettings(prev => ({ ...prev, displayName: previousDisplayNameRef.current }));
  }
  // ... etc per field
}
```
Store the previous value in a ref before calling mutate: `previousLanguageRef.current = settings.language`.

---

### Bug 43 — `mergeNewestFirst` Full Re-Sort on Every Delta
**File:** `apps/expo/lib/chat/delta.ts`
**Priority:** P3 | **Effort:** M

**Fix:**
Instead of sorting the entire merged array, binary-insert incoming messages into the existing sorted list:
```typescript
export function mergeNewestFirst(existing: Message[], incoming: Message[]): Message[] {
  // existing is already sorted newest-first (descending createdAt)
  const result = [...existing];
  for (const msg of incoming) {
    const insertAt = result.findIndex(m => m.createdAt <= msg.createdAt);
    if (insertAt === -1) {
      result.push(msg);
    } else if (result[insertAt].id !== msg.id) {
      result.splice(insertAt, 0, msg);
    }
    // If ids match, it's a duplicate — skip
  }
  return result;
}
```
This is O(k × log n) with the `findIndex` binary search instead of O((n+k) log(n+k)).

---

### Bug 44 — `OfflineBanner` Assumes Online at Mount
**File:** `apps/expo/components/offline/OfflineBanner.tsx`
**Priority:** P3 | **Effort:** S

**Fix:**
Initialize with an immediate NetInfo fetch:
```typescript
useEffect(() => {
  // Get current state synchronously
  NetInfo.fetch().then(state => {
    setOffline(state.isInternetReachable === false);
  });

  const unsubscribe = NetInfo.addEventListener(state => {
    setOffline(state.isInternetReachable === false);
  });
  return unsubscribe;
}, []);
```
This ensures the banner appears immediately if the device is already offline when the component mounts.

---

### Bug 49 — Contacts Importer Resets `invited` Set on Re-Import
**File:** `apps/expo/components/ContactsImporter.tsx`
**Priority:** P3 | **Effort:** XS

**Fix:**
Move `const [invited, setInvited] = useState(new Set<string>())` to module-level or persist it across re-imports by not resetting it when `importContacts` is called again. Alternatively, after a successful import, disable the import button for the session:
```typescript
const [hasImported, setHasImported] = useState(false);
// After successful import:
setHasImported(true);
// In JSX:
<Button disabled={hasImported} title="Import Contacts" onPress={importContacts} />
```

---

### Bug 50 — `isInternetReachable` Null Treated as Connected
**File:** `apps/expo/components/offline/OfflineBanner.tsx`
**Priority:** P3 | **Effort:** XS

**Fix:**
Add a JSDoc comment explaining the intentional null handling:
```typescript
// isInternetReachable is null during initial connectivity check.
// We treat null as "connected" to avoid a false-positive offline banner
// on every cold start. The syncQueue uses a different policy (treat null
// as unknown/potentially-offline). This asymmetry is intentional.
setOffline(state.isInternetReachable === false);
```
No behavior change needed — the current strict `=== false` check is correct for the banner use case. The bug is a documentation gap, not a logic error.

---

### Bug 51 — TOTP Lockout Logic Duplicated in Two Catch Blocks
**File:** `apps/expo/app/auth/two-factor.tsx`
**Priority:** P3 | **Effort:** S

**Fix:**
Extract a `handleFailedAttempt()` function:
```typescript
function handleFailedAttempt() {
  const count = (totpAttemptsRef.current ?? 0) + 1;
  totpAttemptsRef.current = count;
  storage.set(STORE_KEYS.TOTP_LOCKOUT_COUNT, count);
  const durationMs = Math.min(
    15 * 60 * 1000 * Math.pow(2, count - 1),
    24 * 60 * 60 * 1000,
  );
  const lockUntil = Date.now() + durationMs;
  storage.set(STORE_KEYS.TOTP_LOCKOUT_UNTIL, lockUntil);
  setLockedUntil(lockUntil);
}
```
Call `handleFailedAttempt()` from both `catch` blocks. Delete the duplicated inline logic.

---

### Bug 55 — Notification Payload IDs Not Sanitized
**File:** `apps/expo/app/notifications/index.tsx`
**Priority:** P3 | **Effort:** S

**Fix:**
Add UUID validation before embedding IDs in route strings:
```typescript
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeId(id: string | undefined): string | null {
  if (!id || !UUID_RE.test(id)) return null;
  return id;
}

// In getNotificationRoute:
case 'message': {
  const id = safeId(p.conversationId);
  return id ? `/messages/${id}` : null;
}
```
Return `null` for any route where a required ID fails validation, and skip navigation for `null` routes.

---

## Phase 4 — Low Priority (P4): Code Quality & Polish

### Bug 42 — Pidgin Dictionary Contains Offensive Terms
**File:** `apps/expo/lib/i18n/pidgin.ts`
**Priority:** P4 | **Effort:** XS

**Fix:**
Remove `'Mumu'` and `'Olodo'` from all entries in `PIDGIN_SUGGESTIONS`. Specifically:
- Delete the `'stupid'` → `['Mumu', 'Olodo']` entry entirely.
- Remove `'Mumu'` from the `'person'` entry (if present).

Review the full dictionary for any other potentially derogatory or offensive terms before shipping.

---

### Bug 46 — `GIFT_PIN_LOCKOUT_COUNT` Defined But Unused
**File:** `apps/expo/lib/offline/store.ts`
**Priority:** P4 | **Effort:** XS

**Fix:**
This is resolved by the Phase 2 fix for Bug 45. Once the exponential backoff is implemented in `gift-send.tsx` using `STORE_KEYS.GIFT_PIN_LOCKOUT_COUNT`, this dead-code issue is automatically resolved. If Bug 45 is deferred beyond this sprint, add a comment to the key definition: `// Used by gift-send PIN backoff — see Bug 45 fix`.

---

### Bug 47 — FlatList Components Missing `accessibilityLabel`
**Files:** `apps/expo/app/notifications/index.tsx`, `apps/expo/app/rooms/[roomId].tsx`, `apps/expo/app/messages/[conversationId].tsx`
**Priority:** P4 | **Effort:** S

**Fix:**
Add descriptive `accessibilityLabel` props to each FlatList:
```tsx
// Notifications screen:
<FlatList accessibilityLabel="Notifications list" ... />

// Room messages:
<FlatList accessibilityLabel="Room messages" ... />

// DM conversation:
<FlatList accessibilityLabel="Conversation messages" ... />
```
These are non-breaking, purely additive changes.

---

## Implementation Order Recommendation

1. **Phase 1** (P0/P1 — 6 bugs): Fix immediately, don't release without these.
   - Bug 1, 34, 2, 4, 23, 27

2. **Phase 2** (P2 — 27 bugs): Fix in a focused sprint, group by file for efficiency:
   - `eas.json` / config group: Bugs 5, 6, 7, 13
   - `api/client.ts` group: Bug 11
   - `settings/index.tsx` group: Bugs 28, 29, 30, 31, 39, 53
   - `auth/two-factor.tsx` group: Bug 32
   - `economy/*.tsx` group: Bugs 3, 21, 38, 40, 41, 45, 46
   - `games/GameWebView.tsx` group: Bugs 22, 48
   - `layout/SwipeDrawer.tsx` group: Bugs 36, 54
   - Other: Bugs 9, 12, 14, 17, 25, 35, 52

3. **Phase 3** (P3 — 18 bugs): Ongoing code quality sprint.

4. **Phase 4** (P4 — 3 bugs): Merge alongside Phase 3 changes as quick wins.

---

## Testing Checklist (Per-Phase)

### Phase 1 Tests
- [ ] Navigate to Wallet → Stars tab → verify real transaction history renders
- [ ] Initiate IAP purchase → kill app at billing confirmation → relaunch → verify coins granted
- [ ] Test PIN entry from auto-submit (4-digit typing) AND manual submit — both should lock out consistently
- [ ] Sign out → sign back in → attempt purchase — billing should work without `endConnection` error
- [ ] Navigate to `/r/[slug]` — verify API resolve called exactly once (no loop)
- [ ] Load gift-send screen with stars balance — verify non-zero star amount displayed

### Phase 2 Tests
- [ ] Build dev profile → verify EAS project linked and Telegram login works
- [ ] Cold start while offline → verify OfflineBanner shows immediately (Bug 44 check)
- [ ] Switch to Arabic → verify RTL reload only happens after server confirms save
- [ ] Tap gift notification → verify navigation reaches wallet screen without 404
- [ ] Room presence: navigate away via tabs → verify heartbeat stops (check network logs)
- [ ] Test inverted FlatList chat on Android API 36 device with keyboard open
- [ ] Attempt > 5 gift PIN failures → verify each lockout doubles duration

### Phase 3 Tests
- [ ] TalkBack walkthrough of notifications, chat, room screens — verify descriptive labels
- [ ] Import contacts twice in same session → verify no duplicate friend requests sent
- [ ] Trigger network offline at app launch → verify OfflineBanner shows at mount
- [ ] Test Pidgin autocomplete: type "stu" → verify no "Mumu" suggestion appears
- [ ] Verify announcement modal doesn't suppress a new modal that shares a content prefix

---

## Notes for Implementors

1. **Do not skip Phase 1.** Bugs 1 and 34 involve lost user money and broken core features.
2. **Bugs 45+46 must be fixed together** — they are two symptoms of the same omitted feature.
3. **Bug 52 requires a backend change** — coordinate with the API team before deploying the client fix.
4. **Bug 54 (SwipeDrawer on Android 36)** should be tested on real hardware, not emulator — the predictive back gesture zone varies by device and Android skin.
5. **Bug 14 (RTL)** can be verified in dev once the guard is in place — the fallback Alert must appear when switching language in Expo Go.
6. **Bugs 16 and 47** (accessibility) are additive-only changes; they carry zero regression risk and can be merged any time.
