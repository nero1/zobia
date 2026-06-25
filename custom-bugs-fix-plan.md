# Zobia Expo App — Bug Fix Plan

**Generated:** June 25, 2026 at 02:29 PM  
**Based on:** custom-bugs-report.md (35 bugs)  
**Status:** PLAN ONLY — do not implement until reviewed

---

## Execution Order

Fixes are grouped into 5 phases by risk and dependency. Complete each phase before starting the next.

---

## Phase 1 — Critical Security (fix immediately before any release)

### TASK-1: Fix BUG-SEC-01 — Remove JWT from WebView window global

**File:** `apps/expo/components/games/GameWebView.tsx`

- Remove the `injectedJavaScriptBeforeContentLoaded` line that sets `window.__ZOBIA_TOKEN__`
- Implement a postMessage-based API proxy instead:
  - Add an `onMessage` handler that receives `{ type: 'API_REQUEST', method, endpoint, body }` messages from the WebView
  - The handler calls `apiClient[method](endpoint, body)` using the secure React Native context
  - Posts the response back via `webViewRef.current.postMessage(JSON.stringify({ type: 'API_RESPONSE', requestId, data, error }))`
- Update the game HTML/JS SDK to use `window.ReactNativeWebView.postMessage(...)` instead of direct `fetch()` with the token
- If games genuinely need direct API access, issue a scoped short-lived token (60s TTL, game-endpoints-only) via a dedicated `/api/games/session-token` endpoint, and inject only that limited token

---

### TASK-2: Fix BUG-SEC-02 — Hash PIN before sending to server

**File:** `apps/expo/app/economy/store.tsx`

- Import `Crypto` from `expo-crypto` (already a dependency)
- Before calling `apiClient.post('/auth/pin/verify', { pin: pinInput })`, compute:
  ```
  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${userId}:${pinInput}`
  );
  ```
- Send `{ pinHash: hash }` instead of `{ pin: pinInput }`
- Coordinate the server-side `/api/auth/pin/verify` endpoint to accept and compare `pinHash` (or use a HMAC approach with a server-provided nonce for replay protection)
- Apply the same pattern to any other place where a raw PIN is sent (search for all `/auth/pin/` API calls)

---

## Phase 2 — Critical Functionality (fix before production launch)

### TASK-3: Fix BUG-ENV-01 — APP_ENV never reaches production builds

**Files:** `apps/expo/app.json`, `apps/expo/lib/env.ts`, `apps/expo/eas.json`

Option A (Recommended — Dynamic Config):
- Rename `app.json` to `app.config.ts`
- Forward all needed env vars from `process.env` into the `extra` block:
  ```ts
  extra: {
    APP_ENV: process.env.APP_ENV ?? 'development',
    API_BASE_URL: process.env.API_BASE_URL ?? 'http://localhost:3000/api',
    REALTIME_PROVIDER: process.env.REALTIME_PROVIDER ?? 'none',
  }
  ```
- In `eas.json`, keep `APP_ENV`, `API_BASE_URL`, and `REALTIME_PROVIDER` in the `env` blocks (they already are)
- `env.ts` already reads `Constants.expoConfig?.extra?.APP_ENV`, so no changes needed there

Option B (EXPO_PUBLIC_ prefix):
- Rename the EAS env vars to `EXPO_PUBLIC_APP_ENV`, `EXPO_PUBLIC_API_BASE_URL`, etc.
- Update `env.ts` to read `process.env.EXPO_PUBLIC_APP_ENV` directly (Metro inlines these at bundle time)
- No `Constants.expoConfig.extra` plumbing needed

Choose Option A if you want runtime-switchable values; Option B for simpler setup.

---

### TASK-4: Fix BUG-OFFLINE-01 — Add offline queue to room chat

**File:** `apps/expo/app/rooms/[roomId].tsx`

- Import `queueMessage` from `@/lib/offline/sqlite`
- Import `NetInfo` from `@react-native-community/netinfo`
- In the room message mutation's `onError` callback, after rolling back the optimistic update:
  - Check `(await NetInfo.fetch()).isConnected === false` to confirm this is an offline failure
  - If offline, call `queueMessage({ conversationId: roomId, conversationType: 'room', content, messageType, idempotencyKey })`
  - Show a softer UI message like "Message saved — will send when online" instead of a hard error alert
- The `syncPendingMessages()` in `syncQueue.ts` already handles `conversationType: 'room'` routing to `/rooms/${conversationId}/messages`, so no changes to the sync side are needed

---

### TASK-5: Fix BUG-PAY-01 — Fix swallowed billing error in store.tsx

**File:** `apps/expo/app/economy/store.tsx` (handleBuy function)

- Replace the `.catch(() => {}).then(...)` pattern with a proper try/catch:
  ```ts
  setPurchasingId(packId);
  try {
    await initGooglePlayBilling();
    const result = await purchaseCoins(playProduct.id);
    if (result.success) {
      Alert.alert('Success!', `You received ${result.coins.toLocaleString()} coins!`);
    } else if (result.error !== 'Purchase cancelled') {
      Alert.alert('Purchase Failed', result.error ?? 'Could not complete purchase.');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not connect to Google Play.';
    Alert.alert('Purchase Failed', msg);
  } finally {
    setPurchasingId(null);
  }
  ```

---

## Phase 3 — High Severity (fix before public beta)

### TASK-6: Fix BUG-ADS-01 — Dangling event listener in showInterstitialAd

**File:** `apps/expo/lib/ads/admob.ts`

- Locate the `.show().catch(err => reject(err))` block
- Add `unsubClosed()` call before the `reject`:
  ```ts
  interstitialAd.show().catch((err) => {
    unsubClosed(); // prevent listener leak
    reject(err);
  });
  ```

---

### TASK-7: Fix BUG-ADS-02 — showRewardedAd EARNED_REWARD/CLOSED race condition

**File:** `apps/expo/lib/ads/admob.ts`

- Add a short `setTimeout` delay in the `CLOSED` handler to allow `EARNED_REWARD` to arrive first:
  ```ts
  const unsubClosed = rewardedAd.addAdEventListener(RewardedAdEventType.CLOSED, () => {
    setTimeout(() => {
      unsubEarned();
      unsubClosed();
      resolve({ rewarded });
    }, 150); // Allow EARNED_REWARD callback to arrive
  });
  ```
- Ensure `unsubClosed()` itself is called in the timeout callback to avoid double-cleanup

---

### TASK-8: Fix BUG-PAY-02 — Clear maps on billing disconnect

**File:** `apps/expo/lib/payments/googlePlay.ts`

- In `disconnectGooglePlayBilling()`, after the `await RNIap.endConnection()` call, add:
  ```ts
  purchaseResolvers.clear();
  activePurchaseSessions.clear();
  pendingRecovery.clear();
  ```

---

### TASK-9: Fix BUG-AUTH-01 — handleDeepLink stale closure in login.tsx

**File:** `apps/expo/app/auth/login.tsx`

- Apply the `useRef` pattern to capture the latest `handleDeepLink` without re-subscribing:
  ```ts
  const handleDeepLinkRef = useRef(handleDeepLink);
  useEffect(() => { handleDeepLinkRef.current = handleDeepLink; });
  useEffect(() => {
    const sub = Linking.addEventListener('url', ({ url }) => handleDeepLinkRef.current({ url }));
    return () => sub.remove();
  }, []); // stable subscriber, latest handler via ref
  ```
- Remove the `// eslint-disable-next-line react-hooks/exhaustive-deps` comment

---

### TASK-10: Fix BUG-MEM-01 — XP flash setTimeout leak in room screen

**File:** `apps/expo/app/rooms/[roomId].tsx`

- Add a ref: `const xpFlashTimerRef = useRef<NodeJS.Timeout | null>(null)`
- Replace all `setTimeout(() => setShowXPFlash(false), N)` calls with:
  ```ts
  if (xpFlashTimerRef.current) clearTimeout(xpFlashTimerRef.current);
  xpFlashTimerRef.current = setTimeout(() => setShowXPFlash(false), N);
  ```
- Add cleanup effect:
  ```ts
  useEffect(() => {
    return () => { if (xpFlashTimerRef.current) clearTimeout(xpFlashTimerRef.current); };
  }, []);
  ```

---

### TASK-11: Fix BUG-UI-01 — Tab bar height clipping on Android gesture nav

**File:** `apps/expo/app/(tabs)/_layout.tsx`

- Import `useSafeAreaInsets` from `react-native-safe-area-context`
- Add at the top of the layout component: `const { bottom } = useSafeAreaInsets()`
- Change `tabBarStyle` from `{ height: 60 }` to:
  ```ts
  tabBarStyle: {
    height: 60 + bottom,
    paddingBottom: bottom,
  }
  ```

---

### TASK-12: Fix BUG-PERM-01 — READ_CONTACTS missing from Android manifest

**File:** `apps/expo/app.json`

- Add `"READ_CONTACTS"` to `android.permissions`:
  ```json
  "android": {
    "permissions": [
      "POST_NOTIFICATIONS",
      "ACCESS_NETWORK_STATE",
      "READ_CONTACTS"
    ]
  }
  ```
- Verify `ios.infoPlist.NSContactsUsageDescription` exists for iOS (required for App Store)

---

## Phase 4 — Medium Severity (fix before stable release)

### TASK-13: Fix BUG-CHAT-01 — Pidgin chips replace full input text

**File:** `apps/expo/app/messages/[conversationId].tsx`

- Replace `setInputText(suggestion)` in the chip tap handler with:
  ```ts
  setInputText(prev => {
    const words = prev.split(' ');
    words[words.length - 1] = suggestion;
    return words.join(' ') + ' ';
  });
  ```

---

### TASK-14: Fix BUG-CHAT-02 — DM message dedup uses content+sender key

**File:** `apps/expo/app/messages/[conversationId].tsx`

- Change the dedup/key extraction to use `msg.id` (server message ID) or `msg.idempotencyKey` for pending messages
- Update the merging logic in `mergeNewestFirst` or wherever dedup happens to use ID-based keying

---

### TASK-15: Fix BUG-CHAT-03 — pendingIdCounter is module-level

**File:** `apps/expo/app/messages/[conversationId].tsx`

- Move `let pendingIdCounter = 0` inside the component to a `useRef`:
  ```ts
  const pendingIdCounterRef = useRef(0);
  ```
- Replace all `pendingIdCounter++` usages with `pendingIdCounterRef.current++`

---

### TASK-16: Fix BUG-CHAT-04 — Fake 1-hour fallback drop timer

**File:** `apps/expo/app/rooms/[roomId].tsx`

- Remove the `?? new Date(Date.now() + 3_600_000)` fallback
- Wrap the drop timer component in a guard: only render when `room.dropEndsAt` is non-null and in the future

---

### TASK-17: Fix BUG-CHAT-05 — Gift send with empty creatorId

**File:** `apps/expo/app/rooms/[roomId].tsx`

- Conditionally render/enable the gift button only when `room.creatorId` is truthy:
  ```tsx
  {room.creatorId ? <GiftButton toUserId={room.creatorId} /> : null}
  ```

---

### TASK-18: Fix BUG-CHAT-06 — GifPickerModal re-fetches on every open

**File:** `apps/expo/app/messages/[conversationId].tsx`

- Move the GIF fetch into React Query with `enabled: isGifPickerOpen` and `staleTime: 5 * 60_000`
- If keeping raw `useEffect`, add an `AbortController` and call `controller.abort()` in the cleanup to cancel in-flight requests when picker closes

---

### TASK-19: Fix BUG-I18N-01 — Pidgin locale never auto-selected

**File:** `apps/expo/lib/i18n/index.ts`

- After the BCP 47 locale loop, add a comment documenting that Pidgin requires manual selection
- Check MMKV for a user-saved language preference (`storage.getString('user_language')`) before the device locale loop, and return that as highest priority if valid:
  ```ts
  function resolveLocale(): SupportedLocale {
    try {
      const saved = storage.getString('user_language');
      if (saved && SUPPORTED_LOCALES.includes(saved as SupportedLocale)) return saved as SupportedLocale;
    } catch { /* storage not ready */ }
    // BCP 47 loop follows...
  }
  ```
- Add a language picker in Settings that saves the user's choice to MMKV and calls `i18n.changeLanguage()`

---

### TASK-20: Fix BUG-WV-01 — GameWebView origin hardcoded to staging URL

**File:** `apps/expo/components/games/GameWebView.tsx`

- Import `env` from `@/lib/env`
- Replace the hardcoded `originWhitelist`:
  ```ts
  const gameOrigin = (() => {
    try { return new URL(env.API_BASE_URL).origin; } catch { return 'https://zobia.vercel.app'; }
  })();
  // ...
  originWhitelist={[gameOrigin, 'about:blank']}
  ```

---

### TASK-21: Fix BUG-MEM-02 — Home screen toast setTimeout leak

**File:** `apps/expo/app/(tabs)/index.tsx`

- Add `const toastTimerRef = useRef<NodeJS.Timeout | null>(null)`
- In `dailyLoginMutation.onSuccess`: replace the inline `setTimeout` with:
  ```ts
  if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  toastTimerRef.current = setTimeout(() => setShowLoginToast(false), 3500);
  ```
- Add cleanup: `useEffect(() => () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); }, [])`

---

### TASK-22: Fix BUG-CRASH-01 — Daily login MMKV read before init

**File:** `apps/expo/app/(tabs)/index.tsx`

- Wrap the daily login `useEffect` body in a try/catch:
  ```ts
  useEffect(() => {
    try {
      const today = new Date().toDateString();
      if (storage.getString('daily_login_last_date') === today) return;
      storage.set('daily_login_last_date', today);
      dailyLoginMutation.mutate();
    } catch { /* storage not yet initialized — skip */ }
  }, []);
  ```

---

## Phase 5 — Low Severity and Code Quality

### TASK-23: Fix BUG-NAV-01, BUG-NAV-02, BUG-NAV-03 — SwipeDrawer issues

**File:** `apps/expo/components/layout/SwipeDrawer.tsx`

- Replace `setTimeout(() => router.push(route), 50)` with navigation inside the Reanimated animation completion callback using `runOnJS`
- Replace `setTimeout(() => signOut(), 100)` with proper async handling and error display
- Unify drawer open state: remove `isOpen` React state, derive it from the Reanimated shared value with `useAnimatedReaction`

---

### TASK-24: Fix BUG-API-01 — subscription fetchMe inconsistent return shape

**File:** `apps/expo/app/settings/subscription.tsx`

- Remove the `data.user ?? data` pattern and use a typed response:
  ```ts
  const { data } = await apiClient.get<{ user: UserMe }>('/users/me');
  return data.user;
  ```
- Standardize `planTier` vs `plan` field name across `UserMe`, `AuthUser`, and the API response schema — pick one and enforce it everywhere

---

### TASK-25: Fix BUG-DUP-01 — Duplicated capacity increase code

**File:** `apps/expo/app/rooms/[roomId].tsx`

- Extract the capacity increase logic into a named `handleIncreaseCapacity()` async function
- Call this function from both the primary handler and remove the duplicated code from the catch block
- The catch block should only handle errors (show alert, reset loading state)

---

### TASK-26: Fix BUG-UX-01 — isAtBottomRef initial true causes auto-scroll on first load

**File:** `apps/expo/app/rooms/[roomId].tsx`

- Initialize `isAtBottomRef` to `false`
- Add a separate one-time scroll-to-end on initial message load:
  ```ts
  const hasScrolledInitiallyRef = useRef(false);
  useEffect(() => {
    if (messages?.length && !hasScrolledInitiallyRef.current) {
      hasScrolledInitiallyRef.current = true;
      flatListRef.current?.scrollToEnd({ animated: false });
    }
  }, [messages]);
  ```

---

### TASK-27: Fix BUG-MINOR-01 — Redundant Date.now() in idempotencyKey

**File:** `apps/expo/lib/offline/sqlite.ts`

- Change `idempotencyKey: \`${localId}_${Date.now()}\`` to `idempotencyKey: localId`

---

### TASK-28: Fix BUG-MINOR-02 — ContactsImporter sends duplicate phone numbers

**File:** `apps/expo/components/ContactsImporter.tsx`

- Deduplicate before slicing:
  ```ts
  const uniquePhones = [...new Set(phoneNumbers)].slice(0, 500);
  ```

---

### TASK-29: Fix BUG-MINOR-03 — Purchase timeout timer never cleared

**File:** `apps/expo/lib/payments/googlePlay.ts`

- Store the timeout ID and clear it after the race resolves:
  ```ts
  let timeoutId: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('Purchase timed out after 5 minutes')), 5 * 60_000);
  });
  try {
    const result = await Promise.race([purchasePromise, timeoutPromise]);
    return result;
  } finally {
    clearTimeout(timeoutId!);
  }
  ```

---

### TASK-30: Fix BUG-CI-01 — EAS auth failure silently passes CI

**File:** `.github/workflows/build-android.yml`

- Remove `continue-on-error: true` from the `eas whoami` step
- This allows the step to fail the workflow properly if `EXPO_TOKEN` is missing/invalid
- The downstream `if: steps.eas-auth.outcome == 'success'` guard becomes unnecessary and can be removed
- The "Notify build complete" step should be conditioned on actual build success, not just absence of failures

---

### TASK-31: Fix BUG-THEME-01 — Wallet tab uses raw system scheme instead of app theme

**File:** `apps/expo/app/(tabs)/wallet.tsx`

- Remove `import { useColorScheme } from 'react-native'` and `const scheme = useColorScheme()`
- Add `const { colors: themeColors, isDark } = useTheme()` from `@/lib/theme`
- Replace all local color derivations (`bg`, `cardBg`, `border`, `textPrimary`, `textSecondary`) with `themeColors.background`, `themeColors.surface`, `themeColors.border`, `themeColors.text`, `themeColors.textMuted` respectively

---

### TASK-32: Fix BUG-UI-02 — Progress bars collapse at 0% with flex:0

**Files:** `apps/expo/app/(tabs)/index.tsx` (QuestCard, NemesisXPBar)

- For `QuestCard`, replace the flex-based track with a fixed container + absolute/width approach:
  ```tsx
  <View style={styles.questProgressTrack}>
    <View style={[styles.questProgressFill, { width: `${progressPct * 100}%` }]} />
  </View>
  ```
- Same fix for `NemesisXPBar`:
  ```tsx
  <View style={styles.xpBarOuter}>
    <View style={[styles.xpBarMe, { width: `${myRatio * 100}%` }]} />
  </View>
  ```
- Update styles: `questProgressTrack` gets `overflow: 'hidden'` and `position: 'relative'`; fill gets `position: 'absolute'`, `left: 0`, `top: 0`, `bottom: 0`

---

### TASK-33: Fix BUG-CRASH-02 — Profile screen non-null assertion on profile

**File:** `apps/expo/app/profile/[userId].tsx`

- In both `friendMutation` and `followMutation`, add guards:
  ```ts
  mutationFn: () => {
    if (!profile || !userId) throw new Error('Profile not loaded');
    return toggleFriend(userId, profile.isFriend);
  },
  ```
- This prevents the crash if `profile` becomes undefined during a background refetch while a mutation is in flight

---

## Summary Table

| Task | Bug | Phase | Effort | Risk |
|------|-----|-------|--------|------|
| TASK-1 | BUG-SEC-01 JWT in WebView | 1 | High | Critical |
| TASK-2 | BUG-SEC-02 PIN plaintext | 1 | Medium | Critical |
| TASK-3 | BUG-ENV-01 APP_ENV always dev | 2 | Medium | Critical |
| TASK-4 | BUG-OFFLINE-01 Room offline queue | 2 | Medium | High |
| TASK-5 | BUG-PAY-01 Billing error swallowed | 2 | Low | High |
| TASK-6 | BUG-ADS-01 Listener leak interstitial | 3 | Low | High |
| TASK-7 | BUG-ADS-02 Rewarded ad race | 3 | Low | High |
| TASK-8 | BUG-PAY-02 Maps not cleared on disconnect | 3 | Low | High |
| TASK-9 | BUG-AUTH-01 Stale closure deeplink | 3 | Low | Medium |
| TASK-10 | BUG-MEM-01 XP flash timer leak | 3 | Low | Medium |
| TASK-11 | BUG-UI-01 Tab bar height Android | 3 | Low | High |
| TASK-12 | BUG-PERM-01 Missing contacts permission | 3 | Low | Critical |
| TASK-13 | BUG-CHAT-01 Pidgin chip replaces text | 4 | Low | Medium |
| TASK-14 | BUG-CHAT-02 Bad dedup key | 4 | Low | Medium |
| TASK-15 | BUG-CHAT-03 Module-level counter | 4 | Low | Low |
| TASK-16 | BUG-CHAT-04 Fake drop timer | 4 | Low | Medium |
| TASK-17 | BUG-CHAT-05 Empty creatorId gift | 4 | Low | Medium |
| TASK-18 | BUG-CHAT-06 GIF picker no cache | 4 | Medium | Low |
| TASK-19 | BUG-I18N-01 Pidgin locale | 4 | Low | Low |
| TASK-20 | BUG-WV-01 WebView origin hardcoded | 4 | Low | Medium |
| TASK-21 | BUG-MEM-02 Toast timer leak | 4 | Low | Low |
| TASK-22 | BUG-CRASH-01 MMKV before init | 4 | Low | Medium |
| TASK-23 | BUG-NAV-01/02/03 SwipeDrawer | 5 | Medium | Low |
| TASK-24 | BUG-API-01 fetchMe shape | 5 | Low | Low |
| TASK-25 | BUG-DUP-01 Duplicated code | 5 | Low | Low |
| TASK-26 | BUG-UX-01 Auto-scroll on first load | 5 | Low | Low |
| TASK-27 | BUG-MINOR-01 Redundant timestamp | 5 | Low | None |
| TASK-28 | BUG-MINOR-02 Duplicate phone numbers | 5 | Low | Low |
| TASK-29 | BUG-MINOR-03 Timeout not cleared | 5 | Low | Low |
| TASK-30 | BUG-CI-01 CI silent auth failure | 5 | Low | Low |
| TASK-31 | BUG-THEME-01 Wallet uses raw scheme | 5 | Low | Low |
| TASK-32 | BUG-UI-02 Flex 0 progress bars | 5 | Low | Low |
| TASK-33 | BUG-CRASH-02 Profile non-null assert | 5 | Low | Medium |

---

*Plan generated: June 25, 2026 at 02:29 PM*  
*35 bugs | 33 tasks (TASK-23 covers 3 bugs) | 5 phases*
