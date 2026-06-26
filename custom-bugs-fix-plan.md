# Zobia Expo App — Bug Fix Plan

> **Reference:** All bugs described here correspond to entries in `custom-bugs-report.md`.
> Fixes are ordered by severity (critical → high → medium → low).
> **Do not begin any fix until the report has been reviewed and confirmed.**

---

## Priority 1 — Critical / Showstoppers (fix before next release)

### Task 1 — Fix EAS_PROJECT_ID in All Build Profiles [BUG-SEC-01 / BUG-HARD-04]

**Why:** Push notifications are completely non-functional in all EAS builds (including production) because `'YOUR_EAS_PROJECT_ID'` ships as the project ID. Every push token registration fails silently.

**Steps:**
1. In the EAS dashboard for the `nero1/zobia` project, copy the actual EAS Project ID (UUID format).
2. Add it as an EAS secret named `EAS_PROJECT_ID`.
3. Edit `apps/expo/eas.json` — add `"EAS_PROJECT_ID": "$EAS_PROJECT_ID"` to the `env` block of every build profile (`development`, `preview`, `staging`, `production`).
4. Verify `apps/expo/app.config.ts` already reads `process.env.EAS_PROJECT_ID` (it does). The fallback string `'YOUR_EAS_PROJECT_ID'` will now only appear in bare local `expo start` runs where `EAS_PROJECT_ID` is not set, which is acceptable.
5. Trigger a fresh build for the `development` profile and confirm `Constants.expoConfig.extra.eas.projectId` equals the real UUID.

**Files:** `apps/expo/eas.json`

---

### Task 2 — Fix Notification Rows Not Tappable [BUG-UX-01]

**Why:** The notifications screen is a core feature; tapping a notification with no action is a severe UX regression that users will immediately notice.

**Steps:**
1. In `apps/expo/app/notifications/index.tsx`, change `NotifRow` from rendering a `View` to a `Pressable`.
2. Add an `onPress` prop to `NotifRow` and implement a `getNotificationRoute(notif: AppNotification): string | null` helper:
   - `'dm'` / `'new_message'` → `/messages/${payload.conversationId}`
   - `'guild_war'` / `'guild_low_contribution'` → `/guilds/${payload.guildId}`
   - `'gift'` / `'gift_received'` → `/economy/wallet`
   - `'friend'` / `'friend_request'` → `/profile/${payload.senderId}`
   - `'mention'` / `'room'` → `/rooms/${payload.roomId}`
   - `'rank_up'` / `'prestige_complete'` → `/(tabs)/profile`
   - `'streak_risk'` / `'reengagement'` → `/(tabs)`
   - All others → `null` (no navigation)
3. In the `onPress` handler:
   - If `getNotificationRoute` returns a non-null path, call `router.push(path)`.
   - Fire `PATCH /notifications/${notif.id}/read` (or a batch read endpoint) to mark the notification as read.
   - Invalidate `['notifications']` query after the PATCH.
4. If the API does not yet have a per-notification read endpoint, keep the `POST /notifications/read-all` approach but fire it when entering the screen (not only on button press).

**Files:** `apps/expo/app/notifications/index.tsx`

---

## Priority 2 — High Severity (fix in the same release cycle)

### Task 3 — Secure Email Change With Verification Flow [BUG-SEC-02 / BUG-HARD-01]

**Why:** Email can be changed with zero verification, enabling account takeover via device access.

**Steps:**
1. Remove `email` from the inline `onEndEditing` PATCH in `settings/index.tsx`. Render the email field as read-only text (not a `TextInput`).
2. Add a "Change Email" chevron row that navigates to a new screen `/settings/change-email`.
3. Create `apps/expo/app/settings/change-email.tsx`:
   - Fields: current password, new email, confirm new email.
   - On submit, call `POST /auth/change-email` with `{ currentPassword, newEmail }`.
   - Display a success banner: *"A verification link has been sent to [newEmail]. Click the link to confirm the change."*
   - The actual email update in the DB only happens after the server verifies the emailed token (handled server-side).
4. Update the API route (`POST /api/auth/change-email`) to send a verification email and only persist the change on the verification callback.

**Files:** `apps/expo/app/settings/index.tsx`, `apps/expo/app/settings/change-email.tsx` (new), backend route

---

### Task 4 — Add Exponential Backoff to TOTP and Standardize All PIN Lockouts [BUG-BF-01 / BUG-BF-02 / BUG-BF-03]

**Why:** Three different lockout implementations with inconsistent windows. Gift-send and settings PIN are weaker than the store PIN.

**Steps:**
1. Create `apps/expo/lib/hooks/usePinRateLimit.ts`:
   ```typescript
   export function usePinRateLimit(keys: { attempts: string; lockedUntil: string; lockCount: string }) {
     // - Read failedAttempts, lockedUntil, lockoutCount from MMKV on mount
     // - Expose: { isLocked, remainingMs, recordFailure(), resetAttempts() }
     // - recordFailure() increments count; on >= MAX_ATTEMPTS:
     //     lockoutMs = Math.min(30 * 60_000 * Math.pow(2, lockoutCount), 24 * 60 * 60_000)
     //     set MMKV lockedUntil, increment lockCount, reset attempts to 0
     // - resetAttempts() clears all three MMKV keys
   }
   ```
2. Add to `STORE_KEYS` in `lib/offline/store.ts`:
   ```
   SETTINGS_PIN_ATTEMPTS: 'settings_pin_failed_attempts',
   SETTINGS_PIN_LOCKED_UNTIL: 'settings_pin_locked_until',
   SETTINGS_PIN_LOCKOUT_COUNT: 'settings_pin_lockout_count',
   TOTP_LOCKOUT_COUNT: 'totp_lockout_count',
   GIFT_PIN_LOCKOUT_COUNT: 'gift_pin_lockout_count',
   ```
3. Replace the manual rate-limit logic in `app/auth/two-factor.tsx`, `app/economy/gift-send.tsx`, `app/economy/store.tsx`, and `app/settings/pin.tsx` with calls to `usePinRateLimit()`.
4. In `app/auth/two-factor.tsx`, add a `useEffect` that sets a countdown timer when `isLocked` is true and displays the remaining seconds.
5. Verify all flows produce the same lockout progression: `15 min → 30 min → 1 h → 2 h → ... → 24 h max`.
6. Remove the raw string constants from `settings/pin.tsx` and use `STORE_KEYS.SETTINGS_PIN_ATTEMPTS` etc.

**Files:** `apps/expo/lib/hooks/usePinRateLimit.ts` (new), `apps/expo/lib/offline/store.ts`, `apps/expo/app/auth/two-factor.tsx`, `apps/expo/app/economy/gift-send.tsx`, `apps/expo/app/economy/store.tsx`, `apps/expo/app/settings/pin.tsx`

---

### Task 5 — Register Settings PIN MMKV Keys in STORE_KEYS Registry [BUG-SEC-06]

*(This is partially addressed in Task 4 above. If Task 4 is deferred, do this as a standalone fix.)*

**Steps:**
1. Add `SETTINGS_PIN_ATTEMPTS` and `SETTINGS_PIN_LOCKED_UNTIL` to `STORE_KEYS` in `lib/offline/store.ts`.
2. Update `settings/pin.tsx` to use `STORE_KEYS.SETTINGS_PIN_ATTEMPTS` and `STORE_KEYS.SETTINGS_PIN_LOCKED_UNTIL` instead of the raw string literals.

**Files:** `apps/expo/lib/offline/store.ts`, `apps/expo/app/settings/pin.tsx`

---

### Task 6 — Fix TOTP Locked-Out State Auto-Reset + Countdown [BUG-UX-02 / BUG-HARD-03]

*(If Task 4 is completed first, this is already covered by the usePinRateLimit hook. If not, implement standalone:)*

**Steps:**
1. In `app/auth/two-factor.tsx`, add a `useEffect` that fires when `lockedOut` becomes true:
   ```typescript
   useEffect(() => {
     if (!lockedOut) return;
     const until = storage.getNumber(STORE_KEYS.TOTP_LOCKED_UNTIL) ?? 0;
     const remaining = until - Date.now();
     if (remaining <= 0) { setLockedOut(false); return; }
     const timer = setTimeout(() => setLockedOut(false), remaining);
     return () => clearTimeout(timer);
   }, [lockedOut]);
   ```
2. Add a `remainingSeconds` state that counts down from `remaining / 1000` using a 1-second `setInterval`, cleared when `lockedOut` becomes false.
3. Display the countdown in the UI: *"Try again in 14:32"*.

**Files:** `apps/expo/app/auth/two-factor.tsx`

---

### Task 7 — Fix `change-password.tsx` Wrong Button Prop [BUG-UX-03]

**Steps:**
1. In `apps/expo/app/settings/change-password.tsx` line ~164, change `title={t(...)}` to `label={t(...)}`.
2. Verify the `Button` component's TypeScript interface accepts `label: string` (not `title`).

**Files:** `apps/expo/app/settings/change-password.tsx`

---

### Task 8 — Fix Onboarding Loop on 4xx from `/onboarding/complete` [BUG-UX-06]

**Steps:**
1. In `apps/expo/app/onboarding/welcome-drop.tsx`, update the `.catch()` handler:
   - Extract the HTTP status from the error.
   - For **409 Conflict** (username taken): navigate back to `/onboarding` with an error param so step 1 shows *"That username is already taken"*.
   - For **other 4xx** (validation, bad request): write `STORE_KEYS.ONBOARDING_COMPLETE = true` and clear the draft, then let the user proceed. The server will handle partial profile completion on next login.
   - For **5xx / network** errors: keep the error banner and a "Retry" button that re-fires the POST.
2. Add a Retry button to the error banner UI.
3. Disable the "Start exploring" CTA while the POST is in-flight (`isSubmitting` state).

**Files:** `apps/expo/app/onboarding/welcome-drop.tsx`

---

### Task 9 — Fix `handleSubscribe` Stale Closure on `currentTier` [BUG-DATA-01]

**Steps:**
1. In `apps/expo/app/settings/subscription.tsx`, add `currentTier` to the `useCallback` dependency array of `handleSubscribe`:
   ```typescript
   const handleSubscribe = useCallback(
     async (plan) => { ... },
     [queryClient, isAnnual, currentTier] // add currentTier
   );
   ```
   Alternatively, use a ref:
   ```typescript
   const currentTierRef = useRef(currentTier);
   useEffect(() => { currentTierRef.current = currentTier; }, [currentTier]);
   ```
   And read `currentTierRef.current` inside the callback.

**Files:** `apps/expo/app/settings/subscription.tsx`

---

## Priority 3 — Medium Severity (fix in next sprint)

### Task 10 — Add Cursor-Based Pagination to Notifications [BUG-DATA-02 / BUG-PERF-01]

**Steps:**
1. Update the backend `GET /api/notifications` endpoint to accept `?cursor=<notifId>&limit=50` and return `{ notifications: [...], nextCursor: string | null }`.
2. In `apps/expo/app/notifications/index.tsx`, replace `useQuery` with `useInfiniteQuery`:
   ```typescript
   useInfiniteQuery({
     queryKey: ['notifications'],
     queryFn: ({ pageParam }) => fetchNotifications(pageParam),
     getNextPageParam: (last) => last.nextCursor ?? undefined,
   });
   ```
3. Add `onEndReached={() => fetchNextPage()}` to the `FlatList`.
4. Flatten pages: `data?.pages.flatMap((p) => p.notifications) ?? []`.
5. Update `fetchNotifications` to accept an optional cursor parameter.

**Files:** `apps/expo/app/notifications/index.tsx`, backend notification route

---

### Task 11 — Validate GIF URLs Against Allowlist [BUG-SEC-04]

**Steps:**
1. Create `apps/expo/lib/utils/mediaUrl.ts`:
   ```typescript
   const GIF_CDN_ALLOWLIST = ['media.giphy.com', 'media.tenor.com', 'media1.giphy.com', 'media2.giphy.com'];
   export function isTrustedGifUrl(url: string): boolean {
     try {
       const { hostname } = new URL(url);
       return GIF_CDN_ALLOWLIST.some((h) => hostname === h || hostname.endsWith('.' + h));
     } catch { return false; }
   }
   ```
2. In `app/rooms/[roomId].tsx` and `app/messages/[conversationId].tsx`, call `isTrustedGifUrl(gifUrl)` before adding the GIF to the message payload. If the check fails, show an error alert and prevent sending.
3. On the backend, enforce the same allowlist before any outbound fetch of GIF URLs (server-side is mandatory; client-side is defense-in-depth).

**Files:** `apps/expo/lib/utils/mediaUrl.ts` (new), `apps/expo/app/rooms/[roomId].tsx`, `apps/expo/app/messages/[conversationId].tsx`

---

### Task 12 — Chunk Contacts Upload [BUG-DATA-03]

**Steps:**
1. In `apps/expo/app/onboarding/index.tsx` `handleFindFriends()`, replace the single-request POST with chunked batches:
   ```typescript
   const BATCH_SIZE = 500;
   let anySuccess = false;
   for (let i = 0; i < numbers.length; i += BATCH_SIZE) {
     const batch = numbers.slice(i, i + BATCH_SIZE);
     try {
       await apiClient.post('/friends/contacts-check', { phoneNumbers: batch });
       anySuccess = true;
     } catch {
       // log but continue with next batch
     }
   }
   setContactsStatus(anySuccess ? 'done' : 'unavailable');
   ```
2. This also fixes **BUG-UX-04** (misleading error message) since `'unavailable'` now only fires when all batches fail, which indicates a genuine network problem rather than a permission issue.

**Files:** `apps/expo/app/onboarding/index.tsx`

---

### Task 13 — Fix Personalized Ads Respecting UMP Consent [BUG-SEC-03]

**Steps:**
1. In `apps/expo/lib/ads/admob.ts`, after the UMP consent flow, store the consent outcome:
   ```typescript
   let _personalizedAdsEnabled = false;
   // After AdsConsent.showForm() or checking status:
   if (consentInfo.status === AdsConsentStatus.OBTAINED) {
     _personalizedAdsEnabled = true;
   }
   ```
2. In `loadRewardedAd()` and `loadInterstitialAd()`, use the stored flag:
   ```typescript
   requestNonPersonalizedAdsOnly: !_personalizedAdsEnabled,
   ```
3. Export `export function isPersonalizedAdsEnabled(): boolean { return _personalizedAdsEnabled; }` for any component that needs to know.

**Files:** `apps/expo/lib/ads/admob.ts`

---

### Task 14 — Fix Subscription Price Display for Non-NGN Users [BUG-FIN-01]

**Steps:**
1. In `apps/expo/app/settings/subscription.tsx`, when `liveMonthlyPrices` or `liveAnnualPrices` are empty (fetch not yet complete or failed), display `"—"` as the price and disable the Subscribe button with a loading indicator.
2. Cache the last successful live prices in MMKV (key: `'live_subscription_prices_v1'`) so offline users see the last known price rather than the Naira fallback.
3. Remove the hardcoded Naira price strings from the `PLANS` array or clearly label them as NGN-only fallbacks in a comment.

**Files:** `apps/expo/app/settings/subscription.tsx`

---

### Task 15 — Harden GameWebView postMessage Origin Check [BUG-SEC-05]

**Steps:**
1. In `components/games/GameWebView.tsx`, add a `currentUrlRef` updated by `onNavigationStateChange`:
   ```typescript
   const currentUrlRef = useRef<string>(uri);
   // In JSX:
   onNavigationStateChange={(state) => { currentUrlRef.current = state.url; }}
   ```
2. In `handleMessage`, validate the source before processing:
   ```typescript
   try {
     const msgOrigin = new URL(currentUrlRef.current).origin;
     if (msgOrigin !== gameOrigin) return;
   } catch { return; }
   ```
3. Remove the `/*` suffix from the `originWhitelist` entry so it reads `originWhitelist={[gameOrigin]}`. The `/*` form is a navigation allowlist pattern, not an origin restriction, and is misleading.

**Files:** `apps/expo/components/games/GameWebView.tsx`

---

### Task 16 — Add Rate Limiting on GameWebView Bridge Messages [BUG-ARCH-03]

**Steps:**
1. In `components/games/GameWebView.tsx`, add a message rate tracker:
   ```typescript
   const msgCountRef = useRef(0);
   const msgWindowRef = useRef(Date.now());
   const BRIDGE_MSG_LIMIT = 100; // per second
   const PENALTY_MS = 5_000;
   const penaltyUntilRef = useRef(0);
   ```
2. At the top of `handleMessage`:
   ```typescript
   if (Date.now() < penaltyUntilRef.current) return;
   const now = Date.now();
   if (now - msgWindowRef.current > 1_000) { msgCountRef.current = 0; msgWindowRef.current = now; }
   msgCountRef.current += 1;
   if (msgCountRef.current > BRIDGE_MSG_LIMIT) {
     penaltyUntilRef.current = now + PENALTY_MS;
     return;
   }
   ```

**Files:** `apps/expo/components/games/GameWebView.tsx`

---

## Priority 4 — Low Severity / Code Quality (fix in a maintenance sprint)

### Task 17 — Fix `formatTime` NaN Guard in Notifications [BUG-HARD-02]

1. In `app/notifications/index.tsx`, update `formatTime`:
   ```typescript
   function formatTime(iso: string): string {
     if (!iso) return '';
     const ts = new Date(iso).getTime();
     if (isNaN(ts)) return '';
     const diff = Date.now() - ts;
     if (diff < 0) return 'just now';
     const m = Math.floor(diff / 60_000);
     // ... rest of logic
   }
   ```

**Files:** `apps/expo/app/notifications/index.tsx`

---

### Task 18 — Replace `react-native` `Image` with `expo-image` in Rooms Screen [BUG-PERF-03]

1. In `apps/expo/app/rooms/[roomId].tsx`, replace `import { ..., Image, ... } from 'react-native'` with `import { Image } from 'expo-image'` for GIF thumbnail usage.
2. Adjust any props that differ between the two APIs (mainly `source` format is compatible; `resizeMode` becomes `contentFit`).

**Files:** `apps/expo/app/rooms/[roomId].tsx`

---

### Task 19 — Consolidate `/manifest` Fetches Under One Query Key [BUG-PERF-02]

1. Create `apps/expo/lib/hooks/useManifest.ts`:
   ```typescript
   interface Manifest { currency: CurrencyConfig; features: FeaturesConfig; ... }
   export function useManifest() {
     return useQuery<Manifest>({ queryKey: ['manifest'], queryFn: fetchManifest, staleTime: 5 * 60_000 });
   }
   export function useCurrency() {
     const { data } = useManifest();
     return data?.currency ?? DEFAULTS;
   }
   export function useFeatureFlags() {
     const { data } = useManifest();
     return data?.features ?? { pidginAutocomplete: false };
   }
   ```
2. Replace `useCurrency` in `lib/hooks/useCurrency.ts` to delegate to `useManifest`.
3. Replace the standalone `manifestFeatures` query in `settings/index.tsx` with `useFeatureFlags()`.
4. Remove the separate `['manifest', 'currency']` and `['manifest', 'features']` query keys everywhere.

**Files:** `apps/expo/lib/hooks/useManifest.ts` (new), `apps/expo/lib/hooks/useCurrency.ts`, `apps/expo/app/settings/index.tsx`

---

### Task 20 — Settings Notifications Send Diff-Only Patch [BUG-UX-07]

1. In `apps/expo/app/settings/index.tsx`, in the outer notification `ToggleRow.onChange` handler, send only the changed key:
   ```typescript
   onChange={(v) => {
     const updated = { ...merged.notifications, [key]: v };
     setSettings((prev) => ({ ...prev, notifications: updated }));
     patchMutation.mutate({ notifications: { [key]: v } }); // diff-only
   }}
   ```
   The server should apply a partial merge to the stored JSON object.

**Files:** `apps/expo/app/settings/index.tsx`

---

### Task 21 — Remove Dead `enter_remove` Step in PIN Screen [BUG-UX-05]

1. In `apps/expo/app/settings/pin.tsx`:
   - Remove `'enter_remove'` from the `Step` type union.
   - Remove the `'enter_remove'` entries from `headings`, `subtext`, and the `advance()` switch.
   - Remove the `removePin` state and `setRemovePin` setter (they are only used in the dead step).
   - In `advance()`, confirm the `step === 'enter_current'` + `mode === 'remove'` path calls `removeMutation` correctly (it does).
2. Audit no other code path sets `step` to `'enter_remove'`.

**Files:** `apps/expo/app/settings/pin.tsx`

---

### Task 22 — Fix RTL Reload on Programmatic Language Change [BUG-MISC-01]

1. In `apps/expo/lib/i18n/index.ts`, update the `languageChanged` handler:
   ```typescript
   i18n.on('languageChanged', (lng) => {
     const wasRTL = I18nManager.isRTL;
     setupRTL(lng);
     if (I18nManager.isRTL !== wasRTL) {
       // RTL state changed — reload to apply native mirroring
       import('expo-updates').then(({ reloadAsync }) => reloadAsync().catch(() => {}));
     }
   });
   ```
2. Remove the duplicate `I18nManager.forceRTL` + `Updates.reloadAsync()` block from `settings/index.tsx` (it becomes redundant) — or keep it as defense-in-depth if the language-change event fires after the settings screen has already applied the change.

**Files:** `apps/expo/lib/i18n/index.ts`, `apps/expo/app/settings/index.tsx`

---

### Task 23 — Fix Contacts Error Message Clarity [BUG-UX-04]

1. In `apps/expo/app/onboarding/index.tsx`, add a third status value:
   ```typescript
   type ContactsStatus = 'idle' | 'loading' | 'done' | 'denied' | 'unavailable' | 'error';
   ```
2. In `handleFindFriends`, if an error is thrown that is not `'permission_denied'`, set `setContactsStatus('error')`.
3. Render a different message for `'error'`: *"Something went wrong checking contacts. You can add friends manually."* vs. `'unavailable'`: *"Contacts access is not available on this device."*

**Files:** `apps/expo/app/onboarding/index.tsx`

---

### Task 24 — Rename Currency Utility Functions [BUG-FIN-02]

*(Low risk, purely cosmetic/architectural)*

1. In `apps/expo/lib/utils/currency.ts`, rename:
   - `koboToNairaStr` → `minorUnitToStr(amount: number, symbol = '₦')`
   - `koboToDecimal` → `minorUnitToDecimal`
   - `koboToNairaInt` → `minorUnitToInt`
2. Update all import sites.
3. Keep backward-compatible re-exports (`export const koboToNairaStr = (n: number) => minorUnitToStr(n, '₦')`) for a transition period to avoid breaking changes.

**Files:** `apps/expo/lib/utils/currency.ts`, and all files that import from it

---

### Task 25 — Consolidate `['user-me-totp']` Query Key [BUG-ARCH-02]

1. In `apps/expo/app/settings/index.tsx`, change the outer `meData` query key from `['user-me-totp']` to `['user-me']` (or another distinct key).
2. Ensure `TwoFactorSection` also reads from the same `['user-me']` key (or reads from `meData` passed as a prop from the parent).
3. This prevents two components sharing a cache entry with different shape expectations.

**Files:** `apps/expo/app/settings/index.tsx`

---

## Summary Table

| # | Bug ID | Severity | Task | Files Changed |
|---|--------|----------|------|---------------|
| 1 | SEC-01 / HARD-04 | **Critical** | Task 1 | `eas.json` |
| 2 | UX-01 | **Critical** | Task 2 | `notifications/index.tsx` |
| 3 | SEC-02 / HARD-01 | High | Task 3 | `settings/index.tsx`, new `change-email.tsx` |
| 4 | BF-01/02/03 | High | Task 4 | 5 files + new `usePinRateLimit.ts` |
| 5 | SEC-06 | High | Task 5 (part of 4) | `store.ts`, `pin.tsx` |
| 6 | UX-02/HARD-03 | High | Task 6 | `two-factor.tsx` |
| 7 | UX-03 | High | Task 7 | `change-password.tsx` |
| 8 | UX-06 | High | Task 8 | `welcome-drop.tsx` |
| 9 | DATA-01 | Medium | Task 9 | `subscription.tsx` |
| 10 | DATA-02/PERF-01 | Medium | Task 10 | `notifications/index.tsx` |
| 11 | DATA-03 | Medium | Task 12 | `onboarding/index.tsx` |
| 12 | SEC-04 | Medium | Task 11 | new `mediaUrl.ts`, rooms, messages |
| 13 | SEC-03 | Medium | Task 13 | `admob.ts` |
| 14 | FIN-01 | Medium | Task 14 | `subscription.tsx` |
| 15 | SEC-05 | Medium | Task 15 | `GameWebView.tsx` |
| 16 | ARCH-03 | Low | Task 16 | `GameWebView.tsx` |
| 17 | HARD-02 | Low | Task 17 | `notifications/index.tsx` |
| 18 | PERF-03 | Low | Task 18 | `rooms/[roomId].tsx` |
| 19 | PERF-02 | Low | Task 19 | `useCurrency.ts`, `settings/index.tsx` |
| 20 | UX-07 | Low | Task 20 | `settings/index.tsx` |
| 21 | UX-05 | Low | Task 21 | `settings/pin.tsx` |
| 22 | MISC-01 | Low | Task 22 | `i18n/index.ts`, `settings/index.tsx` |
| 23 | UX-04 | Low | Task 23 | `onboarding/index.tsx` |
| 24 | FIN-02 | Low | Task 24 | `currency.ts` + call sites |
| 25 | ARCH-02 | Low | Task 25 | `settings/index.tsx` |
