# Zobia Expo App — Forensic Bug Report

**Generated:** June 26, 2026 08:23 AM  
**Scope:** Expo / React Native (Android API 36), with API surface notes where relevant  
**Methodology:** Static code analysis — every relevant file read and cross-referenced manually  

---

## Quick-Reference Bug List

| # | Severity | One-line Description |
|---|----------|----------------------|
| C-1 | CRITICAL | `displayName` field missing from token-refresh user object → blank display names after silent refresh |
| C-2 | CRITICAL | `total` variable undeclared in admin payouts screen → ReferenceError crash on every render |
| C-3 | CRITICAL | Admin refunds screen reads auth token from MMKV (`authToken` key) — key never exists, all calls unauthenticated |
| C-4 | CRITICAL | Notification cold-start deep-link navigation fires before nav tree is rendered → action silently lost |
| H-1 | HIGH | Android App Links require `assetlinks.json` at `/.well-known/` — not deployed; universal links open browser instead of app |
| H-2 | HIGH | Play Billing subscription upgrade uses deprecated `replaceSku`/`prorationMode` (removed in Billing v5+) |
| H-3 | HIGH | Production EAS profile missing `EXPO_PUBLIC_ADMOB_*` ad unit ID env vars → production builds serve Google test ads |
| H-4 | HIGH | `apiFetch` reads SecureStore on every call instead of in-memory cache; also has no 401/auto-refresh |
| H-5 | HIGH | Auth restore calls `setUser(parsedUser)` after `refreshAccessToken()`, overwriting fresh user set by `notifyUserUpdated` |
| M-1 | MEDIUM | Ably client orphaned when channel prop changes rapidly — cleanup closure assigned too late |
| M-2 | MEDIUM | 2FA TOTP attempt counter is in-memory only; app restart bypasses lockout |
| M-3 | MEDIUM | Push notification cold-start router path has no auth check before navigating |
| M-4 | MEDIUM | PIN lockout in `gift-send.tsx` not persisted to MMKV — resets on app restart |
| M-5 | MEDIUM | PIN lockout in `creator/dashboard.tsx` not persisted to MMKV — resets on app restart |
| M-6 | MEDIUM | Date of birth passed as Expo Router URL params → PII in nav history and crash reports |
| M-7 | MEDIUM | Chat message MMKV cache has no global conversation count limit → unbounded growth |
| M-8 | MEDIUM | `admin/financial.tsx` swallows both API errors silently — no error state or retry button |
| M-9 | MEDIUM | PIN lockout in `store.tsx` resets attempt count to 0 after lockout — unlimited 5-attempt windows |
| M-10 | MEDIUM | Live notification response listener doesn't verify `user !== null` before navigating |
| L-1 | LOW | `prevMessageIdsRef` Set eviction in room screen is O(n) at the 500-entry cap |
| L-2 | LOW | i18n language preference stored in a separate unencrypted MMKV instance |
| L-3 | LOW | No per-screen React error boundaries — any thrown error propagates to root expo-router boundary |
| L-4 | LOW | Stale `isAdmin: true` in SecureStore shows admin tab to demoted admin until next token rotation |
| L-5 | LOW | `validateBirthYear` allows current calendar year with misleading hint text |
| L-6 | LOW | Non-NGN currency formatting in `store.tsx` uses floating-point division instead of Decimal.js |
| L-7 | LOW | Contacts upload on onboarding is fire-and-forget; UI shows "✓ Contacts imported!" even on server failure |
| L-8 | LOW | Push token registration silently no-ops when `Constants.expoConfig?.extra?.eas?.projectId` is undefined |

---

## Pre-Fix Code Quality Ratings

| Dimension | Score | Notes |
|-----------|-------|-------|
| **Security** | 6 / 10 | Good: AES-256-GCM offline DB, encrypted MMKV, SecureStore JWTs, idempotency keys, CSRF Origin header, JWT structural validation, VALID_PUSH_ROUTES allowlist. Gaps: admin refunds unauthenticated, PIN lockouts not persisted, PII in nav params, stale isAdmin UI. |
| **Performance** | 6.5 / 10 | Good: delta fetch, MMKV over AsyncStorage, React Query staleTime, batched offline sync, debounced reconnect. Gaps: SecureStore read on every `apiFetch` call, O(n) Set eviction, unbounded message cache. |
| **Reliability** | 5.5 / 10 | Good: retry backoff in `apiFetch`, sync queue idempotency, `refreshPromise` race guard, Ably ref pattern. Gaps: two CRITICAL crashes (`total` crash, unauthenticated refunds), cold-start notification loss, orphaned Ably clients. |
| **Structure / Architecture** | 7 / 10 | Good: clear layering (lib→app→components), typed env, STORE_KEYS registry, cursor-based pagination in payouts, modular billing. Gaps: two screens diverged to raw-fetch anti-pattern, inconsistent PIN lockout pattern across screens. |
| **Financial Integrity** | 7.5 / 10 | Good: Decimal.js throughout, server-side verification before `finishTransaction`, idempotency keys, `pendingRecovery` map. Gaps: Play Billing upgrade API broken (subscription changes can't prorate), zero ad revenue in production. |

---

## Detailed Bug Reports

---

### C-1 · CRITICAL — `displayName` missing from token-refresh user object

**File:** `apps/expo/lib/api/client.ts` — `refreshAccessToken()`, lines 168–180

**What happens:**  
After every silent token rotation (background refresh, foreground refresh on app resume), the function builds an `updatedUser` object from the `/api/users/me` response and calls `notifyUserUpdated(userJson)` to update the in-memory auth state. That object contains `id`, `username`, `avatarEmoji`, `city`, `xp`, `rankTier`, `plan`, `isAdmin`, `isModerator`, `isCreator`, `onboardingCompleted` — but **`displayName` is absent**. Every component that renders `user.displayName` (chat headers, profile cards, payout screens, gift confirmations) will show `undefined` text after any background token rotation.

**Reproduction:** Open the app, wait 15–30 minutes (access token expiry), then perform any action that triggers a 401 + refresh cycle. Alternatively, background and foreground the app when the token is within 60 seconds of expiry.

**Fix:** Add `displayName: (me.displayName ?? me.display_name ?? '') as string` to the `updatedUser` object in `refreshAccessToken()` at `client.ts` line ~171.

---

### C-2 · CRITICAL — `total` undeclared in admin payouts screen

**File:** `apps/expo/app/admin/payouts.tsx` — `ListHeaderComponent`, line 274

**What happens:**  
`AdminPayoutsScreen` renders `{total} payout{total !== 1 ? 's' : ''}` in the `FlatList.ListHeaderComponent`, but no `total` state variable is declared anywhere in the component. The component tracks `payouts: Payout[]`, `hasMore: boolean`, `loadingMore`, etc. — but not a total count. This causes an immediate `ReferenceError: total is not defined` (or renders `undefined payout`) every time the screen mounts, crashing the admin payouts screen.

**Fix:**  
1. Declare `const [total, setTotal] = useState(0)` in the component.  
2. In `loadPayouts()`, extract the total from the API response: `setTotal(data.total ?? 0)` (or accumulate `payouts.length` if the API returns only cursor-based pagination without a total).  
3. Reset `setTotal(0)` in the tab-change `useEffect` alongside `setPayouts([])`.

---

### C-3 · CRITICAL — Admin refunds screen reads auth token from MMKV

**Files:** `apps/expo/app/admin/refunds.tsx` — lines 89–93 and 146–158

**What happens:**  
Both `loadRefunds()` and `handleIssueRefund()` fetch auth credentials via:
```js
const token = storage.getString('authToken');
```
Auth tokens in this app are stored in `expo-secure-store` under the key `'zobia_jwt'` (exported as `JWT_KEY` from `client.ts`). They are **never written to MMKV**. The `STORE_KEYS` registry in `lib/offline/store.ts` has no `authToken` entry. `storage.getString('authToken')` always returns `undefined`, so the `Authorization` header is never set. All requests to `/api/admin/refunds` are sent without credentials → the server returns 401 → the UI silently shows no refund data and all refund issuing fails.

**This screen is directly responsible for financial operations (coin refunds) and was completely broken.**

**Fix:** Replace both raw `fetch()` calls with `apiClient.get()` / `apiClient.post()`, which has the JWT interceptor. Mirror the pattern used correctly in `admin/payouts.tsx` (`apiClient.get('/admin/payouts?...')`).

---

### C-4 · CRITICAL — Notification cold-start deep-link navigation is silently lost

**File:** `apps/expo/app/_layout.tsx` — `RootLayoutNav` init `useEffect`, lines 230–237

**What happens:**  
On a cold start triggered by a notification tap, `getLastNotificationResponseAsync()` is called inside the startup `useEffect`. At this point, `isLoading` is `true` and `storeReady` is `false`, so `RootLayoutNav` returns `null` (line 347) — no navigator is mounted. The immediately following `router.push(action)` call fails silently (caught by `try/catch`). The user ends up on the default tab with no deep-link navigation. The `addNotificationResponseReceivedListener` path correctly defers until `isLoadingRef.current === false`, but the cold-start path has no such guard.

**Fix:**  
Store the pending notification action in a ref during startup, then navigate in a separate `useEffect` that watches `isLoading && storeReady && user`:
```js
const pendingNotifAction = useRef<string | null>(null);
// In init effect: pendingNotifAction.current = action (instead of router.push)
// In a new effect: if (!isLoading && storeReady && user && pendingNotifAction.current) { ... }
```

---

### H-1 · HIGH — Android App Links `assetlinks.json` not deployed

**File:** `apps/expo/app.json` — Android intent filters, lines 44–74

**What happens:**  
Both intent filter entries use `"autoVerify": true` to claim the `zobia.vercel.app` domain as an Android App Link. Android requires the app's SHA-256 signing certificate fingerprint to be listed in `https://zobia.vercel.app/.well-known/assetlinks.json`. Without that file (or if it exists but the fingerprint doesn't match the production signing key), Android silently removes the app from App Link handling. All deep links (profile shares, room invites, referral links, OAuth callbacks from email/SMS) open in the browser instead of the app, breaking the entire deep-link UX and the referral attribution system.

**Fix:**  
1. Generate `assetlinks.json` via the Play Console (App signing → "App Links" section) or use Google's Asset Links generator.  
2. Deploy the file to `apps/web/public/.well-known/assetlinks.json` (or equivalent Next.js public route) so it's accessible at the required URL.  
3. Run `adb shell pm get-app-links --user 0 org.zobia.social` on a production device to verify verification status.

---

### H-2 · HIGH — Play Billing subscription upgrade uses removed API

**File:** `apps/expo/lib/payments/googlePlay.ts` — `purchaseSubscription()`, lines 715–726

**What happens:**  
When `oldProductId` is provided (upgrade/downgrade path), `requestSubscription` is called with:
```js
replaceSku: oldProductId,
prorationMode: 2,
```
`replaceSku` and `prorationMode` were part of the `REPLACE_SKU` API from Google Play Billing Library v1–v3. They were deprecated in v2 and **removed in v5**. react-native-iap v12 uses Play Billing v7. The `replaceSku` field is not a valid parameter in the current `BillingFlowParams.SubscriptionUpdateParams` API. The call either silently ignores the replacement (resulting in a parallel subscription instead of a plan switch) or throws an error depending on the react-native-iap version's TypeScript types.

The correct API requires passing the **purchase token** of the existing active subscription (`purchaseTokenAndroid`), not the product ID.

**Fix:**  
1. When a subscription purchase succeeds, store its `purchaseToken` in MMKV keyed by product ID.  
2. In `purchaseSubscription(newProductId, oldProductId)`, look up the stored purchase token for `oldProductId`.  
3. Pass `purchaseTokenAndroid: storedOldPurchaseToken` to `requestSubscription()`. The `prorationMode` equivalent is now `subscriptionUpdateParams.replacementMode` (see react-native-iap v12 Android docs).

---

### H-3 · HIGH — Production builds serve Google test ads (zero ad revenue)

**Files:** `apps/expo/eas.json` production env, `apps/expo/lib/ads/admob.ts` lines 60–66, 205–212, 217–223

**What happens:**  
The EAS production profile (`eas.json`) sets only `ADMOB_APP_ID_ANDROID` and `ADMOB_APP_ID_IOS` (the app-level SDK init IDs, used by Gradle at build time). The per-format ad unit IDs read at JS runtime — `EXPO_PUBLIC_ADMOB_REWARDED_ANDROID`, `EXPO_PUBLIC_ADMOB_BANNER_ANDROID`, `EXPO_PUBLIC_ADMOB_INTERSTITIAL_ANDROID` (and iOS variants) — are **not in the production env**. When `process.env.EXPO_PUBLIC_ADMOB_REWARDED_ANDROID` is `undefined`, `admob.ts` falls back to `TestIds.REWARDED`, serving Google test ads. Test ads generate zero revenue and must not appear in production.

**Fix:** Add all six `EXPO_PUBLIC_ADMOB_*` ad unit IDs to EAS production secrets and reference them in the `production.android.env` block in `eas.json`.

---

### H-4 · HIGH — `apiFetch` reads SecureStore on every invocation

**File:** `apps/expo/lib/api/apiFetch.ts` — line 54

**What happens:**  
```js
const token = await SecureStore.getItemAsync(JWT_KEY).catch(() => null);
```
SecureStore operations on Android go through the Android Keystore / TEE and involve disk I/O. They are significantly slower than reading an in-memory variable. `apiClient` avoids this by caching the token in `_cachedToken` (set by `setCachedToken()`). `apiFetch` bypasses this cache, paying the SecureStore penalty on every call.

Additionally, `apiFetch` has no 401 response handling. If the access token has expired when an `apiFetch` call is made, the server returns 401 and the error propagates to the caller unhandled — there is no token refresh + retry as the Axios interceptor provides. This affects any code path that uses `apiFetch` (including the `/api/users/me` call inside `refreshAccessToken` itself).

**Fix:**  
1. Export a `getCachedToken(): string | null` getter from `client.ts`.  
2. In `apiFetch`, use `getCachedToken() ?? await SecureStore.getItemAsync(JWT_KEY)` (same pattern as the Axios request interceptor).  
3. Add a 401 handler: on 401, call `refreshAccessToken()`, update the `Authorization` header, and retry once — mirroring the Axios interceptor logic.

---

### H-5 · HIGH — Auth restore overwrites fresh user with stale data after token refresh

**File:** `apps/expo/lib/auth/context.tsx` — startup restore `useEffect`, lines 163–168

**What happens:**  
The startup restore flow is:
```js
const newAccessToken = await refreshAccessToken();
// ↑ This calls notifyUserUpdated(freshUser) → setUser(freshUser)
if (newAccessToken) {
  setCachedToken(newAccessToken);
  setToken(newAccessToken);
  setUser(parsedUser);  // ← Overwrites freshUser with OLD stale user
}
```
`refreshAccessToken()` synchronously calls `notifyUserUpdated(freshUserJson)`, which fires the `onUserUpdated` subscriber, which calls `setUser(freshUser)`. Then, immediately after `refreshAccessToken()` returns, `setUser(parsedUser)` is called with the original stale user object loaded from SecureStore before the refresh. In React 18 batched state updates, the last `setState` call wins, so `parsedUser` (stale) replaces `freshUser`. Combined with C-1, the stale user also lacks `displayName`.

**Fix:** Remove the `setUser(parsedUser)` call in the `if (newAccessToken)` branch. The `notifyUserUpdated` path already updates the user state and persists to SecureStore. If `notifyUserUpdated` is not guaranteed to fire (e.g., the `/users/me` fetch fails), fall back to re-reading `zobia_user` from SecureStore after the refresh.

---

### M-1 · MEDIUM — Ably client orphaned when channel changes rapidly

**File:** `apps/expo/lib/realtime/useRealtimeChannel.ts` — async init block, lines 50–103

**What happens:**  
The `cleanup` variable is a `let` declared inside the `useEffect` and assigned **after** the async Ably client init completes. The React effect cleanup function checks:
```js
cleanup?.();
```
If the component unmounts (or `channel` changes) while Ably is still initialising the WebSocket — a common case during fast tab switching or rapid room navigation — the cleanup fires before `cleanup` is assigned. The `cancelled = true` flag prevents further state updates, but the Ably client has already been created (`new Ably.Realtime(...)`) and the channel subscribe has started. The client is never closed, leaving an open WebSocket connection and unreleased event listeners.

**Fix:** Move the client/channel references into the `cancelled` guard block at line 90. When `cancelled` is true at that point, `ch.unsubscribe(); client.close()` should be called immediately, as is already done for the active-session path. Additionally, assign `cleanup` before awaiting any further async work, or restructure to create the Ably client before the async authCallback by using a synchronous `authUrl` approach.

---

### M-2 · MEDIUM — 2FA TOTP attempt counter resets on app restart

**File:** `apps/expo/app/auth/two-factor.tsx` — `totpAttemptsRef`

**What happens:**  
The attempt counter for TOTP verification is stored as a React ref (`totpAttemptsRef = useRef(0)`). Because refs are in-memory, killing and relaunching the app resets the counter to zero, allowing unlimited TOTP attempts with no genuine lockout. A determined attacker can brute-force a 6-digit TOTP by cycling through app restarts between attempts.

**Fix:** Store the attempt count and a lockout-until timestamp in MMKV (keyed by user ID or device ID), read them on mount, and clear only after the lockout window expires. The server-side TOTP endpoint should also enforce its own rate limit.

---

### M-3 · MEDIUM — Notification cold-start path doesn't verify auth

**File:** `apps/expo/app/_layout.tsx` — `getLastNotificationResponseAsync()` block, lines 230–237

**What happens:**  
(See C-4 for the primary crash — this is the auth-check secondary issue.) When the navigation action _does_ execute (e.g., after refactoring C-4), there is no check that `user !== null` before calling `router.push(action)`. If the notification arrived for a different account or the user is signed out, the push will navigate to a protected route and then the auth gate will redirect, causing a brief flash of the protected screen's loading state.

**Fix:** In the pending navigation effect (from the C-4 fix), check `user !== null` before navigating; if user is null, discard the pending action.

---

### M-4 · MEDIUM — PIN lockout in `gift-send.tsx` not persisted

**File:** `apps/expo/app/economy/gift-send.tsx` — `pinAttempts` state, line 189

**What happens:**  
The gift-send screen's PIN verification tracks failed attempts in React state (`const [pinAttempts, setPinAttempts] = useState(0)`). State is ephemeral — app restart or screen remount resets to zero. The 5-attempt lockout is completely bypassable by navigating away and back.

Compare this to `store.tsx` which correctly uses MMKV-persisted `PIN_ATTEMPTS_KEY` and `PIN_LOCKED_UNTIL_KEY`.

**Fix:** Adopt the same MMKV persistence pattern used in `store.tsx`: read initial state from `storage.getNumber(PIN_ATTEMPTS_KEY)` and `storage.getNumber(PIN_LOCKED_UNTIL_KEY)`, and write back on every change.

---

### M-5 · MEDIUM — PIN lockout in `creator/dashboard.tsx` not persisted

**File:** `apps/expo/app/creator/dashboard.tsx` — `pinAttempts` state, line 191

**What happens:**  
Same issue as M-4. The payout PIN attempt counter in `CreatorDashboardScreen` is in-memory state. Creators requesting payouts can bypass the PIN lockout by restarting the app.

**Fix:** Same MMKV persistence pattern as `store.tsx`.

---

### M-6 · MEDIUM — Date of birth passed as Expo Router URL params

**File:** `apps/expo/app/onboarding/index.tsx` — `handleNext()`, lines 199–208

**What happens:**  
```js
router.push({
  pathname: '/onboarding/vibe-quiz',
  params: {
    username: username.trim(),
    emoji: selectedEmoji,
    city: city.trim(),
    birthYear: birthYear.trim(),
    birthMonth: birthMonth.trim(),
    birthDay: birthDay.trim(),
  },
});
```
Birth year, month, and day become URL search parameters (`/onboarding/vibe-quiz?birthYear=...&birthMonth=...&birthDay=...`). These are serialised into:
- Expo Router's navigation history (accessible from developer menus)
- React Native's JS-to-native bridge log (visible in `adb logcat`)
- Crash reporting tool breadcrumbs (Sentry, Crashlytics) if integrated
- Any analytics SDK that captures screen transitions with query params

**Fix:** Use a dedicated onboarding context or a short-lived MMKV draft key (`STORE_KEYS.ONBOARDING_DRAFT`) to pass the registration data between steps. Clear the draft on successful account creation or onboarding cancellation.

---

### M-7 · MEDIUM — Chat message cache unbounded across conversations

**File:** `apps/expo/lib/chat/messageCache.ts`

**What happens:**  
`writeCachedMessages` caps each conversation to 50 messages, but no limit exists on the total number of conversations cached. MMKV uses a single memory-mapped file. An active user with many open DMs, group chats, rooms, and guilds accumulates unbounded cache entries. For admin accounts with hundreds of conversations or stress-test scenarios, this can grow to several MB inside the single MMKV store file, increasing memory pressure and startup time.

**Fix:** Implement a global entry counter: track conversation cache keys in a metadata list, enforce a max count (e.g., 50 conversations), and evict the least-recently-used entry (based on `cachedAt`) when the cap is exceeded.

---

### M-8 · MEDIUM — `admin/financial.tsx` errors swallowed silently

**File:** `apps/expo/app/admin/financial.tsx` — `loadData()`, lines 38–46

**What happens:**  
Both API calls use `.catch(() => null)`:
```js
const [statsRes, payoutsRes] = await Promise.all([
  apiClient.get('/admin/financial').catch(() => null),
  apiClient.get('/admin/payouts?status=pending&limit=20').catch(() => null),
]);
```
If both fail (network error, 401 from expired admin session, server error), `stats` and `payouts` remain null/empty. The screen renders blank sections with no error state, no retry button, and no notification to the admin that the data failed to load. In production, this could mask a real system issue from the admin.

**Fix:** Track an error state; show an error message and a retry/refresh button when both requests fail. Alternatively, use React Query for this screen (as used in `admin/payouts.tsx`) which provides `isError` and retry built-in.

---

### M-9 · MEDIUM — PIN lockout attempt count resets to 0 on lockout in `store.tsx`

**File:** `apps/expo/app/economy/store.tsx` — PIN submission handler, ~line 237

**What happens:**  
When a lockout triggers (`pinFailedAttempts >= PIN_MAX_ATTEMPTS`), the code sets a 30-second lockout timer and then calls `setPinFailedAttempts(0)`. This resets the attempt count entirely. After the 30-second window, the user gets another full 5-attempt window, indefinitely. A patient attacker trying to guess a PIN can make 5 attempts, wait 30 seconds, make 5 more, etc. — essentially unlimited guesses over time.

The `PIN_LOCKOUT_MS = 30_000` is also very short for financial transactions.

**Fix:** Track a lockout count separately; increase the lockout duration exponentially (e.g., 30 s → 5 min → 30 min → account-level lockout requiring re-auth). Consider also enforcing a server-side rate limit on `/auth/pin/verify`.

---

### M-10 · MEDIUM — Live notification listener doesn't confirm user is authenticated

**File:** `apps/expo/app/_layout.tsx` — `addNotificationResponseReceivedListener`, line 316

**What happens:**  
The background/killed notification tap listener checks `isLoadingRef.current` before navigating, but does not check whether `user` is null. If auth loading completes but the user is not authenticated (stored token absent, refresh failed), `isLoadingRef.current` becomes `false` and the router navigates to a protected route. The auth-gate `useEffect` will then redirect to login, but the initial navigation may briefly trigger data fetches on the protected screen or expose a loading skeleton before the redirect.

**Fix:** Also check `user !== null` (or equivalent) in the listener: `if (isLoadingRef.current || !userRef.current) return;`. Store `userRef` in the component analogously to `isLoadingRef`.

---

### L-1 · LOW — `prevMessageIdsRef` Set eviction is O(n)

**File:** `apps/expo/app/rooms/[roomId].tsx` — message deduplication logic

**What happens:**  
When the dedup Set hits 500 entries, the eviction code uses `set.values().next()` to get the first entry and delete it. JavaScript Set iterators are sequential — this is O(n) in the worst case for the first iterator step. At sustained high message rates in busy rooms (many messages per second), this runs on every incoming message. The impact is small but measurable in rooms with very high activity.

**Fix:** Replace the Set with a `Map<string, number>` (message ID → insertion index) backed by a circular buffer approach, or use an array-based ring buffer for the ID list. An LRU-Map from a utility lib also works.

---

### L-2 · LOW — i18n language preference stored in unencrypted MMKV

**File:** `apps/expo/lib/i18n/index.ts`

**What happens:**  
The language preference (`zobia_prefs`) uses a separate, unencrypted MMKV instance. The rest of the app uses an AES-256 encrypted main store keyed from SecureStore. While locale preference is not sensitive, the inconsistency creates two storage instances and prevents the `clearStore()` on sign-out from wiping the preference (which could leak the language preference between accounts on a shared device in theory).

**Fix:** Migrate language preference to the encrypted main store under `STORE_KEYS.USER_PREFERENCES`, or add `STORE_KEYS.LANGUAGE_PREF` to the registry and use `getStorage()`. Remove the separate `zobia_prefs` instance.

---

### L-3 · LOW — No per-screen React error boundaries

**File:** `apps/expo/app/_layout.tsx` — root `ErrorBoundary` re-export

**What happens:**  
`app/_layout.tsx` re-exports `ErrorBoundary` from `expo-router`, providing a single root-level error boundary. Any unhandled JavaScript error (network data shape mismatch, null dereference, third-party SDK crash) in any screen component propagates all the way to the root boundary and shows a full-screen error with a "Retry" button that restarts the entire app. This is a poor UX for recoverable per-screen errors.

**Fix:** Wrap each major screen or screen-group route with an `ErrorBoundary` component that shows a localized error message and a retry button scoped to that screen, allowing the rest of the app to continue working.

---

### L-4 · LOW — Stale `isAdmin` shows admin tab to demoted admin

**File:** `apps/expo/app/(tabs)/_layout.tsx` — line 77

**What happens:**  
`const isAdmin = user?.isAdmin === true` reads from the cached in-memory user object (ultimately sourced from SecureStore). If an admin is demoted server-side but their token has not yet refreshed, `user.isAdmin` remains `true` until the next token rotation. The admin tab appears in the UI. Server-side enforcement prevents any actual admin actions from succeeding, but the confusing UI persists until the next refresh.

**Fix:** The `onUserUpdated` mechanism already updates `user.isAdmin` after every token rotation. To reduce the stale window further, consider calling `/users/me` on app foreground and invalidating the user query. (The tab visibility itself is acknowledged as UI-only in the code comments — this is a low-severity polish item.)

---

### L-5 · LOW — `validateBirthYear` allows current year with misleading error text

**File:** `apps/expo/app/onboarding/index.tsx` — `validateBirthYear()`, line 91

**What happens:**  
```js
if (isNaN(yr) || yr < 1900 || yr > currentYear) return `Enter a valid year between 1900 and ${currentYear}`;
```
The condition `yr > currentYear` (strict greater-than) means `yr === currentYear` passes this validation. A user born in the current year passes the year field validation but fails `validateAge()` with a separate "must be at least 18" error. The error message says "between 1900 and [currentYear]" implying `currentYear` is a valid entry, then a subsequent error tells them they're too young. The UX is confusing.

**Fix:** Show a more helpful constraint: `yr > currentYear - MINIMUM_AGE` rejects years that cannot possibly satisfy the age requirement, and update the helper text to "You must be at least 18 years old."

---

### L-6 · LOW — Non-NGN currency formatting uses floating-point division

**File:** `apps/expo/app/economy/store.tsx` — `formatKobo()`, line 137

**What happens:**  
```js
const formatted = (kobo / 100).toLocaleString('en-NG');
return `${formatted} ${currencyCode}`;
```
This path is reached for currencies other than NGN. Native JavaScript division can produce floating-point artefacts (e.g., `1001 / 100 = 10.009999999999999`). While the app currently only supports NGN, the `formatKobo` function accepts a `currencyCode` parameter and this fallback branch exists for future currencies.

**Fix:** Use `koboToDecimal(kobo).toFixed(2)` (Decimal.js) for all currency values to maintain consistency with the rest of the app's financial formatting.

---

### L-7 · LOW — Contacts upload on onboarding shows success even on server failure

**File:** `apps/expo/app/onboarding/index.tsx` — `handleFindFriends()`, lines 164–168

**What happens:**  
```js
apiClient
  .post('/friends/contacts-check', { phoneNumbers: numbers })
  .catch(() => {});
setContactsStatus('done');
```
`setContactsStatus('done')` is called synchronously after dispatching the fire-and-forget request. Whether or not the server request succeeds, the UI immediately shows "✓ Contacts imported! You can add friends from their profiles." The user believes their contacts were checked successfully, but the friend matching never happened.

**Fix:** Await the API call (or chain `.then(...).catch(...)`). Show the "done" state only on success; show an appropriate error state (or silently re-enable the button for a retry) on failure.

---

### L-8 · LOW — Push token registration silently skips when EAS `projectId` is absent

**File:** `apps/expo/app/_layout.tsx` — `registerForPushNotifications()`, lines 157–160

**What happens:**  
```js
const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
const tokenData = await Notifications.getExpoPushTokenAsync(
  projectId ? { projectId } : undefined
);
```
If `Constants.expoConfig.extra.eas.projectId` is not set (which it won't be for development builds not created via EAS, or if the `extra.eas` section is absent from `app.json`), `getExpoPushTokenAsync()` is called without a `projectId`. Expo SDK 47+ deprecated this call pattern and it will fail in production EAS builds, silently skipping token registration. The result is that push notifications never reach that installation.

**Fix:** Ensure `projectId` is set in `app.json` under `extra.eas.projectId` (Expo CLI sets this automatically for EAS-linked projects). Log a warning in development if `projectId` is absent rather than silently continuing.

---

## Post-Fix Projected Ratings

| Dimension | Current Score | Projected Score | Key Improvements |
|-----------|---------------|-----------------|------------------|
| **Security** | 6 / 10 | 8.5 / 10 | Persisted PIN lockouts, no PII in nav params, no unauthenticated admin endpoints, auth check before push nav |
| **Performance** | 6.5 / 10 | 8 / 10 | In-memory token cache in apiFetch, bounded message cache, better Set eviction |
| **Reliability** | 5.5 / 10 | 8.5 / 10 | No `total` ReferenceError crash, no unauthenticated refunds, cold-start notification fix, no Ably orphans |
| **Structure / Architecture** | 7 / 10 | 8.5 / 10 | Consistent PIN lockout pattern, all admin screens use apiClient, onboarding uses context not URL params |
| **Financial Integrity** | 7.5 / 10 | 9 / 10 | Play Billing upgrade API fixed, real ad unit IDs in production, PIN attempt escalation |

---

*Report generated: June 26, 2026 08:23 AM*
