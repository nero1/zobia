# Zobia Expo App — Forensic Bug Report

**Generated:** 2026-06-26 10:02 UTC  
**Scope:** Expo mobile app (Android API 36 primary target) — `/apps/expo`  
**Analysis depth:** Full codebase forensic review (all screens, components, lib, plugins)  
**Status:** REPORT ONLY — no fixes applied

---

## Current Code Quality Rating

| Dimension | Score | Notes |
|-----------|-------|-------|
| Security | 5/10 | Critical auth flow breakage; PIN lockout typo; no GDPR consent |
| Stability | 6/10 | Compile error (pin.tsx), several crash paths, stale closures |
| Android API 36 compat | 5/10 | Keyboard layout issue is pervasive; SDK 51 targets API 34 |
| Offline / data integrity | 7/10 | Good encryption & idempotency, but no queue size limits or cleanup |
| IAP / payments integrity | 6/10 | Product collision bug; no purchase confirmation |
| Performance | 7/10 | Mostly good, a few unbounded queries |
| Accessibility | 7/10 | Generally good patterns, some gaps |
| i18n / RTL | 8/10 | Good two-phase init, minor raw-key leaks |
| **Overall** | **6.1/10** | Solid architecture undermined by several critical bugs |

**Post-fix projected rating: 8.5/10** (assuming all items in this report are addressed)

---

## Bug Summary (38 bugs total)

| # | Severity | Title |
|---|----------|-------|
| 1 | 🔴 CRITICAL | Google OAuth callback silently dropped — origin mismatch |
| 2 | 🔴 CRITICAL | Android keyboard covers all chat input bars |
| 3 | 🔴 CRITICAL | `settings/pin.tsx` references undefined constants — build error / security bypass |
| 4 | 🔴 CRITICAL | EAS `runtimeVersion` policy mismatch — OTA update incompatibility |
| 5 | 🟠 HIGH | 2FA TOTP lockout race condition on first render |
| 6 | 🟠 HIGH | IAP coin pack product matching by count — collision charges wrong price |
| 7 | 🟠 HIGH | SQLite offline queue: no upper bound on pending messages |
| 8 | 🟠 HIGH | SQLite permanently-failed messages never purged — unbounded bloat |
| 9 | 🟠 HIGH | DM/Group chat `KeyboardAvoidingView` `behavior={undefined}` on Android |
| 10 | 🟠 HIGH | Ably WebSocket not reconnected on mid-session disconnect |
| 11 | 🟠 HIGH | GIF picker debounce timer not cleaned up on modal unmount |
| 12 | 🟠 HIGH | Store screen PIN lockout MMKV keys bypass `STORE_KEYS` registry |
| 13 | 🟠 HIGH | `onUserUpdated` hydrates auth user with no type validation |
| 14 | 🟡 MEDIUM | `daily_login_last_date` MMKV key not registered in `STORE_KEYS` |
| 15 | 🟡 MEDIUM | Messages tab list has no realtime updates — badge/preview 30 s stale |
| 16 | 🟡 MEDIUM | Wallet transaction history fetches only 30 items, no pagination |
| 17 | 🟡 MEDIUM | `ConfettiOverlay` uses fixed `Dimensions.get('window')` — breaks on orientation |
| 18 | 🟡 MEDIUM | `FloatingNotificationProvider` variable shadowing — `t` name collision in closures |
| 19 | 🟡 MEDIUM | No purchase confirmation dialog before triggering IAP |
| 20 | 🟡 MEDIUM | No GDPR/UMP consent flow for AdMob — compliance risk in EU/EEA |
| 21 | 🟡 MEDIUM | Rewarded ad daily cap resets at UTC midnight, not user's local midnight |
| 22 | 🟡 MEDIUM | Admin overview silently shows 0s after error is dismissed |
| 23 | 🟡 MEDIUM | `welcome-drop.tsx`: `JSON.parse(vibeAnswersParam)` not guarded — crash on bad URL |
| 24 | 🟡 MEDIUM | `welcome-drop.tsx`: API failure silently swallowed — onboarding stuck in loop |
| 25 | 🟡 MEDIUM | `refreshAccessToken` fetches `/users/me` unnecessarily — latency on every refresh |
| 26 | 🟡 MEDIUM | `google-services.json` not in repo — fresh clone build fails |
| 27 | 🟡 MEDIUM | MMKV chat cache not invalidated on server-side message deletion |
| 28 | 🟡 MEDIUM | Room countdown doesn't refresh room data when timer hits 0 |
| 29 | 🟢 LOW | `getStorage()` proxy throws uninformative error if called before `initStore()` |
| 30 | 🟢 LOW | Expo SDK 51 officially targets API 34; `compileSdkVersion 36` may cause runtime gaps |
| 31 | 🟢 LOW | `app.json` uses `sdkVersion` OTA policy — `fingerprint` policy is safer |
| 32 | 🟢 LOW | Admin screens show confusing errors for non-admin navigation instead of proper 403 UI |
| 33 | 🟢 LOW | Settings screen fires API PATCH on every field blur even if value unchanged |
| 34 | 🟢 LOW | Pidgin suggestion chip replaces wrong word boundary when input ends with a space |
| 35 | 🟢 LOW | `isInternetReachable === null` (initial NetInfo state) treated as connected |
| 36 | 🟢 LOW | Ably `authCallback` 401 not retried — token expiry causes permanent disconnect |
| 37 | 🟢 LOW | `multiline` TextInput `onSubmitEditing` fires `handleSend` — Enter key sends instead of newline |
| 38 | 🟢 LOW | `clearStore()` on sign-out doesn't clear SQLite offline queue — messages persist across accounts |

---

## Per-Bug Detail

---

### BUG-001 🔴 CRITICAL — Google OAuth callback silently dropped

**FILES:** `apps/expo/app/auth/login.tsx:84–93`

**Description:**  
`handleDeepLink` validates the incoming URL with:
```ts
const parsedUrl = new URL(url);
const expectedOrigin = new URL(env.API_BASE_URL).origin; // "https://zobia.vercel.app"
isValidCallback = parsedUrl.origin === expectedOrigin &&
                  parsedUrl.pathname.startsWith('/api/auth/callback');
```
The Google OAuth callback arrives as `zobia://auth/callback?code=XXX` (custom scheme deep link). `new URL('zobia://auth/callback?code=XXX').origin` returns `'null'` (the string) in React Native's JS engine — not `'https://zobia.vercel.app'`. The comparison fails and the callback is dropped silently. Additionally, the pathname `/auth/callback` does not start with `/api/auth/callback`, so even if origin matched, the check would still fail. **Google login is completely broken on Android.**

**FIX:**  
Replace the origin+pathname check with a scheme+path check appropriate for custom deep links:
```ts
let isValidCallback = false;
try {
  const parsed = new URL(url);
  const isCustomScheme = parsed.protocol === 'zobia:' || parsed.protocol === 'exp+zobia-social:';
  const isUniversalLink = parsed.origin === new URL(env.API_BASE_URL).origin;
  const hasAuthPath = parsed.pathname === '/auth/callback' || parsed.pathname.startsWith('/api/auth/callback');
  isValidCallback = (isCustomScheme || isUniversalLink) && hasAuthPath;
} catch {}
```

---

### BUG-002 🔴 CRITICAL — Android keyboard covers all chat input bars

**FILES:**  
`apps/expo/app.json:` `"softwareKeyboardLayoutMode": "adjustNothing"`  
`apps/expo/app/rooms/[roomId].tsx` (KeyboardAvoidingView with `keyboardOffset=0` on Android)  
`apps/expo/app/messages/[conversationId].tsx:756` (`behavior={Platform.OS === 'ios' ? 'padding' : undefined}`)

**Description:**  
`softwareKeyboardLayoutMode: "adjustNothing"` instructs Android NOT to resize the window when the soft keyboard appears. Every chat screen uses `KeyboardAvoidingView` but on Android `behavior` is `undefined` (no-op). The combination means the keyboard slides over the input bar without any layout adjustment. This affects rooms, DMs, and group chats — the entire messaging core of the app — on the primary target platform.

**FIX:**  
1. In `app.json` change `"softwareKeyboardLayoutMode"` from `"adjustNothing"` to `"adjustResize"` (or remove it entirely — the default is `"adjustResize"`).  
2. In all chat screens, pass `behavior="padding"` on Android too:
```tsx
behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
keyboardVerticalOffset={Platform.OS === 'android' ? StatusBar.currentHeight ?? 0 : 88}
```

---

### BUG-003 🔴 CRITICAL — `settings/pin.tsx` references undefined constants

**FILES:** `apps/expo/app/settings/pin.tsx:31–32, 151, 154, 179, 182`

**Description:**  
The file declares:
```ts
const PIN_PIN_MAX_ATTEMPTS = 5;      // double "PIN" prefix
const PIN_PIN_LOCKOUT_MS = 60_000;
```
But the lockout logic uses:
```ts
if (nextAttempts >= PIN_MAX_ATTEMPTS) {          // UNDEFINED
  setLockedUntil(Date.now() + PIN_LOCKOUT_MS);   // UNDEFINED
```
`PIN_MAX_ATTEMPTS` and `PIN_LOCKOUT_MS` are not declared anywhere. This is either a TypeScript compile error (blocking the build entirely) or, in a permissive build, silently evaluates as `false` — meaning **the PIN lockout never triggers** and users can make unlimited PIN attempts to brute-force their way through payment/deletion confirmations.

**FIX:**  
Rename the constants:
```ts
const PIN_MAX_ATTEMPTS = 5;
const PIN_LOCKOUT_MS = 60_000;
```

---

### BUG-004 🔴 CRITICAL — EAS `runtimeVersion` policy mismatch

**FILES:**  
`apps/expo/eas.json` (development/preview/staging profiles)  
`apps/expo/app.json:` `"runtimeVersion": { "policy": "sdkVersion" }`

**Description:**  
`app.json` uses `"policy": "sdkVersion"` for OTA runtime version, but `eas.json` development, preview, and staging profiles override it with `"policy": "appVersion"`. These two policies produce different runtime version strings. OTA updates built against `appVersion` policy will not be applied to clients that were built against `sdkVersion` policy and vice-versa. Updates deployed from production (which follows `app.json`) will never reach clients built from the preview/staging profiles, and updates from those profiles will fail compatibility checks on production clients.

**FIX:**  
Unify all profiles to the same policy. The recommended approach is to use `"policy": "fingerprint"` in `app.json` and remove the override from `eas.json` development/preview/staging profiles, so all builds use the same runtime version determination strategy.

---

### BUG-005 🟠 HIGH — 2FA TOTP lockout race condition on first render

**FILES:** `apps/expo/app/auth/two-factor.tsx`

**Description:**  
The screen persists lockout state in MMKV (`totp_locked_until`, `totp_attempts`) but hydrates it inside a `useEffect`. The `totpAttemptsRef.current` starts at `0` on mount. If the user submits a code before the `useEffect` fires (e.g. if the component renders with the keyboard already visible and the user is fast), the stored `failedAttempts` count is ignored for the first submission. A locked-out user could close and reopen the app and make one free attempt before the lockout is re-applied.

**FIX:**  
Initialize the ref from MMKV synchronously at declaration time:
```ts
const totpAttemptsRef = useRef<number>(() => {
  try { return storage.getNumber(STORE_KEYS.TOTP_FAILED_ATTEMPTS) ?? 0; } catch { return 0; }
}());
```
And check `lockedUntil` synchronously before rendering the input:
```ts
const [lockedUntil] = useState<number>(() => {
  try { return storage.getNumber(STORE_KEYS.TOTP_LOCKED_UNTIL) ?? 0; } catch { return 0; }
});
```

---

### BUG-006 🟠 HIGH — IAP coin pack product matching by count collision

**FILES:** `apps/expo/lib/payments/googlePlay.ts`, `apps/expo/app/economy/store.tsx`

**Description:**  
When the Play Billing purchase listener fires, the code identifies which coin pack was purchased by matching `coinAmount` from the server's product catalog against the products in `activePurchaseSessions`. If two different coin packs offer the same number of coins (e.g., a basic pack for $0.99 and a promo bundle for $1.99 that happens to have the same coin count), the resolver maps the result to the wrong session. The user who purchased the cheaper pack would receive the more expensive one's resolver, or vice-versa, leading to wrong amounts being credited or wrong products being acknowledged.

**FIX:**  
Match by `productId` (the canonical Play Store SKU), not by coin amount. The `activePurchaseSessions` Map should be keyed by `productId` and the purchase completion path should resolve by `purchase.productId`:
```ts
const resolver = purchaseResolvers.get(purchase.productId);
```

---

### BUG-007 🟠 HIGH — SQLite offline queue: no upper bound on pending messages

**FILES:** `apps/expo/lib/offline/sqlite.ts:238–242`, `apps/expo/lib/offline/syncQueue.ts:53–57`

**Description:**  
`getPendingMessages()` issues:
```sql
SELECT ... FROM offline_messages WHERE sync_status = 'pending' ORDER BY created_at ASC
```
with no `LIMIT`. A user who goes offline for an extended period or has a server outage could accumulate hundreds or thousands of queued messages. `getPendingMessages()` would load all of them into memory at once before the batch processor can iterate them. On low-RAM Android devices this risks an OOM crash or extreme memory pressure.

**FIX:**  
Add a `LIMIT` clause and process in pages:
```sql
SELECT ... FROM offline_messages WHERE sync_status = 'pending'
ORDER BY created_at ASC LIMIT 100
```
The sync function already processes in batches of 3; paging the fetch simply caps peak memory usage.

---

### BUG-008 🟠 HIGH — SQLite permanently-failed messages never purged

**FILES:** `apps/expo/lib/offline/sqlite.ts` (no cleanup function for `permanent_failure` rows)

**Description:**  
Messages that reach `sync_status = 'permanent_failure'` (4xx errors or ≥3 retries) are never deleted from the database. There is no scheduled cleanup, no TTL eviction, and no UI-triggered purge. Over time — especially for active users who frequently lose connectivity or encounter validation errors — this table accumulates rows indefinitely, growing the SQLite database and slowing `getPendingMessages()` (which uses a partial index but still must scan a growing table).

**FIX:**  
Add a cleanup function and call it during `initOfflineDB()` or on each reconnect sync:
```ts
export async function purgePermanentlyFailedMessages(olderThanMs = 7 * 24 * 60 * 60 * 1000): Promise<void> {
  const cutoff = Date.now() - olderThanMs;
  await getDB().runAsync(
    `DELETE FROM offline_messages WHERE sync_status = 'permanent_failure' AND created_at < ?`,
    [cutoff]
  );
}
```
Call this at the end of `syncPendingMessages()`.

---

### BUG-009 🟠 HIGH — DM/Group chat `KeyboardAvoidingView behavior={undefined}` on Android

**FILES:** `apps/expo/app/messages/[conversationId].tsx:756`

**Description:**  
```tsx
<KeyboardAvoidingView
  behavior={Platform.OS === 'ios' ? 'padding' : undefined}
  keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
>
```
On Android, `behavior={undefined}` means `KeyboardAvoidingView` performs no adjustment. Combined with BUG-002 (`adjustNothing`), the keyboard fully obscures the message input bar. This is the same root problem as BUG-002 but manifests independently in the DM screen. (See BUG-002 fix for the joint solution.)

---

### BUG-010 🟠 HIGH — Ably WebSocket not reconnected on mid-session disconnect

**FILES:** `apps/expo/lib/realtime/useRealtimeChannel.ts:78–80`

**Description:**  
The Ably connection state change listener correctly sets `connected = false` when the socket drops, which triggers faster React Query polling as a fallback. However, the Ably client itself is not instructed to reconnect. Ably's default `disconnectedRetryTimeout` is 15 seconds, but if the `cancelled` flag is checked after the async setup (`if (cancelled) { ch.unsubscribe(); client.close(); return; }`) and the cleanup closure has not been set yet, Ably may have been closed prematurely. Furthermore, if the connection enters the `suspended` state (Ably's extended backoff), it can remain there until the next app foreground event — which is not wired to trigger reconnection in this hook.

**FIX:**  
Listen for `connected` state and on `suspended`/`failed` transitions attempt to close and re-establish the client. Alternatively, explicitly call `client.connect()` when `AppState` changes to `active`:
```ts
AppState.addEventListener('change', (state) => {
  if (state === 'active' && ablyClient?.connection.state !== 'connected') {
    ablyClient?.connect();
  }
});
```

---

### BUG-011 🟠 HIGH — GIF picker debounce timer not cleaned up on modal unmount

**FILES:** `apps/expo/app/messages/[conversationId].tsx:328, 343–349`

**Description:**  
```ts
const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
// ...
debounceRef.current = setTimeout(() => {
  setLoading(true);
  searchGifs(text || 'trending').then(setResults)...
}, 400);
```
There is no cleanup in the `GifPickerModal`'s effect or component unmount path. If the user types a query and immediately closes the modal before the 400 ms timer fires, the timeout fires into an unmounted component, calling `setResults` and `setLoading` on stale state, producing a React "can't update unmounted component" warning (React 18 no longer throws but it's still a memory/logic concern).

**FIX:**  
Add a cleanup in the search `useEffect` (or add a `useEffect` return that clears the debounce on unmount):
```ts
useEffect(() => {
  return () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  };
}, []);
```

---

### BUG-012 🟠 HIGH — Store screen PIN lockout keys bypass `STORE_KEYS` registry

**FILES:** `apps/expo/app/economy/store.tsx`

**Description:**  
The IAP store screen's PIN lockout uses raw MMKV string keys:
```ts
storage.getNumber('store_pin_failed_attempts')
storage.getNumber('store_pin_locked_until')
```
These keys are not registered in `STORE_KEYS` (`lib/offline/store.ts`). This means:
1. `clearStore()` (called on sign-out) does NOT clear them — lockout state persists across accounts.
2. Typos in these raw strings would silently read `undefined` instead of the stored value, bypassing lockout.
3. No single place to audit or rename all MMKV key usage.

**FIX:**  
Add `STORE_PIN_FAILED_ATTEMPTS` and `STORE_PIN_LOCKED_UNTIL` to the `STORE_KEYS` constant and use them in both `economy/store.tsx` and `settings/pin.tsx`.

---

### BUG-013 🟠 HIGH — `onUserUpdated` hydrates auth user with no type validation

**FILES:** `apps/expo/lib/auth/context.tsx` (onUserUpdated handler)

**Description:**  
The `onUserUpdated` event handler in AuthProvider does:
```ts
const handler = (userJson: string) => {
  setUser(JSON.parse(userJson) as AuthUser);
};
```
There is no type checking or schema validation. If the event fires with a malformed JSON string (or a server response that changes shape), `JSON.parse` could throw (crashing the handler) or produce a partial object that is cast unsafely to `AuthUser`. This could lead to missing required fields being accessed as `undefined` throughout the app, causing subtle UI/logic failures.

**FIX:**  
Use Zod or a manual shape check after parsing:
```ts
const handler = (userJson: string) => {
  try {
    const parsed = JSON.parse(userJson);
    if (parsed && typeof parsed.id === 'string') {
      setUser(parsed as AuthUser);
    }
  } catch {
    console.warn('[auth] onUserUpdated: malformed user JSON');
  }
};
```

---

### BUG-014 🟡 MEDIUM — `daily_login_last_date` MMKV key not in `STORE_KEYS`

**FILES:** `apps/expo/app/(tabs)/index.tsx:909–934`

**Description:**  
The home screen reads and writes `'daily_login_last_date'` directly:
```ts
storage.getString('daily_login_last_date')
storage.set('daily_login_last_date', today)
```
This raw key is not in `STORE_KEYS`. It won't be cleared on `clearStore()` (sign-out), meaning it persists across sessions for different accounts sharing the same device, potentially skipping the daily XP award for a new account that signs in on the same day.

**FIX:**  
Add `DAILY_LOGIN_LAST_DATE: 'daily_login_last_date'` to `STORE_KEYS` and use `STORE_KEYS.DAILY_LOGIN_LAST_DATE` in `index.tsx`.

---

### BUG-015 🟡 MEDIUM — Messages tab list has no realtime updates

**FILES:** `apps/expo/app/(tabs)/messages.tsx:261–285`

**Description:**  
The DM/Group conversation list uses `staleTime: 30_000` with no realtime subscription. New incoming messages won't update the last-message preview or unread badge for up to 30 seconds. The individual conversation screens have Ably realtime subscription, but the list view stays stale. This means users see outdated conversation summaries in the primary messages view.

**FIX:**  
Subscribe to a `user:{userId}:inbox` Ably channel in the messages tab and `queryClient.invalidateQueries({ queryKey: ['dm-list'] })` on `new_message` events. Alternatively, reduce `staleTime` to `5_000` and use `refetchOnWindowFocus: true`.

---

### BUG-016 🟡 MEDIUM — Wallet transaction history shows only 30 items, no pagination

**FILES:** `apps/expo/app/economy/wallet.tsx:61`

**Description:**  
```ts
apiClient.get<WalletData>('/economy/coins/balance?limit=30')
```
The endpoint is called with `limit=30` and there is no "Load More" button, infinite scroll, or pagination cursor. Active users with more than 30 transactions have no way to view older history.

**FIX:**  
Implement a paginated `FlatList` with an `onEndReached` callback that fetches the next page using a cursor (e.g., `?before=<oldest_id>`), or add a "Load More" button that appends results to the existing list.

---

### BUG-017 🟡 MEDIUM — `ConfettiOverlay` uses fixed `Dimensions.get('window')` — breaks on orientation/split-screen

**FILES:** `apps/expo/components/ui/ConfettiOverlay.tsx:4–5`

**Description:**  
```ts
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
```
This is evaluated once at module import time. On devices with orientation changes or Android split-screen mode, the screen dimensions change but the confetti particles are still positioned based on the original dimensions. Some particles will fly off-screen horizontally or not reach the bottom.

**FIX:**  
Use `useWindowDimensions()` inside the component:
```ts
export function ConfettiOverlay({ onDone }: Props) {
  const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = useWindowDimensions();
  // ...
}
```

---

### BUG-018 🟡 MEDIUM — `FloatingNotificationProvider` variable `t` shadowed in timer filter callbacks

**FILES:** `apps/expo/components/providers/FloatingNotificationProvider.tsx:194, 213, 301, 310`

**Description:**  
```ts
const tid = setTimeout(() => {
  realtimeTimerIds.current = realtimeTimerIds.current.filter(t => t !== tid);
  // ...
}, 400);
```
The parameter `t` in `.filter(t => t !== tid)` shadows the outer `t` from `useTranslation()`. TypeScript may not warn about this because the types differ, but if the filter callback were ever extended to use `t` for translation, it would silently call `setTimeout`'s timer ID instead of the i18next function. This is a fragile naming collision.

**FIX:**  
Rename the filter parameter:
```ts
realtimeTimerIds.current = realtimeTimerIds.current.filter(id => id !== tid);
```

---

### BUG-019 🟡 MEDIUM — No IAP purchase confirmation dialog

**FILES:** `apps/expo/app/economy/store.tsx` (purchaseCoinPack / handleBuyPack)

**Description:**  
When a user taps a coin pack, the PIN verification proceeds immediately and upon success `initiatePurchase()` is called directly — no "You are about to purchase X coins for $Y. Confirm?" dialog. Given that IAP charges are difficult to reverse, accidental taps (especially on small phone screens) can result in unintended purchases. Google Play's own UX guidelines recommend a confirmation step before initiating a billing flow.

**FIX:**  
Add an `Alert.alert` confirmation step between PIN success and `initiatePurchase()`:
```ts
Alert.alert(
  `Purchase ${pack.coinAmount} ${currency.softPlural}`,
  `You will be charged ${pack.priceLabel}. Continue?`,
  [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Buy Now', onPress: () => void initiatePurchase(pack) },
  ]
);
```

---

### BUG-020 🟡 MEDIUM — No GDPR/UMP consent flow for AdMob

**FILES:** `apps/expo/lib/ads/admob.ts`

**Description:**  
Google's AdMob SDK requires integration with the User Messaging Platform (UMP) SDK to collect and surface GDPR consent for users in the EEA/UK. The `admob.ts` file initialises ads directly without checking or requesting consent:
```ts
mobileAds().initialize();
```
Serving personalised ads to EEA users without consent violates GDPR and Google's own publisher policies, which can result in account suspension. Additionally, no `ConsentInformation.requestConsentInfoUpdate()` call is present.

**FIX:**  
Integrate `@react-native-google-ump/consent` (or the UMP methods now built into `react-native-google-mobile-ads` v13+), and gate ad initialization on consent status:
```ts
import { AdsConsent, AdsConsentStatus } from 'react-native-google-mobile-ads';
const consentInfo = await AdsConsent.requestInfoUpdate();
if (consentInfo.isConsentFormAvailable) {
  await AdsConsent.loadAndShowConsentFormIfRequired();
}
// Only initialize after consent is obtained or not required
mobileAds().initialize();
```

---

### BUG-021 🟡 MEDIUM — Rewarded ad daily cap resets at UTC midnight, not user's local midnight

**FILES:** `apps/expo/components/ads/RewardedAdButton.tsx`

**Description:**  
The daily cap check compares the stored date string against today in UTC:
```ts
const today = new Date().toISOString().slice(0, 10); // UTC date
```
For a user in UTC+12 (New Zealand), "today" UTC rolls over at noon local time, meaning their cap resets at 12:00 PM instead of midnight. Conversely, users in UTC-12 (Samoa) can't watch any more ads after 12:00 PM because tomorrow has already started UTC. This creates a confusing UX where the reset time is not predictable.

**FIX:**  
Use the user's local date:
```ts
const now = new Date();
const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
```

---

### BUG-022 🟡 MEDIUM — Admin overview silently shows zeros after error

**FILES:** `apps/expo/app/admin/index.tsx:51–60`

**Description:**  
When `loadStats()` fails, an alert is shown (BUG-018 was supposedly fixed), but the component's `stats` state remains `null`, and all `StatCard` components render `0` (via `stats?.totalUsers ?? 0` etc.) after the alert is dismissed. An admin could mistake zeros for real data. There's also no retry button visible in the UI after the error.

**FIX:**  
Introduce an explicit `error` state; render a full-screen error view with a retry button rather than showing zeroed stats:
```tsx
if (error) return (
  <View style={styles.center}>
    <Text>Failed to load stats</Text>
    <Button label="Retry" onPress={loadStats} />
  </View>
);
```

---

### BUG-023 🟡 MEDIUM — `welcome-drop.tsx`: `JSON.parse(vibeAnswersParam)` not guarded

**FILES:** `apps/expo/app/onboarding/welcome-drop.tsx`

**Description:**  
The screen receives `vibeAnswers` as a URL param string and parses it:
```ts
const vibeAnswers = JSON.parse(vibeAnswersParam);
```
This call is outside any try-catch. If navigation is invoked with a malformed or missing `vibeAnswersParam`, `JSON.parse` throws an uncaught exception which crashes the onboarding screen. A user in this state is stuck — they cannot complete onboarding.

**FIX:**  
```ts
let vibeAnswers: unknown = [];
try {
  if (vibeAnswersParam) vibeAnswers = JSON.parse(vibeAnswersParam);
} catch {
  // malformed param; proceed with empty answers
}
```

---

### BUG-024 🟡 MEDIUM — `welcome-drop.tsx`: API failure silently caught — onboarding not completed

**FILES:** `apps/expo/app/onboarding/welcome-drop.tsx` (completeOnboarding API call)

**Description:**  
If the `POST /onboarding/complete` API call fails (network error, 5xx), the error is swallowed silently. `ONBOARDING_COMPLETE` is not set in MMKV, so on next app start the user is redirected back through onboarding again. The user may loop through onboarding indefinitely without knowing why.

**FIX:**  
Show an error state with a retry button, and only set the MMKV flag after the API call succeeds:
```ts
try {
  await apiClient.post('/onboarding/complete', payload);
  storage.set(STORE_KEYS.ONBOARDING_COMPLETE, true);
  router.replace('/(tabs)');
} catch {
  setError(t('onboarding.completeError'));
}
```

---

### BUG-025 🟡 MEDIUM — `refreshAccessToken` fetches `/users/me` unnecessarily

**FILES:** `apps/expo/lib/api/client.ts` (refreshAccessToken)

**Description:**  
After refreshing tokens, `refreshAccessToken` also calls `apiClient.get('/users/me')` to sync the user profile. This adds an extra network round-trip on every token refresh (which happens on app foreground if the token is near-expiry). Token refresh is already on the critical path for blocked API requests, so this extra call adds 50–200 ms of latency to every foreground refresh cycle.

**FIX:**  
Move the `/users/me` fetch to a separate background call that doesn't block the token refresh path. The refresh should return only the tokens. Profile sync can be done via React Query's existing `['users', 'me']` query key invalidation after successful sign-in.

---

### BUG-026 🟡 MEDIUM — `google-services.json` not in repo — fresh clone build fails

**FILES:** `apps/expo/app.json` (references `./google-services.json`), `.gitignore`

**Description:**  
`app.json` references `"googleServicesFile": "./google-services.json"` for Firebase (push notifications / FCM). This file is not in the repository (presumably gitignored as it contains API keys). A fresh `git clone` + `eas build` will fail with a "file not found" error. New team members or CI pipelines need undocumented manual steps to obtain this file.

**FIX:**  
Document in the repo's README that `google-services.json` must be obtained from the Firebase Console and placed in `apps/expo/`. Alternatively, use EAS Secrets or environment variables to inject this file at build time rather than relying on a local file.

---

### BUG-027 🟡 MEDIUM — MMKV chat message cache not invalidated on server-side deletion

**FILES:** `apps/expo/lib/chat/messageCache.ts`, `apps/expo/app/messages/[conversationId].tsx:637–639`

**Description:**  
Messages are cached in MMKV with a 24-hour TTL and a 50-message FIFO eviction. If a message is deleted server-side (moderation, user deletion), the MMKV cache still returns it until the 24h TTL expires or the cache is evicted. On first paint from cache, deleted messages are visible to users.

**FIX:**  
The delta fetch (`?after=lastTimestamp`) won't return deleted messages, but the cache isn't pruned against it. After merging delta results, filter out message IDs that are absent from the server's full response (add a `?include_deleted=true&tombstones=1` endpoint, or store deletion events). At minimum, reduce the cache TTL to 2–4 hours.

---

### BUG-028 🟡 MEDIUM — Room countdown doesn't refresh data when timer reaches 0

**FILES:** `apps/expo/app/rooms/[roomId].tsx` (countdown timer for drop rooms)

**Description:**  
The room screen displays a countdown to the scheduled drop time. When the timer reaches 0, no re-fetch of room data is triggered. The room may have transitioned to "live" state on the server but the client continues showing stale "upcoming" state until the user manually pulls to refresh or the React Query cache expires.

**FIX:**  
Add a `useEffect` that triggers `queryClient.invalidateQueries({ queryKey: ['room', roomId] })` when `timeLeft` transitions from `> 0` to `0`:
```ts
const prevTimeLeftRef = useRef(timeLeft);
useEffect(() => {
  if (prevTimeLeftRef.current > 0 && timeLeft === 0) {
    queryClient.invalidateQueries({ queryKey: ['room', roomId] });
  }
  prevTimeLeftRef.current = timeLeft;
}, [timeLeft, roomId, queryClient]);
```

---

### BUG-029 🟢 LOW — `getStorage()` proxy throws uninformative error before `initStore()`

**FILES:** `apps/expo/lib/offline/store.ts`

**Description:**  
The `storage` proxy throws `'Store not initialized — call initStore() first'` if accessed before `initStore()` completes. The error message doesn't identify the call site (key being read/written) or suggest remediation. This makes debugging "MMKV not initialized" crashes harder than necessary.

**FIX:**  
Include the key name in the error:
```ts
const handler = {
  get(target: MMKV, prop: string | symbol) {
    if (!_store) throw new Error(`[MMKV] Store not ready (accessed key: ${String(prop)}). Call initStore() first.`);
    return Reflect.get(target, prop);
  }
};
```

---

### BUG-030 🟢 LOW — Expo SDK 51 officially targets Android API 34; declaring API 36 may cause runtime gaps

**FILES:** `apps/expo/app.json` (`compileSdkVersion: 36`, `targetSdkVersion: 36`)

**Description:**  
Expo SDK 51 was tested and certified against Android API 34. Targeting API 36 may trigger behavioral changes in Android that the SDK's native modules haven't been tested against (e.g., predictive back gestures requiring `android:enableOnBackInvokedCallback`, storage permission changes, foreground service type requirements). These could surface as subtle crashes or permission denials on API 36 devices.

**FIX:**  
Downgrade to `targetSdkVersion: 34` for Expo SDK 51. Upgrade to Expo SDK 53+ (which natively targets API 35/36) before bumping `targetSdkVersion` to 36. Track the [Expo SDK changelog](https://expo.dev/changelog) for API 36 support.

---

### BUG-031 🟢 LOW — `app.json` uses `sdkVersion` OTA policy — `fingerprint` is safer

**FILES:** `apps/expo/app.json` `"runtimeVersion": { "policy": "sdkVersion" }`

**Description:**  
The `sdkVersion` policy assigns the same runtime version to all builds of the same Expo SDK, regardless of whether native code changes have occurred. This means an OTA update could be delivered to a client build that has different native dependencies, potentially causing crashes if the update relies on a native module version that differs from what's in the installed APK.

**FIX:**  
Switch to `"policy": "fingerprint"` which computes a hash of all native code and rejects OTA updates that don't match the running APK's native fingerprint.

---

### BUG-032 🟢 LOW — Admin screens provide poor UX for unauthorized navigation

**FILES:** `apps/expo/app/admin/_layout.tsx`, all `app/admin/*.tsx` screens

**Description:**  
The drawer only shows the Admin link for `user.isAdmin === true`, but if a non-admin user navigates directly (e.g., via a deep link `zobia://admin`), the admin screens attempt their API calls, receive 403s, and display generic error states or empty lists. There is no client-side guard that shows a "Not Authorized" screen.

**FIX:**  
Add a guard to the admin layout:
```tsx
const { user } = useAuth();
if (!user?.isAdmin) return <Redirect href="/(tabs)" />;
```

---

### BUG-033 🟢 LOW — Settings screen fires API PATCH on field blur even when value unchanged

**FILES:** `apps/expo/app/settings/index.tsx:779, 791, 801`

**Description:**  
```tsx
<TextInput
  onEndEditing={() => patchMutation.mutate({ displayName: merged.displayName })}
```
The mutation fires on every field blur regardless of whether the user changed anything. Dismissing the keyboard after reading settings triggers unnecessary network requests.

**FIX:**  
Track the original value and only patch if changed:
```tsx
const originalRef = useRef(data?.displayName ?? '');
onEndEditing={() => {
  if (merged.displayName !== originalRef.current) {
    patchMutation.mutate({ displayName: merged.displayName });
  }
}}
```

---

### BUG-034 🟢 LOW — Pidgin suggestion chip replaces wrong word when input ends with a space

**FILES:** `apps/expo/app/messages/[conversationId].tsx:830–836`

**Description:**  
```ts
const words = prev.split(' ');
words[words.length - 1] = s;
return words.join(' ') + ' ';
```
If the user types `"hello "` (with a trailing space), `split(' ')` produces `["hello", ""]`. `words[words.length - 1]` is `""` (the empty last element). The suggestion replaces the empty string, producing `"hello <suggestion> "` which is correct. BUT if the user typed `"hello world "`, the result is `"hello <suggestion> "` — losing "world". The logic replaces the last element regardless of whether it's the word the user is currently typing.

**FIX:**  
Only show suggestions when the user is in the middle of a word (no trailing space), and replace the specific partial word the cursor is on. Or trim trailing spaces before splitting:
```ts
const trimmed = prev.trimEnd();
const words = trimmed.split(' ');
words[words.length - 1] = s;
return words.join(' ') + ' ';
```

---

### BUG-035 🟢 LOW — `isInternetReachable === null` treated as connected

**FILES:** `apps/expo/lib/offline/syncQueue.ts:37–39`

**Description:**  
```ts
if (!state.isConnected || !state.isInternetReachable) { return; }
```
On Android, `isInternetReachable` can be `null` during the initial NetInfo fetch (the check hasn't completed yet). `!null` is `true`, so `syncPendingMessages()` returns early even when the device is actually connected. This delays the first sync after launch or network reconnect until NetInfo resolves.

**FIX:**  
Treat `null` as "unknown/potentially connected" and proceed:
```ts
if (!state.isConnected) return; // null isConnected = no connection info yet
if (state.isInternetReachable === false) return; // explicit false = offline
```

---

### BUG-036 🟢 LOW — Ably `authCallback` 401 not retried — token expiry causes permanent disconnect

**FILES:** `apps/expo/lib/realtime/useRealtimeChannel.ts:62–74`

**Description:**  
The `authCallback` calls `/realtime/ably-token` which requires a valid Bearer JWT. If the JWT has expired at the moment Ably attempts to reconnect (e.g., after a long background period), the API returns 401, the callback returns an error, and Ably enters `failed` state. The hook logs a warning but does not attempt to refresh the JWT and re-initialise. The socket stays permanently disconnected until the app is restarted.

**FIX:**  
In the `authCallback` error handler, attempt a silent token refresh before signalling failure:
```ts
} catch (err) {
  if ((err as AxiosError)?.response?.status === 401) {
    try {
      await refreshAccessToken(); // silently renew
      const { data } = await apiClient.get(`/realtime/ably-token?...`);
      callback(null, data);
      return;
    } catch {}
  }
  callback(err, null);
}
```

---

### BUG-037 🟢 LOW — `multiline` TextInput `onSubmitEditing` fires `handleSend`

**FILES:** `apps/expo/app/messages/[conversationId].tsx:892–895`

**Description:**  
```tsx
<TextInput
  multiline
  returnKeyType="send"
  onSubmitEditing={handleSend}
```
On Android, pressing Enter in a `multiline` TextInput fires `onSubmitEditing` which calls `handleSend` instead of inserting a newline. Users have no way to type multi-line messages. On iOS this typically doesn't fire for multiline inputs, so the behavior is platform-inconsistent.

**FIX:**  
Remove `onSubmitEditing` from the multiline input. The send button is the only intended send trigger for multiline composition. Alternatively, allow newlines and show a separate "send" action.

---

### BUG-038 🟢 LOW — `clearStore()` on sign-out doesn't clear SQLite offline queue

**FILES:** `apps/expo/lib/offline/store.ts` (`clearStore()`), `apps/expo/lib/offline/sqlite.ts`

**Description:**  
`clearStore()` clears all MMKV keys on sign-out but does not touch the SQLite offline message queue. If a user queues messages while offline, then signs out and a different account signs in on the same device, the pending messages (belonging to the previous account) will be retried by `syncPendingMessages()` under the new account's JWT — potentially delivering them to wrong recipients or failing with 403s that produce confusing error logs.

**FIX:**  
Add a `clearOfflineQueue()` function to `sqlite.ts` and call it from `clearStore()` or from the sign-out path in `auth/context.tsx`:
```ts
export async function clearOfflineQueue(): Promise<void> {
  await getDB().runAsync('DELETE FROM offline_messages');
}
```

---

## Code Quality Assessment

### What's done well
- **Encryption at rest**: AES-256-GCM for SQLite content + SecureStore key storage — solid implementation
- **Idempotency**: `idempotencyKey` on all message sends with server dedup
- **JWT handling**: Proper bearer token rotation, deduplicated refresh with `refreshPromise`
- **Stale closure prevention**: `useRef` + `onEventRef.current` pattern in `useRealtimeChannel`
- **Accessibility**: Most interactive elements have `accessibilityRole`, `accessibilityLabel`, proper touch targets (44dp minimum)
- **TypeScript coverage**: Extensive type annotations throughout
- **Error boundaries**: `ScreenErrorBoundary` exported from every screen
- **Offline resilience**: Schema migrations with PRAGMA user_version, `resetSendingMessages` on reconnect
- **Security**: `VALID_PUSH_ROUTES` allowlist for deep-link push routing; postMessage API proxy in GameWebView
- **RTL support**: Two-phase i18n init with `setupRTL` — correct pattern
- **AdMob**: Test IDs used as defaults to prevent accidental live ad charges in dev builds

### What needs improvement
- Authentication callback validation logic is fundamentally wrong for custom-scheme deep links
- Android keyboard avoidance is broken app-wide
- A compile-time error (undefined constants) in a security-critical screen
- No GDPR consent infrastructure for ads
- Several raw MMKV key strings bypass the centralized registry
- Missing pagination in financial history
- IAP reliability concerns (product collision, no confirmation)

---

*Report generated: 2026-06-26 10:02 UTC*  
*Files analyzed: ~75 Expo app source files*  
*DO NOT FIX until review is complete*
