# Zobia Capacitor Android App — Custom Bug Fix Plan

**Plan generated:** 2026-07-03 (July 3, 2026), 02:21 PM UTC
**Companion to:** `custom-bugs-report.md` (15 findings, ZB-AND-01 through ZB-AND-15)

**IMPORTANT: This is a plan only. No fixes have been implemented yet.** Per instructions, implementation should wait for explicit review/approval of this plan.

**Guiding principles for every fix below:**
- Reuse existing conventions, patterns, hooks, and libraries already present in this codebase (web, Expo, or sibling Android files) before introducing anything new. Every task below names the exact existing pattern to copy.
- No new dependencies unless explicitly called out as unavoidable (only one task below, T5, even considers one, and it offers a zero-new-dependency alternative first).
- Preserve the project's existing file/module boundaries (`lib/hooks/`, `lib/deeplinks/`, `lib/payments/`, etc.) — new code goes where its sibling code already lives, not into new top-level structures.
- Each task is independently shippable and testable; ordering below is by severity/dependency, not a strict sequence requirement (T1–T3 should land together since they compound).

---

## Phase 0 — Sequencing note

Tasks **T2 (referral capture)** and **T3 (onboarding flow)** are tightly coupled — the onboarding screen is the actual consumer of the referral code T2 captures. Implement/ship them together as one unit of work. Everything else is independent and can be done in any order or in parallel.

---

## Task List

### T1 — Localize the bottom nav & drawer menu (fixes ZB-AND-01)
**Files to touch:** `apps/android/src/components/layout/BottomNav.tsx`, `apps/android/src/components/layout/TopBar.tsx`, `shared/i18n/locales/*.json` (9 files)
**Plan:**
1. In `BottomNav.tsx`, add `import { useTranslation } from 'react-i18next';` and call `const { t } = useTranslation();` inside `BottomNav()`.
2. Replace the `bottomTabItems` array's `label`/`shortLabel` fields with `t()` calls. Reuse existing keys already used elsewhere in this app for the same concepts (`__root.tsx`'s `getTitle()` already maps these routes to keys like `home.title`, `quests.title`, `wallet.title`, `profile.title`) — for `shortLabel` (the small under-icon caption), reuse the same key or a shorter existing one if present; only add a new key where none exists.
3. In `TopBar.tsx`, do the same for `primaryNavItems` and `secondaryNavItems` — most of these route names already have a corresponding `t('xxx.title')` key from the `getTitle()` switch in `__root.tsx`; cross-reference that switch statement first before adding any new key, since most work is likely just wiring, not authoring new copy.
4. For any nav item with no existing key (e.g. "Browse Guilds" reads differently from "Guild"), add a new flat key (e.g. `nav.browseGuilds`) to `shared/i18n/locales/en.json` first, then have every other locale file translated consistently — this repo already has a translation harvesting script (`scripts/harvest-admin-i18n.py`) as a model for how bulk key additions have been handled before; follow the same "add to `en.json`, then fill in the other 8" workflow, keeping the file's existing flat key-count parity (currently 2,761 keys in every locale) intact.
5. Verify: run the app, switch device/app language to `ar` (RTL) and `sw`, and visually confirm the bottom bar and drawer render translated text with no layout regression (icons are unaffected, only text).

### T2 — Wire up referral deep-link capture (fixes ZB-AND-02; pairs with T3)
**Files to touch:** `apps/android/src/main.tsx` or `apps/android/src/routes/__root.tsx`
**Plan:**
1. Import `useReferralCaptureFromLink` from `@/lib/deeplinks/referral` into `AppShell` in `__root.tsx` (this component already imports and mounts `usePresenceHeartbeat()` at the top — add the referral hook call right alongside it, same shape as the Expo app's `_layout.tsx:47,280` call site).
2. Call `useReferralCaptureFromLink();` unconditionally near the top of `AppShell()` — it's a lightweight `appUrlOpen` listener registration, safe to run regardless of auth state (mirrors how `CapApp.addListener('appUrlOpen', ...)` is already separately registered in the very same component for the gift/OAuth deep links — this hook is simply a second listener on the same native event, which Capacitor supports without conflict since each call to `addListener` gets its own subscription).
3. No changes needed inside `lib/deeplinks/referral.ts` itself — it's already correct; this task is purely "call the thing that already exists."
4. Verify: build a debug APK, use `adb shell am start -a android.intent.action.VIEW -d "zobia://home?r=TESTCODE123"` to simulate a referral deep link while the app is running, then confirm (via a temporary console log or the DebugOverlay) that `Preferences.get({ key: 'pending_referral' })` returns `TESTCODE123`.

### T3 — Add the missing onboarding flow (fixes ZB-AND-03; pairs with T2)
**Files to touch:** new `apps/android/src/routes/onboarding.tsx`, `apps/android/src/routes/__root.tsx` (OAuth callback branch), `apps/android/src/lib/api/client.ts` (background user-update object), `shared/schemas/api/auth.ts` (optional, see step 4)
**Plan:**
1. Design the onboarding screen as a single-page form (username override, city, country, avatar emoji picker, and — if a pending referral code exists via T2's `getPendingReferralCode()` — a pre-filled, editable referral code field), modeled directly on `apps/web/app/onboarding/page.tsx`'s field set and validation rules, and visually consistent with this app's other form screens (e.g. `routes/auth/two-factor.tsx` for form layout conventions).
2. On submit, call `POST /api/onboarding/complete` with the same body shape the web client sends (check `apps/web/app/onboarding/page.tsx`'s submit handler for the exact field names) — this is the existing, already-battle-tested endpoint; no server-side changes are needed.
3. On success, call `clearPendingReferralCode()` (T2), update the auth user state via the existing `setAuth`/`useAuth()` pattern already used everywhere else in this app, and navigate to `/home`.
4. Fix the routing decision itself: in `__root.tsx`'s OAuth `appUrlOpen` handler, the `normalizedUser` object built before `AuthUserSchema.safeParse(...)` needs an onboarding-completion field carried through. Since `AuthUserSchema` (shared) intentionally excludes it (used by both web and Expo for a minimal, stable contract), do **not** widen the shared schema — instead, read `rawUser.onboardingCompleted ?? rawUser.onboarding_completed` directly off `data.user` *before* Zod-parsing it into the stored `AuthUser`, exactly the way `apps/expo/lib/api/client.ts:198` already does it, and use that raw boolean (not a field on the parsed/stored object) purely to decide `navigate({ to: onboardingCompleted ? '/home' : '/onboarding' })`. This keeps the shared schema untouched (no ripple effect on web/Expo) while fixing the navigation decision.
5. Apply the identical fix to the two other places a user object is currently blindly treated as "fully set up": the background `/api/users/me` refresh in `lib/api/client.ts` (`refreshAccessToken`'s inner IIFE) doesn't need a redirect (it's a background sync, not a navigation event) but should log/no-op consistently; skip changing it unless you want an extra defensive check for a returning user whose account was later reset server-side (unlikely; not required for this fix).
6. Verify end-to-end: sign up as a brand-new user via Google OAuth on a debug build, confirm landing on `/onboarding` (not `/home`), submit the form, confirm the referral captured in T2's test flows through to `/api/onboarding/complete` and the referrer receives their tier-1 referral credit (check `referrals` table or the referrer's `/referrals` screen).

### T4 — Protect stored auth tokens from backup/extraction (fixes ZB-AND-04)
**Files to touch:** `apps/android/android/app/src/main/AndroidManifest.xml`, new `apps/android/android/app/src/main/res/xml/data_extraction_rules.xml`, new `apps/android/android/app/src/main/res/xml/full_backup_content.xml`
**Plan (minimum-effort, no new dependency, ship first):**
1. Add `res/xml/data_extraction_rules.xml` (Android 12+) with a `<cloud-backup>`/`<device-transfer>` block that excludes the SharedPreferences file Capacitor Preferences writes to (default file name is `CapacitorStorage` — confirm the exact file name by inspecting a debug build's `/data/data/com.zobiasocial.app/shared_prefs/` directory, since Capacitor 6's Preferences plugin name may differ slightly by version) using an `<exclude domain="sharedpref" path="....xml"/>` rule.
2. Add the legacy equivalent `res/xml/full_backup_content.xml` with the same exclusion, for pre-Android-12 devices, since `allowBackup="true"` is still in effect there.
3. Reference both new files from `AndroidManifest.xml`'s `<application>` tag: `android:dataExtractionRules="@xml/data_extraction_rules"` and `android:fullBackupContent="@xml/full_backup_content"`.
4. Verify: `adb backup -f test.ab com.zobiasocial.app` on a debug-signed test device (requires USB debugging + user confirmation on-device), extract the resulting archive, and confirm the JWT/refresh-token file is absent while non-sensitive prefs (language, device id) are still present (confirms the exclusion is scoped correctly, not over-broad).

**Plan (stronger fix — do only if the above ships and there's appetite for a slightly larger change):**
5. Introduce a Keystore-backed storage plugin (`capacitor-secure-storage-plugin` is the natural choice given this app already uses several community Capacitor plugins) scoped *only* to `JWT_KEY`/`REFRESH_TOKEN_KEY` in `lib/api/client.ts` — leave `zobia_user`, `zobia_lang`, `zobia_device_id`, `zobia_ad_reward_cap_date:*`, and `pending_referral` on the existing Preferences API, since none of those are sensitive and switching them adds migration risk for no security benefit.
6. Add a one-time migration on app boot: read any existing plaintext token from Preferences, move it into the new secure store, then delete the plaintext copy — so upgrading users aren't logged out.

### T5 — Bump `versionCode`/`versionName` from CI (fixes ZB-AND-05)
**Files to touch:** `apps/android/android/app/build.gradle`, `.github/workflows/android-build.yml`
**Plan:**
1. In `build.gradle`, change the hardcoded `versionCode 1` / `versionName "1.0.0"` to read from Gradle project properties with a safe fallback: `versionCode (project.hasProperty('versionCode') ? project.property('versionCode').toInteger() : 1)`, same idea for `versionName`.
2. In `android-build.yml`'s "Build debug APK" step, pass `-PversionCode=${{ github.run_number }} -PversionName=1.0.${{ github.run_number }}` (or a proper semver tag if/when this project starts tagging releases) to the `./gradlew assembleDebug` invocation.
3. No new dependency; this is a Gradle-only change. Zero risk to the debug-build pipeline since the fallback keeps today's behavior when the properties aren't passed (e.g. local `./gradlew` runs during development).
4. Verify: trigger the workflow twice and confirm the two resulting APKs report different `versionCode` values via `aapt dump badging app-debug.apk | grep versionCode`.

### T6 — Make games playable on Android (fixes ZB-AND-06)
**Files to touch:** `apps/android/src/routes/games/$slug.tsx`
**Plan:**
1. Add an `onClick` handler to the existing Play button that calls `Browser.open({ url: universalLink('/g/${slug}/play'), presentationStyle: 'popover' })`, importing `Browser` from `@capacitor/browser` and `universalLink` from `@/lib/deeplinks/routes` — both already imported and used this exact way in `routes/kyc.tsx` and `routes/ads/index.tsx`, so this is a copy-paste-and-adapt, not new integration work.
2. Since the web `/g/[slug]/play` route requires an authenticated web session (cookie-based) and the Android app only has a Bearer token (no cookie), confirm with a quick manual test whether Custom Tabs share cookies with any existing web login for this user (they generally will not, since Custom Tabs are a separate cookie jar from the app's own WebView). If the user is not already logged into the *web* session inside the Custom Tab, `/g/[slug]/play` will bounce them to a login gate per its own logic (`if (!user) router.replace('/g/${slug}')`). To avoid forcing a second login inside the browser tab, extend the mobile-token exchange pattern already used for OAuth (`/api/auth/mobile-token`) — specifically, generate a short-lived one-time "web session handoff" link (server-side, reusing the existing pre-auth-code/exchange-code pattern already built for OAuth in `apps/web/app/api/auth/google/callback/route.ts`) that the app opens instead of the bare `/g/<slug>/play` URL, so the Custom Tab lands already authenticated. This is the one piece of this task that may need a small, narrowly-scoped server-side endpoint reusing an existing pattern (mobile exchange codes) rather than inventing a new auth mechanism.
3. Verify: tap Play on a real device/emulator, confirm the Custom Tab opens the game already logged in (not bounced to a login screen), play a full round, and confirm credits/XP awarded server-side show up back in the native app's Wallet screen after backgrounding/returning (which will trigger the existing token-refresh background user-sync in `lib/api/client.ts`).

### T7 — Debounce the Games search input (fixes ZB-AND-07)
**Files to touch:** `apps/android/src/routes/games/index.tsx`
**Plan:**
1. Split the single `search` state into `searchInput` (bound to the `<input>`) and a debounced `search` (used in the `useQuery` key), exactly mirroring `apps/web/app/(app)/games/page.tsx:175-192`'s existing `useEffect(() => { const t = setTimeout(() => setSearch(searchInput), 250); return () => clearTimeout(t); }, [searchInput]);` pattern — copy it verbatim, it's framework-agnostic React with no web-specific API.
2. Verify: type a search term quickly in the emulator/device and confirm (via network inspector or a temporary log) only one request fires ~250ms after the last keystroke, not one per keystroke.

### T8 — Make adaptive chat polling pause reliably in the background (fixes ZB-AND-08)
**Files to touch:** `apps/android/src/lib/hooks/useAdaptiveChatPoll.ts`
**Plan:**
1. Import `App` from `@capacitor/app` (already a project dependency, used identically in `lib/api/client.ts` and `usePresenceHeartbeat.ts`).
2. Inside the hook's main `useEffect`, register `App.addListener('appStateChange', ({ isActive }) => { if (!isActive) { stopped = true; clear(); } else { stopped = false; pokeNow(); } })` alongside the existing `document.addEventListener('visibilitychange', ...)` — both listeners can safely coexist and set the same `stopped`/`clear`/`pokeNow` local state; whichever fires first (or both) converges to the same paused/resumed state.
3. Clean up the new listener in the effect's teardown (`handle.then(h => h.remove())`), matching the removal pattern already used for every other Capacitor listener in this codebase (e.g. `usePresenceHeartbeat.ts`'s own cleanup).
4. Verify: open a room chat on a real device, background the app (press Home), wait 60+ seconds, and confirm via a temporary console log (visible in DebugOverlay in a debug build) that no poll fired while backgrounded, then confirm a poll fires immediately upon returning to foreground.

### T9 — Add a "Restore Purchases" button (fixes ZB-AND-09)
**Files to touch:** `apps/android/src/routes/settings.tsx` (or `wallet.tsx` — settings is the more discoverable, conventional home for this action)
**Plan:**
1. Add a button in the Settings screen's Account/Data section (near the existing Data Export UI referenced in the report) that calls the already-exported `restorePurchases()` from `@/lib/payments/googlePlay`, with loading/error/success states following the same pattern already used for `handleExport`/`handleDeleteAccount` in that same file.
2. Show a toast/inline message summarizing the result (`restorePurchases()` already returns `{ error?: string }`).
3. Verify: on a test device with a prior purchase associated with the signed-in Google account, uninstall/reinstall the app, sign back in, tap "Restore Purchases," and confirm the prior entitlement (e.g. subscription plan) is re-applied without needing a fresh purchase.

### T10 — Add a baseline Android test suite (fixes ZB-AND-10)
**Files to touch:** new `apps/android/src/lib/api/__tests__/client.test.ts`, new `apps/android/src/lib/push/__tests__/index.test.ts`, new `apps/android/src/lib/deeplinks/__tests__/referral.test.ts`, `apps/android/package.json` (add a `test` script + `vitest` devDependency if not already available at the workspace root)
**Plan:**
1. Confirm whether Vitest is already available at the repo root (it's implied by `apps/web`'s test setup) and can be reused for `apps/android` with minimal config, versus needing its own local `vitest.config.ts` — prefer reusing the root tooling/config conventions over inventing new ones.
2. Write unit tests for: (a) `refreshAccessToken()`'s single-flight behavior (two concurrent callers get the same in-flight promise, not two network calls) in `lib/api/client.ts`; (b) `isAllowedRoute()`'s allowlist matching/rejection in `lib/push/index.ts`; (c) `captureReferralFromUrl`/`isValidReferralCode`/`getPendingReferralCode` round-trip in `lib/deeplinks/referral.ts` (this test would have caught bug #2's dead-code problem at the integration level if it had also asserted the hook is actually mounted — consider a lightweight render test of `__root.tsx`/`main.tsx` asserting `useReferralCaptureFromLink` is invoked, using React Testing Library the same way `apps/web/__tests__` likely already does for component-level assertions).
3. Add `"test": "vitest run"` to `apps/android/package.json` and wire it into the root `package.json`'s `"test"`/`"typecheck"` workspace scripts alongside the existing `apps/web` ones, and into CI if there's a lint/typecheck CI step already running for this workspace.

### T11 — Batch ad event reporting (fixes ZB-AND-11)
**Files to touch:** `apps/android/src/components/ads/AdSlot.tsx`, new `apps/android/src/lib/ads/adEventQueue.ts`
**Plan:**
1. Port `apps/web/lib/ads/adEventQueue.ts`'s queue/flush logic into a new Android-side module at the same relative path, swapping `localStorage` for `@capacitor/preferences` (or `idb-keyval`, already a project dependency via the query persister) as the queue's storage backend.
2. Flush the queue on an interval (e.g. every 15-30s while any `AdSlot` is mounted) and additionally on `App.addListener('appStateChange', ({ isActive }) => { if (!isActive) flushQueue(); })`, since `sendBeacon` isn't a meaningful analog inside a Capacitor WebView — an explicit flush-on-background covers the same "don't lose the last batch on close" goal.
3. Update `AdSlot.tsx`'s `reportEvent()` to enqueue instead of immediately POSTing.
4. Verify: view a feed with several ad slots, confirm (via network inspector) that impressions are sent in a single batched request rather than one-per-slot, and confirm backgrounding the app still flushes any queued-but-unsent events.

### T12 — Add pull-to-refresh to feed screens (fixes ZB-AND-12)
**Files to touch:** new `apps/android/src/components/ui/PullToRefresh.tsx`, `apps/android/src/routes/rooms/index.tsx`, `apps/android/src/routes/moments/index.tsx`, `apps/android/src/routes/notifications.tsx`, `apps/android/src/routes/messages/index.tsx`
**Plan:**
1. Build a small, dependency-free `PullToRefresh` wrapper component (touch-start/touch-move delta on a scrolled-to-top container, revealing a simple spinner/pull affordance past a threshold, calling an `onRefresh: () => Promise<void>` prop) — styled consistently with the app's existing Tailwind conventions (see `SkeletonCard`/spinner styles already used in `games/index.tsx` and `AuthGuard.tsx` for the loading-spinner visual language to match).
3. Wrap the four listed feed screens' scrollable containers with it, wiring `onRefresh` to each screen's existing `queryClient.invalidateQueries({ queryKey: [...] })` (each screen already has this exact query key available from its own `useQuery` call).
4. Verify on a real device (touch gestures don't reliably simulate in desktop browser dev tools): pull down on each of the four screens, confirm a refresh visibly occurs and the gesture doesn't conflict with normal scrolling.

### T13 — Add a release-safe build path without the debug overlay (fixes ZB-AND-13)
**Files to touch:** `.github/workflows/android-build.yml` (or a new sibling workflow file, e.g. `android-release-build.yml`), `docs/SETUP.md`
**Plan:**
1. Add a new job (or a `workflow_dispatch` boolean input, e.g. `release: true/false`, on the existing workflow) that runs `./gradlew bundleRelease`/`assembleRelease` instead of `assembleDebug`, with env `VITE_APP_ENV: production` and **no** `VITE_DEBUG_OVERLAY` set (letting it default to unset/off, per `DebugOverlay.tsx`'s own `FORCED_OFF`/`FORCED_ON` logic — explicitly leaving it unset rather than setting `'0'` is fine either way, but being explicit (`VITE_DEBUG_OVERLAY: '0'`) is the safer, more self-documenting choice).
2. Since `release { minifyEnabled true }` is already configured in `build.gradle` (per the prior ProGuard-rules fix), no Gradle changes are needed beyond what T5 already adds for versioning — this task is CI/workflow-only.
3. Signing: do not commit a real signing keystore. Follow standard practice — inject a base64-encoded keystore + credentials via GitHub Actions secrets at build time (a new secret set, e.g. `ANDROID_KEYSTORE_BASE64`/`ANDROID_KEYSTORE_PASSWORD`/`ANDROID_KEY_ALIAS`/`ANDROID_KEY_PASSWORD`), decoded to a temp file in the workflow step, and referenced from a `signingConfigs.release` block in `build.gradle` that reads those same values from Gradle properties/env — this is the one place this plan calls for genuinely new configuration (not reusing an existing pattern) since no release signing currently exists anywhere in the repo; keep it minimal and exactly mirror how `google-services.json`/`GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` are already handled as base64-or-raw secrets elsewhere in this project's env-var conventions (per `docs/SETUP.md`'s existing "base64-encoded or raw" pattern for other credentials).
4. Update `docs/SETUP.md`'s existing "Build a signed release APK/AAB and upload it to an internal testing track" line to point at this new workflow/job instead of leaving it as a manual, undocumented step.
5. Verify: run the new workflow, confirm the produced artifact is a signed release build, confirm (by decompiling or just checking build logs) that `VITE_APP_ENV=production` and `VITE_DEBUG_OVERLAY` is absent/`'0'`, and spot-check that `DebugOverlay` renders nothing when the app is launched from this build.

### T14 — Fix chat poll change-detection to compare content, not just length (fixes ZB-AND-14)
**Files to touch:** `apps/android/src/routes/rooms/$roomId.tsx`, `apps/android/src/routes/messages/$conversationId.tsx`
**Plan:**
1. In both files' `useAdaptiveChatPoll({ poll: async () => {...} })` callback, replace the `fresh.length !== prev.length` check with a comparison of the newest item's `id` (`fresh[fresh.length - 1]?.id !== prev[prev.length - 1]?.id`) **combined with** the existing length check (so both a pure-append and a same-length swap are caught) — i.e. `const changed = fresh.length !== prev.length || fresh[fresh.length - 1]?.id !== prev[prev.length - 1]?.id;`. This is a minimal, local change with no new dependency and no server contract change.
2. Verify: manually test by having one client send a message while (via an admin/moderation action) another message is concurrently removed from the same room, and confirm the surviving client picks up both changes on the next poll rather than only on a subsequent length-changing event.

### T15 — Route AdMob config through the shared manifest cache (fixes ZB-AND-15)
**Files to touch:** `apps/android/src/lib/ads/admob.ts`
**Plan:**
1. Replace the bespoke `cachedConfig`/`getConfig()` module-level cache with calls into the existing `useManifest()` hook's underlying react-query cache — since `admob.ts`'s functions (`showBanner`, `showInterstitial`, `showRewarded`) are plain async functions (not React hooks) called from event handlers, use `queryClient.getQueryData(['manifest'])` (importing the shared `queryClient` singleton from `@/lib/query/client`, already exported for exactly this kind of non-component access) as a synchronous read, falling back to `queryClient.fetchQuery(['manifest'], fetchManifest)` if the cache is empty, so it participates in the same 5-minute `staleTime` as every other manifest consumer instead of maintaining its own cache with no expiry.
2. Remove the now-redundant module-level `cachedConfig` variable entirely.
3. Verify: with the app open and idle, change `ad_admob_test_mode` (or another `ad_admob_*` key) via `/admin/config` on the web admin panel, wait 5+ minutes (past the manifest's `staleTime`), trigger an ad (`showBanner`), and confirm the updated config is used without force-closing the app.

---

## Suggested Rollout Order

1. **T5** (versionCode fix) — trivial, zero risk, unblocks any future release regardless of what else ships.
2. **T2 + T3** (referral + onboarding) together — highest business impact, since every Android signup today is affected.
3. **T4** (token storage hardening) — security-sensitive, should not wait behind feature work.
4. **T6** (playable games) — highest user-facing functional impact after onboarding.
5. **T8, T14** (chat poll reliability/correctness) — cheap, local, no dependency changes, meaningful cost/correctness wins.
6. **T1** (i18n nav) — mechanical, can be scheduled whenever translation-review bandwidth is available (needs a native/fluent speaker pass on any newly-added keys across all 9 locales, not just English).
7. **T7, T9, T11, T15** (search debounce, restore purchases, ad batching, admob cache) — all small, independent, low-risk polish items; good candidates to batch into one PR together.
8. **T13** (release-safe build pipeline) — do before the first real Play Store submission, not urgent until then.
9. **T12** (pull-to-refresh) — pure UX polish, no urgency, good "next sprint" candidate.
10. **T10** (test suite) — ideally threaded through T2/T3/T6 as they're built (test-as-you-fix), rather than bolted on afterward; listed last only because it has no user-facing urgency of its own.

---

**Plan generated:** 2026-07-03 (July 3, 2026), 02:21 PM UTC
**— End of custom-bugs-fix-plan.md — DO NOT IMPLEMENT UNTIL REVIEWED —**
