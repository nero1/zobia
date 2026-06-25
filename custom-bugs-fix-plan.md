# Zobia Social — Expo Android App: Bug Fix Plan

**Date:** 2026-06-25  
**Time:** 10:40 PM  
**Reference:** custom-bugs-report.md (same date)  
**Rule:** DO NOT implement any fixes until the plan is reviewed and approved.

---

## Fix Priority Order

Fixes are ordered by: (1) revenue / production impact first, (2) user-facing functional regressions, (3) security, (4) UX polish, (5) code hygiene. All critical bugs must be fixed before any high or medium fixes are merged.

---

## PHASE 1 — Critical Fixes (Fix Before Any Release)

---

### TASK-C01 — Fill in real production AdMob App IDs
**Fixes:** BUG-C01  
**Files:** `apps/expo/eas.json`, `apps/expo/lib/ads/admob.ts`  
**Effort:** Small (config change only)

Replace the empty string values for `ADMOB_APP_ID_ANDROID` and `ADMOB_APP_ID_IOS` in the `production` profile of `eas.json` with the real Google AdMob App IDs registered in the AdMob console. Also populate the four `EXPO_PUBLIC_ADMOB_*` ad unit ID env vars (`ADMOB_BANNER_ID`, `ADMOB_INTERSTITIAL_ID`, `ADMOB_REWARDED_ID` for Android, and equivalents for iOS) in the production profile. Move these values to EAS Secrets (not committed to the repo) via `eas secret:create`. The `app.config.ts` fallback to test IDs (`|| ADMOB_TEST_ANDROID`) can remain as a dev convenience — it correctly fires only when the env var is absent, not when it is empty. To fix the empty-string issue, change the fallback operator from `||` to `?? ` and change eas.json to either remove the key entirely or use EAS Secrets so the env var is genuinely absent in local dev.

**Steps:**
1. In the AdMob console, locate the Android app record and copy its App ID (format: `ca-app-pub-XXXX~YYYY`).
2. Run `eas secret:create --scope project --name ADMOB_APP_ID_ANDROID --value "ca-app-pub-..."`.
3. Do the same for `ADMOB_APP_ID_IOS` and the four ad unit IDs.
4. In `eas.json` production profile, reference them using `$ADMOB_APP_ID_ANDROID` (EAS Secrets syntax) or remove the keys so the env var is absent.
5. In `app.config.ts`, change `process.env.ADMOB_APP_ID_ANDROID || ADMOB_TEST_ANDROID` to `process.env.ADMOB_APP_ID_ANDROID ?? ADMOB_TEST_ANDROID` so that an empty string is not treated as absent.
6. Build a production binary and verify the AdMob initialization log shows the real App ID, not the test one.

---

### TASK-C02 — Add "staging" to Zod APP_ENV schema
**Fixes:** BUG-C02  
**Files:** `apps/expo/lib/env.ts`  
**Effort:** Trivial (one-line change)

Add `"staging"` to the `z.enum([...])` validator for `APP_ENV` in `lib/env.ts`. Verify that other parts of the app that branch on `env.APP_ENV` handle the `"staging"` case correctly (e.g., API base URL selection, feature flag gates, ad ID fallback). If the intent is to keep staging pointed at the same API as preview, just add `"staging"` to the enum without any additional branching — the existing `APP_ENV` check logic can treat `"staging"` identically to `"preview"`.

**Steps:**
1. Open `apps/expo/lib/env.ts`.
2. Find the `APP_ENV` schema line — currently `z.enum(["development", "preview", "production"])`.
3. Change to `z.enum(["development", "staging", "preview", "production"])`.
4. Search codebase for all `env.APP_ENV` comparisons to verify `"staging"` case is handled or falls through correctly.
5. Run `eas build --profile staging` to confirm no Zod parse error in staging.

---

### TASK-C03 — Fix DM reaction `userReacted` always false
**Fixes:** BUG-C03  
**Files:** `apps/expo/app/messages/[conversationId].tsx`

Pass the current user's ID into `mapApiDM` and compute `userReacted` by comparing the API's per-reaction user list (or boolean field from the API) against the authenticated user's ID.

**Steps:**
1. Open `app/messages/[conversationId].tsx` and locate `mapApiDM`.
2. Inspect what the API returns for each reaction object in a real DM response. The API likely returns one of: `user_reacted: boolean`, `has_reacted: boolean`, or `reacted_user_ids: string[]`.
3. Add a `currentUserId: string` parameter to `mapApiDM`.
4. For each reaction, set `userReacted` to: `reaction.user_reacted ?? reaction.has_reacted ?? (reaction.reacted_user_ids ?? []).includes(currentUserId)`.
5. Pass `user?.id ?? ''` as `currentUserId` when calling `mapApiDM`.
6. Test in the DM screen: react to a message, confirm the reaction pill shows as highlighted (active style) for your own reaction.

---

## PHASE 2 — High Priority Fixes

---

### TASK-H04 — Add idempotency guard to deep-link handler
**Fixes:** BUG-H04  
**Files:** `apps/expo/app/auth/login.tsx`

Add a `useRef<boolean>` flag that tracks whether a token exchange is in progress. Check and set this flag at the start of `handleDeepLink`.

**Steps:**
1. In `LoginScreen`, add `const exchangingRef = useRef(false)`.
2. At the top of `handleDeepLink`, add: `if (exchangingRef.current) return; exchangingRef.current = true;`.
3. In the `finally` block (or on error path), reset: `exchangingRef.current = false`.
4. Reset `exchangingRef.current = false` at the start of `handleGoogleLogin` (before opening the browser) so repeated login attempts work.
5. Test on a real Android device: confirm that tapping Google Login, completing OAuth, then navigating to the home screen happens exactly once even if the deep-link fires via both the EventListener and the `result.url` path.

---

### TASK-H05 — Use `crypto.randomUUID()` for optimistic message IDs in rooms
**Fixes:** BUG-H05  
**Files:** `apps/expo/app/rooms/[roomId].tsx`

Replace `` `pending-${Date.now()}` `` with `` `pending-${crypto.randomUUID()}` `` for all optimistic message ID generation.

**Steps:**
1. Open `app/rooms/[roomId].tsx`.
2. Find all occurrences of `` `pending-${Date.now()}` `` (there should be one or two in the send handler / optimistic update logic).
3. Replace with `` `pending-${crypto.randomUUID()}` ``.
4. `crypto.randomUUID()` is available globally in Hermes (Expo SDK 49+) — no import needed.
5. Verify that the `prevMessageIdsRef` deduplication set correctly skips received messages that match the optimistic ID (it compares by `id` — UUIDs will still match correctly).

---

### TASK-H06 — Fix Android keyboard handling across all chat screens
**Fixes:** BUG-H06, BUG-M16 (companion fix)  
**Files:** `apps/expo/app.json`, `apps/expo/app/rooms/[roomId].tsx`, `apps/expo/app/messages/[conversationId].tsx`, `apps/expo/app/guilds/[guildId]/chat.tsx`

Remove the double-adjustment by using `adjustNothing` in the manifest and `behavior="padding"` only on iOS in `KeyboardAvoidingView`.

**Steps:**
1. In `apps/expo/app.json`, change `"softwareKeyboardLayoutMode": "pan"` to `"softwareKeyboardLayoutMode": "adjustNothing"` (or remove the key entirely — Expo SDK 51 defaults to `adjustNothing` for edge-to-edge apps).
2. In all three chat screen files, change the `behavior` prop on `KeyboardAvoidingView` from `Platform.OS === 'ios' ? 'padding' : 'height'` to `Platform.OS === 'ios' ? 'padding' : undefined`. On Android with `adjustNothing`, the KAV should be effectively a passthrough.
3. In `app/rooms/[roomId].tsx`, verify the `keyboardVerticalOffset` computation. The iOS value `insets.top + 44` accounts for the safe area + header height; this is correct for iOS. Android offset should remain 0.
4. Test on a real Android API 36 device: open the keyboard in all three chat screens. Verify the input bar rises above the keyboard without double-shifting. Verify the message list scrolls to the bottom correctly.
5. If manual bottom-padding adjustment is needed on Android with `adjustNothing`, use `react-native-keyboard-controller`'s `useKeyboardAnimation` or the `Keyboard.addListener('keyboardDidShow', ...)` event to animate `paddingBottom` on the container.

---

### TASK-H07 — Fix guild chat scroll-to-bottom on load older messages
**Fixes:** BUG-H07  
**Files:** `apps/expo/app/guilds/[guildId]/chat.tsx`

Remove `onContentSizeChange` and implement controlled scroll-to-bottom only after sending a new message.

**Steps:**
1. Remove the `onContentSizeChange` prop from the `FlatList`.
2. Add a `shouldScrollRef = useRef(false)` flag.
3. In `sendMutation.onSuccess`, set `shouldScrollRef.current = true`.
4. Add `onLayout` to the FlatList: `onLayout={() => { if (shouldScrollRef.current) { flatListRef.current?.scrollToEnd({ animated: true }); shouldScrollRef.current = false; } }}`.
5. Alternatively, convert to an inverted FlatList: set `inverted={true}`, reverse the `allMessages` array before passing to `data`, and change "Load older messages" to call `fetchNextPage` while keeping the inverted scroll anchored to the bottom. An inverted list is the standard chat pattern and eliminates this class of bugs.

---

### TASK-H08 — Add timeout to `signOut` logout fetch
**Fixes:** BUG-H08  
**Files:** `apps/expo/lib/auth/context.tsx`

Wrap the logout `fetch()` in an `AbortController` with a 5-second timeout.

**Steps:**
1. In `lib/auth/context.tsx`, find the `signOut` function.
2. Add: `const controller = new AbortController(); const timeoutId = setTimeout(() => controller.abort(), 5000);`
3. Pass `signal: controller.signal` to the `fetch()` options object.
4. In the `finally` block: `clearTimeout(timeoutId)`.
5. The `catch` block can swallow both network errors and `AbortError` — the fire-and-forget intent means the outcome doesn't matter, but log it for debugging: `console.warn('[auth] signOut request abandoned', err)`.

---

### TASK-H09 — Add timeout to token exchange fetch in deep-link handler
**Fixes:** BUG-H09  
**Files:** `apps/expo/app/auth/login.tsx`

Add a 15-second `AbortController` timeout to the `/api/auth/mobile-token` fetch call in `handleDeepLink`.

**Steps:**
1. In `handleDeepLink`, before the `fetch()` call, create: `const controller = new AbortController(); const timeoutId = setTimeout(() => controller.abort(), 15_000);`
2. Pass `signal: controller.signal` to `fetch()`.
3. In the `try/finally` block, call `clearTimeout(timeoutId)`.
4. In the `catch` block, check for `AbortError` specifically: `if (err instanceof Error && err.name === 'AbortError') { Alert.alert('Login timed out', 'The login link expired. Please try again.'); return; }`
5. Test on a throttled network connection (use Android Studio's network profiler or a network throttle app) to verify the timeout fires and shows the correct message.

---

## PHASE 3 — Security & Build Config Fixes

---

### TASK-S10 — Replace deprecated `username` with `projectId` in expo-updates config
**Fixes:** BUG-M10  
**Files:** `apps/expo/app.json`

Update the `expo-updates` plugin entry in `app.json` to use `projectId` instead of the deprecated `username` field.

**Steps:**
1. In `app.json`, find the plugin entry: `["expo-updates", { "username": "zobia" }]`.
2. Replace with: `["expo-updates", { "projectId": "ad68e531-aa48-4873-8d41-3bca8f18b9a4" }]`.
3. The `projectId` value matches `extra.eas.projectId` already in the file.
4. Run `expo prebuild --clean` and verify no deprecation warnings about `username`.

---

### TASK-S11 — Disable Android automatic backup
**Fixes:** BUG-M11  
**Files:** `apps/expo/app.json`

Add `"allowBackup": false` to the `android` section to prevent Google's automatic backup from capturing app data.

**Steps:**
1. In `app.json` under `"android"`, add: `"allowBackup": false`.
2. If selective backup of truly non-sensitive data (e.g., theme preferences) is needed, create an `android/app/src/main/res/xml/backup_rules.xml` that excludes databases and MMKV files, and reference it via `"android.fullBackupContent"`.
3. Run `expo prebuild` and verify `AndroidManifest.xml` contains `android:allowBackup="false"`.

---

## PHASE 4 — UX & Functional Bug Fixes

---

### TASK-U12 — Reset GIF picker state on modal close (rooms screen)
**Fixes:** BUG-M12  
**Files:** `apps/expo/app/rooms/[roomId].tsx`

Reset GIF search query and results state when the GIF picker modal closes.

**Steps:**
1. Locate the GIF picker modal close handler in `app/rooms/[roomId].tsx`.
2. In the `onRequestClose` callback and in any explicit "close" button `onPress`, add: `setGifQuery(''); setGifResults([]);` (use the actual state setter names from the component).
3. Alternatively, extract the GIF picker into a child component (`GifPickerModal`) so its local state naturally resets when it unmounts. This is the cleaner long-term approach.

---

### TASK-U13 — Unify GIF search query param name
**Fixes:** BUG-M13  
**Files:** `apps/expo/app/messages/[conversationId].tsx`, `apps/expo/app/rooms/[roomId].tsx`

Standardize the GIF search URL parameter name and extract into a shared helper.

**Steps:**
1. Check the backend `/api/gifs/search` route to determine the canonical parameter name (`q` or `query`).
2. Create `apps/expo/lib/api/gifs.ts` with an exported `searchGifs(term: string)` function that uses the canonical parameter name.
3. Replace the inline GIF fetch in both `app/messages/[conversationId].tsx` and `app/rooms/[roomId].tsx` with calls to `searchGifs(term)`.

---

### TASK-U14 — Track SQLite schema version to avoid redundant migrations
**Fixes:** BUG-M14  
**Files:** `apps/expo/lib/offline/sqlite.ts`

Use SQLite's `PRAGMA user_version` to track which migrations have run and skip already-applied migrations.

**Steps:**
1. In `initOfflineDB()`, after opening the DB, read `PRAGMA user_version` to get the current schema version.
2. Define migration steps as an array: `[{ version: 1, sql: 'ALTER TABLE...' }, ...]`.
3. Run only migrations where `migration.version > current_user_version`.
4. After each migration, update `PRAGMA user_version` to the migration's version.
5. On a fresh install, `user_version` is 0 and `CREATE TABLE IF NOT EXISTS` already creates the table with all columns — no migrations need to run. Set `PRAGMA user_version = 3` (or the highest migration version) after `CREATE TABLE` on fresh installs.
6. Remove or guard the three existing `ALTER TABLE` statements behind the version check.

---

### TASK-U15 — Add "Open Settings" button to push notification failure alert
**Fixes:** BUG-M15  
**Files:** `apps/expo/app/_layout.tsx`

Add a second button to the permission-failure alert that opens device Settings directly.

**Steps:**
1. In `app/_layout.tsx`, find the `registerForPushNotifications` failure `Alert.alert(...)` call.
2. Import `Linking` from `react-native`.
3. Change the buttons array from `[{ text: 'OK' }]` to:
   ```
   [
     { text: 'Not now', style: 'cancel' },
     { text: 'Open Settings', onPress: () => Linking.openSettings() }
   ]
   ```
4. Test on Android: deny push notification permission, verify the alert appears with "Open Settings," tap it, verify the app's notification settings page opens.

---

### TASK-U17 — Fix age gate to use exact birthday comparison
**Fixes:** BUG-M17  
**Files:** `apps/expo/app/onboarding/index.tsx`

Replace the year-only age check with a full date comparison that correctly handles users whose birthday hasn't passed yet this year.

**Steps:**
1. In `app/onboarding/index.tsx`, locate the age validation logic.
2. Construct a `Date` object from the user's birth year, birth month, and birth day.
3. Compute the age in full years: subtract the birthday from today, compare the month/day portion to determine if the birthday has passed this year.
4. Change the validation to: `const today = new Date(); const birthday = new Date(birthYear, birthMonth - 1, birthDay); const age = today.getFullYear() - birthday.getFullYear() - (today < new Date(today.getFullYear(), birthday.getMonth(), birthday.getDate()) ? 1 : 0); if (age < MINIMUM_AGE) { showUnderageError(); }`.
5. Update the code comment to accurately describe this as a true birthday check.
6. Test edge cases: Dec 31 birthday user in the first week of January (should fail), Dec 31 birthday user on their actual birthday (should pass).

---

### TASK-U18 — Resolve SwipeDrawer vs Android system back gesture conflict
**Fixes:** BUG-M18  
**Files:** `apps/expo/components/layout/SwipeDrawer.tsx`

Change the drawer trigger from an edge swipe to a visible drag handle, or use a button, to avoid the system gesture conflict zone.

**Steps:**
1. In `SwipeDrawer.tsx`, consider replacing the edge-swipe activation with a visible drag handle widget (a pill/bar at the left edge, outside the 30px system gesture zone).
2. If an edge swipe is required, use `react-native-gesture-handler`'s `GestureDetector` with `simultaneousHandlers` to cooperate with the system gesture recognizer.
3. The most pragmatic fix: raise the activation threshold from 24px to 40px and add a visible tab widget that users tap to open the drawer, making the swipe supplemental rather than the primary interaction.
4. Test on a physical Android device with gesture navigation enabled (swipe navigation, not button navigation) and verify the back gesture works normally while the drawer can still be opened.

---

### TASK-U19 — Guard `prefsStore` MMKV instantiation in i18n module
**Fixes:** BUG-M19  
**Files:** `apps/expo/lib/i18n/index.ts`

Wrap the `prefsStore` construction in error handling so a native bridge failure doesn't crash the JS thread.

**Steps:**
1. In `lib/i18n/index.ts`, replace the top-level `const prefsStore = new MMKV({ id: 'zobia_prefs' });` with a lazy-initialized getter:
   ```ts
   let _prefsStore: MMKV | null = null;
   function getPrefsStore(): MMKV | null {
     if (_prefsStore) return _prefsStore;
     try { _prefsStore = new MMKV({ id: 'zobia_prefs' }); } catch { /* not available yet */ }
     return _prefsStore;
   }
   export const prefsStore = { getString: (key: string) => getPrefsStore()?.getString(key), set: (key: string, value: string) => getPrefsStore()?.set(key, value) };
   ```
2. Update all callers of `prefsStore` to handle `undefined` returns from `getString`.
3. The `resolveLocale` function already has a `try/catch` — ensure it handles the null-store case.

---

### TASK-U20 — Fix GiftSpectacle animation on rapid successive gifts
**Fixes:** BUG-M20  
**Files:** `apps/expo/components/rooms/GiftSpectacle.tsx`

Stop any in-progress animation before resetting animated values and starting new animations.

**Steps:**
1. In `GiftSpectacle.tsx`, add refs to track the running animations: `const animInRef = useRef<Animated.CompositeAnimation | null>(null)` and `const animOutRef = useRef<Animated.CompositeAnimation | null>(null)`.
2. At the start of the data-change `useEffect`, before calling `scaleAnim.setValue` and `opacityAnim.setValue`, call `animInRef.current?.stop()` and `animOutRef.current?.stop()`.
3. Store the result of `Animated.parallel(...)` in `animInRef.current` before calling `.start()`.
4. In `handleDismiss`, store the `Animated.timing(...)` result in `animOutRef.current` before calling `.start()`.
5. Test with two rapid gift sends to the same room and verify the animation transitions cleanly.

---

## PHASE 5 — Low Priority / Code Quality

---

### TASK-L21 — Explicitly register `react-native-google-mobile-ads` in plugins array
**Fixes:** BUG-L21  
**Files:** `apps/expo/app.json`

Add `"react-native-google-mobile-ads"` to the `plugins` array.

**Steps:**
1. In `app.json`, add `"react-native-google-mobile-ads"` to the `plugins[]` array.
2. Keep the `'react-native-google-mobile-ads'` config block in `app.config.ts` — the plugin reads from it.
3. Run `expo prebuild` and verify `AndroidManifest.xml` contains the `<meta-data android:name="com.google.android.gms.ads.APPLICATION_ID" ...>` entry.

---

### TASK-L22 — Replace `setTimeout` scroll in guild chat with controlled scroll
**Fixes:** BUG-L22  
**Files:** `apps/expo/app/guilds/[guildId]/chat.tsx`

Replace the fragile 100ms timeout with an optimistic insert or a scroll triggered by the FlatList's `onScrollToIndexFailed` / post-render callback.

**Steps:**
1. Add a `shouldScrollAfterSendRef = useRef(false)`.
2. In `sendMutation.onSuccess`, set `shouldScrollAfterSendRef.current = true` and `setInputText('')`.
3. Add `onMomentumScrollEnd` or a FlatList render callback that checks `shouldScrollAfterSendRef.current` and scrolls if true.
4. Remove `setTimeout(..., 100)`.
5. Better alternative: add the sent message optimistically to the local `allMessages` array before the server response arrives and scroll immediately.

---

### TASK-L23 — Re-establish IAP listeners on foreground return
**Fixes:** BUG-L23  
**Files:** `apps/expo/app/_layout.tsx`, `apps/expo/lib/payments/googlePlay.ts`

Call `initGooglePlayBilling()` when the app returns to the foreground.

**Steps:**
1. In `app/_layout.tsx`, find the existing `AppState` listener (used for auth refresh on foreground).
2. In the `active` state branch of the AppState change handler, add `initGooglePlayBilling().catch(console.warn)` (Platform.OS === 'android' guard is inside the function so it's safe to call unconditionally).
3. Verify `initGooglePlayBilling` sets `initialised = true` at the top to prevent double-init if already running, and resets to `false` on `endBillingConnection`.
4. Test: start a purchase, background the app, return, verify the purchase listener fires correctly.

---

### TASK-L24 — Verify and document guild chat pagination direction
**Fixes:** BUG-L24  
**Files:** `apps/expo/app/guilds/[guildId]/chat.tsx`

Audit the backend pagination contract and update the UI label and query configuration to match.

**Steps:**
1. Call `GET /guilds/{id}/chat?limit=30` and inspect the response. Note whether the returned messages are the most recent 30, and whether `nextCursor` points to older or newer messages.
2. If `nextCursor` = older messages (correct for a history-scroll chat): keep `fetchNextPage`, the label "Load older messages" is correct. Convert the FlatList to `inverted={true}` so the most recent messages appear at the bottom naturally, and the cursor loads backward into history.
3. If `nextCursor` = newer messages (forward pagination, wrong for chat): switch to `fetchPreviousPage` with `getPreviousPageParam` and restructure the query so the initial load fetches the most recent messages.
4. Add a comment at the `getNextPageParam` definition documenting the direction: `// nextCursor points to older messages — cursor goes backward in time`.

---

## Testing Checklist (Per Phase)

### Phase 1 (Critical)
- [ ] Build production APK, open app — verify real ads load (not test ads with white placeholder)  
- [ ] Run staging EAS build — verify `env.APP_ENV` resolves to `"staging"`, no Zod error  
- [ ] In DM screen, react to a message — verify the reaction pill shows highlighted (active border)

### Phase 2 (High)
- [ ] Trigger Google login on Android, complete OAuth — confirm login happens once, not twice  
- [ ] In rooms chat, send two messages as fast as possible — verify both appear, no duplicate key warning in dev  
- [ ] Open keyboard in rooms, DM, and guild chat on Android API 36 device — verify single clean shift  
- [ ] In guild chat, tap "Load older messages" — verify scroll position stays near old messages, not bottom  
- [ ] Sign out on a throttled (slow 2G) network — verify the app does not hang  
- [ ] Complete Google OAuth on a throttled network — verify timeout alert appears after 15 seconds

### Phase 3 (Security/Config)
- [ ] `expo prebuild` produces no deprecation warnings about `expo-updates` username field  
- [ ] `AndroidManifest.xml` contains `android:allowBackup="false"`  
- [ ] `adb backup` of the app produces an empty backup or is rejected

### Phase 4 (UX)
- [ ] Open GIF picker in rooms, search, close without selecting — reopen, verify empty state  
- [ ] Deny push notification permission — verify alert with "Open Settings" button appears; tapping it opens Android notification settings  
- [ ] Enter birth year of age - 1, same birth month and day as today minus 1 day — verify underage error  
- [ ] Enter birth year of age, but birth month/day not yet passed — verify underage error  
- [ ] Open SwipeDrawer on Android with gesture navigation — verify system back gesture works and drawer opens from handle

---

## Estimated Total Effort

| Phase | Tasks | Estimated Effort |
|-------|-------|-----------------|
| Phase 1 — Critical | 3 | ~2 hours |
| Phase 2 — High | 6 | ~6 hours |
| Phase 3 — Security/Config | 2 | ~1 hour |
| Phase 4 — UX/Functional | 9 | ~8 hours |
| Phase 5 — Low/Code Quality | 4 | ~3 hours |
| **Total** | **24** | **~20 hours** |

---

*Fix plan generated: 2026-06-25 at 10:40 PM*  
*Reference: custom-bugs-report.md — DO NOT fix any bugs until the plan is reviewed and approved.*
