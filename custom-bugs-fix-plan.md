# Zobia Expo App — Bug Fix Plan

**Generated:** June 26, 2026 — 12:00 PM WAT
**Reference Report:** `custom-bugs-report.md`
**Total Issues:** 48 bugs across 8 categories
**Platform:** Android API 36 · Expo SDK ~51.0.0 · React Native 0.74.0

---

## Priority Tiers

- **P1 — Critical:** Build failures, crashes, financial errors, security vulnerabilities. Fix immediately before any release.
- **P2 — High:** Silent error swallowing, broken core UX flows, memory leaks. Fix in the next sprint.
- **P3 — Medium:** Performance/network efficiency, incomplete theming, missing i18n, navigation edge cases. Fix within two sprints.
- **P4 — Low:** Minor accessibility gaps, cosmetic inconsistencies, build config fragility. Fix in a cleanup sprint.

---

## P1 — Critical (Fix Before Any Release)

---

### TASK-01 · BUG-PKG-01 — Fix expo-file-system version mismatch
**Files:** `apps/expo/package.json`
**Steps:**
1. Change `"expo-file-system": "^56.0.8"` to `"expo-file-system": "~16.0.0"` in `package.json`.
2. Run `npx expo install expo-file-system` in `apps/expo` to let the Expo peer-dep resolver pin the correct SDK-51-compatible version.
3. Delete and regenerate `package-lock.json` (or `yarn.lock`).
4. Run `npx expo-doctor` and verify no peer-dependency warnings remain.
5. Trigger a local Android build (`expo run:android`) to confirm resolution succeeds.
6. Run the EAS staging build profile to validate before production.

---

### TASK-02 · BUG-CRASH-01 — Guard null cacheDirectory in data export
**Files:** `apps/expo/app/settings/index.tsx`
**Steps:**
1. Before constructing the export path, check: `if (!FileSystem.cacheDirectory) { showToast(t('settings.exportUnavailable', 'Export not available — storage not ready')); return; }`
2. If `cacheDirectory` is null, also try `FileSystem.documentDirectory` as a fallback (guaranteed non-null on all Android versions).
3. After path construction, verify the directory exists with `FileSystem.makeDirectoryAsync(dir, { intermediates: true })` before writing.
4. Add an error state to surface any write failures to the user rather than swallowing them.

---

### TASK-03 · BUG-SEC-01 · BUG-SEC-02 — Move PIN lockout to server-side
**Files:** `apps/expo/app/economy/store.tsx`, `apps/expo/app/settings/pin.tsx`
**Steps:**
1. Update the PIN verification API endpoint (`/economy/pin/verify`, `/settings/pin/change`) to track attempt counts in Redis per user account, not per request.
2. After 5 failed attempts, the server returns HTTP 429 with a `retryAfter` field (seconds until the lockout expires).
3. On the client: remove all local attempt counters and timestamp checks. Display the server-provided `retryAfter` value in the lockout UI. Never re-enable the PIN input based on local time — only re-enable when a test call to the endpoint succeeds.
4. The local state may still track the attempt count for UX feedback ("2 attempts remaining") but must never gate submission.
5. Add tests: verify that clearing app data and relaunching does not reset the lockout.

---

### TASK-04 · BUG-PAY-01 — Rewarded ad coin credit with retry and offline queue
**Files:** `apps/expo/components/ads/RewardedAdButton.tsx`
**Steps:**
1. On ad completion, generate an idempotency key from the ad unit ID + completion timestamp (or use the ad reward item identifier if available).
2. Wrap the credit API call in a retry loop: up to 3 attempts with exponential backoff (1 s, 2 s, 4 s).
3. If all 3 attempts fail, write a `{ type: 'ad_credit', idempotencyKey, coins }` record to the offline SQLite queue so it is replayed when the network recovers. The queue already has idempotency key support.
4. Show the user a UI state: loading spinner during the credit call, then success confirmation on credit, then an error toast with "We'll add your coins when you reconnect" on failure.
5. On the server, ensure the idempotency key prevents double-credit if the client retries a request that already succeeded.

---

### TASK-05 · BUG-MEM-01 — Fix Ably channel memory leak on early unmount
**Files:** `apps/expo/lib/realtime/useRealtimeChannel.ts`
**Steps:**
1. Introduce a cancellation flag at the top of the `useEffect` body: `let cancelled = false`.
2. Set `cancelled = true` in the cleanup function (returned from `useEffect`).
3. After each `await` inside the async setup function, check `if (cancelled) { /* run cleanup if partially initialised */ return; }`.
4. Store the partially-built cleanup steps in a ref: `cleanupRef.current = () => { channel?.unsubscribe(); client?.close(); }`. In the returned cleanup, always call `cleanupRef.current?.()`.
5. This ensures that even if the component unmounts before the async work completes, all allocated resources are released.

---

## P2 — High (Next Sprint)

---

### TASK-06 · BUG-PAY-02 — Add replacementMode to subscription upgrades
**Files:** `apps/expo/app/settings/subscription.tsx`
**Steps:**
1. When the user already has an active subscription (`user.plan !== 'free'`), fetch the current subscription's `purchaseToken` from the server (`/subscriptions/current`) before launching the upgrade flow.
2. Pass `replacementMode: 'IMMEDIATE_WITH_TIME_PRORATION'` (or the value that matches your business policy) and `purchaseTokenAndroid: currentToken` to `purchaseSubscription`.
3. For downgrades, use `replacementMode: 'DEFERRED'`.
4. For fresh subscriptions (no current plan), omit both fields.
5. Document the chosen proration policy in the UI: add a note below the upgrade button (e.g. "Upgrade applies immediately; remaining days credited proportionally.").

---

### TASK-07 · BUG-PAY-03 — Show live Play Store subscription pricing
**Files:** `apps/expo/app/settings/subscription.tsx`
**Steps:**
1. Call `react-native-iap`'s `getSubscriptions({ skus: SUBSCRIPTION_SKUS })` on screen mount.
2. Map the returned `localizedPrice` field to each plan card instead of the hardcoded NGN amounts.
3. While prices are loading, show a skeleton or the hardcoded price with a "~" prefix to indicate it's approximate.
4. If `getSubscriptions` fails, fall back to the hardcoded prices and show a disclaimer: "Prices shown are approximate. Actual price may vary by region."
5. Cache the prices for the session (no need to re-fetch on every render).

---

### TASK-08 · BUG-UX-01 — Fix translateApiError call in change-password screen
**Files:** `apps/expo/app/settings/change-password.tsx`
**Steps:**
1. In the mutation `onError` handler, replace `setFieldError(translateApiError(err))` with the correct call:
   `setFieldError(translateApiError(t, (err as AxiosError)?.response?.data?.code, (err as AxiosError)?.response?.data?.message ?? t('errors.passwordChangeFailed', 'Password change failed. Please try again.')))`
2. Ensure `t` is obtained from `useTranslation()` in the component scope.
3. Verify the `fieldError` state is rendered in the UI (check the JSX renders `{fieldError && <Text style={styles.error}>{fieldError}</Text>}`).
4. Test with a wrong current password and verify the translated error appears.

---

### TASK-09 · BUG-NAV-01 — Stabilise notification listeners in _layout.tsx
**Files:** `apps/expo/app/_layout.tsx`
**Steps:**
1. Replace `const router = useRouter()` with a ref: `const routerRef = useRef(router); useEffect(() => { routerRef.current = router; }, [router]);`
2. In the notification listener `useEffect`, use `routerRef.current.push(url)` instead of `router.push(url)`. Remove `router` from the dependency array of the listener effect.
3. This ensures the listener is registered once on mount and never torn down due to `router` reference changes. The ref always holds the latest router instance.

---

### TASK-10 · BUG-NAV-02 — Gate notification deep-links behind auth state
**Files:** `apps/expo/app/_layout.tsx`
**Steps:**
1. Add a `pendingNotificationUrl` ref: `const pendingNotificationUrl = useRef<string | null>(null)`.
2. In the notification response handler, if `authContext.isLoading` is true, store the URL: `pendingNotificationUrl.current = url; return;`.
3. Add a separate `useEffect` that watches `[authContext.isLoading, authContext.user]`. When `isLoading` becomes `false`, check if `pendingNotificationUrl.current` is set and navigate then.
4. Before navigating, validate the URL against the existing `VALID_PUSH_ROUTES` allowlist.
5. Clear `pendingNotificationUrl.current` after consuming it.

---

### TASK-11 · BUG-NAV-03 — Replace push with replace in SessionExpiredModal
**Files:** `apps/expo/components/auth/SessionExpiredModal.tsx`
**Steps:**
1. Change `router.push('/auth/login')` to `router.replace('/auth/login')`.
2. Test: open the app, trigger a session expiry (manually clear the stored token), confirm the session-expired modal appears, tap "Log in", verify that pressing Android Back from the login screen exits the app (or goes to the guest home) rather than returning to an authenticated screen.

---

### TASK-12 · BUG-RENDER-01 — Guard LevelBar division by zero
**Files:** `apps/expo/app/profile/[userId].tsx`
**Steps:**
1. Change `const progress = track.level / track.maxLevel` to:
   `const progress = track.maxLevel > 0 ? Math.min(1, Math.max(0, track.level / track.maxLevel)) : 0`
2. The `Math.min(1, Math.max(0, ...))` clamp also handles cases where `track.level > track.maxLevel` (e.g. pending XP that hasn't rolled over yet).
3. Add a UI test or screenshot test for the profile screen with a mock where `maxLevel = 0` to prevent regression.

---

### TASK-13 · BUG-RENDER-02 — Fix GIF rendering in room chat
**Files:** `apps/expo/app/rooms/[roomId].tsx`, `apps/expo/components/rooms/MessageBubble.tsx`
**Steps:**
1. In `mapApiMessage`, add: `gifUrl: message.metadata?.gifUrl ?? message.gif_url ?? null`.
2. Add `gifUrl?: string | null` to the `MessageBubble` props interface.
3. In `MessageBubble`, for `messageType === 'gif'`, render `<Image source={{ uri: gifUrl }} style={styles.gifImage} />` using `expo-image` for efficient caching. Define `styles.gifImage` with a max width/height.
4. Pass `gifUrl={msg.gifUrl}` from the `FlatList` renderItem in `rooms/[roomId].tsx`.
5. Handle the case where `gifUrl` is null/undefined for `messageType === 'gif'` — show a placeholder or the `content` field as fallback text.

---

### TASK-14 · BUG-AUTH-01 · BUG-AUTH-02 — Remove 'me' fallback for myUserId
**Files:** `apps/expo/app/messages/[conversationId].tsx`, `apps/expo/app/messages/group/[groupId].tsx`
**Steps:**
1. In both files, remove the `?? 'me'` fallback: use `const myUserId = user?.id ?? null`.
2. Wrap the message list rendering in a condition: only render `<FlatList>` when `!isLoading && user !== null`. While loading, render `<ActivityIndicator />`. If `user` is null after loading, redirect to login.
3. In the `renderItem` function, the `isOwnMessage` check should be `item.sender_id === myUserId && myUserId !== null`.

---

### TASK-15 · BUG-LOGIC-01 · BUG-LOGIC-02 — Replace pending message counters with UUIDs
**Files:** `apps/expo/app/messages/[conversationId].tsx`, `apps/expo/app/messages/group/[groupId].tsx`
**Steps:**
1. In `[conversationId].tsx`: remove the module-level `let pendingCounter = 0` and all `++pendingCounter` usages. Replace with `const localId = \`pending-${crypto.randomUUID()}\``.
2. In `group/[groupId].tsx`: same — remove module-level `pendingCounter`, replace with UUID.
3. No other changes needed; the local ID is only used to key the optimistic message and remove it from the list on success/failure.

---

### TASK-16 · BUG-UX-02 — Show error state in game deeplink screen
**Files:** `apps/expo/app/g/[slug].tsx`
**Steps:**
1. Add `const [fetchError, setFetchError] = useState<string | null>(null)` to the component.
2. Replace `.catch(() => {})` with `.catch((err) => { setFetchError((err as AxiosError)?.response?.status === 404 ? t('games.notFound', 'This game is no longer available.') : t('games.loadError', 'Could not load game details.')); })`.
3. In the JSX, if `fetchError` is set, render the error message and a "Go back" button instead of the Play button.
4. Do not show the Play button if `game` is null after loading has completed — it will navigate to a non-existent game.

---

### TASK-17 · BUG-PERF-05 — Smart retry logic in QueryClient
**Files:** `apps/expo/lib/api/client.ts`
**Steps:**
1. Replace `retry: 2` in `QueryClient` defaultOptions with a function:
   ```
   retry: (failureCount, error) => {
     const status = (error as AxiosError)?.response?.status;
     if (status !== undefined && status >= 400 && status < 500) return false;
     return failureCount < 2;
   }
   ```
2. This retries up to 2 times on network errors and 5xx responses but immediately surfaces 4xx errors.
3. Optionally add exponential backoff via `retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30000)`.

---

## P3 — Medium (Next Two Sprints)

---

### TASK-18 · BUG-PERF-01 — Reduce home screen thundering herd
**Files:** `apps/expo/app/(tabs)/index.tsx`
**Steps:**
1. Identify the minimum data needed for the first visible frame: `users/me` and `presence`. Fetch these immediately.
2. Use `enabled: !!user` for queries that depend on auth data to prevent premature firing.
3. Delay secondary queries (friends, leaderboard, guilds/discovery) by setting `staleTime: 5 * 60 * 1000` — they will only refetch when stale rather than on every mount.
4. Move `quests/new-member` and `creator-spotlight` to lazy fetch (triggered by scroll or after a 1-second idle). Use `enabled: isIdle` where `isIdle` is a state flag set after the first render cycle.
5. Re-audit after changes and ensure total cold-start requests ≤ 3.

---

### TASK-19 · BUG-PERF-02 — Unify /manifest query key
**Files:** `apps/expo/lib/hooks/useCurrency.ts`, `apps/expo/app/settings/index.tsx`
**Steps:**
1. Create a shared constant: `export const MANIFEST_QUERY_KEY = ['manifest'] as const` in a new `apps/expo/lib/api/queryKeys.ts` file.
2. Update `useCurrency` to use `queryKey: MANIFEST_QUERY_KEY` and select the currency fields.
3. Update settings screen to use the same key and select the feature flags it needs.
4. The single cache entry will be shared across all callers. One request per cache lifetime.

---

### TASK-20 · BUG-PERF-03 — Remove duplicate endpoint call in group chat
**Files:** `apps/expo/app/messages/group/[groupId].tsx`
**Steps:**
1. Merge `fetchGroupMeta` and `fetchGroupMessages` into a single query. Option A: the `/messages/group/${groupId}` endpoint already returns both — use one `useQuery` and destructure both `meta` and `messages` from the response.
2. Option B: add a `?include=meta` query param to request combined data from the server in one round trip.
3. Remove the second `useQuery` entirely. Derive all needed state from the single combined response.

---

### TASK-21 · BUG-PERF-04 — Paginate guild members and war history
**Files:** `apps/expo/app/guilds/[guildId].tsx` (client), corresponding API route (server)
**Steps:**
1. On the server: add `?limit=30&cursor=<id>` support to the guild members and war history endpoints. Return `{ members: [...], nextCursor: string | null, total: number }`.
2. On the client: replace the single `useQuery` with `useInfiniteQuery` using `getNextPageParam: (page) => page.nextCursor ?? undefined`.
3. Remove the local array slicing / "load more" simulation.
4. Render a "Load more" button or use `onEndReached` on the `FlatList` to trigger `fetchNextPage()`.
5. Display `total` member count in the guild header for context.

---

### TASK-22 · BUG-QK-01 — Unify new-member-quest query key
**Files:** `apps/expo/app/(tabs)/index.tsx`, `apps/expo/app/(tabs)/quests.tsx`, `apps/expo/lib/api/queryKeys.ts`
**Steps:**
1. Add `NEW_MEMBER_QUEST: ['quests', 'new-member'] as const` to the shared `queryKeys.ts` file.
2. Update both `index.tsx` and `quests.tsx` to import and use this constant.
3. Any mutations that affect quest state should invalidate `QUERY_KEYS.NEW_MEMBER_QUEST`.

---

### TASK-23 · BUG-RENDER-03 — Fix SwipeDrawer display name
**Files:** `apps/expo/components/layout/SwipeDrawer.tsx`, `apps/expo/lib/auth/context.tsx`, `apps/expo/lib/api/client.ts`
**Steps:**
1. Add `displayName: string` to the `AuthUser` interface in `lib/auth/context.tsx`.
2. In `refreshAccessToken` in `lib/api/client.ts`, populate `displayName: (me.displayName ?? me.display_name ?? me.username ?? '') as string`.
3. In the auth restore flow and `signIn` in `lib/auth/context.tsx`, carry `displayName` through from the API response.
4. Update SwipeDrawer: `const displayName = user?.displayName || user?.username || 'User'`. Ensure the `@handle` line shows `user?.username` (unchanged).
5. Update the `AuthUser` type in all places that construct this object (e.g. the test mock factories).

---

### TASK-24 · BUG-RENDER-04 · BUG-RENDER-05 — Replace hardcoded "coins" label
**Files:** `apps/expo/components/rooms/MessageBubble.tsx`, `apps/expo/components/rooms/GiftSpectacle.tsx`
**Steps:**
1. `MessageBubble`: add a `currencyName?: string` prop to `MessageBubbleProps`. Render `{giftCoinValue.toLocaleString()} {props.currencyName ?? 'coins'}` in the gift variant. The parent (`rooms/[roomId].tsx`) should call `useCurrency()` and pass `currency.softPlural.toLowerCase()` as `currencyName`.
2. `GiftSpectacle`: call `const { softPlural } = useCurrency()` inside the component and replace the hardcoded `"coins"` string with `softPlural.toLowerCase()`.

---

### TASK-25 · BUG-RENDER-06 — Per-tier isPending state in business upgrade
**Files:** `apps/expo/app/settings/business.tsx`
**Steps:**
1. Add `const [activeTierId, setActiveTierId] = useState<string | null>(null)`.
2. In the mutation `onMutate` callback, set `setActiveTierId(tier.id)`.
3. In `onSettled`, set `setActiveTierId(null)`.
4. Each upgrade button checks `activeTierId === tier.id` for its own loading state and `activeTierId !== null && activeTierId !== tier.id` for a "disabled (another in flight)" state.

---

### TASK-26 · BUG-THEME-01 — Add dark mode to ContactsImporter
**Files:** `apps/expo/components/ContactsImporter.tsx`
**Steps:**
1. Add `const { colors: themeColors } = useTheme()` to the component.
2. Replace all hardcoded colour literals:
   - `'#000'` → `themeColors.text`
   - `'#555'`, `'#888'` → `themeColors.textMuted`
   - `'#eee'` → `themeColors.surface` (or `themeColors.border` for dividers)
3. Move colour-dependent styles from `StyleSheet.create` (which is static) into the JSX (dynamic styles). Alternatively, create the stylesheet inside the component after `useTheme()` is called.
4. Test in both light and dark mode.

---

### TASK-27 · BUG-THEME-02 — Fix Quests tab to use useTheme
**Files:** `apps/expo/app/(tabs)/quests.tsx`
**Steps:**
1. Remove `import { useColorScheme } from 'react-native'` and the `colorScheme` variable.
2. Add `const { colors: themeColors, isDark } = useTheme()`.
3. Replace all `colorScheme === 'dark' ? darkValue : lightValue` patterns with `isDark ? darkValue : lightValue` or directly with `themeColors.*` tokens.
4. Verify the screen re-renders correctly when the user changes the in-app theme in Settings.

---

### TASK-28 · BUG-THEME-03 · BUG-THEME-04 — Dynamic colours in MessageBubble and CoinBalance
**Files:** `apps/expo/components/rooms/MessageBubble.tsx`, `apps/expo/components/economy/CoinBalance.tsx`
**Steps:**
1. `MessageBubble`: add a `themeColors` prop (type `ThemeColors`) — populated by the parent from `useTheme()`. In the `bubbleOther` and `messageTextOther` styles, replace static `colors.neutral[100]` and `colors.neutral[900]` with `themeColors.surface` and `themeColors.text`.
2. `CoinBalance`: move `color: colors.neutral[900]` from the static `StyleSheet` into a dynamic style applied in JSX: `<Text style={[styles.amount, { color: themeColors.text }]}>`. Similarly, the container background should use `themeColors.surface` dynamically.

---

### TASK-29 · BUG-KB-01 · BUG-KB-02 · BUG-KB-03 — Fix keyboard overlap in all chat screens
**Files:** `apps/expo/app/rooms/[roomId].tsx`, `apps/expo/app/messages/group/[groupId].tsx`, `apps/expo/app/guilds/[guildId]/chat.tsx`, `apps/expo/app.json` (or `app.config.ts`)
**Steps:**
1. Change `windowSoftInputMode` from `adjustNothing` to `adjustResize` globally, OR selectively per-screen using Expo's `KeyboardController` plugin (if installed) or the `softwareKeyboardLayoutMode` prop.
2. Update all three chat screens to use `behavior="padding"` on `KeyboardAvoidingView` for both iOS and Android.
3. Measure the header/status bar height using `useSafeAreaInsets()` and pass it as `keyboardVerticalOffset` where needed.
4. Test on physical Android devices at API 33, 34, and 36 (the system back-gesture area changes across versions).
5. Verify that the FlatList message list still scrolls and the input remains visible when the keyboard opens.

---

### TASK-30 · BUG-LOGIC-03 — Promote exhausted-retry messages to permanent_failure
**Files:** `apps/expo/lib/offline/sqlite.ts`, `apps/expo/lib/offline/syncQueue.ts`
**Steps:**
1. Add a new function `promoteExhaustedMessages()` to `sqlite.ts`:
   `UPDATE offline_messages SET sync_status = 'permanent_failure' WHERE sync_status = 'failed' AND retry_count >= 3`
2. Call `promoteExhaustedMessages()` at the start of `syncPendingMessages()` in `syncQueue.ts`, before `resetFailedMessages()`.
3. Update `getPermanentlyFailedMessages()` to query only `WHERE sync_status = 'permanent_failure'` (remove the `OR failed AND retry_count >= 3` clause since it's now redundant).

---

### TASK-31 · BUG-LOGIC-04 — Add minimum member validation to group create
**Files:** `apps/expo/app/messages/group/create.tsx`
**Steps:**
1. Update `canSubmit`: `const canSubmit = groupName.trim().length > 0 && selectedMembers.size > 0 && !createMutation.isPending;`
2. In `handleSubmit`, add: `if (selectedMembers.size === 0) { Alert.alert(t('groups.validation.title', 'Add Members'), t('groups.validation.noMembers', 'Please add at least one member to your group.')); return; }`
3. Update the "ADD MEMBERS" section label to show a validation cue when no members are selected: e.g. display a red asterisk or a hint text "Add at least 1 member".

---

### TASK-32 · BUG-LOGIC-05 — Normalise international phone numbers in ContactsImporter
**Files:** `apps/expo/components/ContactsImporter.tsx`
**Steps:**
1. Install `libphonenumber-js` (`npm install libphonenumber-js`).
2. In the normalisation step, use `parsePhoneNumber(rawNumber, deviceRegion)?.format('E.164')` to convert all numbers to E.164 before deduplication and API submission.
3. Determine the device region from `expo-localization`'s `Localization.region` (e.g. `'NG'` for Nigeria).
4. If parsing fails (truly invalid number), discard the contact from the batch.
5. Update the server-side user lookup to also store and match phone numbers in E.164 format.

---

### TASK-33 · BUG-UX-03 · BUG-UX-04 — Fix ContactsImporter error feedback
**Files:** `apps/expo/components/ContactsImporter.tsx`
**Steps:**
1. `handleInvite`: wrap the API call in try/catch. On success, update a local state map `invitedNumbers` to mark the number as invited and show a ✓ icon. On error, show a toast: "Couldn't send invite. Please try again."
2. Silent contact drop: after truncating to 500, display a notice: `t('contacts.truncatedNotice', 'Showing first 500 contacts. Use search to find others.')`.
3. Disable the invite button for a contact after a successful invite to prevent duplicates.

---

### TASK-34 · BUG-I18N-01 · BUG-I18N-02 — Fix hardcoded locales in profile and guild screens
**Files:** `apps/expo/app/profile/[userId].tsx`, `apps/expo/app/guilds/[guildId].tsx`
**Steps:**
1. In both files, import `i18n` from `@/lib/i18n` (or use `useTranslation().i18n.language`).
2. Replace all `toLocaleDateString('en-NG', ...)` and `toLocaleDateString()` calls with `toLocaleDateString(i18n.language, ...)`.
3. Consider using `Intl.DateTimeFormat(i18n.language, { year: 'numeric' }).format(date)` for safer cross-platform consistency on Android.

---

### TASK-35 · BUG-I18N-03 — Add i18n to guild chat and group create screens
**Files:** `apps/expo/app/guilds/[guildId]/chat.tsx`, `apps/expo/app/messages/group/create.tsx`
**Steps:**
1. Add `const { t } = useTranslation()` to both components.
2. Wrap every user-visible string in `t('namespace.key', 'English fallback')`:
   - Guild chat: empty state, load older messages, placeholder, loading state, "Loading…"
   - Group create: section labels, placeholders, empty states, error message, submit button label, group type labels
3. Add all new keys to `apps/expo/lib/i18n/locales/en.json` with English values.
4. Add the same keys to all 8 other locale files, using the existing translations as a model. For a quick fix, duplicate the English string and mark with a `// TODO: translate` comment.
5. Conduct the same audit on any other recently-added screens that may be missing translations.

---

### TASK-36 · BUG-TYPE-01 — Add displayName to AuthUser (dependency for TASK-23)
See TASK-23 — this task is a prerequisite and is covered there.

---

## P4 — Low (Cleanup Sprint)

---

### TASK-37 · BUG-A11Y-01 — Add accessibilityRole to SwipeDrawer nav list
**Files:** `apps/expo/components/layout/SwipeDrawer.tsx`
**Steps:**
1. Wrap the navigation link list in: `<View accessibilityRole="menu" accessibilityLabel={t('nav.menuLabel', 'Navigation menu')}>`.
2. Add `accessibilityRole="menuitem"` to each navigation `Pressable`.
3. Test with TalkBack enabled: navigate by swipe and verify TalkBack announces "Navigation menu" when focus enters the drawer.

---

### TASK-38 · BUG-BUILD-01 — Address babel-preset-expo internal import
**Files:** `apps/expo/babel.config.js`
**Steps:**
1. Check whether `babel-preset-expo` now exports `expoRouterBabelPlugin` via its public `package.json#exports` map. If so, switch to the public import path.
2. If not, add a comment documenting why the internal path is used and pin `babel-preset-expo` to a specific patch version in `package.json`.
3. Add a CI check that runs `expo export` (or `npx babel --version`) and fails if the import cannot resolve — so a future package update surfaces the break immediately rather than silently.

---

### TASK-39 · BUG-BUILD-02 — Track unstable_enablePackageExports stability
**Files:** `apps/expo/metro.config.js`
**Steps:**
1. Add a comment above the flag: `// TODO: rename to enablePackageExports once Metro stabilises the API.`
2. Subscribe to Metro release notes and the `react-native` / `expo` changelogs for this flag's stable graduation.
3. Add an integration test (or a CI smoke test) that verifies `import('@zobia/shared/utils')` resolves correctly in a Metro build. This will catch a silent Metro regression before it reaches production.

---

## Implementation Notes

**Ordering:** Execute tasks in strict P1 → P2 → P3 → P4 order. P1 tasks are gates — do not submit a release build until all P1 tasks pass QA.

**Testing checkpoints:**
- After TASK-01: EAS build must succeed end-to-end.
- After TASK-03 (PIN security): pen-test the PIN lockout by clearing app data and verifying the server still enforces the lockout.
- After TASK-04 (ad credits): simulate API failure during ad completion and verify the credit appears in the user's balance after the next sync.
- After TASK-29 (keyboard): test all three chat screens on a physical Android device with keyboard open, typing, and sending a message.
- After TASK-35 (i18n): switch app locale to French and Arabic and verify newly-translated strings appear correctly.

**Regression guard:** After the complete fix set, run the full type-check (`tsc --noEmit`), ESLint pass, and an EAS Preview build on Android before closing the bug sprint.

---

*Fix plan generated: June 26, 2026 — 12:00 PM WAT*
*39 tasks covering 48 bugs · Estimated: P1 = 3–4 days · P2 = 5–7 days · P3 = 7–10 days · P4 = 1–2 days*
