# Zobia Social — Custom Bug Fix Plan

**Plan generated:** Friday, July 03, 2026 · 12:24 PM UTC
**Companion document to:** `custom-bugs-report.md` (read that first — this plan assumes its findings/serials)
**Status: NOT YET IMPLEMENTED.** Per instructions, no code has been changed. This is a task/plan for review before any fix work begins.

**Guiding principle for every task below:** reuse the existing convention already established elsewhere in this codebase (the same rate-limit presets, the same `RedisCircuitBreaker` class, the same `withAuth`/`ApiError` error-handling shape, the same JSDoc style, the same i18n key structure, the same Decimal.js usage) rather than introducing a new pattern. Every task explicitly names the existing file/pattern to mirror.

---

## Sequencing

Ordered by (a) blast radius if shipped broken, (b) dependency between fixes (App Links must land before the OAuth callback can move to it), and (c) effort. Suggested execution order:

1. **BUG-CAP-01** (ProGuard) — do this first; it's a release-build blocker and independent of everything else.
2. **BUG-CAP-03** (App Links) — unblocks BUG-CAP-04.
3. **BUG-CAP-04** (OAuth callback → verified universal link) — depends on #2.
4. **BUG-CAP-05** (subscription grouping + server cancel-on-switch)
5. **BUG-CAP-02** (DB circuit breaker wiring)
6. **BUG-CAP-08** (push init guard)
7. **BUG-CAP-11** (hardcoded app version) — trivial, bundle with #6 since both touch push/app lifecycle territory.
8. **BUG-CAP-06** (session management API + UI)
9. **BUG-CAP-07** (Android settings parity) — naturally follows #8 since the new Security section reuses the sessions API.
10. **BUG-CAP-09** (manifest screenshots) — trivial, do anytime.
11. **BUG-CAP-10** (migration checksum verification) — trivial, do anytime, no urgency.
12. **BUG-CAP-12** (games catalog) — no code task; an ops verification step (see below), can run in parallel with anything.

---

## Task 1 — Fix ProGuard rules for release Android builds (BUG-CAP-01)

**Files:** `apps/android/android/app/proguard-rules.pro`, `apps/android/android/app/build.gradle`

- [ ] Add keep rules for the Capacitor bridge and installed plugins to `proguard-rules.pro`:
  - `-keep class com.getcapacitor.** { *; }`
  - `-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }` (or the equivalent annotation-keep pattern Capacitor's own docs recommend for the installed Capacitor version)
  - Keep rules for `capacitor-plugin-cdv-purchase`'s underlying Play Billing classes (`com.android.billingclient.api.**`) — check that plugin's own `consumer-rules.pro`/README for the exact recommended set rather than guessing, since AAR-bundled plugins often ship their own consumer ProGuard rules that Gradle should already merge automatically; confirm they *are* being merged (`grep -r consumerProguardFiles` across the plugin's AAR / Gradle module) before assuming manual rules are even necessary — add manual rules only for what isn't already covered.
  - Keep rules for AdMob (`com.google.android.gms.ads.**`) — Google publishes an official recommended ProGuard snippet for AdMob; use that verbatim rather than reinventing it.
- [ ] Build a real **release** artifact locally: `cd apps/android && npm run build && npx cap sync android`, then in `apps/android/android`, run `./gradlew assembleRelease` (or `bundleRelease`).
- [ ] Install that release APK on a test device (`adb install`) and manually exercise: a coin purchase (sandboxed/test track), a push-notification round trip, and an AdMob test-ad render. This is the only way to catch this class of bug — debug builds will look fine either way.
- [ ] Re-run this same release-build smoke test as a standing pre-submission checklist item in `docs/SETUP.md`'s existing AdMob/Play Billing section (it already documents the App ID swap step — add the release-build test alongside it rather than creating a new doc).

---

## Task 2 — Wire the existing DB circuit breaker into real query paths (BUG-CAP-02)

**Files:** `apps/web/lib/db/circuit.ts` (reuse as-is), `apps/web/lib/db/index.ts`, `apps/web/lib/db/providers/supabase.ts`, `railway.ts`, `digitalocean.ts`, `apps/web/app/api/health/route.ts`

- [ ] Do **not** create a new circuit-breaker abstraction — `dbCircuit`/`withCircuitBreaker` in `lib/db/circuit.ts` already exists and already reuses `RedisCircuitBreaker` from `lib/payments/circuit.ts`. The only work is wiring it in.
- [ ] Wrap each provider adapter's `query()` and `transaction()` methods with `withCircuitBreaker(() => ...)`. The cleanest integration point given the existing Proxy-based `db` export in `lib/db/index.ts` is to wrap inside each adapter class method (so `healthCheck()` stays a raw, unwrapped probe — it needs to actually hit the DB to detect recovery, matching how `RedisCircuitBreaker`'s existing `successThreshold`/half-open behavior expects a real call through).
- [ ] When the circuit is open, let the thrown circuit-open error propagate to the same `handleApiError()` path every route already uses (check what error shape `RedisCircuitBreaker.execute()` throws today via its existing usage in `lib/payments/paystack.ts`, and map it to a 503 `ApiError` the same way, rather than inventing a new error code).
- [ ] Add a `checks.dbCircuit` field to `GET /api/health` (`apps/web/app/api/health/route.ts`) reporting the circuit's current state (closed/open/half-open), following the exact `checks`/`latencyMs`/`errors` object shape that route already uses for `db` and `redis`.
- [ ] Add/extend a unit test alongside the existing `lib/db/__tests__/providerLeakage.test.ts` (or a new `lib/db/__tests__/circuit.test.ts` if one doesn't exist) confirming a forced provider failure trips the breaker and that `healthCheck()` still executes during the open state (needed for recovery detection).

---

## Task 3 — Make Android App Links actually verify (BUG-CAP-03)

**Files:** `apps/android/android/app/src/main/AndroidManifest.xml`, `apps/web/public/.well-known/assetlinks.json`

- [ ] Obtain the real release-signing certificate's SHA-256 fingerprint (`keytool -list -v -keystore <release-keystore> ...` or read it from the Play Console's "App signing" page if Play App Signing is used — the Play-held key's fingerprint, not just the local upload key, must be included since that's what actually signs the APK end users install).
- [ ] Replace the `REPLACE_WITH_YOUR_APP_SIGNING_CERT_SHA256` placeholder in `apps/web/public/.well-known/assetlinks.json` with that real value. If both a debug and release fingerprint need to coexist for testing, add both as separate array entries in the same file (this is the standard multi-fingerprint pattern — no new mechanism needed).
- [ ] Add a second `<intent-filter android:autoVerify="true">` block to the existing `MainActivity` entry in `AndroidManifest.xml` (alongside, not replacing, the current `zobia://` filter), with `<data android:scheme="https" android:host="zobia.org" />` and `android.intent.category.BROWSABLE`/`DEFAULT` categories matching the existing filter's structure.
- [ ] Verify locally with `adb shell pm get-app-links com.zobiasocial.app` after a fresh install — look for `verified` status against `zobia.org`, not `legacy_failure` or `unknown`.
- [ ] No server-side route changes are needed — `apps/web/lib/deeplinks/routes.ts` and the public slug resolvers (`lib/public/resolveRoom.ts` etc., per `SEO.md`) already serve these exact paths over HTTPS; this task only makes Android recognize them as app-openable.

---

## Task 4 — Move OAuth callback to the verified universal link (BUG-CAP-04)

**Depends on:** Task 3.
**Files:** `apps/android/src/routes/auth/login.tsx`, `apps/android/src/routes/__root.tsx`, `apps/web/app/api/auth/google/route.ts` (`ALLOWED_REDIRECT_SCHEMES`), `apps/web/app/api/auth/mobile-token/route.ts`

- [ ] Change `CALLBACK_DEEP_LINK` in `apps/android/src/routes/auth/login.tsx` from `'zobia://auth/callback'` to the verified universal link, e.g. `'https://zobia.org/auth/callback'`.
- [ ] Confirm `isRedirectAllowed()` in `apps/web/app/api/auth/google/route.ts` already permits this — it currently allows `https:`/`http:` redirects back to `env.NEXT_PUBLIC_APP_URL`'s hostname, so this should need **no change** there; just confirm `NEXT_PUBLIC_APP_URL` resolves to `zobia.org` in production.
- [ ] `apps/android/src/routes/__root.tsx`'s `appUrlOpen` listener currently parses `zobia://auth/callback` via `parsed.hostname === 'auth' && parsed.pathname === '/callback'`. Once the callback is an `https://zobia.org/auth/callback?code=...` App Link, Capacitor's `appUrlOpen` event still fires with that full URL (Android App Links route through the same event) — update the hostname/pathname check to also match `parsed.hostname === 'zobia.org' && parsed.pathname === '/auth/callback'`, keeping the existing `zobia://` custom-scheme branch as a fallback (don't delete it — retain it for any OEM browsers/edge cases that don't support App Links).
- [ ] Do **not** touch the exchange-code TTL/single-use logic in `mobile-token/route.ts` — that part is already correct and becomes strictly more secure once delivery is via a verified link.
- [ ] Re-test the full Google + Telegram login round trip on a real device after this change (both cold-start deep link and warm-app deep link cases, matching the existing `useReferralCaptureFromLink` cold/warm distinction already handled elsewhere in this codebase).

---

## Task 5 — Make subscription tiers mutually exclusive + cancel-on-switch (BUG-CAP-05)

**Files:** `apps/android/src/lib/payments/googlePlay.ts`, `apps/web/app/api/economy/iap/verify/route.ts`, `apps/web/lib/payments/googlePlayVerify.ts`

- [ ] In `googlePlay.ts`, add `group: 'plan_tier'` to every entry in the `SUBSCRIPTION_IDS.map(...)` registration inside `initGooglePlayBilling()` — copy the exact pattern already used one line below for `BUSINESS_IDS`.
- [ ] In `verifyAndActivateSubscription()` (`app/api/economy/iap/verify/route.ts`), before the `UPDATE users SET plan = $1` transaction: look up the user's currently-active plan/purchase token (if a prior `iap:sub:*` ledger entry exists for a *different* plan tier than the one being verified now), and call a new `cancelGooglePlaySubscription()` helper in `lib/payments/googlePlayVerify.ts` (same file/module already housing `verifyGooglePlaySubscriptionPurchase`/`acknowledgeGooglePlaySubscription` — add the cancel call there using the same JWT-signed Google Play Developer API auth those functions already share) against the old purchase token so Google Play actually stops billing it.
- [ ] Add a regression test alongside the existing `apps/web/lib/games/__tests__/wager.test.ts`-style unit tests (or wherever payment-flow tests currently live, e.g. check for an existing `economy` or `payments` test directory) covering: verify Plus → verify Pro → assert old subscription is cancelled and `users.plan = 'pro'`.

---

## Task 6 — Push notification permission guard fix + real app version (BUG-CAP-08, BUG-CAP-11)

**Files:** `apps/android/src/lib/push/index.ts`, `apps/android/src/routes/settings.tsx`

- [ ] In `initPushNotifications()`, move `initialized = true` to immediately before `await PushNotifications.register()` (i.e., only latch once registration is actually attempted), not at the top of the function.
- [ ] Add an `App.addListener('appStateChange', ({ isActive }) => { if (isActive) recheckPushPermission(); })` hook (reusing the same `@capacitor/app` `appStateChange` event already consumed in `apiClient`'s `focusManager.setEventListener`) that re-runs the permission-check-and-register path on foreground if the last known state was "not granted" — this mirrors the existing focus/online manager wiring pattern already in `lib/api/client.ts` instead of inventing a new lifecycle hook.
- [ ] In `apps/android/src/routes/settings.tsx`, replace `const APP_VERSION = '1.0.0';` with an async read from `App.getInfo()` (from `@capacitor/app`, already a dependency) on mount, stored in local state, falling back to the constant only if the native call throws (e.g. running in a plain browser during `npm run dev`).

---

## Task 7 — Session/device management (view + revoke) (BUG-CAP-06)

**Files (new):** `apps/web/app/api/auth/sessions/route.ts`, `apps/web/app/api/auth/sessions/[sid]/route.ts`
**Files (reference existing patterns):** `apps/web/lib/auth/` (session get/set/revoke helpers already used by `withAuth`, `logout`, `2fa/disable`), `apps/web/app/api/auth/logout/route.ts`

- [ ] Confirm how sessions are currently keyed in Redis (via whatever `getSession`/`getSessionFresh` in the auth lib use as their key pattern) — add a secondary per-user index (e.g. a Redis `SET` of `session:index:<userId>` containing session IDs) updated wherever sessions are created today, so listing "all of a user's sessions" doesn't require a Redis `KEYS`/`SCAN` sweep (which is the standard idempotent-index pattern; check if `lib/redis` already exposes a helper for this kind of secondary index before adding a new one).
- [ ] `GET /api/auth/sessions` (new, `withAuth`-wrapped like every other authenticated route): return each session's device/platform metadata already captured at login time (IP/user-agent/created-at, if not already stored, extend session creation to store them — check what `lib/auth/session.ts`-equivalent already persists first), flagging which entry is the caller's current session.
- [ ] `DELETE /api/auth/sessions/:sid` (new, `withAuth`-wrapped): verify `:sid` belongs to the requesting user, then call the same session-revocation helper `logout/route.ts` and `2fa/disable/route.ts` already use, rather than writing new revocation logic.
- [ ] Add both routes to the rate-limit preset list in `RATE_LIMITS` (`lib/security/rateLimit.ts`) — a new `sessionManage` preset with a modest limit (mirror `RATE_LIMITS.apiWrite`'s shape) is enough; don't leave these unrated-limited given they touch auth state.
- [ ] Web UI: add an "Active Sessions" card to `apps/web/app/(app)/settings/page.tsx`'s existing Security-adjacent section (check where PIN/2FA controls currently render in that 1,506-line file and place it alongside them for a consistent settings information architecture).

---

## Task 8 — Android Settings parity (BUG-CAP-07)

**Depends on:** Task 7 (for the Security/Sessions section).
**Files:** `apps/android/src/routes/settings.tsx`, new `apps/android/src/routes/help.tsx`, new `apps/android/src/routes/settings/*` subroutes if the section grows large enough to warrant splitting (mirror web's `app/(app)/settings/business`, `settings/subscription` nested-route convention rather than one long flat page, if it gets that big)

- [ ] Add a **Privacy** section wired to the existing `GET/PATCH /api/users/me/privacy` endpoint (already used by web) — reuse whatever privacy-toggle component patterns exist in `apps/android/src/components/ui` rather than building new ones.
- [ ] Add a **Security** section: PIN setup/verify/remove (`/api/auth/pin/*`), 2FA setup/verify/disable (`/api/auth/2fa/*`), plus the new Active Sessions list from Task 7 — reuse the `apiClient` + `useQuery`/`useMutation` pattern already used throughout `apps/android/src/routes/*` (e.g. the `toggleFavorite` mutation pattern seen in `routes/games/index.tsx`).
- [ ] Add a **Data & Account** section: a "Download my data" action against `/api/users/me/export` (open the resulting file/link via `@capacitor/browser`'s `Browser.open()`, the same mechanism already used for OAuth and Telegram login flows), and an account deletion/restore entry point against `/api/auth/account/restore`.
- [ ] Add a **Help** route (`apps/android/src/routes/help.tsx`) registered in `routeTree.gen.ts` alongside the other top-level routes, and reachable from Settings. Fastest correct option: reuse `apps/web/app/help/page.tsx`'s content by opening it in-app via `Browser.open({ url: `${env.VITE_API_BASE_URL}/help` })` (same pattern as Terms/Privacy links already in `auth/login.tsx`) rather than re-implementing the help content natively — upgrade to a native screen later only if product wants richer in-app help UX.
- [ ] Add `help.title`/section i18n keys to all 9 locale files under `shared/i18n/locales/*.json`, following the existing flat-key structure (2,706 keys today) — do not introduce a new nesting convention.

---

## Task 9 — PWA manifest screenshots (BUG-CAP-09)

**Files:** `apps/web/public/manifest.json`

- [ ] Add a `screenshots` array entry pointing at `/screenshots/home.png` with correct `sizes` (read the actual PNG dimensions) and `form_factor: "wide"` if it's a desktop-shaped capture, or add it without `form_factor` (defaults to narrow) if it's a phone-shaped capture — check the actual image dimensions before deciding.
- [ ] If only one screenshot exists, consider whether a second, phone-shaped (`"narrow"`) capture is worth producing — Android's install UI specifically favors narrow-form-factor screenshots; a wide-only screenshot may not render on the mobile install prompt at all.

---

## Task 10 — Migration checksum verification (BUG-CAP-10)

**Files:** `apps/web/db/migrate.ts`

- [ ] Change `getAppliedMigrations()` (or add a sibling function) to select `(filename, checksum)` pairs instead of just `filename`.
- [ ] Before applying pending migrations, iterate every **already-applied** file still present on disk, recompute its checksum with the existing `checksum()` function, and compare against the stored value.
- [ ] On any mismatch, call the existing `err()` logger and `process.exit(1)` (matching how every other fatal condition in this file already behaves) rather than silently continuing — this is a deliberately loud, fail-safe check since it protects against undetected schema drift.
- [ ] Add this as a step visible in `--status` output too (e.g. flag a `⚠ modified` status next to any already-applied file whose on-disk checksum no longer matches), reusing the existing `printStatus()` formatting conventions (padded status strings, the `─`.repeat(50) divider).

---

## Task 11 — Games catalog production verification (BUG-CAP-12)

**No code change.** This is an operational checklist item, not a development task:

- [ ] Run `npx tsx db/migrate.ts --status` (from `apps/web`, against the production/staging `DATABASE_URL`) and confirm `0004_seed_games_catalog.sql` and all later migrations show `✓ applied`.
- [ ] If any show `○ pending`, run `npx tsx db/migrate.ts` against that environment.
- [ ] Query the admin key-value config table for the `feature_games` row and confirm it is not explicitly set to `"false"` (default is `true` per `DEFAULT_MANIFEST.features.games`).
- [ ] If the catalog is still empty after both checks pass, escalate as a **new** bug for a follow-up code investigation with direct database read access (this review had none) — do not assume the root cause documented in `0004_seed_games_catalog.sql`'s comment is still the live cause without checking the above first.

---

## Definition of done for this fix-plan pass

- [ ] All 12 tasks above have corresponding PRs/commits.
- [ ] Task 1's release-build smoke test has been performed on a physical device (not an emulator, if AdMob/Billing testing requires it per platform docs) and the result recorded.
- [ ] Task 3's App Links verification has been confirmed via `adb shell pm get-app-links` post-fix.
- [ ] `custom-bugs-report.md`'s rating table is re-scored after these land, to confirm the "after fixes" column was accurate.

---

*Plan generated Friday, July 03, 2026 · 12:24 PM UTC — Zobia Social custom bug fix plan. Awaiting review before implementation begins.*
