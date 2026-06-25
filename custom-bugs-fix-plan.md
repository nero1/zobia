# Zobia Expo App — Bug Fix Plan
**Date:** 2026-06-25 | **Time:** 10:57 PM
**Reference:** `custom-bugs-report.md` (same date)
**Total bugs:** 43 | **Estimated sessions to complete:** 3–4

Bugs are grouped into fix waves ordered by risk, then dependency. Fix security issues first, then reliability, then UX/config. Within each wave, independent items can be tackled in parallel.

---

## WAVE 1 — SECURITY (Fix Immediately Before Next Release)

### Task 1.1: Fix OAuth deep link URL spoofing (BUG-SEC-01)
**File:** `apps/expo/app/auth/login.tsx`
**Steps:**
1. Locate the `handleDeepLink` / URL listener that checks for `'auth/callback'`.
2. Replace `url.includes('auth/callback')` with:
   ```ts
   const parsed = new URL(url);
   const expected = new URL(env.API_BASE_URL);
   const isValid =
     parsed.origin === expected.origin &&
     parsed.pathname.startsWith('/api/auth/callback');
   if (!isValid) return; // reject spoofed URLs
   ```
3. Test with a crafted URL like `https://evil.com/?foo=auth/callback` — must be rejected.
4. Test with the real callback URL — must still work.

### Task 1.2: Fix CSRF bypass in signOut (BUG-SEC-02)
**File:** `apps/expo/lib/auth/context.tsx`
**Steps:**
1. Find the raw `fetch('/auth/logout', ...)` call inside `signOut()`.
2. Replace with `await apiClient.post('/auth/logout').catch(() => {})`.
3. Verify the Origin header is present on the outgoing request.

### Task 1.3: Fix false-online detection on captive portals (BUG-SEC-03)
**File:** `apps/expo/lib/api/client.ts`
**Steps:**
1. Find `onlineManager.setEventListener` at the bottom of the file.
2. Change: `setOnline(Boolean(state.isConnected))` →
   `setOnline(Boolean(state.isConnected && state.isInternetReachable !== false))`.
3. Similarly update the same check in `OfflineBanner.tsx` — already done there, verify it matches.

### Task 1.4: Cache JWT in memory — remove per-request SecureStore reads (BUG-SEC-04)
**File:** `apps/expo/lib/api/client.ts`
**Steps:**
1. Add `let _cachedToken: string | null = null;` at module scope.
2. Export `export function setCachedToken(t: string | null) { _cachedToken = t; }`.
3. In the request interceptor: check `_cachedToken` first; only call `SecureStore.getItemAsync` if null.
4. In `refreshAccessToken`: call `setCachedToken(newToken)` after writing to SecureStore.
5. In auth context `signOut()`: call `setCachedToken(null)` after clearing SecureStore.
6. In auth context `restoreSession()` / startup: call `setCachedToken(token)` when loading the token.

### Task 1.5: Remove hardcoded `APP_ENV: development` from app.json (BUG-SEC-05)
**File:** `apps/expo/app.json`
**Steps:**
1. Delete the `"APP_ENV": "development"` line from the `extra` object.
2. Open `eas.json`; add `"APP_ENV": "development"` to the `development` profile's `env` block.
3. Add `"APP_ENV": "production"` to the `production` profile's `env` block.
4. Update `apps/expo/lib/env.ts` to read `APP_ENV` from `process.env.APP_ENV` if the `extra` approach no longer applies.

### Task 1.6: Add production env var guards for AdMob (BUG-SEC-06, BUG-CFG-01)
**Files:** `apps/expo/app.config.ts`, `apps/expo/lib/ads/admob.ts`
**Steps:**
1. In `app.config.ts`, at the top of the exported function, add:
   ```ts
   if (process.env.EAS_BUILD_PROFILE === 'production') {
     if (!process.env.ADMOB_APP_ID_ANDROID) throw new Error('ADMOB_APP_ID_ANDROID required for production');
     if (!process.env.EXPO_PUBLIC_ADMOB_REWARDED_ANDROID) throw new Error('EXPO_PUBLIC_ADMOB_REWARDED_ANDROID required');
     // repeat for banner, interstitial, iOS IDs
   }
   ```
2. Document the required env vars in `.env.example` or `README.md`.

### Task 1.7: Add `runtimeVersion` policy to expo-updates (BUG-SEC-07, BUG-CFG-03)
**File:** `apps/expo/app.json`
**Steps:**
1. Ensure the `expo.updates` object exists.
2. Add `"runtimeVersion": { "policy": "sdkVersion" }` inside it.
3. If already using `eas.json` update channels, verify they reference the correct channel names.

---

## WAVE 2 — RELIABILITY / DATA INTEGRITY (Fix Before Next Production Build)

### Task 2.1: Call `resetSendingMessages()` on cold startup (BUG-REL-01)
**File:** `apps/expo/app/_layout.tsx`
**Steps:**
1. Find the startup `useEffect` that calls `initOfflineDB()`.
2. Immediately after `await initOfflineDB()`, add `await resetSendingMessages()`.
3. Import `resetSendingMessages` from `@/lib/offline/syncQueue` (already re-exported there).
4. Verify the call order: `initOfflineDB()` → `resetSendingMessages()` → `syncPendingMessages()` (on reconnect).

### Task 2.2: Move daily login MMKV write to `onSuccess` (BUG-REL-02)
**File:** `apps/expo/app/(tabs)/index.tsx`
**Steps:**
1. Find `storage.set(STORE_KEYS.LAST_DAILY_LOGIN, today)` (or the equivalent MMKV write before `dailyLoginMutation.mutate()`).
2. Move it into the mutation's `onSuccess` callback.
3. Add `onError: (err) => console.warn('[daily-login] Failed to award daily XP', err)`.
4. Test: simulate a server 500 on the daily login endpoint; verify MMKV key is NOT set and the mutation retries the next launch.

### Task 2.3: Fix auto-scroll on room entry (BUG-REL-03)
**File:** `apps/expo/app/rooms/[roomId].tsx`
**Steps:**
1. Find `const isAtBottomRef = useRef(false)`.
2. Change to `const isAtBottomRef = useRef(true)`.

### Task 2.4: Gate presence heartbeat on membership confirmation (BUG-REL-04)
**File:** `apps/expo/app/rooms/[roomId].tsx`
**Steps:**
1. Find the `useEffect` that sets up `setInterval` for presence heartbeat.
2. Add `if (!isMember) return;` as the first line inside the effect.
3. Add `isMember` to the dependency array.

### Task 2.5: Standardise idempotency key field name to camelCase (BUG-REL-05)
**File:** `apps/expo/app/rooms/[roomId].tsx`
**Steps:**
1. Find the GIF/sticker message send that uses `idempotency_key`.
2. Change to `idempotencyKey` (camelCase) matching all other send paths.
3. Verify the server's GIF message endpoint accepts `idempotencyKey` (check API route handler).

### Task 2.6: Fix `userReacted` in DM message mapper (BUG-REL-06)
**File:** `apps/expo/app/messages/[conversationId].tsx`
**Steps:**
1. Find `mapApiDM()` function (or equivalent message-mapping code).
2. Add `currentUserId: string` parameter.
3. When building each `MessageReaction`, set `userReacted: reaction.userId === currentUserId`.
4. Pass `user?.id` from `useAuth()` to the mapper at the call site.
5. Test: react to a DM message; verify the pill highlights blue.

### Task 2.7: Fix ad load listener cross-unsubscription leak (BUG-REL-07)
**File:** `apps/expo/lib/ads/admob.ts`
**Steps:**
1. In `loadRewardedAd()`:
   - In LOADED callback: add `unsubscribeError()` before `resolve()`.
   - In ERROR callback: add `unsubscribeLoaded()` before `reject(error)`.
2. In `loadInterstitialAd()`:
   - In LOADED callback: add `unsubError()` before `resolve()`.
   - In ERROR callback: add `unsubLoaded()` before `reject(error)`.

### Task 2.8: Add timeout to `SlugRedirect` (BUG-REL-08)
**File:** `apps/expo/components/deeplink/SlugRedirect.tsx`
**Steps:**
1. Create `const controller = new AbortController()`.
2. `setTimeout(() => controller.abort(), 15_000)`.
3. Pass `{ signal: controller.signal }` to the fetch/apiClient call.
4. In the `catch` block (which now also catches `AbortError`), render an error state with a "Go Back" button (`router.back()`).
5. Clear the timeout in cleanup: return `() => clearTimeout(timer)`.

### Task 2.9: Handle cold-start notifications (BUG-REL-09)
**File:** `apps/expo/app/_layout.tsx`
**Steps:**
1. Import `Notifications` from `expo-notifications`.
2. In the startup `useEffect`, after the initial setup, add:
   ```ts
   const lastResponse = await Notifications.getLastNotificationResponseAsync();
   if (lastResponse) {
     routeNotification(lastResponse.notification); // reuse existing routing function
   }
   ```
3. The existing `routeNotification` (or equivalent handler) uses `VALID_PUSH_ROUTES` allowlist — verify it applies here too.

### Task 2.10: Fix Android keyboard double-offset in room chat (BUG-REL-10)
**File:** `apps/expo/app/rooms/[roomId].tsx`
**Steps:**
1. Find the `<KeyboardAvoidingView>` wrapping the message input area.
2. Change:
   ```tsx
   <KeyboardAvoidingView behavior="height" ...>
   ```
   to:
   ```tsx
   <KeyboardAvoidingView
     behavior={Platform.OS === 'ios' ? 'padding' : undefined}
     ...
   >
   ```
3. On Android with `softwareKeyboardLayoutMode: "pan"`, the OS handles the shift; no extra offset is needed.

### Task 2.11: Fix dedup set cap check order (BUG-REL-11)
**File:** `apps/expo/app/rooms/[roomId].tsx`
**Steps:**
1. Find the `seenIds` (or `seenMessageIds`) Set used in the message dedup loop.
2. Locate the cap check (`if (seenIds.size > 500) ...`).
3. Move the cap check and pruning to *before* `seenIds.add(id)`.
4. Pattern:
   ```ts
   if (seenIds.size >= 500) {
     const first = seenIds.values().next().value;
     seenIds.delete(first);
   }
   seenIds.add(id);
   ```

### Task 2.12: Fix PIN entry double-advance race condition (BUG-REL-12)
**File:** `apps/expo/app/settings/pin.tsx`
**Steps:**
1. Add `const advancingRef = useRef(false)` inside the component.
2. At the start of the `advance()` function, add:
   ```ts
   if (advancingRef.current) return;
   advancingRef.current = true;
   ```
3. Inside the `setTimeout` callback (after the transition), add `advancingRef.current = false`.
4. Test by rapidly tapping a numpad button and simultaneously typing on a Bluetooth keyboard.

### Task 2.13: Stop war countdown timer after war ends (BUG-REL-13)
**File:** `apps/expo/app/guilds/wars/[warId].tsx`
**Steps:**
1. In `useCountdown`'s `tick()` function, find the `if (diff <= 0)` branch.
2. After `setDisplay('Ended')`, add `clearInterval(id)` and `return`.
3. Note: `id` is declared outside `tick()` but `clearInterval` will work because JS closures capture it.

### Task 2.14: Stop war polling after war ends (BUG-REL-14)
**File:** `apps/expo/app/guilds/wars/[warId].tsx`
**Steps:**
1. Find `refetchInterval: 10_000` in the `useQuery` config.
2. Change to `refetchInterval: war?.status === 'ended' ? false : 10_000`.

### Task 2.15: Fix tied-score display in guild war (BUG-REL-15)
**File:** `apps/expo/app/guilds/wars/[warId].tsx`
**Steps:**
1. Replace `const guild1Winning = war.guild1.score >= war.guild2.score` with:
   ```ts
   const isTied = war.guild1.score === war.guild2.score;
   const guild1Winning = !isTied && war.guild1.score > war.guild2.score;
   ```
2. Update the score colour logic: when `isTied`, render both scores in `themeColors.text` (neutral).

### Task 2.16: Add `onError` to settings patch mutation (BUG-REL-16)
**File:** `apps/expo/app/settings/index.tsx`
**Steps:**
1. Find the `patchMutation = useMutation(...)` definition.
2. Add:
   ```ts
   onError: () => Alert.alert(t('common.error'), t('settings.saveFailed', 'Could not save setting. Please try again.'))
   ```
3. Optionally roll back the local state in `onError` by re-fetching: `queryClient.invalidateQueries({ queryKey: ['user-settings'] })`.

### Task 2.17: Validate date-of-birth calendrically (BUG-REL-17)
**File:** `apps/expo/app/settings/index.tsx`
**Steps:**
1. Find `saveDateOfBirth()` after the regex check passes.
2. Add:
   ```ts
   const parsed = new Date(dateOfBirth);
   if (isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== dateOfBirth.trim()) {
     setDobError('Invalid date. Please check the day and month are correct.');
     return;
   }
   ```

---

## WAVE 3 — UX / CONSISTENCY / I18N (Fix Before Next Public Release)

### Task 3.1: Replace launch-time push token Alert with console.warn (BUG-UX-01)
**File:** `apps/expo/app/_layout.tsx`
**Steps:**
1. Find the `Alert.alert()` call triggered by push token registration failure.
2. Replace with `console.warn('[push] Token registration failed:', err)`.
3. Optionally add a non-blocking in-app notification pointing to Settings > Notifications.

### Task 3.2: Migrate Quests tab to React Query (BUG-UX-02)
**File:** `apps/expo/app/(tabs)/quests.tsx`
**Steps:**
1. Remove `useState<DailyQuest[]>`, `useState<MemberQuestData>`, `useState(loading)`.
2. Replace `load()` with two `useQuery` calls:
   - `useQuery({ queryKey: ['daily-quests'], queryFn: () => apiClient.get('/quests/daily'), staleTime: 60_000 })`
   - `useQuery({ queryKey: ['member-quest'], queryFn: () => apiClient.get('/quests/new-member'), staleTime: 60_000 })`
3. Keep the `questUpdateKey` effect to call `queryClient.invalidateQueries` instead of `load()`.
4. Replace `onRefresh` with React Query's `refetch` functions.

### Task 3.3: Migrate Wallet tab to React Query (BUG-UX-03)
**File:** `apps/expo/app/(tabs)/wallet.tsx`
**Steps:**
1. Audit the manual fetch and move it to a `useQuery` call with `queryKey: ['wallet-tab']`.
2. Use `isFetching` for the pull-to-refresh `refreshing` prop.

### Task 3.4: Consolidate duplicate `/users/me` fetches in Settings (BUG-UX-04)
**File:** `apps/expo/app/settings/index.tsx`
**Steps:**
1. Add `useQuery({ queryKey: ['user-me'], queryFn: () => apiClient.get('/users/me'), staleTime: 60_000 })` in `SettingsScreen`.
2. Remove the separate `useEffect` that calls `/users/me` for DoB.
3. Pass `meData` down as a prop to `TwoFactorSection` to remove its own `/users/me` query (or share via the same queryKey — React Query deduplicates by key).
4. Extract DoB from `meData.data?.user?.date_of_birth`.

### Task 3.5: Fix data export to use file sharing (BUG-UX-05)
**File:** `apps/expo/app/settings/index.tsx`
**Steps:**
1. `npx expo install expo-file-system` (add to `package.json`).
2. In `handleExport()`, replace `Share.share({ message: json })` with:
   ```ts
   const path = FileSystem.cacheDirectory + 'zobia-export.json';
   await FileSystem.writeAsStringAsync(path, json, { encoding: FileSystem.EncodingType.UTF8 });
   await Share.shareAsync(path, { mimeType: 'application/json', dialogTitle: 'Zobia Data Export' });
   ```

### Task 3.6: Use i18n locale in `formatPlayingSince` (BUG-UX-06)
**File:** `apps/expo/app/(tabs)/profile.tsx`
**Steps:**
1. Add `const { i18n } = useTranslation()` (already has `const { t } = useTranslation()`; add `i18n`).
2. In `formatPlayingSince(isoDate)`, change `'en-US'` to `i18n.language`.

### Task 3.7: Translate hardcoded English strings in profile tab (BUG-UX-07)
**File:** `apps/expo/app/(tabs)/profile.tsx`
**Steps:**
1. Add i18n keys for: `profile.editProfile`, `profile.trackLevels`, `profile.seasonHistory`, `profile.noGuild`, `profile.noSeasons`, `profile.myWallet`, `profile.store`, `profile.creatorDashboard`.
2. Replace each hardcoded string with `t('profile.xxx', 'English fallback')`.
3. Add translations to all 9 locale JSON files (or at minimum the 3 most-used: en, fr, ha).

### Task 3.8: Translate messages tab section headers (BUG-UX-08)
**File:** `apps/expo/app/(tabs)/messages.tsx`
**Steps:**
1. Add `messages.directMessages` and `messages.groupChats` to i18n locale files.
2. Replace hardcoded strings in `SectionHeader` calls.

### Task 3.9: Fix SwipeDrawer gesture conflict with horizontal scrolls (BUG-UX-09)
**File:** `apps/expo/components/layout/SwipeDrawer.tsx`
**Steps:**
1. In the `Gesture.Pan()` definition, add `.activeOffsetX([5, Infinity]).failOffsetY([-10, 10])`.
   - This makes the drawer gesture active only on clear rightward movement and fail if vertical movement dominates — which is the pattern for a horizontal scroll.
2. Test: season history horizontal scroll on profile tab should not accidentally open the drawer.

### Task 3.10: Add client-side PIN attempt rate limiting (BUG-UX-10)
**Files:** `apps/expo/app/settings/pin.tsx`, `apps/expo/app/economy/store.tsx`
**Steps:**
1. In each PIN verification flow, add `const attemptCountRef = useRef(0)` and `const [lockedUntil, setLockedUntil] = useState<Date | null>(null)`.
2. On each wrong PIN: `attemptCountRef.current += 1; if (attemptCountRef.current >= 5) { setLockedUntil(new Date(Date.now() + 30_000)); }`.
3. Render a countdown when `lockedUntil` is set and disable the numpad.
4. Reset on successful PIN entry.

### Task 3.11: Audit and standardise reaction API endpoints (BUG-UX-11)
**Files:** `apps/expo/app/messages/[conversationId].tsx`, `apps/expo/app/rooms/[roomId].tsx`
**Steps:**
1. Check the server-side routes for reactions in DMs, groups, and rooms.
2. Standardise client calls to match. Suggested pattern: `POST /messages/{type}/{id}/reactions` body `{ emoji }`.
3. Extract the endpoint builder into a shared `lib/api/reactions.ts` helper.

### Task 3.12: Use Decimal.js in `formatCoins()` (BUG-UX-12)
**File:** `apps/expo/app/economy/wallet.tsx`
**Steps:**
1. Import `Decimal from 'decimal.js'` (already in `package.json`).
2. Replace:
   ```ts
   if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(2)}M`;
   if (amount >= 1_000) return `${(amount / 1_000).toFixed(1)}K`;
   ```
   with:
   ```ts
   const d = new Decimal(amount);
   if (d.gte(1_000_000)) return `${d.div(1_000_000).toFixed(2)}M`;
   if (d.gte(1_000)) return `${d.div(1_000).toFixed(1)}K`;
   ```

### Task 3.13: Guard admin users `FlatList.onEndReached` (BUG-UX-13)
**File:** `apps/expo/app/admin/users.tsx`
**Steps:**
1. Find `onEndReached={() => { if (hasMore) void loadUsers(); }}`.
2. Change to `onEndReached={() => { if (hasMore && !loading && !refreshing) void loadUsers(); }}`.

### Task 3.14: Replace `as never` route casts with typed routes (BUG-UX-14)
**Files:** `apps/expo/app/(tabs)/profile.tsx`, `apps/expo/app/(tabs)/quests.tsx`, `apps/expo/app/(tabs)/guild.tsx`
**Steps:**
1. Replace `router.push('/guilds/${profile.guildId}' as never)` with:
   `router.push({ pathname: '/guilds/[guildId]', params: { guildId: profile.guildId } })`.
2. Similarly fix `'/quests/new-member' as never` → `'/quests/new-member'` (if it's a static route).
3. Verify `tsconfig.json` has `"strict": true` and expo-router typed routes enabled.

### Task 3.15: Standardise admin financial number formatting (BUG-UX-15)
**File:** `apps/expo/app/admin/index.tsx`
**Steps:**
1. Replace `.toLocaleString()` (no locale) with `.toLocaleString('en-US')` for all numeric stat values in the admin dashboard.

---

## WAVE 4 — BUILD CONFIGURATION (Fix Before Shipping to Play Store)

### Task 4.1: Add `googleServicesFile` to app.json (BUG-CFG-02)
**File:** `apps/expo/app.json`
**Steps:**
1. Obtain `google-services.json` from Firebase console for the Zobia Android project.
2. Place it at `apps/expo/google-services.json`.
3. Add `"googleServicesFile": "./google-services.json"` inside the `android` object in `app.json`.
4. Add `google-services.json` to `.gitignore` if it contains server key (though the standard client file is safe to commit — verify).

### Task 4.2: Document `prefsStore` unencrypted intent (BUG-CFG-04)
**File:** `apps/expo/lib/i18n/index.ts`
**Steps:**
1. Add a one-line comment above the `prefsStore` declaration:
   ```ts
   // Intentionally unencrypted: stores only UI language preference (non-sensitive).
   // Do NOT write user data or auth tokens to this store.
   const prefsStore = new MMKV({ id: 'zobia_prefs' });
   ```

---

## SUMMARY TABLE

| Wave | # Tasks | Priority | Estimated Effort |
|------|----------|----------|-----------------|
| 1 — Security | 7 | CRITICAL | 4–6 hours |
| 2 — Reliability | 17 | HIGH | 8–12 hours |
| 3 — UX/I18N | 15 | MEDIUM | 6–10 hours |
| 4 — Config | 2 | LOW | 1 hour |
| **Total** | **41 tasks** | — | **19–29 hours** |

> Note: Some bugs share tasks (e.g., BUG-SEC-06 and BUG-CFG-01 are fixed together in Task 1.6; BUG-SEC-07 and BUG-CFG-03 share Task 1.7). 43 bugs → 41 tasks due to 2 merged fix targets.

---

## TESTING CHECKLIST (After All Fixes)

- [ ] OAuth Google login completes end-to-end on a real Android device
- [ ] Telegram login completes end-to-end (polls until session resolves)
- [ ] Deep link with crafted `auth/callback` in query string is rejected
- [ ] Push notification tap on cold start routes to correct screen
- [ ] Kill app mid-send; relaunch; verify message resumes from queue
- [ ] Daily login XP only saved to MMKV after server 200 response
- [ ] Room chat: enter room and verify new messages auto-scroll immediately
- [ ] Open keyboard in room chat on Android — no double offset
- [ ] React to a DM — reaction pill highlights blue for own reaction
- [ ] Watch rewarded ad twice in a row — no listener error in console
- [ ] Navigate to slug URL with server offline — error state appears within 15s
- [ ] Guild war: verify tied scores show neutral colours, ended war stops polling
- [ ] Settings: change language to Arabic, verify RTL + translated strings
- [ ] Settings: enter `2024-13-45` as DoB — verify validation rejects it
- [ ] Admin build: verify production EAS build fails without required AdMob env vars
- [ ] Pull-to-refresh on all 3 migrated screens (quests, wallet tab, settings)

---

*Fix plan generated: 2026-06-25 10:57 PM*
*DO NOT implement fixes until this plan has been reviewed and approved.*
