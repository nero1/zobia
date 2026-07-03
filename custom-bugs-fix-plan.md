# Zobia — Custom Bug Fix Plan

**Plan generated:** Friday, July 03, 2026 — 05:05 PM UTC
**Companion to:** `custom-bugs-report.md` (25 confirmed issues, ZSB-01 … ZSB-25)
**Status: NOT STARTED.** Per instructions, none of these fixes have been applied yet — this is a plan for review only.

## Ground rules for whoever implements this

- Reuse existing conventions everywhere — this codebase already has the right patterns in most places; the bugs below are almost all "the pattern wasn't applied here too," not "the pattern doesn't exist."
  - Auth: `apps/android/src/lib/auth/store.ts` (`useAuth`, `setAuth`, `clearAuth`) and `apps/android/src/lib/api/client.ts` (`setCachedToken`, `onUnauthenticated`, `refreshAccessToken`) are the only places token/session state should be touched.
  - Cache invalidation: `qc.invalidateQueries({ queryKey: [...] })` after a mutation's `onSuccess`, exactly as already done in `routes/quests.tsx`-style screens, `routes/friends.tsx`, `routes/stickers.tsx`, etc.
  - i18n: `useTranslation()` + `t('namespace.key', 'English fallback')`, keys added to **all nine** `shared/i18n/locales/*.json` files (en, fr, ar, ha, sw, am, zu, pt, pidgin) — never just `en.json`.
  - Toasts: the `toast`/`setTimeout(() => setToast(null), 3500)` pattern already used in `routes/classroom.tsx` and `routes/admin/kyc.tsx` (`AdminToast`).
  - Deep-link route allowlisting: `isAllowedRoute()` / `VALID_PUSH_ROUTES` in `lib/push/index.ts` is the existing pattern for "server-controlled data must resolve to a safe in-app route" — reuse it, don't invent a second allowlist.
- Do not touch anything under `apps/expo` — it's discontinued and out of scope.
- Every fix below should ship with (at minimum) a manual verification pass in the Android emulator or a Vitest unit test where one already exists for the touched file (`__tests__` folders already exist next to `lib/api/client.ts`, `lib/push/index.ts`, `lib/deeplinks/referral.ts` — add cases there rather than creating new test files/locations).
- Work through phases in order — Phase 1 fixes the two most severe items and unblocks safe testing of Phase 2/3 (e.g. you don't want to be testing push-token re-registration while session recovery is still broken).

---

## Phase 1 — Critical / high severity (do first, ship independently if needed)

### Task 1.1 — Fix ZSB-02: Web Creator Dashboard field-name mismatch (crash)
- **Files:** `apps/web/app/(app)/creator/page.tsx`, `apps/web/app/api/creator/dashboard/route.ts`
- **Steps:**
  1. Decide the direction: either (a) fix the web page to read the API's real shape (`revenue.week`/`revenue.month`/`revenue.byStream`/`members.total`/`members.active`/`topGifters[].user_id`/`avatar_emoji`/`total_coins`, and drop/rebuild the `RevenueChart`/`dailyRevenue`/`payoutBalance` UI against what the route actually returns), or (b) extend the API route to also return `dailyRevenue`, `revenueStreams` (as an array, matching what the page expects), `totalMembers`, `activeMembersPct`, and `payoutBalance` if that richer UI is wanted.
  2. Cross-check `apps/android/src/routes/creator/index.tsx` — it already implements the correct-shape version; use it as the reference contract for option (a).
  3. Add a lightweight contract test (e.g. a Jest test asserting the API route's response against a Zod schema, and the page's expected-shape type against the same schema) so this specific class of bug — client and server independently hand-typing the same payload — can't silently reappear.
- **Verify:** Load `/creator` as a seeded creator user locally; confirm no console error and that revenue/members/payout sections render real numbers.

### Task 1.2 — Fix ZSB-01: Register screen's insecure OAuth callback scheme
- **Files:** `apps/android/src/routes/auth/register.tsx`, `apps/android/src/routes/auth/login.tsx`, ideally `apps/android/src/lib/deeplinks/routes.ts`
- **Steps:**
  1. Extract the callback-URL construction from `login.tsx` (`` `${env.VITE_WEB_BASE_URL.replace(/\/$/, '')}/auth/callback` ``) into a shared helper in `lib/deeplinks/routes.ts` (e.g. `export const OAUTH_CALLBACK_LINK = universalLink('/auth/callback');`).
  2. Import and use that same constant in both `login.tsx` and `register.tsx`, deleting `register.tsx`'s local `zobia://auth/callback` constant.
  3. Confirm `__root.tsx`'s `appUrlOpen` handler still accepts both forms (it already does — no change needed there), so this is purely a "stop shipping the fallback as primary" fix.
- **Verify:** Full Google/Telegram sign-up flow on a fresh test account through Register; confirm the flow completes and the returned URL in logcat is the `https://` App Link, not `zobia://`.

### Task 1.3 — Fix ZSB-03 + ZSB-08: Wire up session-death recovery
- **Files:** `apps/android/src/lib/api/client.ts`, `apps/android/src/lib/api/apiFetch.ts`, `apps/android/src/lib/auth/store.ts`
- **Steps:**
  1. In `client.ts`'s response interceptor, add `setCachedToken(null)` in the refresh-failed branch, right alongside the existing `Preferences.remove(...)` calls.
  2. In `store.ts`'s `AuthProvider`, subscribe once via `useEffect` to `onUnauthenticated(() => { void clearAuth(); })` (import `onUnauthenticated` from `lib/api/client.ts`). Do NOT navigate from inside the store — `AuthGuard`'s existing `!token` effect will already redirect to `/auth/login` once `clearAuth()` flips `token` to `null`.
  3. In `apiFetch.ts`'s 401-refresh-failed branch (where it currently does `return response;`), also call `setCachedToken(null)` before returning, so both token paths agree. Do not duplicate the "who tells the UI" logic here — `apiFetch` calls already go through the same `_cachedToken`/Preferences state `client.ts` owns, so clearing it there is sufficient; the `onUnauthenticated` subscriber from step 2 will still catch it on the next `apiClient` call, or add a second, explicit call to the same notify function if `apiFetch` needs to react immediately.
  4. Add a unit test to `lib/api/__tests__/client.test.ts` asserting that a failed refresh clears `getCachedToken()` and fires the `onUnauthenticated` callback exactly once.
- **Verify:** Manually expire/revoke a test refresh token server-side, confirm the app redirects to login within one API call instead of silently failing forever.

### Task 1.4 — Scope and fix ZSB-04: Auth-less browser hand-offs
- **Files:** `apps/android/src/routes/kyc.tsx`, `routes/ads/index.tsx`, `routes/creator/bank-account.tsx`, `routes/creator/wallet.tsx`, `routes/games/$slug.tsx`, `routes/games/saved.tsx`, `routes/admin/users.tsx`; new: a bridge endpoint under `apps/web/app/api/auth/mobile-bridge/route.ts` (naming to match the existing `apps/web/app/api/auth/mobile-token/route.ts` convention)
- **Steps:**
  1. Add `POST /api/auth/mobile-bridge` (authenticated via the existing Bearer-token `withAuth` middleware, same as every other authenticated Android-facing route) that mints a short-lived (60–120s), single-use, random code stored in Redis mapped to the caller's user id — same TTL/one-shot pattern already used for the pre-auth 2FA token (`lib/auth/session.ts`/`redis` usage in `app/api/auth/2fa/verify/route.ts` is a good reference).
  2. Add `GET /api/auth/mobile-bridge/consume?code=...` (no auth required — the code itself is the credential) that looks up the code, deletes it (single-use), and — if valid — sets the same `accessCookie`/`refreshCookie` HttpOnly session cookies the web OAuth flow sets (reuse `buildCookieHeaders` from `lib/auth/session.ts`), then redirects to the originally-requested path.
  3. On the Android side, add a small helper (`lib/deeplinks/bridge.ts`) with `async function openAuthenticatedWebLink(path: string)` that calls the new mint endpoint via `apiClient`, then `Browser.open({ url: universalLink(`/api/auth/mobile-bridge/consume?code=${code}&redirect=${encodeURIComponent(path)}`) })`. Replace every plain `Browser.open({ url: universalLink(...) })` call in the six files above with this helper.
  4. Rate-limit the mint endpoint the same way `enforceRateLimit` is used elsewhere (e.g. `RATE_LIMITS.apiWrite`-style limit) to prevent abuse.
- **Verify:** From a real device/emulator, tap "Verify identity (KYC)" and "Manage on web" (bank account) while logged in only via the Android app (no prior browser session); confirm the Custom Tab lands on the actual feature, not the login page.

### Task 1.5 — Fix ZSB-05: Push token lifecycle across account switches
- **Files:** `apps/android/src/lib/push/index.ts`, `apps/android/src/lib/auth/store.ts`, new: `apps/web/app/api/users/push-token/route.ts` (add `DELETE`)
- **Steps:**
  1. Add a `DELETE /api/users/push-token` handler to the existing route file, deleting the row for `(auth.user.sub, body.token)` — same `withAuth`/`validateBody`/`enforceRateLimit` scaffolding already in that file's `POST` handler.
  2. Export a `resetPushInitState()` from `lib/push/index.ts` that sets the module-level `initialized`/`foregroundRetryAttached` flags back to `false`, and export the last-registered token (cache it in the module alongside `initialized`) so logout can call the new `DELETE` endpoint with it.
  3. Call both from `clearAuth()` in `store.ts`: unregister the last known token server-side (best-effort, swallow errors — same non-fatal pattern used everywhere else in this file), then call `resetPushInitState()`.
  4. `__root.tsx`'s existing `useEffect(() => { if (!token) return; initPushNotifications(router)... }, [token])` will then correctly re-run `attemptInit` on the next login since `initialized` is back to `false`.
- **Verify:** Log in as User A on a test device, confirm a push token row for A; log out, log in as User B without restarting the app, confirm A's row is gone and a new row for B appears.

### Task 1.6 — Fix ZSB-06: Enable Ably in CI builds
- **Files:** `.github/workflows/android-build.yml`
- **Steps:**
  1. Add `VITE_REALTIME_PROVIDER: 'ably'` to the `env:` block of both the `build` and `release` jobs' "Build Vite app + sync Capacitor assets" step, alongside the existing `VITE_API_BASE_URL`/`VITE_WEB_BASE_URL` lines. This value isn't sensitive, so a plain literal (not a secret reference) is fine, matching how `VITE_APP_ENV: production` is already set as a literal.
  2. Confirm `secrets.VITE_API_BASE_URL`'s backend actually has `ABLY_API_KEY`/`REALTIME_PROVIDER` configured (or at minimum `ABLY_API_KEY`, since `/api/realtime/ably-token` only checks that one var, independent of the primary `REALTIME_PROVIDER`) — this is an infra/secrets check outside the repo, flag it to whoever owns the Vercel env vars.
- **Verify:** Build a debug APK from CI, install it, open a Room with a second device/tab active in the same room on web, confirm messages appear near-instantly rather than on the ~3–30s poll cadence.

### Task 1.7 — Fix ZSB-07: Persist refresh token on 2FA login
- **Files:** `apps/android/src/routes/auth/two-factor.tsx`
- **Steps:** One-line change: `await setAuth(data.accessToken, data.user, data.refreshToken);`.
- **Verify:** Enable 2FA on a test account, log in through it, confirm `Preferences.get({ key: REFRESH_TOKEN_KEY })` returns a value afterward (not empty), and that the session survives an access-token expiry without forcing a fresh login.

---

## Phase 2 — Medium severity (cache correctness, security-adjacent config hygiene)

### Task 2.1 — Fix ZSB-09: Serialize ad-event queue writes
- **Files:** `apps/android/src/lib/ads/adEventQueue.ts`
- **Steps:** Introduce a module-level `let writeChain: Promise<void> = Promise.resolve();` and change `enqueueAdEvent` to `writeChain = writeChain.then(async () => { const queue = await readQueue(); queue.push({...}); await writeQueue(queue); });` so every enqueue call is strictly ordered relative to the others, instead of firing independent, unordered read-modify-write cycles.
- **Verify:** Add a unit test that calls `enqueueAdEvent` 10 times in a tight loop (no `await` between calls) and asserts the persisted queue ends up with all 10 events.

### Task 2.2 — Fix ZSB-10: Friend request race condition
- **Files:** `apps/android/src/routes/friends.tsx`
- **Steps:** Change `respondMutation`'s `mutationFn`/`onSuccess` signature so `action` is destructured from the callback's own `variables` argument (`onSuccess: (_res, { requestId, action }) => { ...; if (action === 'accept') qc.invalidateQueries(...) }`), removing the `respondMutation.variables?.action` read entirely.
- **Verify:** Manually fire two accept/reject taps in quick succession in the emulator (throttle network in devtools to widen the race window) and confirm the friends list refreshes correctly for both outcomes.

### Task 2.3 — Fix ZSB-11: Coin balance cache invalidation after spend
- **Files:** `apps/android/src/routes/gifts.tsx`, `apps/android/src/routes/stickers.tsx`, and audit any other coin/star-spending mutation (search for `apiClient.post` calls to `/economy/*`, `/stickers`, `/classroom/*/enroll`, etc.)
- **Steps:** Add `qc.invalidateQueries({ queryKey: ['users', 'me'] })` to each spend mutation's success path, matching the pattern already used in `wallet.tsx`'s `RewardedAdButton onRewarded` handler and `BuyCurrencyPanel`'s `onPurchased`.
- **Verify:** Send a gift, immediately open Wallet, confirm the coin balance already reflects the spend without needing a pull-to-refresh.

### Task 2.4 — Fix ZSB-12: Wallet purchase → transaction history refresh
- **Files:** `apps/android/src/routes/wallet.tsx`
- **Steps:** In `WalletPage`'s `onPurchased` callback passed to `BuyCurrencyPanel`, also invalidate `['wallet', 'transactions', tab]` (or all tabs) so the just-completed purchase appears immediately.
- **Verify:** Buy a coin pack, confirm it appears at the top of Transaction History without a manual refresh.

### Task 2.5 — Fix ZSB-13: Referral code expiry parity
- **Files:** `apps/android/src/lib/deeplinks/referral.ts`
- **Steps:** Store `{ code, capturedAt }` as a JSON value under `PENDING_REFERRAL_KEY` instead of a bare string. In `getPendingReferralCode()`, parse it, and return `null` (clearing the key) if `Date.now() - capturedAt > 30 * 24 * 60 * 60 * 1000` (reuse/import the same `30`-day constant web uses if it's ever centralized, or duplicate the literal with a comment cross-referencing `apps/web/lib/referral/clientStore.ts`'s `TTL_DAYS`).
- **Verify:** Update the existing test in `lib/deeplinks/__tests__/referral.test.ts` to cover both "code younger than 30 days is returned" and "code older than 30 days returns null and clears storage."

### Task 2.6 — Fix ZSB-14: Wire up `applyStoredLanguagePref`
- **Files:** `apps/android/src/main.tsx`, `apps/android/src/lib/i18n/index.ts`
- **Steps:** Add `import { applyStoredLanguagePref } from './lib/i18n';` and call `void applyStoredLanguagePref();` early in `main.tsx`, after the `import './lib/i18n'` side-effect line (order matters — `i18n.init()` must have already run synchronously before this is called, which it has, since `initImmediate: false`).
- **Verify:** Change language in Settings, clear the WebView's site data only (not app data) via `adb shell pm clear --cache-only`-equivalent or Android's "Clear cache" (not "Clear storage"), relaunch the app, confirm the chosen language is still active.

### Task 2.7 — Fix ZSB-15: Remove dead `VITE_ABLY_API_KEY`
- **Files:** `apps/android/src/lib/env.ts`
- **Steps:** Delete the `VITE_ABLY_API_KEY` field from `EnvSchema` and the `raw` object. Confirm nothing else references `env.VITE_ABLY_API_KEY` (already confirmed empty by search) before removing.
- **Verify:** `npm run typecheck --workspace=apps/android` passes with no new errors.

### Task 2.8 — Fix ZSB-16: Notification tap-to-navigate
- **Files:** `apps/android/src/lib/notifications/queries.ts`, `apps/android/src/routes/notifications.tsx`, `apps/android/src/lib/push/index.ts` (reuse `isAllowedRoute`/`ACTION_ALIASES`, consider moving them to a shared `lib/notifications/routing.ts` importable by both push and the in-app list)
- **Steps:**
  1. Extend the `Notification` interface with an optional `action?: string` (whatever the server's `type`/`metadata` maps to — check how `apps/web/app/(app)/notifications/page.tsx` derives its `actionUrl` and mirror the same server-side field/logic; if web's own `actionUrl` plumbing turns out to be similarly broken, fix that as part of this task too since it blocks parity entirely).
  2. Move `isAllowedRoute`/`VALID_PUSH_ROUTES`/`ACTION_ALIASES` out of `lib/push/index.ts` into a shared `lib/notifications/routing.ts` so both the push handler and the in-app list use one allowlist.
  3. In `notifications.tsx`'s row `onClick`, after marking read, resolve the notification's action through the shared allowlist and `navigate({ to: route })` if allowed.
- **Verify:** Trigger a test notification with a known type (e.g. a gift-received notification), confirm tapping it both marks it read and navigates to the relevant screen (Wallet/Gifts).

### Task 2.9 — Scope ZSB-17: PWA Web Push (larger feature, own sub-plan)
- **Files:** `apps/web/app/sw.ts`, new: a subscription-registration flow + `POST /api/users/push-token` extension to accept a `platform: 'web'` + Web Push subscription object, new: server-side Web Push send integration (`web-push` npm package or equivalent) alongside the existing FCM sender in `lib/notifications/fcm.ts`
- **Steps:** This is real feature work, not a one-line fix — treat as its own mini-project: (1) confirm product actually wants this before investing (2) add VAPID key generation/config (3) add `self.addEventListener('push', ...)` + `notificationclick` to `sw.ts` (4) add a client-side subscribe flow gated behind a notification-permission prompt, mirroring `lib/push/index.ts`'s permission-check pattern (5) extend the send-side fan-out in `lib/notifications/push.ts`/`fcm.ts` to also dispatch to Web Push subscriptions.
- **Verify:** End-to-end: install the PWA, grant notification permission, trigger a server-side notification, confirm it appears as an OS-level notification with the app closed.

### Task 2.10 — Fix ZSB-18 & ZSB-19: i18n coverage gaps
- **Files (Android):** `apps/android/src/routes/ads/index.tsx`, `routes/business/ads/index.tsx`, `routes/business/pages/index.tsx`, `routes/business/pages/$pageId.tsx`
- **Files (Web):** `apps/web/app/(app)/classroom/page.tsx`
- **Steps:**
  1. Add `business.ads.*`, `ads.hub.*`, `business.pages.*` keys to all nine `shared/i18n/locales/*.json` files, following the existing nesting/naming convention (check `shared/i18n/locales/en.json`'s `business.*`/`ads.*` namespaces for the established style before inventing new key names).
  2. Wire `useTranslation()`/`t()` through the four Android files, replacing every hardcoded string.
  3. For the web Classroom page, reuse the `classroom.*` keys the Android port already added to `en.json` (and now needs added to the other 8 locale files if it only added them to `en.json` — verify and backfill), and wire `t('classroom.*', 'fallback')` through the page's copy.
- **Verify:** Switch device/browser language to French or Arabic, visit each of the five affected screens, confirm no raw English strings remain (aside from proper nouns/brand name).

### Task 2.11 — Fix ZSB-20: CAPTCHA hang timeout
- **Files:** `apps/android/src/routes/onboarding.tsx`, `apps/web/app/onboarding/page.tsx`
- **Steps:** Wrap the existing `getCaptchaToken()` body in `Promise.race([existingPromise, new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000))])` in both files (same fix, same root cause, apply identically to keep them in sync). Confirm the server's `CAPTCHA_REQUIRED`/`CAPTCHA_FAILED` error codes are already handled gracefully by the existing `catch` block in `handleSubmit` (they are, per the code already read) so a `null` token surfaces as a normal, recoverable form error instead of a hang.
- **Verify:** Throttle network to simulate a slow `recaptcha/api.js` load, submit onboarding before the script finishes loading, confirm the submit button recovers with an error message within ~8s instead of hanging forever.

### Task 2.12 — Fix ZSB-21: Admin KYC schedule feedback
- **Files:** `apps/android/src/routes/admin/kyc.tsx`
- **Steps:** Add `onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'kyc', 'detail', id] })` to the `schedule` mutation (mirroring `approve`/`reject`'s existing `onResolved` pattern), and surface a toast via the same `notify()` helper already used by the page-level `AdminKycPage` (thread a callback down, or lift the toast state up one level if simpler).
- **Verify:** Schedule a physical verification appointment, confirm the detail view immediately shows the new scheduled date/notes and a success toast appears.

---

## Phase 3 — Low severity / polish (batch together, low risk)

### Task 3.1 — Fix ZSB-22: OAuth button double-tap protection
- **Files:** `apps/android/src/routes/auth/login.tsx`, `routes/auth/register.tsx`
- **Steps:** Keep the loading state true until either the `appUrlOpen` OAuth-callback handler in `__root.tsx` fires (success path) or the app resumes foreground without a completed login within some window (abandon path) — simplest implementation: lift a shared "oauth in progress" flag into `lib/auth/preAuth.ts`-style module state, set it true before `Browser.open`, and clear it from `__root.tsx`'s `appUrlOpen` handler once the exchange completes (success or failure), rather than clearing it locally in the button's `finally`.
- **Verify:** Tap Google login, background the app before completing sign-in, foreground it again, confirm the button doesn't allow an immediate second Custom Tab to stack on top of the first.

### Task 3.2 — Fix ZSB-23: Add "Recent chats" tab to Friends
- **Files:** `apps/android/src/routes/friends.tsx`, `shared/i18n/locales/*.json`
- **Steps:** Add `friends.tabs.recent`/`friends.recent.*` keys to all nine locale files, then port the tab from `apps/web/app/(app)/friends/page.tsx`'s "Recent chats" implementation, reusing the existing `ProfileLink` component already defined in this file.
- **Verify:** Confirm the fourth tab appears and lists recent conversation partners, matching web's behaviour.

### Task 3.3 — Fix ZSB-24: CI branch trigger hygiene
- **Files:** `.github/workflows/android-build.yml`
- **Steps:** Replace the hardcoded `on.push.branches` list with `on.pull_request: { branches: [main] }` (plus keep the existing `workflow_dispatch` block untouched), so any branch gets a debug-APK build the moment a PR is opened against `main`, without needing a workflow edit. If push-triggered builds on specific long-lived branches are still wanted, keep `on.push.branches: [main, android]` only (drop the one-off `claude/...` entries) and let PRs cover everything else.
- **Verify:** Open a PR from a new, never-before-seen branch name, confirm the debug-APK job runs without any workflow edit.

### Task 3.4 — Fix ZSB-25: PullToRefresh mid-scroll edge case
- **Files:** `apps/android/src/components/ui/PullToRefresh.tsx`
- **Steps:** In `onTouchMove`, if `startYRef.current === null` but `el.scrollTop <= 0`, latch `startYRef.current = e.touches[0].clientY` at that point (instead of only ever latching it in `onTouchStart`) so a gesture that scrolls up to the top mid-drag can still arm the refresh indicator for the remainder of that same touch.
- **Verify:** Manually test scrolling up mid-swipe into a pull-to-refresh gesture on Rooms/Moments/Notifications; confirm the refresh indicator now appears.

---

## Suggested rollout order / batching for PRs

1. **PR 1 (ship ASAP, independent):** Task 1.1 (ZSB-02) — it's a live crash on production web, isolated to two files, no dependency on anything else in this plan.
2. **PR 2:** Tasks 1.2, 1.7 (ZSB-01, ZSB-07) — both tiny, both auth-security-adjacent, easy to review together.
3. **PR 3:** Task 1.3 (ZSB-03/ZSB-08) — session-recovery wiring; do this before Task 1.5 (push) since 1.5's manual test steps assume auth state behaves correctly.
4. **PR 4:** Task 1.5 (ZSB-05) — push lifecycle, needs the new `DELETE` endpoint reviewed by whoever owns notification infra.
5. **PR 5:** Task 1.6 (ZSB-06) — one-line CI change, but confirm the `ABLY_API_KEY` secret is actually set on the backend before merging, or this "fixes" the client while the server still can't issue tokens.
6. **PR 6 (larger, needs its own design review):** Task 1.4 (ZSB-04) — new bridge endpoint + security review of the single-use-code flow before shipping (this is the one item in Phase 1 that's genuinely new server surface, not just fixing existing wiring).
7. **PR 7:** Batch all of Phase 2's cache-invalidation fixes (2.1–2.4, 2.12) together — same shape of change, easy single review.
8. **PR 8:** Batch Phase 2's i18n/config fixes (2.5, 2.6, 2.7, 2.10, 2.11) together.
9. **PR 9 (separate, needs product sign-off on scope):** Task 2.9 (ZSB-17, Web Push) — track as its own project, not a quick fix.
10. **PR 10:** Task 2.8 (ZSB-16, notification navigation) — depends on confirming/fixing web's `actionUrl` derivation first if that turns out to be broken too.
11. **PR 11:** All of Phase 3 together — lowest risk, batch freely.

---

*End of fix plan.*
**Generated:** Friday, July 03, 2026 — 05:05 PM UTC
