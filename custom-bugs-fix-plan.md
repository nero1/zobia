# Zobia Social — Expo App Bug Fix Plan

**Generated:** June 25, 2026 1:05 PM  
**Scope:** apps/expo (Android primary, API 36 target)  
**Source report:** custom-bugs-report.md (34 bugs, generated same session)

> **DO NOT MERGE THIS PLAN WITH ANY PREVIOUS VERSION.** This is the authoritative replacement.  
> All tasks reference bug codes from the companion report. Fix phases are ordered by severity.  
> Do not begin any fix task until the full plan has been reviewed and approved.

---

## Fix Phase Overview

| Phase | Priority | Bugs | Rationale |
|-------|----------|------|-----------|
| 1 | CRITICAL | BUG-CRIT-01, 02, 03, 04 | Auth is broken, billing is broken, production has test IDs |
| 2 | HIGH | BUG-HIGH-05, 06, 07, 08, 09 | Purchase failures, silent security gaps, push nav broken |
| 3 | MEDIUM | BUG-MED-10–22 | UX/feature gaps: theme, keyboard, Pidgin, dupes, etc. |
| 4 | LOW | BUG-LOW-23–34 | Edge cases, type safety, stale closures, comment accuracy |

---

## Phase 1 — Critical (Fix First, Block Everything Else)

---

### TASK-01 · BUG-CRIT-01 — Fix settings logout to call `signOut()`

**File:** `apps/expo/app/settings/index.tsx`

**Steps:**
1. Import `useAuth` (or `signOut` directly) at the top of the component if not already imported.
2. Inside `handleLogout`, after `await logoutUser()` succeeds, replace `router.replace('/auth/login')` with a call to `signOut()`.
3. Remove the `router.replace` call — auth context navigates to login automatically once `user` becomes null.
4. Verify that `signOut()` in the auth context clears the JWT from SecureStore, clears the React Query cache, and wipes the MMKV store. If it does not already do all three, add those steps to `signOut()` directly.
5. Confirm the app navigates to `/auth/login` after logout without requiring an explicit `router.replace`.

**Effort:** Small — 1–2 file changes  
**Blocks:** TASK-02 benefits from the same `signOut()` review done here

---

### TASK-02 · BUG-CRIT-02 — Fix settings delete-account to call `signOut()`

**File:** `apps/expo/app/settings/index.tsx`

**Steps:**
1. Inside `handleConfirmDelete`, after `await deleteAccount(pin)` succeeds, replace `router.replace('/auth/login')` with `signOut()`.
2. Same reasoning as TASK-01 — let auth context redirect rather than navigating directly.
3. Verify that `signOut()` covers the same teardown checklist noted in TASK-01.

**Effort:** Small — same file as TASK-01, can be done in the same PR  
**Dependency:** Can be batched with TASK-01

---

### TASK-03 · BUG-CRIT-03 — Fix Google Play Billing lifecycle: reconnect on foreground

**Files:** `apps/expo/app/_layout.tsx`, `apps/expo/app/economy/store.tsx`, `apps/expo/lib/payments/googlePlay.ts`

**Steps:**
1. In `_layout.tsx`, extend the AppState listener to call `initGooglePlayBilling()` when `status === 'active'` (i.e., app returns to foreground). This is the primary fix.
2. Separately (defensive belt-and-suspenders), in `store.tsx`'s `handleBuy` Android coin purchase path, add `await initGooglePlayBilling()` before `purchaseCoins()` — mirrors what the subscription screen already does correctly. (This also resolves BUG-HIGH-09 below; the tasks can be done together.)
3. Confirm that `initGooglePlayBilling()` is idempotent (already returns early if `initialised` is true), so calling it in the `'active'` handler on every foreground is safe.
4. Test the full cycle: open app → go to home screen (background) → return to app → open coin store → purchase successfully completes.

**Effort:** Medium — touches billing lifecycle logic  
**Dependency:** Should be done before or alongside TASK-09 (BUG-HIGH-09)

---

### TASK-04 · BUG-CRIT-04 — Replace test AdMob app IDs with production IDs

**File:** `apps/expo/app.json`

**Steps:**
1. Log in to the AdMob dashboard and register the Zobia Social Android app (and iOS app when applicable).
2. Copy the production `android_app_id` and `ios_app_id` from the AdMob dashboard.
3. Replace the test values `ca-app-pub-3940256099942544~3347511713` (Android) and `ca-app-pub-3940256099942544~1458002511` (iOS) with the real production IDs.
4. Move the test IDs into an EAS build profile environment variable or a dev-only `app.config.js` override so they can still be used in development builds.
5. Rebuild the app (EAS Build) to pick up the new `app.json` values — AdMob app ID is baked in at build time, not runtime.
6. Verify that a production preview build shows real ads in the app.

**Effort:** Small (config change) + administrative (AdMob account setup)  
**Note:** If AdMob account and app are already registered but IDs were never updated, this is a 1-line change.

---

## Phase 2 — High

---

### TASK-05 · BUG-HIGH-05 — Fix booster purchase passing UUID as `boosterType`

**Files:** `apps/expo/app/economy/store.tsx`, server `/economy/store` endpoint (for API schema change)

**Steps:**
1. Confirm with the server team (or review `/economy/store` response schema) what field carries the semantic booster type string (e.g., `'xp_boost'`). It should be a field like `booster.type` or `booster.boosterType` on the `BoosterItem` model.
2. If the field is missing from the server response, add it to the `/economy/store` API endpoint and TypeScript type definitions in `shared/`.
3. In `store.tsx` line 465, change `handleBuyBooster(booster.id, booster.id)` to `handleBuyBooster(booster.id, booster.type)`.
4. Confirm the `BoosterItem` TypeScript interface includes a `type: string` field.
5. End-to-end test: purchase each booster type and verify the server applies the correct booster.

**Effort:** Small–Medium (depends on whether server schema change is needed)

---

### TASK-06 · BUG-HIGH-06 — Fix SQLite encryption key promise not cleared on failure

**File:** `apps/expo/lib/offline/sqlite.ts`

**Steps:**
1. Locate `getOrCreateEncryptionKey()` where `_encKeyPromise` is assigned.
2. After the promise is assigned, attach a `.catch()` handler that resets `_encKeyPromise = null` before re-throwing the error. This ensures the next call retries from scratch rather than returning the cached rejected promise.
3. Optionally add a counter so that if the SecureStore fails more than N times consecutively, the offline queue degrades gracefully (e.g., falls back to unencrypted storage or shows a user-visible error).
4. Test: simulate a SecureStore failure (mock the module to throw on first call), then call `getOrCreateEncryptionKey()` again and confirm it retries successfully on the second call.

**Effort:** Small

---

### TASK-07 · BUG-HIGH-07 — Add missing routes to push notification allowlist

**File:** `apps/expo/app/_layout.tsx`

**Steps:**
1. Audit the server's push notification service for all possible `action` payloads it sends. Confirm the full set of route patterns used.
2. Add to `VALID_PUSH_ROUTES`:
   - `/^\/guilds\/[a-f0-9-]+\/chat$/` (guild chat)
   - `/^\/messages\/group\/[a-f0-9-]+$/` (group messages)
   - Any other action payloads the server sends that are not currently covered.
3. Regression-test all existing routes still pass the allowlist.
4. Test: trigger a push notification for a new guild chat message and confirm tapping it navigates into the correct screen.

**Effort:** Small

---

### TASK-08 · BUG-HIGH-08 — Stop disconnecting billing on `'inactive'` AppState

**File:** `apps/expo/app/_layout.tsx`

**Steps:**
1. Find the AppState listener that calls `disconnectGooglePlayBilling()`.
2. Change the condition from `status === 'background' || status === 'inactive'` to `status === 'background'` only.
3. Confirm that this task is done in the same commit as TASK-03 (the foreground-reconnect fix), since both relate to the same billing lifecycle listener. They can be a single atomic change.
4. Test: open the store screen, pull down the Android notification shade (`'inactive'` fires), release it (`'active'` fires), then attempt a purchase — should succeed without reconnect error.

**Effort:** Trivial — single-line condition change  
**Dependency:** Bundle with TASK-03 for a single billing lifecycle fix PR

---

### TASK-09 · BUG-HIGH-09 — Add `initGooglePlayBilling()` before coin purchase

**File:** `apps/expo/app/economy/store.tsx`

**Steps:**
1. In `handleBuy` (Android coin purchase path, lines 303–324), add `await initGooglePlayBilling()` immediately before the `purchaseCoins()` call.
2. This mirrors the subscription screen pattern and ensures billing is live regardless of prior lifecycle events.
3. Confirm `initGooglePlayBilling()` is `async` and is properly awaited.
4. Test: background the app, return to foreground, navigate to coin store, complete a purchase.

**Effort:** Trivial  
**Dependency:** Can be bundled with TASK-03

---

## Phase 3 — Medium

---

### TASK-10 · BUG-MED-10 — Add `'pidgin'` to locale checks in Pidgin suggestion utils

**Files:** `apps/expo/lib/i18n/pidgin.ts`, `apps/expo/lib/i18n/pidginEnabled.ts`

**Steps:**
1. In `pidgin.ts` `getPidginSuggestions()`: add `|| locale === 'pidgin'` to the locale check condition.
2. In `pidginEnabled.ts` `isPidginEnabled()`: add `'pidgin'` to the locale array used in `.some()`.
3. Run any existing i18n unit tests. Add a test asserting that `locale === 'pidgin'` triggers both functions correctly.

**Effort:** Trivial  
**Note:** Can be done in the same commit as TASK-14 (missing Pidgin language picker option).

---

### TASK-11 · BUG-MED-11 — Wire user-selected theme preference to `ThemeProvider`

**Files:** `apps/expo/lib/theme/index.tsx`, `apps/expo/app/settings/index.tsx`

**Steps:**
1. When the user selects a theme in settings, persist the selection to MMKV using `setItem(STORE_KEYS.USER_PREFERENCES, { theme: selectedTheme })` (or a dedicated `STORE_KEYS.THEME_PREFERENCE` key if preferred).
2. In `ThemeProvider`, on mount read the stored preference from MMKV synchronously (MMKV reads are synchronous — no async needed).
3. If the stored value is `'light'` or `'dark'`, use that directly regardless of `useColorScheme()`. If it is `'system'` or absent, fall back to `useColorScheme()`.
4. Expose a `setTheme` function from the theme context so the settings screen can update both MMKV and the context on selection, reflecting the change immediately without an app restart.
5. Test: select 'Dark' in settings while device is in light mode — app should switch immediately to dark theme.

**Effort:** Medium

---

### TASK-12 · BUG-MED-12 — Move `setSpectacle()` out of React Query `select` callback

**File:** `apps/expo/app/rooms/[roomId].tsx`

**Steps:**
1. Remove the `setSpectacle(...)` call from inside the `select` callback.
2. In its place, add a `useEffect` that watches the messages query result for new gift messages above the spectacle threshold.
3. Inside the `useEffect`, check if the newest gift message differs from what's currently in `spectacle` (use a ref to track the last-displayed gift message ID to avoid re-triggering on every render).
4. Call `setSpectacle(...)` inside the effect.
5. Remove the `prevMessageIdsRef` mutation that was also inside `select` and move it to the same `useEffect` or to the message-received callback.
6. Verify: spectacle animation fires exactly once per qualifying gift, and does not double-fire on re-renders.

**Effort:** Medium

---

### TASK-13 · BUG-MED-13 — Replace full JWT injection in GameWebView with scoped session token

**Files:** `apps/expo/components/games/GameWebView.tsx`, server-side game session endpoint

**Steps:**
1. Create a new server endpoint (e.g., `POST /games/:gameId/session-token`) that issues a short-lived, scoped token (valid 5 minutes, grants access only to the specific game session, no other API scopes).
2. In `GameWebView`, before rendering, fetch this scoped token via `apiClient.post('/games/{gameId}/session-token')`.
3. Inject the scoped token via `injectedJavaScriptBeforeContentLoaded` instead of the full JWT.
4. Fix the misleading inline comment that says the token is "injected via the URL" — it is injected into `window.__ZOBIA_TOKEN__` via the JS bridge.
5. Ensure the game embed page's server sets a Content-Security-Policy that blocks loading third-party scripts.

**Effort:** Medium–Large (server change required)

---

### TASK-14 · BUG-MED-14 — Add Pidgin to settings language picker

**File:** `apps/expo/app/settings/index.tsx`

**Steps:**
1. In the `LANGUAGES` array, add `{ code: 'pidgin', label: 'Pidgin' }` (consider the display label — 'Pidgin' or 'Naija' depending on branding decision).
2. Confirm that `i18n.changeLanguage('pidgin')` works and loads `locales/pidgin.json` translations.
3. Test: select 'Pidgin' from the language picker and verify UI strings update.

**Effort:** Trivial  
**Note:** Bundle with TASK-10.

---

### TASK-15 · BUG-MED-15 — Remove duplicate session-expired UI

**Files:** `apps/expo/app/auth/login.tsx`, `apps/expo/app/_layout.tsx`

**Steps:**
1. Decide on a single source of truth for session-expired UI. The `SessionExpiredModal` in `_layout.tsx` is the more architecturally correct location (works from any screen, not just login). Recommend keeping it.
2. Remove the inline expired-session banner and its conditional from `auth/login.tsx`.
3. Verify: on session expiry from any screen, only `SessionExpiredModal` appears (once). No duplicate on the login screen.

**Effort:** Small

---

### TASK-16 · BUG-MED-16 — Fix `KeyboardAvoidingView` behavior in rooms screen

**File:** `apps/expo/app/rooms/[roomId].tsx`

**Steps:**
1. Import `Platform` from `react-native` if not already imported.
2. Change `behavior="padding"` to `behavior={Platform.OS === 'ios' ? 'padding' : 'height'}`.
3. Consistent with the pattern already used in `messages/[conversationId].tsx`, `guilds/[guildId]/chat.tsx`, and `messages/group/[groupId].tsx`.
4. Test on Android: open a room, tap the message input, keyboard appears — confirm the input bar is visible above the keyboard.

**Effort:** Trivial

---

### TASK-17 · BUG-MED-17 — Deduplicate pending + server messages in chat screens

**Files:** `apps/expo/app/messages/[conversationId].tsx`, `apps/expo/app/messages/group/[groupId].tsx`

**Steps:**
1. Choose a deduplication strategy. Recommended: include an idempotency key (`clientMessageId`) in the send payload; the server echoes it back in the response and in subsequent poll results. Client filters out pending messages whose `clientMessageId` already exists in the server messages list.
2. Alternatively (client-only approach): when building `combinedMessages`, filter out any pending message where a server message with matching `senderUserId` + `content` + `createdAt` within ±5 seconds already exists in the server list.
3. Apply the same fix to both DM and group chat screens.
4. Test: send a message, watch the combined list — the message should appear once, not twice, even during the period between optimistic add and server confirmation.

**Effort:** Medium (server change preferred; client-only workaround is Medium complexity)

---

### TASK-18 · BUG-MED-18 — Add `'broadcast'` render branch to `MessageBubble`

**File:** `apps/expo/components/rooms/MessageBubble.tsx`

**Steps:**
1. Review what `'broadcast'` message data looks like in the server schema — confirm its shape (e.g., does it have `content`? Does it have a separate `broadcastData` field?).
2. Add a dedicated render branch for `messageType === 'broadcast'`. Style it as a system/announcement message spanning the full width (similar to a "User X joined the room" notification).
3. Ensure the branch handles a `null` or missing `content` field gracefully.
4. Test: trigger a broadcast message in a room and confirm it renders correctly.

**Effort:** Small–Medium

---

### TASK-19 · BUG-MED-19 — Fix stale `t` closure in login screen `handleDeepLink`

**File:** `apps/expo/app/auth/login.tsx`

**Steps:**
1. Wrap `handleDeepLink` in `useCallback` with `[t]` in its dependency array.
2. Add `handleDeepLink` to the `useEffect` dependency array that registers it as the deep-link event listener.
3. The effect will now re-register the listener when `t` changes (locale switch), ensuring the latest translation function is always used.
4. Remove the `eslint-disable-next-line react-hooks/exhaustive-deps` comment if it was added solely to suppress this warning.
5. Test: change locale while on the login screen, then simulate a deep-link event — the error message should be in the new locale.

**Effort:** Small

---

### TASK-20 · BUG-MED-20 — Use stable Play Store product ID for coin pack lookup

**Files:** `apps/expo/app/economy/store.tsx`, server `/economy/store` endpoint

**Steps:**
1. Add a `playStoreProductId` field to the server's coin pack response object (e.g., `{ ..., playStoreProductId: 'com.zobia.coins_100' }`).
2. Update the TypeScript type for `CoinPack` to include `playStoreProductId?: string`.
3. In `handleBuy`, change the lookup from `COIN_PRODUCTS.find((cp) => cp.coins === pack.coinsGranted)` to `COIN_PRODUCTS.find((cp) => cp.id === pack.playStoreProductId)`.
4. Verify that each Play Store product ID in `COIN_PRODUCTS` matches the product ID registered in Google Play Console.

**Effort:** Small–Medium (server schema change required)

---

### TASK-21 · BUG-MED-21 — Verify AASA hosting for iOS universal links

**Files:** `apps/expo/app.json`, Vercel deployment config / `apps/web/public/.well-known/apple-app-site-association`

**Steps:**
1. Fetch `https://zobia.vercel.app/.well-known/apple-app-site-association` and confirm it returns valid JSON with the correct `applinks` configuration pointing to `org.zobia.social`.
2. Confirm the file is served with `Content-Type: application/json` (not `text/plain`).
3. Verify the `paths` array in the AASA file covers the deep-link routes the app handles.
4. If a custom domain (`zobia.app` etc.) is configured, update `associatedDomains` in `app.json` to use it and repeat steps 1–3 for that domain.
5. Use Apple's AASA validation tool to confirm the file is reachable and valid.
6. Rebuild the iOS app with EAS Build after any `app.json` changes.

**Effort:** Small (verification) + potentially Medium (if AASA file needs updating)

---

### TASK-22 · BUG-MED-22 — Add `ACCESS_NETWORK_STATE` permission to Android manifest

**File:** `apps/expo/app.json`

**Steps:**
1. Add `"android.permission.ACCESS_NETWORK_STATE"` to the `android.permissions` array.
2. Optionally add `"android.permission.INTERNET"` (harmless to declare explicitly) and `"android.permission.VIBRATE"` if push notification vibration is used.
3. Rebuild and test on Android: confirm `NetInfo` correctly reports `isInternetReachable` as `true`/`false` rather than `null`.

**Effort:** Trivial

---

## Phase 4 — Low

---

### TASK-23 · BUG-LOW-23 — Verify and fix Telegram bot name

**File:** `apps/expo/app.json`

**Steps:**
1. Log in to the Telegram BotFather account and confirm the exact registered username for the Zobia bot.
2. Update `extra.telegramBotName` to match the confirmed username (without `@` prefix).
3. Test the Telegram OAuth deep link (`https://t.me/${telegramBotName}?start=...`) end-to-end in a preview build.

**Effort:** Trivial (administrative verification)

---

### TASK-24 · BUG-LOW-24 — Clear `sessionExpired` flag in `signOut()`

**File:** `apps/expo/lib/auth/context.tsx`

**Steps:**
1. In the `signOut()` function body, add `setSessionExpired(false)` (or however the flag is reset in that context).
2. Confirm the fix applies after TASK-01/02 (which now call `signOut()` from settings), closing the potential ghost-modal loop.

**Effort:** Trivial  
**Dependency:** Best done after TASK-01 and TASK-02.

---

### TASK-25 · BUG-LOW-25 — Clear `FloatingNotificationProvider` timeouts on unmount

**File:** `apps/expo/components/providers/FloatingNotificationProvider.tsx`

**Steps:**
1. Create a ref (e.g., `timeoutIdsRef = useRef<ReturnType<typeof setTimeout>[]>([])`) to collect timeout IDs.
2. Wrap each `setTimeout` call to push the returned ID into the ref array.
3. In a `useEffect` with empty deps, return a cleanup function that calls `clearTimeout(id)` for every ID in the array.
4. Alternatively, if the notification logic can be rewritten as a single `useEffect` per event type (with proper deps), that is the cleaner solution.

**Effort:** Small

---

### TASK-26 · BUG-LOW-26 — Wire `contentType` to `AnnouncementBanner` background colour

**File:** `apps/expo/components/announcements/AnnouncementBanner.tsx`

**Steps:**
1. Review the `contentType` enum values used by the server (e.g., `'info'`, `'warning'`, `'danger'`, `'success'`).
2. Add a mapping from `contentType` to colour: `'danger'` → `colors.semantic.error` (or equivalent red), `'warning'` → `colors.brand.gold` (or equivalent amber), `'success'` → `colors.semantic.success`, default → `colors.brand.blue`.
3. Replace the hardcoded `bgColor = colors.brand.blue` with the mapped colour.
4. Test: trigger each contentType and confirm the correct colour is shown.

**Effort:** Small

---

### TASK-27 · BUG-LOW-27 — Clear GIF search `debounceRef` on rooms screen unmount

**File:** `apps/expo/app/rooms/[roomId].tsx`

**Steps:**
1. Find the `useEffect` that handles GIF search input.
2. In its cleanup function (the return value), add `if (debounceRef.current) clearTimeout(debounceRef.current)`.
3. Test: type in the GIF search box, immediately navigate away — no state-update-on-unmounted-component warning.

**Effort:** Trivial

---

### TASK-28 · BUG-LOW-28 — Use `i18n.language` in wallet `formatDate`

**File:** `apps/expo/app/economy/wallet.tsx`

**Steps:**
1. Import `useTranslation` (likely already imported in this file) and destructure `i18n`.
2. Change `new Date(ts).toLocaleDateString('en-NG', ...)` to `new Date(ts).toLocaleDateString(i18n.language, ...)`.
3. Test: switch to French locale, view wallet — transaction dates should format in French locale style.

**Effort:** Trivial

---

### TASK-29 · BUG-LOW-29 — Remove `[token]` from AppState listener effect deps in auth context

**File:** `apps/expo/lib/auth/context.tsx`

**Steps:**
1. Move the token value reference inside the AppState listener to a `tokenRef` that is updated via a separate one-liner `useEffect` (with `[token]` deps) that just sets `tokenRef.current = token`.
2. Change the AppState effect's deps from `[token]` to `[]` (mount-only) since it now reads from the stable ref.
3. Confirm: after token rotation, the AppState listener does not re-register. Foreground token refresh still triggers (because the handler reads the current ref value at invocation time).

**Effort:** Small

---

### TASK-30 · BUG-LOW-30 — Fix `refreshAccessToken` TypeScript generic type

**File:** `apps/expo/lib/api/client.ts`

**Steps:**
1. Change the `axios.post` generic from `{ expiresIn: number }` to the correct response shape: `{ accessToken: string; refreshToken?: string; expiresIn: number }`.
2. Remove the `as { accessToken?: string }` and `as { refreshToken?: string }` casts and access the fields directly from `res.data`.
3. Confirm no TypeScript errors after the change.

**Effort:** Trivial

---

### TASK-31 · BUG-LOW-31 — Fix `GiftSpectacle` auto-dismiss stale closure

**File:** `apps/expo/components/rooms/GiftSpectacle.tsx`

**Steps:**
1. Add a `handleDismissRef = useRef(handleDismiss)` and update it on every render: `useEffect(() => { handleDismissRef.current = handleDismiss; })`.
2. Change the `setTimeout` body from calling `handleDismiss()` to calling `handleDismissRef.current()`.
3. This ensures the timer always invokes the latest `onDismiss` prop, not the version closed over at mount.

**Effort:** Trivial

---

### TASK-32 · BUG-LOW-32 — Simplify two-factor screen submit button disabled condition

**File:** `apps/expo/app/auth/two-factor.tsx`

**Steps:**
1. Change `disabled={loading || code.length !== 6 || !!error && code.length !== 6}` to `disabled={loading || code.length !== 6}`.
2. If there is a design intent to allow re-submitting when an error exists and 6 digits are entered, reconsider the logic — but the current code does not implement that intent anyway.

**Effort:** Trivial

---

### TASK-33 · BUG-LOW-33 — Fix `MAX_RETRIES` naming vs loop behaviour in `apiFetch`

**File:** `apps/expo/lib/api/apiFetch.ts`

**Steps:**
1. Choose one of the two consistent options:
   - **Option A:** Rename to `MAX_ATTEMPTS = 4` and change loop to `attempt < MAX_ATTEMPTS` (0, 1, 2, 3 = 4 attempts).
   - **Option B:** Keep `MAX_RETRIES = 3` and change loop to `attempt < MAX_RETRIES` with attempt starting at 1 (1 initial + 3 retries = 4 total, clearly named).
2. Add a brief comment above the constant explaining the convention chosen.

**Effort:** Trivial

---

### TASK-34 · BUG-LOW-34 — Fix Telegram OAuth backoff comment accuracy

**File:** `apps/expo/app/auth/login.tsx`

**Steps:**
1. Calculate the actual backoff curve: attempt 0 = 500ms, 1 = 500ms, 2 = 500ms, 3 = 1000ms, 4 = 2000ms, ... (depends on exact formula) — work out the actual values.
2. Update the comment above `scheduleNext` to accurately describe the curve, e.g., "Exponential backoff: 500ms, 500ms, 1s, 2s, 4s, ... capped at 16s."
3. If the intent was 2s first delay, adjust the formula accordingly (e.g., change `Math.max(0, attempt - 2)` to `Math.max(0, attempt - 1)`).

**Effort:** Trivial

---

## Suggested PR / Commit Groupings

To make review manageable, batch fixes into these logical PRs:

| PR | Tasks | Label |
|----|-------|-------|
| PR-1 | TASK-01, TASK-02, TASK-24 | `fix/auth-logout-teardown` |
| PR-2 | TASK-03, TASK-08, TASK-09 | `fix/billing-lifecycle` |
| PR-3 | TASK-04 | `fix/admob-production-ids` |
| PR-4 | TASK-05, TASK-20 | `fix/purchase-product-mapping` |
| PR-5 | TASK-06 | `fix/sqlite-enc-key-retry` |
| PR-6 | TASK-07, TASK-22 | `fix/android-permissions-push-allowlist` |
| PR-7 | TASK-10, TASK-14 | `fix/pidgin-locale-support` |
| PR-8 | TASK-11 | `fix/theme-preference-wiring` |
| PR-9 | TASK-12, TASK-27 | `fix/rooms-select-sideeffect-gif-cleanup` |
| PR-10 | TASK-13 | `fix/gamewebview-scoped-token` |
| PR-11 | TASK-15, TASK-16, TASK-17, TASK-18, TASK-19 | `fix/chat-ux-improvements` |
| PR-12 | TASK-21 | `fix/ios-universal-links-aasa` |
| PR-13 | TASK-23 | `fix/telegram-bot-name` |
| PR-14 | TASK-25–34 | `fix/low-priority-cleanup` |

---

## Testing Checklist (Post-Fix Verification)

- [ ] Logout clears JWT, React Query cache, and MMKV; app navigates to login; re-opening app shows login screen
- [ ] Delete account follows the same teardown path; `sessionExpired` is false after re-login
- [ ] Background app → foreground → open coin store → complete purchase (no billing failure)
- [ ] Pull notification shade → release → open store → complete purchase (billing not killed by `'inactive'`)
- [ ] Subscribe to premium while billing was previously disconnected — succeeds
- [ ] Booster purchase applies the correct booster type on the server
- [ ] Tap a push notification for guild chat → navigates into guild chat screen (not home)
- [ ] Tap a push notification for group message → navigates into group message screen
- [ ] SQLite enc key failure on first attempt → next message queue attempt succeeds
- [ ] Pidgin locale selected → autocomplete suggestions appear
- [ ] Theme set to 'Dark' on light-mode device → app renders dark immediately
- [ ] Room screen on Android: tap message input → keyboard does not cover the input bar
- [ ] Send a message quickly followed by a poll → message appears once only
- [ ] Broadcast message in room renders in a dedicated system message style
- [ ] AdMob shows real ads in a production build (not test ads)
- [ ] iOS universal links: open `https://zobia.vercel.app/rooms/xyz` from Notes → opens in app
- [ ] Wallet screen date formatting matches selected locale

---

*Plan generated: June 25, 2026 1:05 PM*  
*Zobia Social — Expo App Bug Fix Plan*  
*Reference: custom-bugs-report.md (34 bugs, June 25, 2026 12:43 PM)*
