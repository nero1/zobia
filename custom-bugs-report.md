# Zobia Expo App — Forensic Bug Report

**Generated:** June 26, 2026 — 12:00 PM WAT
**Target Platform:** Android API 36 · Expo SDK ~51.0.0 · React Native 0.74.0 · Expo Router ~3.5.0
**Scope:** `apps/expo` (monorepo). Web/PWA included only where it directly impacts the mobile app.
**Methodology:** Full forensic file-by-file read of all relevant Expo source files; three-pass cross-reference analysis.

---

## Quality Assessment

| Dimension | Current | Post-Fix |
|---|---|---|
| Stability / Crash Safety | 6 / 10 | 9 / 10 |
| Security | 6 / 10 | 8.5 / 10 |
| Payment Integrity | 6 / 10 | 9 / 10 |
| Performance / Network Efficiency | 6 / 10 | 8.5 / 10 |
| UX / Error Feedback | 5.5 / 10 | 8.5 / 10 |
| Dark Mode / Theming | 5.5 / 10 | 9 / 10 |
| Accessibility | 5 / 10 | 8 / 10 |
| Internationalisation | 6 / 10 | 8.5 / 10 |
| Code Robustness | 7 / 10 | 9 / 10 |
| **Overall** | **6.1 / 10** | **8.8 / 10** |

**Review:** The codebase demonstrates solid architectural choices — Decimal.js for financials, AES-256-GCM encrypted SQLite queue, idempotency keys, cursor-based pagination in guild chat, SecureStore JWT management with silent refresh, and a well-structured theme provider. However, it carries a cluster of critical issues: a package version mismatch that will break EAS builds, multiple client-side-only security controls that are trivially bypassed, broken dark mode across several components, systemic keyboard overlap on Android, silent error swallowing in key UX flows, and an unhandled financial race condition on rewarded ads. Post-fix the app would be production-grade and genuinely well-built.

---

## Bug List — One-Line Summaries

1. BUG-PKG-01: `expo-file-system` pinned to `^56.0.8` — incompatible with Expo SDK 51 (requires `~16.x`)
2. BUG-CRASH-01: Data export path is invalid when `cacheDirectory` is null — write fails or targets wrong location
3. BUG-MEM-01: Ably channel memory leak when component unmounts before async init resolves — cleanup never called
4. BUG-SEC-01: PIN lockout in store.tsx is client-side timestamp only — bypassed by device clock or app restart
5. BUG-SEC-02: PIN lockout in settings/pin.tsx is client-side only — same bypass vector
6. BUG-PAY-01: Rewarded-ad coin credit lost when the post-ad API call fails — ad watched but balance not updated
7. BUG-PAY-02: Subscription upgrade missing `replacementMode` — Google Play proration behaviour is undefined
8. BUG-PAY-03: Subscription prices hardcoded in NGN — ignores Play Store regional and currency pricing
9. BUG-UX-01: `translateApiError` called with wrong arity in change-password.tsx — server errors silently dropped
10. BUG-NAV-01: `useRouter()` result included in useEffect deps in `_layout.tsx` — notification listeners torn down on every render
11. BUG-NAV-02: Last notification response navigates before auth gate runs — deep-links to protected routes unauthenticated
12. BUG-NAV-03: `SessionExpiredModal` uses `router.push` instead of `router.replace` — Back press returns to unauthenticated screen
13. BUG-RENDER-01: `LevelBar` divides `track.level / track.maxLevel` without guarding `maxLevel === 0` — `Infinity%` width crashes layout
14. BUG-RENDER-02: GIF messages include metadata on send but `mapApiMessage` never extracts `gifUrl` — GIFs render as empty bubbles
15. BUG-RENDER-03: SwipeDrawer shows username in both the display-name and `@handle` slots
16. BUG-RENDER-04: `MessageBubble` gift variant hardcodes `"coins"` label — ignores currency context
17. BUG-RENDER-05: `GiftSpectacle` hardcodes `"coins"` label — ignores currency context
18. BUG-RENDER-06: Business upgrade screen — all tier buttons share one `upgradeMutation.isPending` indicator
19. BUG-PERF-01: Home screen fires 7–9 simultaneous API requests on cold start — thundering herd
20. BUG-PERF-02: `/manifest` endpoint fetched twice under different React Query keys — duplicate network call
21. BUG-PERF-03: Group chat fetches meta and messages via two separate calls to the same endpoint on mount
22. BUG-PERF-04: Guild detail screen fetches all members and war history in one unbound call — no server-side pagination
23. BUG-PERF-05: `QueryClient` default `retry: 2` retries all query failures including 4xx — wastes resources on auth and validation errors
24. BUG-QK-01: New-member-quest query key differs between `index.tsx` and `quests.tsx` — cache miss on every navigation
25. BUG-THEME-01: `ContactsImporter` hardcodes hex color values — completely broken in dark mode
26. BUG-THEME-02: Quests tab calls `useColorScheme()` directly instead of `useTheme()` — ignores in-app theme override
27. BUG-THEME-03: `MessageBubble` "other" bubble background hardcoded to `neutral[100]` — unreadable in dark mode
28. BUG-THEME-04: `CoinBalance` amount text color hardcoded to `neutral[900]` — invisible on dark surface
29. BUG-KB-01: Keyboard overlaps chat input in `rooms/[roomId].tsx` on Android (`adjustNothing` + `behavior={undefined}`)
30. BUG-KB-02: Keyboard overlaps chat input in `messages/group/[groupId].tsx` on Android
31. BUG-KB-03: Keyboard not handled in `guilds/[guildId]/chat.tsx` on Android (`behavior={undefined}`)
32. BUG-AUTH-01: `myUserId` falls back to string `'me'` in DM screen — own/other bubble alignment breaks without loaded auth
33. BUG-AUTH-02: `myUserId` falls back to string `'me'` in group chat screen — same misalignment
34. BUG-LOGIC-01: Pending offline message IDs use an incrementing module counter in DM screen — not collision-safe across sessions
35. BUG-LOGIC-02: `pendingCounter` is module-level in `group/[groupId].tsx` — counter persists across screen unmounts
36. BUG-LOGIC-03: `resetFailedMessages()` never promotes `retry_count ≥ 3` rows to `permanent_failure` — inconsistent with `getPermanentlyFailedMessages()` logic
37. BUG-LOGIC-04: Group create screen allows creating a group with zero members — no client-side minimum validation
38. BUG-LOGIC-05: `ContactsImporter` strips formatting characters but ignores international prefix variations — cross-country matching fails
39. BUG-UX-02: `g/[slug].tsx` game fetch error is silently caught — user sees blank screen with no error message
40. BUG-UX-03: `ContactsImporter` `handleInvite` swallows all errors — user gets no feedback on failure
41. BUG-UX-04: `ContactsImporter` silently drops contacts beyond 500 unique numbers with no user notification
42. BUG-I18N-01: Profile screen `joinYear` formatted with hardcoded `'en-NG'` locale
43. BUG-I18N-02: Guild screen war dates use `toLocaleDateString()` with device locale — inconsistent with app i18n approach
44. BUG-I18N-03: Guild chat and group-create screens contain hardcoded untranslated strings
45. BUG-TYPE-01: `AuthUser` type missing `displayName` field — SwipeDrawer shows username as the user's display name
46. BUG-A11Y-01: SwipeDrawer nav list missing `accessibilityRole="menu"` — screen reader loses navigation context
47. BUG-BUILD-01: `babel.config.js` imports an internal `babel-preset-expo` path — breaks on any structural refactor of that package
48. BUG-BUILD-02: `metro.config.js` uses `unstable_enablePackageExports` — flagged unstable, potential edge-case breakage on Metro upgrade

---

## Detailed Bug Descriptions

---

### 1: BUG-PKG-01 — expo-file-system version mismatch

FILES: `apps/expo/package.json`

The dependency is declared as `"expo-file-system": "^56.0.8"`. Expo SDK 51 ships with and requires `expo-file-system` at `~16.x`. Version 56 is 40 major versions ahead and does not exist for SDK 51. EAS Build (and local builds) will either fail to resolve the package, or install a version incompatible with the managed SDK. The `^` range means npm will attempt to find any `56.x.x`, which either doesn't exist on npm at all (causing a resolution error) or belongs to a far-future SDK. The postinstall `patch-package` step will also silently fail if the wrong package is installed. This needs to be corrected to `~16.0.0` (matching SDK 51) and the lock file regenerated.

FIX: Change `"expo-file-system"` to `"~16.0.0"` in `package.json`. Run `npx expo install expo-file-system` to let the SDK peer-dep resolver select the correct version. Regenerate the lock file and verify the EAS build succeeds.

---

### 2: BUG-CRASH-01 — Null cacheDirectory crashes data export

FILES: `apps/expo/app/settings/index.tsx`

The data-export feature constructs a file path with `(cacheDirectory ?? '') + 'zobia-export.json'`. `expo-file-system`'s `cacheDirectory` is typed as `string | null` and returns `null` on some Android devices or when the file system is not yet initialised. When null, the fallback empty string produces the path `'zobia-export.json'` — a relative path that `expo-file-system`'s write function cannot use and will either throw or silently write nowhere. The user sees a silent failure or an unhandled exception.

FIX: Validate `cacheDirectory` before using it. If null, surface an error toast to the user and abort the export. Use: `if (!cacheDirectory) { showToast('Export not available — storage not ready'); return; }`. Alternatively, use `FileSystem.documentDirectory` as a fallback since that is guaranteed non-null.

---

### 3: BUG-MEM-01 — Ably channel memory leak on early component unmount

FILES: `apps/expo/lib/realtime/useRealtimeChannel.ts`

The hook initiates async Ably client creation and channel subscription inside a `useEffect`. The cleanup variable is declared outside the async function and is assigned only after the async work completes. If the component unmounts before the async function finishes, the `useEffect` cleanup runs with the variable still `undefined`, resulting in a no-op. The Ably client and channel subscription are never released. On screens that mount/unmount rapidly (e.g. during navigation), this accumulates open WebSocket connections and event listeners, eventually causing message delivery to wrong components and RAM growth.

FIX: Use a cancellation flag (`let cancelled = false`) set to `true` in the cleanup. After each `await`, check `if (cancelled)` before proceeding; if cancelled, call the Ably cleanup immediately. Alternatively, restructure so the Ably client is created synchronously or use a ref to hold the cleanup and always call it (even if partially initialised) in the effect's return.

---

### 4: BUG-SEC-01 — Client-side PIN lockout in economy store

FILES: `apps/expo/app/economy/store.tsx`

The PIN brute-force lockout (`pinLockedUntil`) is stored only in local React state or MMKV with a timestamp. The user can bypass it by: (a) changing the device clock to a future time and back, (b) force-closing and relaunching the app, or (c) clearing app data. Five attempts and 1-minute lockout provide no real protection against an attacker with physical device access.

FIX: The PIN lockout must be enforced server-side. On each incorrect PIN attempt, send it to the server; the server returns a 429 with a `retryAfter` seconds field and enforces the lockout in Redis against the user's account. On the client, always treat a server-issued `retryAfter` response as authoritative and display the remaining cooldown. Never rely on local state alone for security controls.

---

### 5: BUG-SEC-02 — Client-side PIN lockout in PIN settings screen

FILES: `apps/expo/app/settings/pin.tsx`

Same vulnerability as BUG-SEC-01 — the PIN verification attempt counter and lockout timer live in component state. The screen tracks up to 5 attempts before showing a 1-minute lockout UI, but this is completely reset on component unmount. A user (or attacker) can dismiss the screen and re-open it to get fresh attempts indefinitely.

FIX: Same server-side approach as BUG-SEC-01. The PIN change endpoint should accept current-PIN verification and enforce its own rate-limit (5 attempts per 15 minutes, account-level, persisted in Redis). The client should only display whatever the server communicates.

---

### 6: BUG-PAY-01 — Rewarded ad coin credit lost on API failure

FILES: `apps/expo/components/ads/RewardedAdButton.tsx`

After the user watches a rewarded ad to completion, the component calls the API to credit coins. If that API call fails (network error, server 5xx, timeout), the coins are simply not awarded — the user has satisfied the watch obligation but receives nothing. There is no retry, no queue for deferred credit, and no user-visible error explaining what happened. This is an accounting integrity gap: the ad network records a completed view but the user's balance is not updated.

FIX: Wrap the post-ad credit call in a retry loop with exponential backoff (up to 3 retries). If all retries fail, store a `pending_ad_credit` record in the offline SQLite queue (with an idempotency key derived from the ad completion event ID) so it can be replayed on next app launch. Show the user a clear message: "Ad viewed! Coins are being credited — check back in a moment." Never silently fail a financial transaction the user has already paid with their time.

---

### 7: BUG-PAY-02 — Subscription upgrade missing replacementMode

FILES: `apps/expo/app/settings/subscription.tsx`

When the user upgrades from a lower plan to a higher plan mid-cycle, `purchaseSubscription` is called without a `replacementMode` parameter. Google Play Billing v5+ requires an explicit `replacementMode` for subscription upgrades to determine whether to prorate immediately, at the next renewal, or charge the difference now. Without it, Google Play applies its default (which may or may not prorate) and the behaviour is undefined across Play Store versions. This can result in users being double-charged, getting the upgrade delayed, or the upgrade silently failing on certain device/Play Store configurations.

FIX: Detect when the user already has an active plan (check current `user.plan`). For upgrades, pass `replacementMode: DEFERRED` (or `IMMEDIATE_WITH_TIME_PRORATION`) to `purchaseSubscription` along with the existing subscription's `purchaseToken`. For downgrades, use `DEFERRED`. Document the chosen proration policy for users (e.g. "upgrade takes effect immediately and remaining days are credited").

---

### 8: BUG-PAY-03 — Subscription prices hardcoded in NGN

FILES: `apps/expo/app/settings/subscription.tsx`

The subscription UI displays prices as `₦500`, `₦1,500`, etc. — hardcoded Naira amounts. Unlike the coin-purchase screen (which attempts to fetch live Play Store pricing), subscriptions show only the hardcoded price. Users in other supported regions (Play Store supports localised pricing) will see incorrect prices, and if Google Play applies local pricing the displayed amount will not match what is charged.

FIX: Fetch subscription product details from Google Play via `react-native-iap`'s `getSubscriptions()` at screen mount and display the `localizedPrice` field returned by the store. Fall back to the hardcoded price only when the fetch fails, and show a disclaimer that prices may vary by region.

---

### 9: BUG-UX-01 — Silent error swallow in change-password screen

FILES: `apps/expo/app/settings/change-password.tsx`, `apps/expo/lib/i18n/apiErrors.ts`

The mutation error handler calls `setFieldError(translateApiError(err))` with a single argument (the raw `AxiosError`). The correct signature is `translateApiError(t: TranslateFn, code: string | null | undefined, fallbackMessage: string)`. With only one argument, `t` receives the error object, `code` is `undefined`, and `fallbackMessage` is `undefined`. The function returns `undefined`, `setFieldError` is set to `undefined`, and the field error state is never rendered. From the user's perspective: the password change fails and nothing happens — no message, no indication of what went wrong.

FIX: Replace `setFieldError(translateApiError(err))` with `setFieldError(translateApiError(t, (err as AxiosError)?.response?.data?.code, (err as AxiosError)?.response?.data?.message ?? t('errors.generic', 'Something went wrong')))`. Ensure `t` is destructured from `useTranslation()` in scope.

---

### 10: BUG-NAV-01 — useRouter() in useEffect deps causes notification listener churn

FILES: `apps/expo/app/_layout.tsx`

`router` obtained from `useRouter()` is included in the dependency array of the `useEffect` that registers Expo notification listeners. `useRouter()` returns a new object reference on every render. As a result, the notification listeners are torn down and re-registered on every render of the root layout, including on every navigation event. This creates a window during which incoming notifications may be dropped, and on high-frequency renders could exhaust listener slots.

FIX: Wrap `router` in a `useRef` (assign `routerRef.current = router` in a separate stable effect) and reference `routerRef` (not `router`) inside the notification effect. Alternatively, extract the navigation callback into a `useCallback` with an empty dependency array and use that as the listener, so the `useEffect` can safely omit `router` from deps.

---

### 11: BUG-NAV-02 — Notification deep-link fires before auth gate

FILES: `apps/expo/app/_layout.tsx`

The notification response listener calls `router.push(url)` immediately when a notification is tapped, before the auth state has been restored from SecureStore (`isLoading` may still be `true`). A user tapping a push notification while the app cold-starts can be routed to a protected screen (DM, wallet, profile) before the auth context has loaded, resulting in blank screens, uncaught errors from null `user`, or bypassing the onboarding gate.

FIX: In the notification response handler, check `if (authContext.isLoading) { pendingNotificationUrl.current = url; return; }`. After `isLoading` flips to `false`, navigate to `pendingNotificationUrl.current` if set and clear it. Also validate the URL against the `VALID_PUSH_ROUTES` allowlist before navigating.

---

### 12: BUG-NAV-03 — SessionExpiredModal pushes instead of replaces

FILES: `apps/expo/components/auth/SessionExpiredModal.tsx`

The "Go to Login" action calls `router.push('/auth/login')`. This stacks the login screen on top of the current (authenticated) screen. If the user presses the Android Back button from the login screen, they return to the unauthenticated screen that was underneath — potentially a wallet, chat, or admin screen that will now throw because `user` is null.

FIX: Change to `router.replace('/auth/login')` so the login screen replaces the entire navigation stack. This is the standard pattern for session expiry redirects and prevents the back-navigation vulnerability.

---

### 13: BUG-RENDER-01 — Division by zero in LevelBar

FILES: `apps/expo/app/profile/[userId].tsx`

The XP level progress bar computes `const progress = track.level / track.maxLevel`. When `track.maxLevel` is `0` (e.g. a newly-created rank tier or a corrupted API response), `progress` becomes `Infinity`. `width: '${Infinity * 100}%'` produces the string `'Infinity%'` in the StyleSheet, which React Native cannot lay out, potentially crashing the component or silently rendering an incorrectly filled bar.

FIX: Guard with `const progress = track.maxLevel > 0 ? track.level / track.maxLevel : 0`. Also clamp to `[0, 1]` to handle unexpected API values: `Math.min(1, Math.max(0, progress))`.

---

### 14: BUG-RENDER-02 — GIF messages render as empty bubbles

FILES: `apps/expo/app/rooms/[roomId].tsx`

`handleGifSelect` sends `{ content: '', messageType: 'gif', metadata: { gifUrl: '...' } }` to the API. When the message is returned from the API and passed through `mapApiMessage`, the function does not extract `metadata.gifUrl` — the resulting message object has `content: ''` and no gif URL. The `MessageBubble` renders an empty text bubble. GIFs are never visible to any user in the room.

FIX: Update `mapApiMessage` to extract `gifUrl: message.metadata?.gifUrl ?? null`. Update `MessageBubble` (and its type definitions) to accept and render a `gifUrl` prop — use `expo-image` or `Image` with the URL for `messageType === 'gif'`. Pass `gifUrl` from the room screen's render function.

---

### 15: BUG-RENDER-03 — SwipeDrawer shows username in both name and handle slots

FILES: `apps/expo/components/layout/SwipeDrawer.tsx`

The drawer header assigns `displayName = user?.username ?? 'User'` and uses it for the user's "name" display line. The `@handle` line then also shows `user?.username`. Both lines display the identical username string. Users with different display names (stored server-side) will never see their chosen display name in the drawer.

FIX: Add `displayName?: string` to the `AuthUser` type in `lib/auth/context.tsx`. Populate it from the API response in `refreshAccessToken` (client.ts) and in `signIn`. Update SwipeDrawer to use `user?.displayName ?? user?.username ?? 'User'` for the name line.

---

### 16: BUG-RENDER-04 — MessageBubble gift hardcodes "coins"

FILES: `apps/expo/components/rooms/MessageBubble.tsx`

Gift message bubbles display `{giftCoinValue.toLocaleString()} coins`. The word `"coins"` is hardcoded in English and ignores the configurable soft-currency name provided by `useCurrency()` (e.g. `Stars`, `Gems`, `Chips` depending on admin config) and is also not passed through i18n.

FIX: The component needs access to the currency context. Either pass `currencyName` as a prop from the parent (preferable, keeps the component pure) or call `useCurrency()` inside. Replace `"coins"` with `currency.softPlural.toLowerCase()`.

---

### 17: BUG-RENDER-05 — GiftSpectacle hardcodes "coins"

FILES: `apps/expo/components/rooms/GiftSpectacle.tsx`

The gift animation overlay displays a coin value with the hardcoded string `"coins"` — the same problem as BUG-RENDER-04 but in the spectacle animation layer. Any admin-configured soft-currency name change will leave this display inconsistent.

FIX: Call `useCurrency()` inside `GiftSpectacle` (it is a React component so the hook is valid) and replace the hardcoded `"coins"` with `currency.softPlural.toLowerCase()`.

---

### 18: BUG-RENDER-06 — Business tier upgrade — shared isPending state across all buttons

FILES: `apps/expo/app/settings/business.tsx`

All business tier upgrade buttons render their loading state via the single `upgradeMutation.isPending` boolean from one shared `useMutation` instance. When the user taps one upgrade button and the mutation is in flight, every other upgrade button on the screen simultaneously shows "Loading…" and is disabled. This is confusing UX — the user cannot tell which action is in progress and cannot distinguish a loading button from a broken one.

FIX: Either create separate `useMutation` instances per tier (cleanest), or track which tier is in flight with a `useState<string | null>(null)` for `activeTierId` and set/clear it around the mutation. Each button checks `activeTierId === tier.id` to determine its own loading state.

---

### 19: BUG-PERF-01 — Thundering herd on home screen cold start

FILES: `apps/expo/app/(tabs)/index.tsx`

On mount the home screen fires 7–9 concurrent API requests: presence, friends, nemesis, quests/daily, leaderboard/me, users/me, guilds/discovery, quests/new-member, and creator-spotlight. These all launch simultaneously, saturating the device's HTTP connection pool and the server's request handler. On slow connections this causes all requests to queue and take several times longer than sequential requests would. On the server it can trigger a request storm if many users open the app simultaneously.

FIX: Introduce staggered fetch priorities. Requests critical for the first visible frame (users/me, presence) should fetch immediately. Secondary data (friends, leaderboard, guilds/discovery) should be deferred 200–500 ms using `setTimeout` or by setting a higher `staleTime` so they only fetch when idle. Non-critical data (creator-spotlight, quests/new-member) should be lazy-loaded on scroll or after a 1–2 s delay. Also consolidate the related `/manifest` calls (see BUG-PERF-02).

---

### 20: BUG-PERF-02 — /manifest endpoint called twice with different query keys

FILES: `apps/expo/lib/hooks/useCurrency.ts`, `apps/expo/app/settings/index.tsx`

`useCurrency` fetches `/manifest` with key `['manifest', 'currency']`. The settings screen fetches the same `/manifest` endpoint with key `['manifest-features']`. Because React Query deduplicates by key, these are two independent cache entries that both fire network requests to the same endpoint, returning the same payload. Every screen that mounts both components triggers two identical API calls.

FIX: Standardise on a single canonical query key for the manifest endpoint — e.g. `['manifest']`. Both `useCurrency` and the settings manifest query should use the same key and select/transform the fields they need from the shared response. One request, one cache entry, zero duplication.

---

### 21: BUG-PERF-03 — Group chat mounts two requests to the same endpoint

FILES: `apps/expo/app/messages/group/[groupId].tsx`

Both `fetchGroupMeta` and `fetchGroupMessages` call `/messages/group/${groupId}` on mount. Two sequential (or concurrent) requests to the same endpoint fire every time the screen renders. The second request's response is identical to the first's except possibly for included messages. This doubles unnecessary load on the API.

FIX: Either: (a) merge into a single query that returns both meta and message history (preferred — add `?include=meta,messages` to the endpoint), or (b) make one query depend on the other so only one fires at mount, or (c) separate the endpoints server-side so `/messages/group/${id}/meta` and `/messages/group/${id}/messages` are distinct resources. At minimum ensure both share a single React Query cache key and result.

---

### 22: BUG-PERF-04 — Guild detail screen fetches all members and war history unbounded

FILES: `apps/expo/app/guilds/[guildId].tsx`

The guild detail screen requests all guild members and war history in a single API call with no `limit` or `cursor` parameter. The client then implements "load more" by slicing a local array. For large guilds (thousands of members) this results in a massive JSON payload, high memory consumption, slow TTI, and potential API timeouts. There is no server-side cursor-based pagination in this flow.

FIX: Add cursor-based pagination to the guild members and war history endpoints. On the client, use `useInfiniteQuery` with `getNextPageParam` (matching the approach already used in `guilds/[guildId]/chat.tsx`). The initial fetch should return 20–30 members and a `nextCursor`, with subsequent pages fetched on demand. Remove the client-side array slicing.

---

### 23: BUG-PERF-05 — React Query retries 4xx errors with default retry:2

FILES: `apps/expo/lib/api/client.ts`

The shared `QueryClient` is configured with `retry: 2` for all queries. This means every failing query — including 401 Unauthorized, 403 Forbidden, 404 Not Found, and 422 Validation Error — retries twice before surfacing an error. 4xx errors are client errors that will not succeed on retry. Each retry burns a network round trip, re-logs a JWT (in the request interceptor), and delays the error state shown to the user by 2× retry wait.

FIX: Set the default `retry` to a function: `retry: (failureCount, error) => { const status = (error as AxiosError)?.response?.status; if (status && status >= 400 && status < 500) return false; return failureCount < 2; }`. This retries only on network errors and 5xx server errors.

---

### 24: BUG-QK-01 — new-member-quest query key mismatch

FILES: `apps/expo/app/(tabs)/index.tsx`, `apps/expo/app/(tabs)/quests.tsx`

The home tab fetches the new-member quest with key `['new-member-quest']`. The quests tab fetches the same data with key `['quests', 'new-member']`. React Query treats these as independent cache entries. Navigating between the two tabs triggers a duplicate network request, and a mutation on one screen does not invalidate the other screen's stale data.

FIX: Define a single canonical query key constant (e.g. `QUERY_KEYS.NEW_MEMBER_QUEST = ['quests', 'new-member']` in a shared constants file). Both screens import and use this constant. Any mutation that affects this data invalidates the single shared key.

---

### 25: BUG-THEME-01 — ContactsImporter hardcodes all colours

FILES: `apps/expo/components/ContactsImporter.tsx`

The component uses hardcoded colour literals `'#000'`, `'#555'`, `'#888'`, `'#eee'` for all text and backgrounds. In dark mode, black text on a dark surface (e.g. `#000` on `neutral[950]`) is invisible. The "eee" background for contact rows is similarly unreadable on a dark background. This component is completely broken in dark mode.

FIX: Replace all hardcoded colour values with `themeColors` from `useTheme()`. Map: primary text → `themeColors.text`, muted text → `themeColors.textMuted`, container background → `themeColors.surface`, row separator → `themeColors.border`.

---

### 26: BUG-THEME-02 — Quests tab bypasses in-app theme setting

FILES: `apps/expo/app/(tabs)/quests.tsx`

The quests screen uses `const colorScheme = useColorScheme()` from React Native directly and derives its colours from this. All other screens use `const { colors } = useTheme()` which respects the user's in-app preference (stored in MMKV). If the user sets the app to "dark" mode while their OS is in light mode, the quests screen will render in light mode while every other screen renders dark. The mismatch is jarring and visible on every tab switch.

FIX: Replace `useColorScheme()` with `useTheme()`. Update all colour references to use `themeColors.*` tokens.

---

### 27: BUG-THEME-03 — MessageBubble "other" bubble background hardcoded to light grey

FILES: `apps/expo/components/rooms/MessageBubble.tsx`

`bubbleOther` has `backgroundColor: colors.neutral[100]` and `messageTextOther` has `color: colors.neutral[900]`. Both are static light-theme values. In dark mode, the bubble background is light grey on a dark screen, visually inverted from all other surfaces, and the dark text (`neutral[900]`) on a light grey bubble reads fine in light mode but the white background bubble itself is jarringly bright in dark mode. There is no dynamic theming applied to message bubbles.

FIX: `MessageBubble` should accept `themeColors` as a prop (passed from the parent which calls `useTheme()`), or call `useTheme()` inside. Set `bubbleOther` background to `themeColors.surface` and other-message text to `themeColors.text`. Own bubble can stay brand-blue as it is.

---

### 28: BUG-THEME-04 — CoinBalance amount text hardcoded to dark colour

FILES: `apps/expo/components/economy/CoinBalance.tsx`

The `amount` style in `StyleSheet.create` sets `color: colors.neutral[900]`. This is a dark-grey value that reads correctly on the light `neutral[100]` background but is invisible in dark mode where the container uses `themeColors.surface` (dark). The number will not be readable in dark mode.

FIX: Move the `amount` text colour out of `StyleSheet.create` into the component's JSX where `themeColors` is available: `<Text style={[styles.amount, { color: themeColors.text }]}>{...}</Text>`. Similarly, the static `backgroundColor: colors.neutral[100]` in `styles.container` should be `themeColors.surface` applied dynamically.

---

### 29: BUG-KB-01 — Keyboard overlaps chat input on Android in room screen

FILES: `apps/expo/app/rooms/[roomId].tsx`

The `KeyboardAvoidingView` is configured with `keyboardVerticalOffset={0}` on Android and `behavior={undefined}` (no behaviour). The `AndroidManifest.xml` (via Expo config) sets `windowSoftInputMode="adjustNothing"`. With `adjustNothing` the system makes no room for the keyboard — the `KeyboardAvoidingView` with no `behavior` does nothing to compensate. The result is the software keyboard covering the message input on every Android device.

FIX: Change `windowSoftInputMode` to `adjustResize` for this screen (use Expo's `<StatusBar>` or `softwareKeyboardLayoutMode` in `app.json`), which allows the system to shrink the layout automatically. If `adjustNothing` must be kept globally, use `behavior="padding"` on `KeyboardAvoidingView` with a measured `keyboardVerticalOffset` (typically header height + status bar height). Test on multiple Android API levels.

---

### 30: BUG-KB-02 — Keyboard overlaps chat input on Android in group chat screen

FILES: `apps/expo/app/messages/group/[groupId].tsx`

`KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}` is used. The `'height'` behaviour on Android shrinks the entire view's height rather than shifting it upward; combined with the `adjustNothing` soft input mode, the keyboard still overlaps the input, or the FlatList collapses and no messages are visible while the keyboard is open. This is a known Android/React Native incompatibility.

FIX: Same remediation as BUG-KB-01. For Android, either switch to `adjustResize` globally for chat screens, or use a measured `padding` approach. Avoid `behavior="height"` on Android — it interacts poorly with `FlatList` in a flex container.

---

### 31: BUG-KB-03 — Keyboard not handled in guild chat on Android

FILES: `apps/expo/app/guilds/[guildId]/chat.tsx`

`KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}` — Android explicitly receives `undefined`, which means the component does nothing on Android. The message input is covered by the keyboard on every Android device. Users cannot see what they're typing.

FIX: Same as BUG-KB-01 and BUG-KB-02. Provide a consistent Android keyboard avoidance strategy across all three chat screens.

---

### 32: BUG-AUTH-01 — DM screen myUserId falls back to string 'me'

FILES: `apps/expo/app/messages/[conversationId].tsx`

`const myUserId = user?.id ?? 'me'`. If `user` is null (auth not yet loaded, or user logged out mid-session), all messages with `sender_id === 'me'` — which will be none since the server never sends that value — are treated as "other" messages. Every message renders in the "other-user" bubble style (left-aligned, shows sender name). The user's own messages appear to come from someone else.

FIX: Render the chat list only after `!isLoading && user !== null`. Show a loading spinner or `<Screen>` while auth is initialising. Never fall back to a sentinel string for identity checks.

---

### 33: BUG-AUTH-02 — Group chat screen myUserId falls back to string 'me'

FILES: `apps/expo/app/messages/group/[groupId].tsx`

Identical to BUG-AUTH-01. `const myUserId = user?.id ?? 'me'` causes the same misalignment of own vs. other messages.

FIX: Same as BUG-AUTH-01. Gate the message list render on auth being loaded and non-null.

---

### 34: BUG-LOGIC-01 — DM screen pending message IDs use non-UUID counter

FILES: `apps/expo/app/messages/[conversationId].tsx`

Optimistic UI pending messages are assigned IDs like `pending-1`, `pending-2`, using a module-level incrementing counter. If the module is reloaded (hot reload in dev, or Metro bundle refresh) the counter resets to 0. Two sessions in the same process could collide on the same pending ID (`pending-1`), causing the wrong optimistic message to be removed from the list when the real message arrives. The offline SQLite queue (correctly) uses `crypto.randomUUID()`, but the optimistic layer does not.

FIX: Replace the counter with `crypto.randomUUID()` for pending message IDs: `const localId = \`pending-${crypto.randomUUID()}\``. Remove the module-level counter.

---

### 35: BUG-LOGIC-02 — Group chat pendingCounter is module-level

FILES: `apps/expo/app/messages/group/[groupId].tsx`

`let pendingCounter = 0` is declared at module scope. Navigating away from the group chat screen and back does not reset the counter. Over multiple navigation round-trips, the counter grows without bound. While individual IDs remain unique within a session (low collision risk), the counter leaks memory semantically and is a fragile pattern. If two instances of the component somehow mount simultaneously (edge case in navigators), they share the same counter and will generate overlapping IDs.

FIX: Use `crypto.randomUUID()` for all pending IDs, same as BUG-LOGIC-01.

---

### 36: BUG-LOGIC-03 — resetFailedMessages does not promote exhausted retries to permanent_failure

FILES: `apps/expo/lib/offline/sqlite.ts`

`resetFailedMessages()` resets rows with `sync_status = 'failed' AND retry_count < 3` back to `pending`. Rows with `retry_count >= 3` stay in `failed` status. However, `getPermanentlyFailedMessages()` queries `WHERE sync_status = 'permanent_failure' OR (sync_status = 'failed' AND retry_count >= 3)`. This means messages that have exhausted retries are perpetually visible in `getPermanentlyFailedMessages()` but are never promoted to `permanent_failure`, creating a split view of "permanently failed" messages between the status column and the query. The `syncQueue.ts` logic for client errors (`status >= 400 < 500`) correctly calls `markMessagePermanentlyFailed`, but the retry-ceiling path does not.

FIX: Add a step in `resetFailedMessages()` (or as a separate `promoteExhaustedToPermFailed()` call in `syncPendingMessages`): `UPDATE offline_messages SET sync_status = 'permanent_failure' WHERE sync_status = 'failed' AND retry_count >= 3`. This keeps the status column as the single source of truth.

---

### 37: BUG-LOGIC-04 — Group create allows zero members

FILES: `apps/expo/app/messages/group/create.tsx`

`handleSubmit` only checks that the group name is non-empty. It does not validate that at least one member has been selected. A user can create a solo group chat with themselves, which is likely unintentional and could lead to confusing UX or server-side errors if the API enforces a minimum member count. There is no client-side feedback guiding the user to add at least one member.

FIX: Add a validation check: `if (selectedMembers.size === 0) { Alert.alert(t('groups.noMembersError', 'Add at least one member')); return; }`. Update `canSubmit` to also require `selectedMembers.size > 0`. The "CREATE GROUP" button should clearly indicate it is disabled due to no members being selected.

---

### 38: BUG-LOGIC-05 — ContactsImporter phone normalization ignores country codes

FILES: `apps/expo/components/ContactsImporter.tsx`

Phone normalisation strips spaces, dashes, and parentheses but does not handle international prefix variants. A contact stored as `+2348012345678` and one stored as `08012345678` (local Nigerian format) refer to the same number but will never match. Similarly, `+1-800-555-0100` and `18005550100` won't match. The "find existing users" API call will therefore miss users whose numbers are stored in a different format, causing the importer to incorrectly report contacts as "not on Zobia."

FIX: Normalise all phone numbers to E.164 format before hashing/comparing. Use a library like `libphonenumber-js` (already available or add it) to parse with a default region hint (user's device locale), then convert to E.164. Store and query using E.164 on both client and server.

---

### 39: BUG-UX-02 — Game screen silently catches all fetch errors

FILES: `apps/expo/app/g/[slug].tsx`

The game details fetch in `useEffect` calls `.catch(() => {})` — a swallowed empty catch. If the game slug is invalid, the API returns 404, or there's a network error, `setLoading(false)` is still called and `game` remains `null`. The screen renders the fallback title "Game" and cover emoji `🎮` with the Play button visible (if authed) — but pressing Play will then also fail because the slug may be invalid. No error state, no retry button, and no "game not found" message.

FIX: Add error state: `const [fetchError, setFetchError] = useState<string | null>(null)`. In the catch block: `setFetchError(t('games.loadError', 'Could not load game details.'))`. Render the error message if `fetchError` is set. If the error is a 404, navigate back or show "This game is no longer available."

---

### 40: BUG-UX-03 — ContactsImporter invite errors silently swallowed

FILES: `apps/expo/components/ContactsImporter.tsx`

`handleInvite` calls the invite API and ignores all errors. If the API returns an error (already invited, network failure, rate limit), the button gives no feedback — it may appear to succeed or do nothing. The user has no way to know whether the invite was sent.

FIX: Catch errors in `handleInvite` and show a brief toast or inline error message. On success, update the button state to "Invited ✓" or similar. Disable the button after successful invite to prevent re-sends.

---

### 41: BUG-UX-04 — ContactsImporter silently discards contacts beyond 500

FILES: `apps/expo/components/ContactsImporter.tsx`

When phone contact normalisation yields more than 500 unique numbers, the list is silently truncated. The user sees their contacts list apparently fully loaded but some contacts are missing from the search without explanation.

FIX: After truncation, show a non-intrusive notice: "Showing the first 500 contacts. Search to find others." Consider raising the limit or paginating the API call in batches of 500 rather than hard-capping.

---

### 42: BUG-I18N-01 — Profile screen joinYear hardcoded to en-NG locale

FILES: `apps/expo/app/profile/[userId].tsx`

The join-year date formatter is called with `{ locale: 'en-NG' }` hardcoded. Users with Arabic (`ar`), French (`fr`), Hausa (`ha`), Swahili (`sw`), Amharic (`am`), Zulu (`zu`), or Portuguese (`pt`) app locales will see the join year formatted in Nigerian English regardless of their selected language.

FIX: Use the current i18n locale: `import { i18n } from '@/lib/i18n'; ... date.toLocaleDateString(i18n.language, { year: 'numeric' })`. Alternatively expose the locale from the i18n context and consume it here.

---

### 43: BUG-I18N-02 — Guild screen war dates use device locale inconsistently

FILES: `apps/expo/app/guilds/[guildId].tsx`

War dates are formatted with `toLocaleDateString()` (no locale argument), which uses the device's OS locale — not the app's i18n locale. This creates inconsistency: if a user sets the app to French but their phone is in English, war dates appear in English while the rest of the app is in French.

FIX: Pass `i18n.language` as the first argument to `toLocaleDateString`. Apply this fix consistently across all date displays in the guild screens.

---

### 44: BUG-I18N-03 — Guild chat and group create contain untranslated hardcoded strings

FILES: `apps/expo/app/guilds/[guildId]/chat.tsx`, `apps/expo/app/messages/group/create.tsx`

Guild chat: "No messages yet. Say hi to your guild! 👋", "Load older messages", "Loading…", "Message your guild..." — all hardcoded English strings with no `t()` wrapper. Group create: "GROUP NAME", "GROUP TYPE", "ADD MEMBERS ({n} selected)", "Enter group name…", "Search friends…", "No friends match your search.", "No friends yet.", "Failed to create group. Please try again.", "Create Group" — all hardcoded. These screens are invisible to users of the app's 8 non-English supported locales.

FIX: Wrap every user-visible string in the `t('namespace.key', 'fallback')` function from `useTranslation()`. Add the corresponding keys and translations to all 9 locale JSON files (`en`, `fr`, `ar`, `ha`, `sw`, `am`, `zu`, `pt`, `pidgin`). Apply the same audit to other recently-added screens.

---

### 45: BUG-TYPE-01 — AuthUser type missing displayName field

FILES: `apps/expo/lib/auth/context.tsx`, `apps/expo/lib/api/client.ts`, `apps/expo/components/layout/SwipeDrawer.tsx`

The `AuthUser` interface does not include a `displayName` property. The SwipeDrawer's "header" section therefore can only show `user.username` as the user's name. Users who have set a distinct display name on their profile (different from their @username handle) see their username in both the name slot and the `@handle` slot, which looks broken and removes the UX benefit of having a display name.

FIX: Add `displayName: string` to `AuthUser`. Populate it from `me.displayName ?? me.display_name ?? me.username` in the `refreshAccessToken` user-update block in `client.ts`, and from the API response in `AuthProvider`'s restore flow and `signIn`. Update SwipeDrawer to use `user.displayName` for the name line and `user.username` for the `@handle`.

---

### 46: BUG-A11Y-01 — SwipeDrawer navigation list missing semantic role

FILES: `apps/expo/components/layout/SwipeDrawer.tsx`

The drawer's navigation link list renders as a series of `Pressable` elements without an enclosing `View` with `accessibilityRole="menu"`. Screen readers (TalkBack on Android) cannot identify the region as a navigation menu. Users navigating by swipe/linear navigation will encounter the links without context that they are in a menu, making it hard to distinguish navigation from content.

FIX: Wrap the navigation link list in `<View accessibilityRole="menu" accessibilityLabel="Navigation menu">`. Each navigation `Pressable` should have `accessibilityRole="menuitem"`.

---

### 47: BUG-BUILD-01 — babel.config.js imports internal babel-preset-expo path

FILES: `apps/expo/babel.config.js`

`require('babel-preset-expo/build/expo-router-plugin').expoRouterBabelPlugin` imports a file from inside the package's `build/` directory — an internal implementation path not guaranteed to be stable across versions. If `babel-preset-expo` refactors its internals (common across minor/patch bumps), this require will throw at build time with a cryptic module-not-found error that is hard to diagnose.

FIX: Check whether the plugin is now available via a public export (it may have been added to the package's main export map in a newer version). If not, open an issue with the Expo team or pin `babel-preset-expo` to a specific version and include a comment explaining why. Alternatively, replace this workaround with the plugin registered through `expo-router`'s own babel configuration once available.

---

### 48: BUG-BUILD-02 — metro.config.js uses unstable_enablePackageExports

FILES: `apps/expo/metro.config.js`

`config.resolver.unstable_enablePackageExports = true` enables Metro's package-exports resolver, which is explicitly named `unstable_`. While functional, the `unstable_` prefix means Meta can change or remove this API in any Metro release without a semver breaking-change notice. It is currently required for the `@zobia/shared/*` subpath imports to resolve correctly, but should be tracked for stability.

FIX: Monitor the Metro changelog for when this becomes `enablePackageExports` (stable). Consider adding an integration test that verifies `@zobia/shared/utils` resolves correctly so a Metro upgrade that breaks this is caught immediately rather than silently at runtime.

---

*Report completed: June 26, 2026 — 12:00 PM WAT*
*Total bugs found: 48*
*Severity breakdown: 3 Critical build/crash · 7 Security/Payment · 8 Performance/Network · 10 UX/Rendering · 8 Theming/Accessibility · 7 Logic/Data · 5 i18n/Build*
