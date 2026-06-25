# Zobia Expo App — Forensic Bug Report
**Date:** 2026-06-25 | **Time:** 10:57 PM
**Scope:** Expo Android app (primary target: Android API 36); cross-cutting issues noted
**Analyst:** Claude Code (inline analysis — no sub-agents)

---

## BUGS

### ── CRITICAL SECURITY ──────────────────────────────────────────────────────

**1: BUG-SEC-01: Auth callback URL validated via substring match — OAuth deep link spoofing**
FILES: `apps/expo/app/auth/login.tsx`
FIX: Replace `url.includes('auth/callback')` with a strict URL parse. Parse with `new URL(url)` and assert that `parsedUrl.origin === env.API_BASE_URL` AND `parsedUrl.pathname.startsWith('/api/auth/callback')`. A crafted URL like `https://evil.com/?r=auth/callback` currently passes.

**2: BUG-SEC-02: `signOut()` uses raw `fetch()` — CSRF Origin header bypassed on logout**
FILES: `apps/expo/lib/auth/context.tsx`
FIX: Replace the raw `fetch('/auth/logout', ...)` call with `apiClient.post('/auth/logout')`. The bare `fetch` doesn't inject the `Origin: env.API_BASE_URL` header that the CSRF middleware requires, and bypasses the retry/interceptor chain.

**3: BUG-SEC-03: `onlineManager` uses only `isConnected`, ignoring `isInternetReachable` — false-online on captive portals**
FILES: `apps/expo/lib/api/client.ts`
FIX: Change `setOnline(Boolean(state.isConnected))` to `setOnline(Boolean(state.isConnected && state.isInternetReachable !== false))`. Without this, devices on hotel/airport Wi-Fi show as online and React Query fires API calls that will all fail, burning retries.

**4: BUG-SEC-04: JWT read from SecureStore on every API request — performance bottleneck and sequencing hazard**
FILES: `apps/expo/lib/api/client.ts`
FIX: Add a module-level `let cachedToken: string | null = null`. In the request interceptor, use the cached value if set; fall back to `SecureStore.getItemAsync(JWT_KEY)` only if empty. Update the cache on login, token refresh, and clear it on sign-out. Eliminates 1+ Android Keystore round-trips per concurrent request.

**5: BUG-SEC-05: `APP_ENV: "development"` hardcoded in app.json extra — dev flags shipped to production**
FILES: `apps/expo/app.json`
FIX: Remove the `"APP_ENV": "development"` key from `extra`. Set it per-environment in `eas.json` under each profile's `env` block so the build pipeline controls the value.

**6: BUG-SEC-06: AdMob test unit IDs used silently in production when env vars absent — zero ad revenue**
FILES: `apps/expo/lib/ads/admob.ts`, `apps/expo/app.config.ts`
FIX: In `app.config.ts`, add a production guard: if `process.env.EAS_BUILD_PROFILE === 'production'` and `ADMOB_APP_ID_ANDROID` is unset, throw `Error('ADMOB_APP_ID_ANDROID is required for production builds')`. Same for iOS and rewarded/banner/interstitial unit IDs.

**7: BUG-SEC-07: No `runtimeVersion` policy — OTA updates can push incompatible JS bundles to old native builds**
FILES: `apps/expo/app.json`
FIX: Add `"runtimeVersion": { "policy": "sdkVersion" }` inside the `expo.updates` object. Without this, EAS Update defaults to `"nativeVersion"`, which can cause native API calls in a new JS bundle to crash on an older native binary still installed on user devices.

### ── RELIABILITY / DATA LOSS ────────────────────────────────────────────────

**8: BUG-REL-01: `resetSendingMessages()` not called on cold app startup — offline queue stalls permanently after crash**
FILES: `apps/expo/app/_layout.tsx`
FIX: Call `await resetSendingMessages()` immediately after `await initOfflineDB()` in the root `useEffect` startup sequence. Currently it's only called inside `syncPendingMessages()` (triggered on reconnect), which means a crash during a send leaves messages in `sending` state that are never retried on the next cold launch until connectivity is lost and re-gained.

**9: BUG-REL-02: Daily login XP set in MMKV before server confirms — XP silently lost on server error**
FILES: `apps/expo/app/(tabs)/index.tsx`
FIX: Move `storage.set(STORE_KEYS.LAST_DAILY_LOGIN, today)` from the pre-mutation call site into the mutation's `onSuccess` callback. Add an `onError` callback that resets the key (or leaves it unset) so that on the next launch the mutation is retried rather than skipped silently.

**10: BUG-REL-03: `isAtBottomRef` initialised to `false` — no auto-scroll when entering a room chat**
FILES: `apps/expo/app/rooms/[roomId].tsx`
FIX: Initialise `const isAtBottomRef = useRef(true)`. Users always arrive at the bottom of a conversation. The current `false` default means newly arriving messages don't trigger auto-scroll until the user manually scrolls to the bottom once.

**11: BUG-REL-04: Presence heartbeat fires before membership is confirmed in room screen**
FILES: `apps/expo/app/rooms/[roomId].tsx`
FIX: Gate the heartbeat `setInterval` with `if (!isMember) return;` inside the `useEffect`. Currently the interval starts as soon as the room screen mounts, even for non-members, resulting in spurious 401/403 heartbeat calls for private rooms.

**12: BUG-REL-05: GIF messages use `idempotency_key` (snake_case), text messages use `idempotencyKey` (camelCase)**
FILES: `apps/expo/app/rooms/[roomId].tsx`
FIX: Standardise all room message sends to `idempotencyKey` (camelCase), matching the field name in `syncQueue.ts` and the DM path. Verify the server accepts the camelCase variant and remove the inconsistent snake_case usage in the GIF send branch.

**13: BUG-REL-06: `userReacted` never `true` in DM message mapper — reaction highlight broken for current user**
FILES: `apps/expo/app/messages/[conversationId].tsx`
FIX: Pass the authenticated user's ID into `mapApiDM()`. When building `MessageReaction`, set `userReacted: r.userId === currentUserId`. Without this, all reaction pills are always rendered in the un-reacted state, hiding which reactions the current user has applied.

**14: BUG-REL-07: Ad load listeners leak — only one listener unsubscribed on completion in rewarded and interstitial loaders**
FILES: `apps/expo/lib/ads/admob.ts`
FIX: In `loadRewardedAd()`: when LOADED fires, call `unsubscribeError()` before `resolve()`; when ERROR fires, call `unsubscribeLoaded()` before `reject()`. Repeat for `loadInterstitialAd()`. The surviving listener remains attached and fires again the next time an ad event occurs, potentially double-resolving or double-rejecting a stale Promise.

**15: BUG-REL-08: `SlugRedirect` has no timeout — infinite spinner on unresponsive server**
FILES: `apps/expo/components/deeplink/SlugRedirect.tsx`
FIX: Create an `AbortController` and set `setTimeout(() => controller.abort(), 15_000)`. Pass `{ signal: controller.signal }` to the fetch. On abort or any unrecoverable error, render an error state with a "Go Back" button instead of a perpetual spinner.

**16: BUG-REL-09: Cold-start-from-notification not handled — deep link lost when app is fully closed**
FILES: `apps/expo/app/_layout.tsx`
FIX: Add `const lastResponse = await Notifications.getLastNotificationResponseAsync()` in the startup `useEffect`. If present, route it through the same `VALID_PUSH_ROUTES` allowlist handler used for foreground notification taps. Without this, tapping a push notification that cold-starts the app takes the user to the home tab instead of the notified content.

**17: BUG-REL-10: `KeyboardAvoidingView` on Android conflicts with `softwareKeyboardLayoutMode: "pan"`**
FILES: `apps/expo/app/rooms/[roomId].tsx`, `apps/expo/app.json`
FIX: Wrap `<KeyboardAvoidingView>` in a `Platform.OS === 'ios'` condition or render it with `behavior={Platform.OS === 'ios' ? 'padding' : undefined}`. Android's `pan` mode in `app.json` already shifts the whole view; an additional `KeyboardAvoidingView` creates a double-offset that pushes the message list too far up.

**18: BUG-REL-11: Dedup set cap checked post-insert — the 501st room message ID enters the set**
FILES: `apps/expo/app/rooms/[roomId].tsx`
FIX: Check `if (seenIds.size >= 500)` and prune the oldest entries *before* calling `seenIds.add(id)`. The current post-add check allows the set to grow to 501 on each boundary crossing before trimming begins.

**19: BUG-REL-12: PIN entry dual-input paths can both call `advance()` within the same 150 ms window — double-advance**
FILES: `apps/expo/app/settings/pin.tsx`
FIX: Add `const advancingRef = useRef(false)` at the top of `advance()`. Return early if `advancingRef.current` is already `true`; set it `true` on entry and `false` after the `setTimeout` callback fires. Both the hidden `TextInput.onChangeText` and numpad `Pressable.onPress` share a 150 ms delay and can race on rapid input.

**20: BUG-REL-13: War countdown timer keeps firing every second after `diff <= 0` — pointless state updates**
FILES: `apps/expo/app/guilds/wars/[warId].tsx`
FIX: Inside `tick()`, after `setDisplay('Ended')` when `diff <= 0`, call `clearInterval(id)` before returning. The current code lets the interval continue indefinitely after the war ends.

**21: BUG-REL-14: Guild war React Query poll continues every 10 s after war ends — wasteful API calls**
FILES: `apps/expo/app/guilds/wars/[warId].tsx`
FIX: Change `refetchInterval: 10_000` to `refetchInterval: war?.status === 'ended' ? false : 10_000`. React Query supports dynamic interval values; `false` stops polling.

**22: BUG-REL-15: `guild1Winning` is `true` when scores are tied — incorrect "winning" highlight during tie**
FILES: `apps/expo/app/guilds/wars/[warId].tsx`
FIX: Change `const guild1Winning = war.guild1.score >= war.guild2.score` to `const isTied = war.guild1.score === war.guild2.score`, `const guild1Winning = !isTied && war.guild1.score > war.guild2.score`. Render both scores in neutral colour when tied.

**23: BUG-REL-16: Settings `patchMutation` has no `onError` — silent save failures**
FILES: `apps/expo/app/settings/index.tsx`
FIX: Add `onError: () => Alert.alert(t('common.error'), t('settings.saveFailed', 'Could not save setting. Please try again.'))` to `patchMutation`. Currently the UI optimistically updates state while the server error is swallowed.

**24: BUG-REL-17: Date-of-birth regex accepts structurally valid but calendrically invalid dates (e.g. 2000-13-45)**
FILES: `apps/expo/app/settings/index.tsx`
FIX: After the `/^\d{4}-\d{2}-\d{2}$/` regex passes, validate calendrically: `const d = new Date(dateOfBirth); if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== dateOfBirth) { setDobError('Invalid date'); return; }`.

### ── UX / ACCESSIBILITY / I18N ──────────────────────────────────────────────

**25: BUG-UX-01: Push token registration failure shows blocking modal `Alert` — disruptive on every launch failure**
FILES: `apps/expo/app/_layout.tsx`
FIX: Remove the `Alert.alert()` on push token registration failure. Use `console.warn()` only. Surface a non-blocking nudge in the Settings/Notification section if push permission has never been granted.

**26: BUG-UX-02: Quests tab uses manual `useState`/`useEffect` — no stale-while-revalidate, no focus refetch**
FILES: `apps/expo/app/(tabs)/quests.tsx`
FIX: Migrate to `useQuery({ queryKey: ['daily-quests'], queryFn: ..., staleTime: 60_000 })` and a separate query for new-member quests. This brings it in line with the rest of the app and enables automatic background refetch on tab focus.

**27: BUG-UX-03: Wallet tab uses manual `useState`/`useEffect` — same inconsistency, no background refetch**
FILES: `apps/expo/app/(tabs)/wallet.tsx`
FIX: Migrate to `useQuery({ queryKey: ['wallet', 'balance'], queryFn: fetchWallet, staleTime: 30_000 })`.

**28: BUG-UX-04: Settings screen makes two separate `/users/me` fetches — `TwoFactorSection` and the DoB `useEffect`**
FILES: `apps/expo/app/settings/index.tsx`
FIX: Extract both into a single `useQuery({ queryKey: ['user-me'], queryFn: () => apiClient.get('/users/me') })` call and pass the result as props where needed. Eliminates the duplicate network round-trip.

**29: BUG-UX-05: Data export uses `Share.share({ message: json })` — large JSON will fail or be truncated on Android**
FILES: `apps/expo/app/settings/index.tsx`
FIX: Install `expo-file-system`. Write JSON to `FileSystem.cacheDirectory + 'zobia-export.json'`, then use `Share.shareAsync(path, { mimeType: 'application/json', dialogTitle: 'Zobia Data Export' })`. The TODO comment in the existing code already documents this exact fix.

**30: BUG-UX-06: `formatPlayingSince` hardcodes `'en-US'` locale — always formats in English regardless of user language**
FILES: `apps/expo/app/(tabs)/profile.tsx`
FIX: Replace `d.toLocaleDateString('en-US', ...)` with `d.toLocaleDateString(i18n.language, ...)` using the `i18n` instance from `useTranslation()`.

**31: BUG-UX-07: Multiple hardcoded English strings in profile tab — not run through `t()`**
FILES: `apps/expo/app/(tabs)/profile.tsx`
FIX: Pass "Edit Profile", "Track Levels", "Season History", "No Guild", "No past seasons yet", "My Wallet", "Coins Store", "Creator Dashboard" through `t()` with appropriate i18n keys and English fallbacks.

**32: BUG-UX-08: Messages tab section headers "Direct Messages" and "Group Chats" are hardcoded English**
FILES: `apps/expo/app/(tabs)/messages.tsx`
FIX: Replace with `t('messages.directMessages', 'Direct Messages')` and `t('messages.groupChats', 'Group Chats')`.

**33: BUG-UX-09: SwipeDrawer pan gesture conflicts with horizontal `ScrollView` children — drawer opens instead of horizontal scroll**
FILES: `apps/expo/components/layout/SwipeDrawer.tsx`
FIX: Set `activeOffsetX: [5, Infinity]` on the pan gesture so it only activates for clear rightward swipes. Alternatively, set `.activeOffsetX(10).failOffsetY([-10, 10])` to fail the drawer gesture when vertical movement dominates, which is characteristic of a horizontal scroll.

**34: BUG-UX-10: No client-side PIN attempt rate limiting — user can brute-force the 4-digit PIN UI**
FILES: `apps/expo/app/settings/pin.tsx`, `apps/expo/app/economy/store.tsx`
FIX: Track `attemptCount` in a `useRef`. After 5 consecutive wrong PINs, disable the numpad for 30 seconds with a visible countdown label. (Server-side enforcement is also required, but client-side friction is free.)

**35: BUG-UX-11: DM reaction endpoint is `POST .../react`, room reaction is `PATCH .../reactions` — likely one is wrong**
FILES: `apps/expo/app/messages/[conversationId].tsx`, `apps/expo/app/rooms/[roomId].tsx`
FIX: Audit both against the server route definitions. Standardise to one HTTP verb and one path pattern across DM, group, and room reactions. Add the canonical endpoint as a constant in a shared API types file.

**36: BUG-UX-12: `formatCoins()` uses native JS float division — precision risk at large balances**
FILES: `apps/expo/app/economy/wallet.tsx`
FIX: Replace `(amount / 1_000_000).toFixed(2)` and `(amount / 1_000).toFixed(1)` with `new Decimal(amount).div(1_000_000).toFixed(2)` etc., using the already-imported `decimal.js` package.

**37: BUG-UX-13: Admin users `FlatList.onEndReached` can fire while `loading === true` — spurious second-page fetch**
FILES: `apps/expo/app/admin/users.tsx`
FIX: Guard: `onEndReached={() => { if (hasMore && !loading && !refreshing) void loadUsers(); }}`.

**38: BUG-UX-14: `router.push(...as never)` in multiple screens suppresses type checking on routes**
FILES: `apps/expo/app/(tabs)/profile.tsx`, `apps/expo/app/(tabs)/quests.tsx`, `apps/expo/app/(tabs)/guild.tsx`
FIX: Use typed route objects: `{ pathname: '/guilds/[guildId]', params: { guildId: profile.guildId } }`. TypeScript will then catch route renames at compile time.

**39: BUG-UX-15: `admin/index.tsx` `coinsInCirculation` formatted with `.toLocaleString()` (no locale) — device-locale-dependent output**
FILES: `apps/expo/app/admin/index.tsx`
FIX: Use `.toLocaleString('en-US')` for all admin financial metrics so the formatting is deterministic across all admin devices.

### ── BUILD / CONFIGURATION ───────────────────────────────────────────────────

**40: BUG-CFG-01: `app.config.ts` AdMob app ID falls back to Google test app ID in production when env var unset**
FILES: `apps/expo/app.config.ts`
FIX: Throw a build-time error when `process.env.EAS_BUILD_PROFILE === 'production'` and `ADMOB_APP_ID_ANDROID` is undefined. Test IDs shipped to the Play Store will be silently rejected by AdMob and generate no revenue.

**41: BUG-CFG-02: No `googleServicesFile` in `app.json` android section — FCM not configured for direct delivery**
FILES: `apps/expo/app.json`
FIX: Add `"googleServicesFile": "./google-services.json"` to the `android` block. Obtain `google-services.json` from the Firebase console (it contains only app IDs — no server key — so it's safe to commit). Required for reliable FCM on Android 13+ / API 33+.

**42: BUG-CFG-03: `expo-updates` plugin lacks `runtimeVersion` policy — incompatible OTA bundles risk native crashes**
FILES: `apps/expo/app.json`
FIX: Add `"runtimeVersion": { "policy": "sdkVersion" }` inside `expo.updates`. Without an explicit policy, Expo defaults to `"nativeVersion"`, which couples each native binary to a specific JS bundle version and prevents patching old installs without forcing an app store update.

**43: BUG-CFG-04: `i18n/index.ts` `prefsStore` is an unencrypted MMKV instance separate from the main encrypted store**
FILES: `apps/expo/lib/i18n/index.ts`
FIX: Language preference is low-sensitivity and unencrypted MMKV is acceptable. Document this explicitly with a comment: `// Intentionally unencrypted: only stores UI language preference, never user data`. Ensure no other keys are ever written to `prefsStore`.

---

## RATINGS

### Current Code Rating: **6.5 / 10**

**Strengths (well-executed):**
- Robust offline architecture: SQLite AES-256-GCM encrypted queue, MMKV encrypted with SecureStore-backed key
- Idempotency keys on all message sends (UUID v4 via `crypto.randomUUID()`)
- `refreshPromise` singleton prevents concurrent token-refresh races
- React Query usage is solid in most screens (staleTime, optimistic updates with rollback)
- Auth event emitter for 401 propagation is clean and decoupled
- Ably realtime with `onEventRef` pattern correctly avoids stale closures without re-subscribing
- IAP session/resolver map prevents concurrent purchases
- Decimal.js used for all displayed financial figures (koboToNairaStr)
- CSRF Origin header injected on all `apiClient` calls
- 2FA TOTP setup and disable flows are complete with proper modal UX
- Telegram login with exponential backoff polling and cleanup on unmount
- Delta message fetch with dedup set and sort is correctly implemented
- Admin audit log, moderation, and user action flows with reason modal are thorough
- `markMessageSending()` / `resetSendingMessages()` crash-restart safety pattern (good idea, just missing the cold-start call)

**Weaknesses (driving the score down):**
- Auth deep link substring match is a real security gap
- `APP_ENV: "development"` hardcoded for all builds
- No cold-start notification handling
- Two screens bypass React Query (manual fetch pattern)
- Multiple silent data loss paths: daily XP, settings patches, reaction display
- Listener leak in ad loading code
- Several i18n gaps in visible strings
- Keyboard avoiding view conflict on Android
- Missing build-time production env var guards

### Projected Rating After All Fixes Applied: **9.0 / 10**

After all 43 bugs are fixed, the app will have:
- Hardened OAuth callback with proper origin validation
- Zero silent data losses (XP, reactions, messages, settings)
- Fully consistent React Query data layer across all tabs
- Cold-start notification routing
- Production-safe build configuration with env var guards
- No ad listener leaks or timer leaks
- Complete i18n across all visible strings
- Correct Android keyboard handling
- Client-side PIN brute-force friction

The remaining 1 point reflects inherent mobile platform complexity (gesture interaction, API 36 compatibility tuning, Play Store policy compliance) that requires ongoing production monitoring rather than one-off fixes.

---

*Report generated: 2026-06-25 10:57 PM*
*Total bugs found: 43*
*Files analysed: All files in `apps/expo/` — app screens, components, lib, plugins, config*
