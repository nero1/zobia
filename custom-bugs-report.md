# Zobia Capacitor Android App — Custom Forensic Bug Audit Report

**Report generated:** 2026-07-03 (July 3, 2026), 02:21 PM UTC
**Scope:** `apps/android` (Capacitor + Vite + React + TanStack Router Android app), cross-referenced against `apps/web` (Next.js web/PWA — the source of truth for parity) and `apps/expo` (legacy, read-only, used only for comparison). `apps/expo` itself was **not** audited or reported on per instructions — it is discontinued.
**Method:** Three full manual passes over the Android app's routing, auth, session/token storage, deep links, payments (Google Play Billing), realtime/polling, push notifications, ads, i18n, admin panel, and native Android project (Gradle/Manifest/ProGuard), each cross-checked line-by-line against the equivalent web/PWA and (where relevant) Expo implementation to verify genuine divergence rather than assume it. No sub-agents were used; every finding below was read and verified directly in the source files cited. This audit intentionally ignored CRON-frequency concerns per instructions (external CRON already compensates for the Vercel Hobby daily-CRON limit).

---

## How to read this report

This codebase has already been through several prior hardening rounds (visible in git history — CSRF/CORS fixes, DB circuit breaker wiring, IAP replay protection, ProGuard rules, admin-parity work, i18n translation passes, etc.), so the "easy," previously-known bugs are largely gone. This audit deliberately did **not** re-report anything already fixed in the current `main`/working tree. Everything below is a **new** finding, verified by direct code inspection (not simulation/guesswork), with exact file paths.

**I found 15 concrete, verified issues.** I did not pad this list to reach 30 — several areas that are classic sources of bugs in apps of this type (webhook replay protection, RLS-style `is_admin` re-checks, CSRF/CORS, financial idempotency, rate limiting, circuit breakers, DB connection pooling, health checks, request-correlation IDs) were inspected and found to already be well-implemented on the current `main`, so they are **not** listed as bugs — see the "Also checked, no issue found" section at the end for the full list of things I specifically looked for and ruled out, so you know what was actually covered.

---

## Summary — Numbered List of All Bugs/Issues Found

1: **ZB-AND-01**: Bottom tab bar and side-drawer navigation labels are hardcoded in English, bypassing the app's i18n system entirely.
FILES: `apps/android/src/components/layout/BottomNav.tsx`, `apps/android/src/components/layout/TopBar.tsx`
FIX: Replace every hardcoded `label:`/`shortLabel:` string with `t('nav.xxx')` calls, reusing existing translation keys already present in `shared/i18n/locales/*.json` (e.g. `home.title`, `wallet.title`) or adding new `nav.*` keys across all 9 locale files.

2: **ZB-AND-02**: Referral deep-link capture is fully implemented but never wired up — referral attribution from shared links is completely non-functional on Android.
FILES: `apps/android/src/lib/deeplinks/referral.ts`, `apps/android/src/main.tsx`, `apps/android/src/routes/__root.tsx`, `apps/android/src/routes/auth/register.tsx`
FIX: Call `useReferralCaptureFromLink()` once at app root (mirroring `apps/expo/app/_layout.tsx`), and pass `await getPendingReferralCode()` into the OAuth-initiation URL / onboarding-completion call (see bug #3) so a captured code is actually redeemed, then call `clearPendingReferralCode()` after successful use.

3: **ZB-AND-03 (Critical)**: The Android app has no onboarding flow at all — new users who sign up via Google/Telegram OAuth are dropped straight onto `/home` without ever setting a username, city, avatar, or redeeming a referral code, and without receiving welcome XP/credits.
FILES: `apps/android/src/routes/__root.tsx` (OAuth callback handler), `apps/android/src/routes/auth/register.tsx`, `shared/schemas/api/auth.ts` (`AuthUserSchema` has no `onboarding_completed` field), missing: `apps/android/src/routes/onboarding.tsx`
FIX: Add an `/onboarding` route (mirroring `apps/expo/app/onboarding` and `apps/web/app/onboarding`), branch on `onboardingCompleted`/`onboarding_completed` from the mobile-token response instead of always navigating to `/home`, and call `POST /api/onboarding/complete` with username/city/country/avatar + the pending referral code from bug #2.

4: **ZB-AND-04 (Critical/Security)**: JWT access token and long-lived refresh token are stored in plaintext, backup-eligible Android storage.
FILES: `apps/android/src/lib/api/client.ts` (uses `@capacitor/preferences`, i.e. unencrypted `SharedPreferences`), `apps/android/android/app/src/main/AndroidManifest.xml` (`android:allowBackup="true"`, no `dataExtractionRules`/`fullBackupContent`)
FIX: Either add an Android 12+ `dataExtractionRules.xml` (and legacy `fullBackupContent.xml`) that excludes the Capacitor Preferences file/keys holding `zobia_jwt`/`zobia_rt`, or switch token storage to a Keystore-backed encrypted store (e.g. `capacitor-secure-storage-plugin` or `EncryptedSharedPreferences` via a small native shim), matching the higher bar `expo-secure-store` already provided in the (discontinued) Expo app.

5: **ZB-AND-05 (Critical/Release-blocking)**: `versionCode`/`versionName` are hardcoded and never incremented, which will make every subsequent Play Store upload rejected.
FILES: `apps/android/android/app/build.gradle`
FIX: Derive `versionCode`/`versionName` from CI (e.g. `github.run_number` / a git tag) at build time instead of a hardcoded literal, so each new APK/AAB upload strictly increases `versionCode` as Google Play requires.

6: **ZB-AND-06 (Critical)**: The "Play" button on the game detail screen does nothing — there is no game-play screen anywhere in the Android app.
FILES: `apps/android/src/routes/games/$slug.tsx` (button has no `onClick`), `apps/android/src/routeTree.gen.ts` (no `/games/$slug/play` route exists), compare `apps/web/app/g/[slug]/play/page.tsx`
FIX: Add a play screen/route that opens the game engine — per the project's own stated convention ("no webview wrappers except for very complicated code like games"), the pragmatic fix is a `Browser.open()`/in-app-browser hand-off to the existing authenticated web player (`universalLink('/g/<slug>/play')`), matching the pattern already used for KYC (`routes/kyc.tsx`) and Business ads, rather than reimplementing the game engine natively.

7: **ZB-AND-07**: The Games discovery search box fires a full network request on every keystroke, with no debounce — unlike the web page, which explicitly debounces 250ms.
FILES: `apps/android/src/routes/games/index.tsx`, compare `apps/web/app/(app)/games/page.tsx:189-192`
FIX: Debounce the `search` state update by ~250ms before it flows into the `useQuery` key, exactly mirroring the web implementation, to cut unnecessary API/rate-limit consumption and battery/data use while typing.

8: **ZB-AND-08**: The adaptive chat-poll backoff (used by both Rooms and DM chat) relies solely on the DOM `visibilitychange`/`document.hidden` API, which the codebase's own comments elsewhere acknowledge is unreliable inside a Capacitor WebView.
FILES: `apps/android/src/lib/hooks/useAdaptiveChatPoll.ts`, contrast with `apps/android/src/lib/hooks/usePresenceHeartbeat.ts` (explicitly says: "reacts to Capacitor App state... since visibilitychange alone is unreliable inside a WebView"), used by `apps/android/src/routes/rooms/$roomId.tsx` and `apps/android/src/routes/messages/$conversationId.tsx`
FIX: Add a `@capacitor/app` `appStateChange` listener alongside the existing `visibilitychange` listener (same pattern already used in `lib/api/client.ts`'s `focusManager`/`onlineManager` wiring) so backgrounding reliably pauses the poll, protecting the documented Vercel-Hobby/free-Redis cost model from an Android-specific leak.

9: **ZB-AND-09**: Google Play Billing's purchase-restore flow is fully implemented server- and client-side but has no UI entry point anywhere in the app.
FILES: `apps/android/src/lib/payments/googlePlay.ts` (`restorePurchases()` exported, never imported), `apps/android/src/routes/wallet.tsx`, `apps/android/src/routes/settings.tsx`
FIX: Add a "Restore Purchases" button (Settings → Account, or Wallet) that calls `restorePurchases()`, so users who reinstall the app or switch devices can recover subscriptions/entitlements without contacting support.

10: **ZB-AND-10**: The Android app has zero automated test coverage (no unit, component, or e2e tests), unlike the extensive test suite for the web app.
FILES: `apps/android/` (no `*.test.*`/`*.spec.*` files exist anywhere in the package), compare `apps/web/__tests__`, `apps/web/e2e`, `security-tests/`
FIX: Add at minimum unit tests for the auth/token-refresh singleton logic (`lib/api/client.ts`), the deep-link route allowlist (`lib/push/index.ts`), and the referral/onboarding flow once fixed (bugs #2/#3), using the same Vitest/Playwright tooling already configured at the repo root.

11: **ZB-AND-11**: In-house ad impression/click events are reported one HTTP POST per event with no batching, unlike the documented, cost-conscious web pattern.
FILES: `apps/android/src/components/ads/AdSlot.tsx`, compare `apps/web/lib/ads/adEventQueue.ts` (batches + flushes via `sendBeacon`)
FIX: Reuse the same local-queue-and-flush pattern as web (batch into `Preferences`/IndexedDB, flush periodically or on `appStateChange` background), since a feed with several ad slots currently produces one POST per impression per slot instead of one batched call per session.

12: **ZB-AND-12**: No pull-to-refresh gesture exists anywhere in the app (web, PWA, or Android), despite being explicitly expected mobile UX for feed-style screens (Rooms, Moments, Notifications, Messages).
FILES: none implement it — checked `apps/android/src/routes/*` and `apps/web/app/(app)/**` broadly
FIX: Add a lightweight pull-to-refresh wrapper (e.g. a small touch-gesture hook invoking `queryClient.invalidateQueries`) around the main scrollable list in Rooms/Moments/Notifications/Messages screens on Android at minimum, since native-feeling pull-to-refresh is a low-cost, high-expectation mobile affordance.

13: **ZB-AND-13**: The on-device debug log overlay (which can export/share full console error text and stack traces via the native share sheet) is force-enabled in the only existing CI build pipeline, and there is no separate, debug-overlay-off release build path.
FILES: `.github/workflows/android-build.yml` (`VITE_DEBUG_OVERLAY: '1'`), `apps/android/src/components/debug/DebugOverlay.tsx`, `apps/android/src/lib/env.ts` (`VITE_APP_ENV` defaults to `'development'` if unset)
FIX: Add a distinct release workflow/job (or a workflow input flag) that builds a signed release artifact with `VITE_DEBUG_OVERLAY` unset/`'0'` and `VITE_APP_ENV=production`, so a future Play Store upload doesn't inherit the debug-only configuration by default; document the distinction clearly in `docs/SETUP.md` next to the existing "Build a signed release APK/AAB" step.

14: **ZB-AND-14**: Both chat surfaces' polling "did anything change?" check compares only array length, so a same-length add+remove (e.g. a new message arrives at the same moment a moderator/report action removes another) is silently missed until the next length-changing poll.
FILES: `apps/android/src/routes/rooms/$roomId.tsx` (`fresh.length !== prev.length`), `apps/android/src/routes/messages/$conversationId.tsx` (same pattern)
FIX: Compare by the latest message id (or a cheap hash of ids) instead of bare `.length`, so any content change — not just a count change — triggers a state replace; this is a small, local change with no server contract impact.

15: **ZB-AND-15**: The AdMob manifest configuration (`ad_admob_*` keys, test-mode flag) is cached indefinitely in a module-level variable with no expiry, unlike every other manifest-driven setting in the app.
FILES: `apps/android/src/lib/ads/admob.ts` (`cachedConfig` never invalidated), compare `apps/android/src/lib/hooks/useManifest.ts` (5-minute `staleTime` via react-query)
FIX: Route AdMob config through the existing `useManifest()`/react-query cache (5-minute staleTime) instead of a bespoke module-level cache, so an admin rotating a compromised ad unit ID or disabling `admobAds` takes effect within the same session rather than requiring every user to force-close the app.

---

## Detailed Findings

### 1. ZB-AND-01 — Bottom nav & drawer menu are not localized
**Files:** `apps/android/src/components/layout/BottomNav.tsx`, `apps/android/src/components/layout/TopBar.tsx`
**Details:** The app ships a full i18n system (9 locale files — `en`, `fr`, `ar`, `ha`, `sw`, `am`, `zu`, `pt`, `pidgin` — each with an identical 2,761-key set, plus Arabic RTL support wired via `document.dir`), and virtually every other screen in the app calls `useTranslation()`. However, the two navigation surfaces every user sees on every screen — the 6-item bottom tab bar and the 25-item hamburger drawer — are built from plain object literals with hardcoded English strings (`label: 'Home'`, `label: 'Quests'`, etc.), and neither component imports `useTranslation` at all. A Hausa- or Swahili-preferring user still sees "Home / Quests / Games / Friends / Wallet / Profile" and the full drawer menu in English.
**Fix:** Add `useTranslation()` to both components and replace every literal `label`/`shortLabel` with a `t()` call against existing keys (`home.title`, `quests.title`, `games.title` etc. are already used elsewhere in `__root.tsx`'s `getTitle()`) or new `nav.*` keys added to all 9 locale JSON files (which already share one flat key structure, so this is a mechanical addition).

### 2. ZB-AND-02 — Referral deep-link capture is dead code
**Files:** `apps/android/src/lib/deeplinks/referral.ts`, `apps/android/src/main.tsx`, `apps/android/src/routes/__root.tsx`, `apps/android/src/routes/auth/register.tsx`
**Details:** `apps/android/src/lib/deeplinks/referral.ts` implements a complete, well-written referral-capture module: `captureReferralFromUrl()`, `getPendingReferralCode()`, `clearPendingReferralCode()`, and a ready-to-use `useReferralCaptureFromLink()` hook that listens for `appUrlOpen` and persists a captured `?r=CODE` to Capacitor Preferences. A `grep` across the entire `apps/android/src` tree shows these exports are referenced **only within the file that defines them** — `useReferralCaptureFromLink()` is never called from `main.tsx` or `__root.tsx`, and `getPendingReferralCode()`/`clearPendingReferralCode()` are never called from anywhere (there is no onboarding flow to call them from either — see bug #3). By contrast, the (discontinued) Expo app's `apps/expo/app/_layout.tsx:47,280` explicitly calls `useReferralCaptureFromLink(storeReady)`. This means every referral link shared and opened via the Android app (`zobia://...?r=CODE` or a verified `https://zobia.org/...?r=CODE` App Link) silently fails to attribute the referral — with real revenue impact, since referrals drive the commission/growth loop described in `docs/HOW-IT-WORKS.md`.
**Fix:** Mount `useReferralCaptureFromLink()` once near the app root (in `main.tsx`'s `App()` or `__root.tsx`'s `AppShell`), and once the onboarding flow (bug #3) exists, read `getPendingReferralCode()` when submitting it and call `clearPendingReferralCode()` afterward.

### 3. ZB-AND-03 — No onboarding flow exists on Android (Critical)
**Files:** `apps/android/src/routes/__root.tsx`, `apps/android/src/routes/auth/register.tsx`, `shared/schemas/api/auth.ts`, `apps/android/src/lib/api/client.ts` (refresh-token background user update)
**Details:** `apps/android/src/routes/auth/register.tsx` is OAuth-only (Google/Telegram) — it never collects a username, city, country, or avatar, and the server auto-generates a username from the user's email for brand-new accounts (`apps/web/app/api/auth/google/callback/route.ts`, `baseUsernameFromEmail`). On web, a fresh account is created with `onboarding_completed = false` and the web callback explicitly redirects to `/onboarding` instead of `/home` until that flow completes. On Android, the OAuth deep-link handler in `__root.tsx` (lines ~129-147) unconditionally does `navigate({ to: '/home', replace: true })` the instant it receives an access token and user object from `/api/auth/mobile-token` — there is no check of any onboarding-completion flag, and there is no `/onboarding` route in the Android route tree at all (confirmed against the full `routeTree.gen.ts` route list and the `apps/android/src/routes/` directory listing). Compounding this, the shared `AuthUserSchema` (`shared/schemas/api/auth.ts`) — the schema every Android auth payload is parsed through — doesn't even declare an `onboarding_completed`/`onboardingCompleted` field, so even if the server includes it, Zod's default "strip unknown keys" behavior silently discards it before the app could act on it. The Expo app avoids this exact trap by building its user object manually (`apps/expo/lib/api/client.ts:198`, `onboardingCompleted: Boolean(me.onboardingCompleted ?? me.onboarding_completed ?? false)`) instead of parsing through the shared schema, and by having a real `apps/expo/app/onboarding` screen. The net effect on Android: every brand-new user gets an auto-generated username, no avatar/city, no welcome XP/credits, and any referral code they arrived with is never recorded — they land on `/home` looking like a fully onboarded but oddly empty account.
**Fix:** Add an `/onboarding` route mirroring the web/Expo flow (username/avatar/city + referral code fields, posting to `POST /api/onboarding/complete`); extend the manually-built user object in the OAuth callback (matching Expo's `?? onboarding_completed` pattern, not the stripped `AuthUserSchema`) so the app can tell new users apart from returning ones; and branch the post-auth navigation on that flag instead of always going to `/home`.

### 4. ZB-AND-04 — Auth tokens stored unencrypted with app backup enabled (Critical/Security)
**Files:** `apps/android/src/lib/api/client.ts`, `apps/android/android/app/src/main/AndroidManifest.xml`
**Details:** `JWT_KEY`/`REFRESH_TOKEN_KEY` are written via `@capacitor/preferences`, which on Android is a thin wrapper over plain (unencrypted) `SharedPreferences`. `AndroidManifest.xml` sets `android:allowBackup="true"` with no `android:dataExtractionRules` (Android 12+) or `android:fullBackupContent` (Android 6-11) to exclude this data. In combination: (a) `adb backup` against a debuggable or user-authorized device can extract the app's SharedPreferences file wholesale, including the long-lived refresh token; (b) on a rooted device, the file is trivially readable by any other app with root; (c) if Android's Auto Backup to Google Drive is ever exercised for this app (default behavior for `allowBackup="true"` apps on stock Android), the refresh token could be persisted to a user's cloud backup. This is a materially different (weaker) posture than the Expo app, which used `expo-secure-store` (Android Keystore-backed, hardware-encrypted).
**Fix:** Minimum-effort fix: ship a `res/xml/data_extraction_rules.xml` (and legacy `full_backup_content.xml`) that explicitly excludes the SharedPreferences file backing Capacitor Preferences (`CapacitorStorage.xml` by default) from both cloud and device-to-device backup, and reference both from the manifest. Stronger fix: move `JWT_KEY`/`REFRESH_TOKEN_KEY` (not the non-sensitive `zobia_user`/`zobia_lang`/`zobia_device_id` keys) to a Keystore-backed store such as `capacitor-secure-storage-plugin`.

### 5. ZB-AND-05 — Hardcoded versionCode/versionName blocks future releases (Critical/Release-blocking)
**Files:** `apps/android/android/app/build.gradle`
**Details:** `defaultConfig` hardcodes `versionCode 1` and `versionName "1.0.0"`. The Google Play Console rejects any AAB/APK upload whose `versionCode` is not strictly greater than the previous accepted upload for that app. As currently configured, the very first Play Store release would work, but every subsequent update — bug fix, feature, or otherwise — would be rejected outright until someone notices and manually edits this file per release, which is easy to forget under release pressure.
**Fix:** Compute `versionCode` from a monotonic CI value (`github.run_number`, or a counter file bumped by a release script) and `versionName` from a git tag/semantic version, injected via Gradle properties (`-PversionCode=... -PversionName=...`) at build time — the existing `android-build.yml` workflow is the natural place to compute and pass these.

### 6. ZB-AND-06 — Games cannot actually be played on Android (Critical)
**Files:** `apps/android/src/routes/games/$slug.tsx`, `apps/android/src/routeTree.gen.ts`, compare `apps/web/app/g/[slug]/play/page.tsx` + `apps/web/components/games/GameRunner`
**Details:** The game detail screen renders a prominent `{t('android.games.play')}` button styled as the primary call-to-action, but it has no `onClick` handler, no navigation, and no mutation — tapping it is a complete no-op. Cross-checking the generated route tree confirms there is no `/games/$slug/play` (or any other) route in the Android app at all, whereas the web app has a dedicated authenticated player at `/g/[slug]/play` that loads `GameRunner` (the actual game engine host). Users can browse the catalogue, favorite games, read descriptions, and view leaderboards on Android, but the entire point of the feature — playing a game and earning the credits/XP shown right there on the same screen — is unreachable.
**Fix:** Per this project's own explicitly stated convention (avoid webview wrappers except for genuinely complex flows like games/KYC), the lowest-risk fix is to wire the Play button to `Browser.open({ url: universalLink('/g/${slug}/play') })`, exactly mirroring the existing `routes/kyc.tsx` and Business/ads Custom Tab hand-off pattern — this requires no native game-engine porting and reuses the already-authenticated web session via the App Link.

### 7. ZB-AND-07 — Games search has no debounce
**Files:** `apps/android/src/routes/games/index.tsx`, compare `apps/web/app/(app)/games/page.tsx:189-192`
**Details:** The Android `search` state is written directly from the `<input onChange>` handler and used verbatim as a `useQuery` key (`['games', search]`), so every keystroke fires a fresh `GET /api/games?tab=popular&q=...` call. The web discovery page explicitly debounces the same input by 250ms before it affects the fetch, specifically to keep `ILIKE` query volume low as documented in a code comment there. On Android this protection is simply absent, so a user typing a 10-character search term fires up to 10 API calls (each consuming `RATE_LIMITS.apiRead` budget) instead of roughly one.
**Fix:** Add the same 250ms `setTimeout`-based debounce web already uses, so the query only re-fires once typing pauses.

### 8. ZB-AND-08 — Adaptive chat poll doesn't reliably pause when Android app is backgrounded
**Files:** `apps/android/src/lib/hooks/useAdaptiveChatPoll.ts`, `apps/android/src/lib/hooks/usePresenceHeartbeat.ts` (contrast), `apps/android/src/routes/rooms/$roomId.tsx`, `apps/android/src/routes/messages/$conversationId.tsx`
**Details:** `useAdaptiveChatPoll` — the hook that backs off room/DM polling to 3s/15s/30s intervals to keep serverless-invocation and Redis costs low on Vercel Hobby — pauses entirely only via `document.addEventListener('visibilitychange', ...)` / `document.hidden`. This file is explicitly annotated as "copied verbatim from apps/web/lib/hooks/useAdaptiveChatPoll.ts — no changes needed — it is already framework-agnostic React," i.e. it was ported without considering Capacitor-specific lifecycle semantics. Tellingly, a sibling file in the very same directory, `usePresenceHeartbeat.ts`, explicitly documents why this is risky: "Also reacts to Capacitor App state (foreground/background), since visibilitychange alone is unreliable inside a WebView." If `visibilitychange` doesn't fire (or fires late/inconsistently) when the Android activity is paused, the chat poll for whichever room/DM screen was open keeps firing every 3-30 seconds while the app sits in the background — directly undermining the cost-control design this whole hook exists for, and draining battery/data on the user's device.
**Fix:** Add a `@capacitor/app` `App.addListener('appStateChange', ({ isActive }) => ...)` listener alongside the existing `visibilitychange` listener inside `useAdaptiveChatPoll`, pausing/resuming on `isActive` exactly as `usePresenceHeartbeat.ts` and `lib/api/client.ts`'s `focusManager` already do elsewhere in this same app.

### 9. ZB-AND-09 — "Restore Purchases" has no UI entry point
**Files:** `apps/android/src/lib/payments/googlePlay.ts`, `apps/android/src/routes/wallet.tsx`, `apps/android/src/routes/settings.tsx`
**Details:** `restorePurchases()` is fully implemented (calls `store.restorePurchases()` and surfaces any error) but is never imported anywhere else in the app. A user who uninstalls/reinstalls the app, or moves to a new device signed into the same Google account, has no in-app way to trigger a re-verification of previously-purchased non-consumables or to nudge subscription state — they'd have to contact support, even though the underlying plumbing to fix it themselves already exists and works.
**Fix:** Add a small "Restore Purchases" action (Settings → Account section is the natural home, next to the Data & Account export/delete section already there) that calls `restorePurchases()` and shows a toast/result.

### 10. ZB-AND-10 — Zero automated test coverage for the Android app
**Files:** `apps/android/` (entire package)
**Details:** A search for `*.test.*`/`*.spec.*` anywhere under `apps/android` returns nothing. Every other part of this monorepo has meaningful test investment: `apps/web/__tests__` (unit/integration), `apps/web/e2e` (Playwright, `playwright.config.ts` at repo root), and a dedicated `security-tests/` package (auth, admin, IDOR, injection, rate-limit). The Android app — which duplicates a large amount of business logic (token refresh, deep-link route allowlisting, purchase verification client state, referral capture) — has none, which is exactly why regressions like bugs #2, #3, #6, and #9 above can exist silently: there's no test that would fail when a hook is defined but never invoked, or when a button has no handler.
**Fix:** Start with a small, high-value unit-test surface using the same Vitest tooling already configured at the workspace root: the token-refresh single-flight lock in `lib/api/client.ts`, the push-notification route allowlist in `lib/push/index.ts` (`isAllowedRoute`), and — once fixed — the referral-capture and onboarding-redirect logic, since those are the highest blast-radius, least-visually-obvious failure modes.

### 11. ZB-AND-11 — Ad event reporting is unbatched
**Files:** `apps/android/src/components/ads/AdSlot.tsx`, compare `apps/web/lib/ads/adEventQueue.ts`
**Details:** Android's `reportEvent()` fires an immediate `apiClient.post('/ads/events', ...)` per impression and per click, with a code comment explicitly rationalizing this as "not worth retry complexity on mobile." The web implementation instead queues events client-side and flushes them in a batch via `sendBeacon` on unload/visibility-change, specifically so that "ad tracking costs at most a couple of requests per session, not one per impression" (per `docs/HOW-IT-WORKS.md`'s own Platform Advertising section). A feed screen with several `<AdSlot>` instances (e.g. Rooms in-stream ads, every N messages) will therefore generate meaningfully more API traffic on Android than the equivalent web session, which matters directly for the project's stated Vercel-Hobby/zero-cost-hosting goal.
**Fix:** Port the same local-queue-and-periodic-flush approach from `lib/ads/adEventQueue.ts` (swap `localStorage` for `@capacitor/preferences` or IndexedDB), flushing on interval and on `appStateChange` backgrounding instead of `sendBeacon` (which isn't meaningful inside a WebView the same way).

### 12. ZB-AND-12 — No pull-to-refresh anywhere in the app
**Files:** none implement it (checked broadly across `apps/android/src/routes/*` and `apps/web/app/(app)/**`)
**Details:** Neither the web/PWA nor the Android app implements a pull-to-refresh gesture on any feed-style screen (Rooms list, Moments feed, Notifications, Messages/DM list). For a Capacitor Android app in particular, this is one of the single most expected native-feeling mobile affordances, and its complete absence stands out against how much native-feeling polish exists elsewhere in this app (safe-area insets, splash screen, haptics, bottom-sheet-style drawers).
**Fix:** Add a lightweight pull-to-refresh wrapper — a small custom touch-gesture hook (no need for a new native dependency; a scroll-position + touch-delta hook wrapping `queryClient.invalidateQueries()` on the relevant query key is sufficient) around the Rooms, Moments, Notifications, and Messages list screens on Android at minimum, since those are the highest-frequency feed screens.

### 13. ZB-AND-13 — Debug log overlay is force-enabled for every build, with no release-safe path
**Files:** `.github/workflows/android-build.yml`, `apps/android/src/components/debug/DebugOverlay.tsx`, `apps/android/src/lib/env.ts`
**Details:** The only existing CI workflow (`android-build.yml`) builds `assembleDebug` and explicitly sets `VITE_DEBUG_OVERLAY: '1'` — intentional and reasonably justified for the current debug-APK-only distribution ("Force-enable... in production-flavoured debug APKs so errors are visible on mobile"). However, there is no second workflow/job/flag for producing a release build with the overlay off, and `env.ts`'s `VITE_APP_ENV` schema defaults to `'development'` if the build-time env var is ever omitted — so `DEBUG_OVERLAY_ENABLED` (`!FORCED_OFF && (FORCED_ON || DEV || VITE_APP_ENV !== 'production')`) would evaluate `true` in a hypothetical future release build unless someone remembers to both unset `VITE_DEBUG_OVERLAY` **and** explicitly set `VITE_APP_ENV=production`. Given `docs/SETUP.md` already describes uploading a signed release build to Play Console for IAP testing, this gap is live, not hypothetical — the overlay can export/share full console error text and stack traces via the native share sheet, which is not something that should reach a real Play Store build by default.
**Fix:** Add a distinct `release` job/workflow (or a `workflow_dispatch` input) that builds `assembleRelease`/`bundleRelease` with `VITE_DEBUG_OVERLAY` unset and `VITE_APP_ENV=production` explicitly set, and note the distinction in `docs/SETUP.md` right next to the existing "Build a signed release APK/AAB" instruction so it isn't reintroduced by copy-pasting the debug workflow later.

### 14. ZB-AND-14 — Chat poll "did anything change" check uses length-only comparison
**Files:** `apps/android/src/routes/rooms/$roomId.tsx`, `apps/android/src/routes/messages/$conversationId.tsx`
**Details:** Both chat surfaces' `useAdaptiveChatPoll({ poll: ... })` implementation fetches the latest page and only calls `qc.setQueryData(queryKey, fresh)` (reporting "changed") when `fresh.length !== prev.length`. If, between two polls, exactly one message was added and one was removed (e.g. a moderation/report action removes a message from the room at nearly the same moment another user sends a new one), the length stays identical and the client silently keeps showing the stale set until some later poll happens to produce a length delta. This is a subtle but real correctness gap in an area (moderation-sensitive chat surfaces) where staleness has real product consequences (a removed message reappearing to stay visible to one viewer while gone for everyone else).
**Fix:** Compare using the newest message id (or a cheap array-of-ids join/hash) instead of `.length`, so any content change — not just a count change — is detected and applied.

### 15. ZB-AND-15 — AdMob manifest config caches forever, never refreshes mid-session
**Files:** `apps/android/src/lib/ads/admob.ts`, compare `apps/android/src/lib/hooks/useManifest.ts`
**Details:** `getConfig()` in `admob.ts` caches the fetched AdMob configuration (`ad_admob_app_id`/unit IDs/test-mode) in a bare module-level variable (`cachedConfig`) with no expiry — once populated, it is reused for the remaining lifetime of the app process, however long that runs. Every other manifest-derived setting in this app (`useManifest()`, and everything built on it — `useCurrency`, `useMomentsConfig`, `useForumConfig`) goes through react-query with a 5-minute `staleTime`, specifically so admin-side config changes (documented as "read at runtime... no rebuild needed") propagate to already-running clients within minutes. AdMob silently breaks that guarantee: if an admin rotates a compromised/incorrect ad unit ID, or flips `admobAds` off in response to a policy issue, users with the app already open keep using the stale config until they fully close and reopen the app.
**Fix:** Replace the bespoke module-level cache with the same `useManifest()`/react-query path (reading `manifest.ads.admob` and `manifest.features.admobAds` reactively), consistent with every sibling hook in `lib/hooks/`.

---

## Also checked, no issue found

For transparency, these are the specific areas called out in the audit brief that were inspected in depth and found to already be correctly implemented on the current codebase (not re-reported as bugs):

- Webhook replay protection (Paystack: HMAC-SHA512 signature check + Redis `SET NX` dedup keyed on event reference, `app/api/economy/webhooks/paystack/route.ts`)
- IAP purchase-token idempotency/replay protection (`app/api/economy/iap/verify/route.ts` — `SELECT FOR UPDATE`, unique `reference_id`, 23505 → 409 conflict)
- CSRF/CORS handling for the Capacitor origin, including OPTIONS preflight (`apps/web/middleware.ts`)
- `is_admin` server-side re-verification against the database, not trusted from client/JWT (`AdminGuard.tsx`'s own comment + spot-checked admin API routes)
- DB circuit breaker wiring into every provider adapter, surfaced on `/api/health`
- ProGuard/R8 keep rules for the Capacitor bridge, Play Billing, AdMob, and FCM (release `minifyEnabled true` would previously have broken these)
- i18n key parity across all 9 locale files (2,761 keys each, no missing keys)
- Blog post HTML rendering (`dangerouslySetInnerHTML`) is server-sanitized via `sanitize-html` + `marked`, not raw user HTML
- Financial math uses `decimal.js` consistently across economy/creator/referral commission code
- Google Play subscription tier mutual-exclusivity (`group:` billing config) and server-side prior-subscription cancellation
- Push notification deep-link route allowlisting (prevents a malicious/crafted push payload from navigating to an arbitrary path)
- Rewarded-ad daily cap correctly namespaced per signed-in user (not per device)

---

## Rating: Current State vs. After Recommended Fixes

**Current state — Overall: 8.0 / 10** (mature, well-hardened platform; the gaps found are real but narrow and Android-specific, not systemic)

| Dimension | Current | Notes |
|---|---|---|
| Security (web/API layer) | 9/10 | CSRF, CORS, webhook signing/replay, RLS-style admin re-checks, rate limiting, and IAP idempotency are all already strong. |
| Security (Android client) | 6/10 | Pulled down specifically by unencrypted token storage + `allowBackup` (#4) and the forced-on debug overlay with no release path (#13). |
| Feature parity (Android vs. web) | 6.5/10 | Pulled down by the missing onboarding flow (#3), non-functional game play (#6), and dead referral capture (#2) — otherwise parity is genuinely excellent (36-page admin panel, full chat/rooms/moments/gifts/blogs coverage). |
| Performance/scalability/cost discipline | 7.5/10 | Excellent adaptive-polling design in principle, undermined on Android specifically by #8 (background poll leak) and #11 (unbatched ad events); #7's missing debounce is a smaller version of the same theme. |
| Code quality/structure | 8.5/10 | Consistently well-commented, consistent conventions across web/Expo/Android, good separation of concerns; #14/#15 are minor logic gaps, not structural problems. |
| Test coverage | 4/10 (Android specifically) | Web/security test suites are strong; Android has none (#10). |
| Release readiness (Play Store) | 5/10 | #5 (versionCode) would block every update after the first; #13 needs a release-safe build path before a real store listing. |
| i18n/accessibility | 7/10 | Strong locale-file coverage undermined by #1 (untranslated nav chrome) for the two most-visible UI surfaces. |

**Projected state after all 15 fixes are applied — Overall: 9.3 / 10**

| Dimension | Projected |
|---|---|
| Security (Android client) | 9/10 |
| Feature parity (Android vs. web) | 9.5/10 |
| Performance/scalability/cost discipline | 9/10 |
| Code quality/structure | 9/10 |
| Test coverage (Android) | 7/10 (baseline suite added; still short of web's depth, expected for a first pass) |
| Release readiness (Play Store) | 9/10 |
| i18n/accessibility | 9/10 |

None of the 15 findings require architectural change — every fix reuses a pattern, hook, or convention that already exists elsewhere in this same codebase (the Expo app, the web app, or a sibling Android file). That is what makes 9.3/10 realistic rather than aspirational once the fix plan (see `custom-bugs-fix-plan.md`) is executed.

---

**Report generated:** 2026-07-03 (July 3, 2026), 02:21 PM UTC
**— End of custom-bugs-report.md —**
