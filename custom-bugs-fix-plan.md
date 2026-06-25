# Zobia Expo App — Bug Fix Plan

**Generated:** June 25, 2026 — 10:30 AM  
**Target:** Expo (React Native 0.74 / Expo SDK 51) — Android API 36  
**Branch:** `claude/expo-app-bug-analysis-o4kt0l`  
**Reference:** `custom-bugs-report.md` (same directory)

---

## Priority Tiers

- **P0 — Critical (ship-blocker):** Security vulnerabilities, Play Store policy violations, production config errors
- **P1 — High (user-facing breakage):** Features that are broken or produce wrong output
- **P2 — Medium (degraded UX):** Poor UX, visual regressions, performance issues
- **P3 — Low (cleanup):** Dead code, minor inconsistencies

---

## P0 — Critical

---

### Fix BUG-CFG-01: Replace Test AdMob App ID

**Files:** `apps/expo/app.json`, `apps/expo/app.config.js` (create if not present)

1. Obtain the real production AdMob App ID from the AdMob console.
2. Store it as an EAS secret: `eas secret:create ADMOB_APP_ID --value ca-app-pub-REAL-ID`.
3. Convert `app.json` → `app.config.js` (or add `app.config.js` that merges into `app.json`) and reference `process.env.ADMOB_APP_ID` for the `googleMobileAdsAppId` field.
4. Keep the test ID only in local `.env` / dev profile so emulator testing still works without touching production config.

---

### Fix BUG-SEC-01: Add API endpoint allowlist to GameWebView

**Files:** `apps/expo/components/games/GameWebView.tsx`

1. Define a constant `ALLOWED_GAME_ENDPOINTS` array of permitted path prefixes, e.g. `['/games/', '/users/me/coins', '/users/me/quests']`.
2. In the `postMessage` handler, before calling `apiClient`, verify that the incoming `endpoint` string starts with at least one allowed prefix: `if (!ALLOWED_GAME_ENDPOINTS.some(p => endpoint.startsWith(p))) { sendError('forbidden'); return; }`.
3. Also restrict the HTTP method to `GET` and `POST` only from the WebView — disallow `DELETE`, `PATCH`, `PUT`.
4. Return a structured error message to the WebView on rejection so games can handle it gracefully.

---

### Fix BUG-SEC-02: Move PIN verification server-side

**Files:** `apps/expo/app/economy/store.tsx`, backend PIN endpoint

1. Remove the client-side `SHA256(userId + ':' + pin)` computation and local hash comparison entirely.
2. Post `{ pin }` (plaintext) over HTTPS to a new or existing server endpoint (e.g. `POST /economy/verify-pin`).
3. The server must store the PIN as a bcrypt or argon2 hash and compare server-side, applying rate-limiting (max 5 attempts per 15 minutes) and account lockout.
4. The server returns `{ valid: true }` or an appropriate 4xx error; the client proceeds based on the HTTP response.

---

### Fix BUG-SEC-03: Unify PIN handling across store and gift-send

**Files:** `apps/expo/app/economy/store.tsx`, `apps/expo/app/economy/gift-send.tsx`

1. After BUG-SEC-02 is implemented, ensure `gift-send.tsx` also sends the raw `{ pin }` to the same server-side verification endpoint rather than doing its own logic.
2. Extract a shared `verifyPin(pin: string): Promise<boolean>` utility in `lib/economy/pin.ts` that both screens call, so the PIN flow can never diverge again.

---

### Fix BUG-PAY-01: Route Android star pack purchases through Google Play Billing

**Files:** `apps/expo/app/economy/store.tsx`, `apps/expo/lib/payments/googlePlay.ts`

1. Define star pack products in the Google Play Console as one-time in-app products (not subscriptions).
2. Add the product IDs to `lib/payments/googlePlay.ts` alongside the subscription IDs.
3. In `store.tsx`, replace the external URL payment path (the `Platform.OS === 'android'` branch that opens an external URL) with a call to `react-native-iap`'s `requestPurchase({ sku: starPackProductId })`.
4. Add a `purchaseUpdatedListener` in `googlePlay.ts` to handle star pack purchase verification (similar to the subscription listener) and call the backend to credit coins after receipt validation.
5. On iOS the flow may differ — verify App Store guidelines apply the same way.

---

## P1 — High

---

### Fix BUG-CFG-02: Configure expo-updates channels per build profile

**Files:** `apps/expo/eas.json`, `apps/expo/app.json`

1. In `eas.json`, add `"channel": "production"` to the `production` build profile and `"channel": "preview"` to the `preview` profile.
2. If `development` builds should not receive OTA updates, set `"channel": "development"` or disable `expo-updates` for that profile.
3. Verify the `runtimeVersion` policy in `app.json` is set (e.g. `{ "policy": "sdkVersion" }`) so updates are only applied to compatible builds.

---

### Fix BUG-NET-01: Handle null isInternetReachable in OfflineBanner

**Files:** `apps/expo/components/offline/OfflineBanner.tsx`

1. Change the show condition from `state.isInternetReachable === false` to `state.isConnected === false || state.isInternetReachable === false`.
2. Optionally, when `state.isInternetReachable === null` (unknown state), show a subtler "Checking connection…" indicator instead of the full offline banner, and resolve it once reachability is confirmed.

---

### Fix BUG-UI-08: Apply i18next.changeLanguage() immediately on language selection

**Files:** `apps/expo/app/settings/index.tsx`, `apps/expo/lib/i18n/index.ts`

1. In the language change handler, after the server PATCH mutation resolves successfully, call `await i18next.changeLanguage(lang.code)`.
2. Also write the new language code to the MMKV pref store (the same key that `lib/i18n/index.ts` reads on init) so it persists across restarts.
3. Ensure the mutation's `onSuccess` callback (not `onMutate`) triggers the language change so it only fires when the server confirms the update.

---

### Fix BUG-UI-09: Call setupRTL after language change and prompt restart if needed

**Files:** `apps/expo/app/settings/index.tsx`, `apps/expo/lib/i18n/rtl.ts`

1. After calling `i18next.changeLanguage(lang.code)` (BUG-UI-08 fix), call `setupRTL(lang.code)` to invoke `I18nManager.forceRTL(isRTL)`.
2. Because `I18nManager.forceRTL` requires an app restart to take full effect in native views, detect when the RTL direction changed (previous vs new) and show the user a prompt: "The app needs to restart to apply the layout direction change. Restart now?" — and call `expo-updates`'s `reloadAsync()` or `react-native-restart` if confirmed.

---

### Fix BUG-UI-11: Implement Change Password screen

**Files:** `apps/expo/app/settings/index.tsx`, `apps/expo/app/settings/change-password.tsx` (new file)

1. Create `apps/expo/app/settings/change-password.tsx` as a new Expo Router screen with three fields: Current Password, New Password, Confirm New Password.
2. On submit, POST to `/auth/change-password` with `{ currentPassword, newPassword }`.
3. Show validation errors inline (current password wrong, new password too short, passwords don't match).
4. Replace the `Alert.alert` stub in `settings/index.tsx` with `router.push('/settings/change-password')`.

---

### Fix BUG-ADS-01: Guard against multiple concurrent loadRewardedAd calls

**Files:** `apps/expo/lib/ads/admob.ts`

1. Add a module-level `isLoading: boolean` flag.
2. At the top of `loadRewardedAd()`, return early if `isLoading` is true.
3. Set `isLoading = true` when starting the load and `isLoading = false` in both the `LOADED` and `ERROR` event callbacks.
4. When creating a new `RewardedAd` instance, if one already exists, call any available cleanup/destroy method on it before overwriting the reference.

---

### Fix BUG-IMG-01: Fix Avatar SVG frame rendering

**Files:** `apps/expo/components/ui/Avatar.tsx`, backend frame asset pipeline

**Option A (Recommended — simpler):** Update the API to serve frame images as PNG or WebP. Frames are static assets; pre-rendering them at 2x and 3x densities is trivial. Update the Avatar component to use `expo-image` as-is.

**Option B (Client-only):** Install `react-native-svg` (already a common Expo dependency) and use `<SvgUri uri={frameUrl} width={size} height={size} />` in place of the `expo-image` frame `<Image>` when the frame URL ends with `.svg`.

---

### Fix BUG-UI-01: Replace nested Alert.alert with a proper modal/bottom sheet for reactions

**Files:** `apps/expo/app/rooms/[roomId].tsx`

1. Remove the chained `Alert.alert` inside the reaction alert's button callback.
2. Add a `reactionModalVisible` state bool and a small `Modal` (or `BottomSheet` if the library is already in use) that displays the emoji reaction grid.
3. Show the modal from the long-press gesture handler directly, without going through an alert first.

---

### Fix BUG-UI-02: Compute keyboardVerticalOffset dynamically

**Files:** `apps/expo/app/rooms/[roomId].tsx`, `apps/expo/app/messages/[conversationId].tsx`

1. In each chat screen, call `useSafeAreaInsets()` from `react-native-safe-area-context`.
2. Replace `keyboardVerticalOffset={88}` with a computed value: header height (query from layout or use a constant that matches the Expo Router Stack header) + `insets.top`. The bottom inset is not needed here because `KeyboardAvoidingView` measures from the window bottom.
3. Alternatively, migrate to `react-native-keyboard-controller`'s `KeyboardAvoidingView` which handles this automatically.

---

### Fix BUG-UI-03: Implement or remove the Moment compose flow

**Files:** `apps/expo/app/messages/[conversationId].tsx`

1. If Moments are in scope: implement `handleSendMoment` to open `expo-image-picker` (camera or gallery), upload the selected media via the API, and post the resulting URL as a `moment` type message.
2. If Moments are not yet in scope: remove the Send Moment button / menu item entirely from the conversation screen so users are not shown an option they cannot complete.

---

### Fix BUG-UI-04: Fix DropRoomTimer interval recreation

**Files:** `apps/expo/components/rooms/RoomCard.tsx`

1. Change the `useEffect` dependency array from `[secondsLeft]` to `[endTime]` (or the timer end timestamp prop/value).
2. Store `secondsLeft` in a `useRef` inside the interval callback if you need to read the previous value without it being a dependency.
3. Alternatively, compute `secondsLeft` inside the interval callback directly from `Math.floor((endTime - Date.now()) / 1000)` so no state is needed as a dependency at all.

---

### Fix BUG-PAY-02: Clear subscriptionOfferTokens on Google Play disconnect

**Files:** `apps/expo/lib/payments/googlePlay.ts`

1. Add `subscriptionOfferTokens.clear()` inside `disconnectGooglePlayBilling()`, after calling `endConnection()`.
2. This ensures that on the next `initConnection()` + product fetch cycle, the map is rebuilt fresh from current Google Play data.

---

### Fix BUG-UI-06: Translate error string in Rooms tab

**Files:** `apps/expo/app/(tabs)/rooms.tsx`

1. Change `setError('rooms.loadError')` to `setError(t('rooms.loadError'))` — translate at the point of storage, or
2. Keep storing the key but render it via `{t(error)}` in the JSX rather than `{error}`.
3. Ensure `t` is in scope at both the catch site and the render site (it should already be via `useTranslation()`).

---

### Fix BUG-UI-10: Debounce or gate Settings field mutations

**Files:** `apps/expo/app/settings/index.tsx`

1. Replace `onChangeText={v => patchMutation.mutate({ [key]: v })}` with local state: `const [value, setValue] = useState(initialValue)`.
2. Use `onChangeText={setValue}` to update local state without triggering mutations.
3. Either: (a) debounce with `useEffect` + `setTimeout` 700 ms on `value` to call `patchMutation.mutate`, or (b) add an explicit Save button per field (or a global Save button for the whole form).
4. Cancel any in-flight debounced call on unmount to prevent state updates on unmounted components.

---

### Fix BUG-IMG-02: Use validated env object in Avatar component

**Files:** `apps/expo/components/ui/Avatar.tsx`

1. Import `env` from `@/lib/env`.
2. Replace `process.env.EXPO_PUBLIC_API_URL` with `env.API_BASE_URL` (or whichever validated field holds the base API URL).
3. This ensures a missing env var causes a startup crash with a clear Zod error rather than a silent broken URL at runtime.

---

### Fix BUG-ADS-02: Gate RewardedAdButton MMKV access behind storeReady

**Files:** `apps/expo/components/ads/RewardedAdButton.tsx`

1. Thread the `storeReady` boolean (already tracked in the root `_layout.tsx`) down via context or a prop to `RewardedAdButton`.
2. In the `useEffect` that reads from `storage`, add an early return if `!storeReady`.
3. Alternatively, wrap the read in a try/catch and gracefully fall back to showing the button without a balance check if the store isn't ready yet.

---

## P2 — Medium

---

### Fix BUG-DSG-01: Replace purple in midnight chat theme

**Files:** `apps/expo/lib/theme/chatThemes.ts`

1. Find the `midnight` theme object.
2. Change `bubbleOwn: '#6366f1'` to `bubbleOwn: '#2563EB'` (brand blue) or another dark-mode-appropriate blue from the color palette.
3. Audit all other theme entries in the file for any other non-brand colors while you are there.

---

### Fix BUG-DSG-02: Replace purple in FloatingNotificationProvider star badge

**Files:** `apps/expo/components/providers/FloatingNotificationProvider.tsx`

1. Find `STAR_COLORS = { backgroundColor: '#8b5cf6' }`.
2. Replace `'#8b5cf6'` with `colors.brand.gold` (the brand gold) or `colors.brand.blue` (`#2563EB`) as appropriate for a star gift notification.
3. Import `colors` from `@/lib/theme/colors` if not already imported.

---

### Fix BUG-DSG-03: Replace purple in Quests tab New Member Quest card

**Files:** `apps/expo/app/(tabs)/quests.tsx`

1. Find all instances of `'#8b5cf6'` in the file.
2. Replace `borderColor: '#8b5cf6'` with `borderColor: theme.colors.primary` (brand blue).
3. Replace `backgroundColor: '#8b5cf6'` on the progress fill with `backgroundColor: theme.colors.primary` or `colors.brand.green` if quest progress should use green.

---

### Fix BUG-UI-05: Separate featured and full badge positions in RoomCard

**Files:** `apps/expo/components/rooms/RoomCard.tsx`

1. Keep `featuredBadge` at `position: 'absolute', top: 8, left: 8`.
2. Move `fullBadge` to `position: 'absolute', top: 8, right: 8` (or `top: 36, left: 8` to stack vertically below the featured badge).
3. Ensure neither badge is clipped by the card's `overflow: 'hidden'` boundary after repositioning.

---

### Fix BUG-UI-12: Fix friends.tsx composite loading state

**Files:** `apps/expo/app/(tabs)/friends.tsx`

1. Identify all `useQuery` / `useInfiniteQuery` calls in the screen: friends list, friend requests, suggestions.
2. Change `const loading = friendsLoading` to `const loading = friendsLoading || requestsLoading || suggestionsLoading` (using all relevant `isLoading` / `isPending` flags).
3. This prevents the premature spinner removal and the resulting partial-render flicker.

---

### Fix BUG-PERF-01: Fix CoinBalance dark mode background

**Files:** `apps/expo/components/economy/CoinBalance.tsx`

1. Import `useTheme` from `@/lib/theme`.
2. Replace `backgroundColor: colors.neutral[100]` with `backgroundColor: theme.colors.surface` (or `isDark ? colors.neutral[800] : colors.neutral[100]`).
3. Verify the coin icon and text color also adapt — use `theme.colors.text` or `theme.colors.textMuted` instead of any hardcoded dark color.

---

### Fix BUG-UI-13: Fix ChatPushToggles duplicate network request

**Files:** `apps/expo/app/settings/index.tsx`

1. Hoist the `useQuery(['user-settings'])` call to the parent `SettingsScreen` component (it likely already exists there).
2. Pass the resulting `settings` data object as a prop to `ChatPushToggles`.
3. Remove the internal `useQuery` call from `ChatPushToggles` so it is a pure presentational component that renders whatever data it receives.

---

## P3 — Low

---

### Fix BUG-SEC-04: Consolidate or document unencrypted MMKV instances

**Files:** `apps/expo/lib/i18n/index.ts`, `apps/expo/lib/theme/index.tsx`

1. Both the i18n store and the theme store create separate unencrypted MMKV instances. Consider merging them into a single `new MMKV({ id: 'zobia-user-prefs' })` shared instance used for all non-sensitive user preferences (theme + language).
2. If keeping them separate, add a comment to each clearly stating "non-sensitive preference — unencrypted by design" so future developers don't inadvertently store sensitive data in these instances.

---

### Fix BUG-UI-07: Remove dead 'guild' key from ROOM_TYPE_FILTER_COLOR

**Files:** `apps/expo/app/(tabs)/rooms.tsx`

1. Delete the `guild: colors.brand.someColor` entry from `ROOM_TYPE_FILTER_COLOR`.
2. If a guild room type filter is planned, add it to `FILTER_CHIPS` at the same time rather than pre-populating only the color map.

---

### Fix BUG-LIFE-01: Move CURRENT_YEAR inside component or useMemo

**Files:** `apps/expo/app/onboarding/index.tsx`

1. Move `const CURRENT_YEAR = new Date().getFullYear()` from module scope into the `OnboardingScreen` component body (or into a `useMemo(() => new Date().getFullYear(), [])` if the component is expensive to re-render for other reasons).
2. This costs nothing at runtime and ensures the year is always accurate regardless of when the JS bundle was loaded.

---

## Implementation Sequence (Recommended Order)

| Step | Bugs | Reason |
|------|------|--------|
| 1 | SEC-01 | Critical security — merge-blocking |
| 2 | SEC-02, SEC-03 | Security — PIN brute-force & inconsistency |
| 3 | PAY-01 | Play Store compliance — merge-blocking |
| 4 | CFG-01 | Production config — must fix before release |
| 5 | CFG-02 | OTA update routing — do before next release |
| 6 | UI-08, UI-09 | Language switch correctness — user-visible |
| 7 | UI-10 | Per-keystroke mutations — server load |
| 8 | UI-11 | Unimplemented feature — trust issue |
| 9 | NET-01 | Offline banner — functional bug |
| 10 | UI-01, UI-02, UI-03 | UX correctness |
| 11 | UI-04, UI-05, UI-06 | Timer, badge, error string |
| 12 | ADS-01, ADS-02 | Ad stability |
| 13 | IMG-01, IMG-02 | Avatar frame rendering |
| 14 | PAY-02 | Stale token defence |
| 15 | DSG-01, DSG-02, DSG-03 | Design violations |
| 16 | UI-12, UI-13, PERF-01 | Performance/UX polish |
| 17 | SEC-04, UI-07, LIFE-01 | Cleanup |

---

*Plan generated: June 25, 2026 — 10:30 AM*  
*Zobia Expo App — Bug Fix Plan | nero1/zobia | branch: claude/expo-app-bug-analysis-o4kt0l*
