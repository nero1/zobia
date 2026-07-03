# Zobia Social — Custom Bug & Code Quality Report

**Report generated:** Friday, July 03, 2026 · 12:24 PM UTC
**Scope:** `apps/web` (Next.js web app + PWA), `apps/android` (Capacitor Android app), `shared/*`. The discontinued `apps/expo` app was excluded per instructions.
**Method:** Manual, forensic, file-by-file review (three passes) of native Android config, deep-link handling, OAuth/session/auth flows, in-app purchase + webhook payment paths, database/migration/RLS layer, rate limiting, circuit breakers, PWA manifest/service worker, admin authorization, and cross-platform (web vs Android) feature parity. No automated bug-report input was used — every finding below was independently re-derived from the current code.

---

## How to read this report

This codebase is **unusually mature** — most of the classic issues (SQL injection, CSRF, IP-spoofing on rate limits, webhook replay, admin-check-trusts-JWT, DB pooling/timeouts, XP/payout idempotency) already carry inline `BUG-XXX FIX` comments showing they were found and fixed in earlier audit rounds. The findings below are the issues that **survived** this fresh pass — either genuinely new, or partially-mitigated risks worth closing off. They are real, file-verified, and none are speculative.

---

## Numbered list of all bugs/issues found

1. **BUG-CAP-01**: Release Android builds enable ProGuard/R8 minification with an empty custom rules file, risking silent breakage of Capacitor's plugin bridge, Google Play Billing, and AdMob in the shipped APK/AAB only.
2. **BUG-CAP-02**: The database circuit breaker module is fully implemented but never imported or wired into any DB provider — it is dead code, so the app has no fail-fast protection against a degraded database.
3. **BUG-CAP-03**: Android App Links are non-functional — `assetlinks.json` still has the placeholder SHA-256 fingerprint and the native manifest declares no `https` intent-filter at all, so verified deep links never work and fall back to the custom scheme only.
4. **BUG-CAP-04**: OAuth login deep-link callback relies solely on the non-exclusive `zobia://` custom scheme, leaving a residual interception window for a malicious app registered on the same scheme.
5. **BUG-CAP-05**: Google Play Billing subscription products (Plus/Pro/Max) are not registered under a mutually-exclusive `group`, unlike Business tiers — a user can stack multiple paid subscriptions and be double/triple-billed while the server silently overwrites a single `plan` field.
6. **BUG-CAP-06**: Neither the web app nor the Android app expose any UI to view or revoke active sessions/devices (OWASP session-management gap), which also weakens account-recovery-after-device-loss.
7. **BUG-CAP-07**: The Android Settings screen is missing most of the account/privacy/support surface that exists on web — no privacy controls, no account deletion/restore access, no data export, no 2FA/PIN/security management, and no Help/FAQ section.
8. **BUG-CAP-08**: Android push-notification initialization sets its one-shot `initialized` guard before permission is confirmed, so a user who denies permission and later grants it from OS Settings (without force-closing the app) never gets push registered again until next cold start.
9. **BUG-CAP-09**: The PWA web app manifest (`manifest.json`) ships an empty `screenshots` array even though a screenshot asset already exists in `public/screenshots/`, losing the richer "Install app" UI on Android/Chrome.
10. **BUG-CAP-10**: The SQL migration runner records a checksum per applied migration but never verifies it against later re-reads, so silent drift (an already-applied migration file edited after the fact) is undetectable.
11. **BUG-CAP-11**: The Android Settings screen hardcodes `APP_VERSION = '1.0.0'` instead of reading the real native version, so the displayed app version silently goes stale after every release.
12. **BUG-CAP-12**: The previously-reported "games discovery catalog is empty" bug traces to a real historical root cause (no migration ever seeded the `games` table) that already has a fix committed in the migration history — this is flagged for **production verification**, not a code fix, since the code path today is correct.

---

## Detailed findings

### 1. BUG-CAP-01 — Empty ProGuard rules with minification enabled on release builds

**Severity: Critical (mobile-only, release-build-only)**

`apps/android/android/app/build.gradle` sets `minifyEnabled true` for the `release` build type, pulling in `proguard-android-optimize.txt` plus a project-specific `proguard-rules.pro`. That custom file contains **only the default placeholder comment** — no actual `-keep` rules.

Capacitor's JS↔native bridge invokes plugin methods via reflection (`@PluginMethod`-annotated classes), and `capacitor-plugin-cdv-purchase` (Google Play Billing), `@capacitor-community/admob`, and the push-notifications/FCM plugin all have native classes that R8 can rename or strip when no explicit keep rules protect them. Because this only manifests in `minifyEnabled` (release) builds — never in `cap run android` debug testing — the failure mode is: everything works in development, then in-app purchases, ads, or push registration crash or silently no-op in the exact build submitted to the Play Store.

**FILES:**
- `apps/android/android/app/build.gradle`
- `apps/android/android/app/proguard-rules.pro`

**FIX:** Add explicit keep rules for the Capacitor bridge (`com.getcapacitor.**`), the installed Capacitor/Cordova plugin packages (`com.capacitorjs.plugins.**`, the AdMob community plugin's package, `capacitor-plugin-cdv-purchase`'s underlying `com.android.billingclient.**` and its native package), and Google Play services classes referenced via `AndroidManifest.xml`'s `APPLICATION_ID` meta-data. Then do a full **release** build (`assembleRelease`/`bundleRelease`) and manually smoke-test IAP + push + AdMob against that artifact before any Play Store upload — debug-build testing alone will not catch this class of bug.

---

### 2. BUG-CAP-02 — Database circuit breaker defined but never wired in

**Severity: High**

`apps/web/lib/db/circuit.ts` defines a fully-built `dbCircuit` (`RedisCircuitBreaker`) and exports `withCircuitBreaker()`, reusing the exact same class already wired into `lib/payments/paystack.ts`, `lib/payments/dodopayments.ts`, and the daily-platform cron. A repo-wide search shows `withCircuitBreaker`/`dbCircuit` are **imported nowhere** outside their own definition file — none of the three DB provider adapters (`supabase.ts`, `railway.ts`, `digitalocean.ts`) or the `db` proxy in `lib/db/index.ts` call it.

This means the "circuit breaker for DB" the hint list calls out **looks** implemented (the class, tests, and Redis-shared state all exist) but provides **zero actual protection today**. During a DB outage or slow-query storm, every request still hits the pool directly and waits out the full `statement_timeout`/`connectionTimeoutMillis`, instead of failing fast once the error-rate threshold trips — exactly the "hammer a degraded dependency" failure mode circuit breakers exist to prevent, and a real risk for a small `DB_POOL_SIZE` tuned for Hobby-plan hosting.

**FILES:**
- `apps/web/lib/db/circuit.ts` (defined, unused)
- `apps/web/lib/db/index.ts` (the `db` proxy that should route through it)
- `apps/web/lib/db/providers/supabase.ts`, `railway.ts`, `digitalocean.ts`

**FIX:** Wrap the `.query()`/`.transaction()` methods in each provider adapter (or centrally, inside the `db` Proxy's `get()` trap in `lib/db/index.ts`) with `withCircuitBreaker()`, mirroring exactly how `lib/payments/paystack.ts` already wraps its outbound HTTP calls. Add a fast-fail 503 response path (reuse `handleApiError`/`ApiError` conventions already used everywhere else) when the circuit is open, and surface `dbCircuit` state in `/api/health` alongside the existing `db`/`redis` checks so ops can see when it trips.

---

### 3. BUG-CAP-03 — Android App Links are not actually verified

**Severity: High**

`apps/web/public/.well-known/assetlinks.json` still contains the literal placeholder `"REPLACE_WITH_YOUR_APP_SIGNING_CERT_SHA256"`. Separately, `apps/android/android/app/src/main/AndroidManifest.xml` only declares one intent-filter, for the custom `zobia://` scheme, with `android:autoVerify="true"` set on it — but `autoVerify` only has meaning for `http`/`https` data elements; it is a no-op on a custom scheme. There is **no** `https://zobia.org/...` intent-filter in the manifest at all.

The practical effect: clicking a real `https://zobia.org/r/<slug>`, `/u/<username>`, `/g/<slug>`, etc. link (from SMS, WhatsApp, another app, search results, or a referral share) on an Android device will **never** open the Zobia app — it always falls through to the browser, even after the placeholder cert hash is eventually filled in, because the manifest has nowhere for Android to attach the verification. This directly undermines the "deeplinks" and referral-attribution requirements, and the cross-platform link-sharing story described in `SEO.md`.

**FILES:**
- `apps/android/android/app/src/main/AndroidManifest.xml`
- `apps/web/public/.well-known/assetlinks.json`

**FIX:** Add a second `<intent-filter android:autoVerify="true">` on `MainActivity` with `android:scheme="https"` and `android:host="zobia.org"` (plus any other production hosts) covering the public path prefixes (`/u/`, `/r/`, `/c/`, `/g/`, `/a/`, `/b/`, `/p/`). Populate `assetlinks.json`'s `sha256_cert_fingerprints` with the real release-signing certificate's SHA-256 (from the Play Console or `keytool`/`apksigner`), and confirm verification via `adb shell pm get-app-links com.zobiasocial.app` after install. Keep the existing custom-scheme filter as a fallback for cases App Links can't cover (e.g. OAuth callback, see next finding).

---

### 4. BUG-CAP-04 — OAuth callback relies solely on a non-exclusive custom URL scheme

**Severity: High (residual, partially mitigated)**

`apps/android/src/routes/auth/login.tsx` and `apps/web/app/api/auth/google/route.ts` implement a genuinely careful OAuth flow: CSRF state cookie, a redirect-target allowlist (`ALLOWED_REDIRECT_SCHEMES`), and a **single-use, 90-second-TTL** exchange code redeemed via `POST /api/auth/mobile-token` (confirmed in that route's Redis `GETDEL`). This is good defense-in-depth and meaningfully narrows the attack window.

However, the callback is still delivered exclusively via `zobia://auth/callback?code=...` — a custom URL scheme. Android does not enforce scheme uniqueness: any other installed app can register an `intent-filter` for `zobia://` and race to receive the redirect Intent before (or instead of) the real app, then call the same public `mobile-token` endpoint itself within the 90-second window to redeem the code and obtain a live access/refresh token pair. The short TTL and single-use design substantially reduce — but do not eliminate — this risk, and it is the direct consequence of BUG-CAP-03 above (no verified `https` App Link exists to use instead).

**FILES:**
- `apps/android/android/app/src/main/AndroidManifest.xml`
- `apps/android/src/routes/__root.tsx` (the `appUrlOpen` listener)
- `apps/android/src/routes/auth/login.tsx`
- `apps/web/app/api/auth/mobile-token/route.ts`

**FIX:** Once App Links are fixed (BUG-CAP-03), change `CALLBACK_DEEP_LINK` to the verified `https://zobia.org/auth/callback` universal link instead of `zobia://auth/callback` — verified App Links are delivered only to the one app that owns the domain, closing the interception window entirely. Keep the custom scheme as a fallback only for devices/OEM browsers that don't support App Links, and consider binding the exchange code to a client-generated PKCE-style verifier (hashed and stored alongside the code in Redis, checked on redemption) as an additional layer if the custom-scheme fallback must stay.

---

### 5. BUG-CAP-05 — Personal subscription tiers aren't billing-exclusive, unlike Business tiers

**Severity: High (payment/accounting integrity)**

In `apps/android/src/lib/payments/googlePlay.ts`, Business Account tiers are explicitly registered with `group: 'business_tier'` so Google Play treats `biz_starter_monthly`/`biz_growth_monthly`/`biz_enterprise_monthly` as mutually exclusive — buying one replaces any other. The personal subscription tiers (`sub_plus_monthly`, `sub_pro_monthly`, `sub_max_monthly`, and their annual equivalents) are registered **without** any `group`, so Google Play has no way to know they're tiers of the same product.

Server-side, `apps/web/app/api/economy/iap/verify/route.ts`'s `verifyAndActivateSubscription()` simply does `UPDATE users SET plan = $1 ...`, unconditionally overwriting whichever plan was verified most recently — it never calls the Google Play Developer API to cancel a previously-active different-tier subscription. Net effect: a user can subscribe to Plus, later subscribe to Pro without Play Billing blocking it, and end up billed for **both** recurring subscriptions indefinitely while the app only reflects (and grants monthly-coin-bonus credit for) whichever one was verified last — an accounting-integrity and customer-trust problem, and a likely source of support/chargeback tickets.

**FILES:**
- `apps/android/src/lib/payments/googlePlay.ts`
- `apps/web/app/api/economy/iap/verify/route.ts`

**FIX:** Register `SUBSCRIPTION_IDS` with a shared `group` (e.g. `'plan_tier'`), mirroring the exact pattern already used for `BUSINESS_IDS`. Server-side, when `verifyAndActivateSubscription()` detects the user already had a different active Play subscription product for the same group, call the Google Play Developer API's subscription cancel/replace endpoint (already have `lib/payments/googlePlayVerify.ts` as the natural home for this) so the old subscription is actually cancelled, not just ignored.

---

### 6. BUG-CAP-06 — No session/device management surface anywhere in the product

**Severity: Medium-High (OWASP session management, account recovery)**

Sessions are otherwise handled carefully — `withAuth`/`withAdminAuth` do a live Redis session check (`getSession`/`getSessionFresh`), refresh tokens rotate on use (`app/api/auth/refresh/route.ts`), and admin paths bypass the L1 session cache to close a de-provisioning window. But there is no endpoint or UI anywhere (web `settings/page.tsx`, Android `settings.tsx`, or any `/api/*sessions*` route) that lets a user see "these are your currently signed-in devices/sessions" or revoke one remotely. This is one of the more consequential OWASP ASVS session-management controls, and it directly matters for the "robust account restore/reactivation after lost access" requirement — if a phone is lost or stolen, the user's only recourse today is a full password/OAuth-level lockout via support, not a self-service "sign out that device."

**FILES:**
- `apps/web/app/(app)/settings/page.tsx`
- `apps/android/src/routes/settings.tsx`
- `apps/web/lib/auth/` (session store — natural home for a `listSessions`/`revokeSession` pair)

**FIX:** Add a `GET /api/auth/sessions` (list active sessions by scanning/tag-indexing the existing Redis session keys per user, including device/platform metadata already captured at login) and `DELETE /api/auth/sessions/:sid` (revokes via the existing session-invalidation path already used by logout/2FA-disable). Surface both in a new "Active Sessions" panel under Settings → Security on web, and add the equivalent to Android's settings once BUG-CAP-07 is addressed.

---

### 7. BUG-CAP-07 — Android Settings is missing most of web's account/privacy/support surface

**Severity: Medium-High (feature parity, ease of use)**

`apps/android/src/routes/settings.tsx` (108 lines) contains only: profile summary, links to Wallet/Stats, a language switcher, an app-version line, and logout. By contrast, web's settings surface includes business/subscription management sections, a dedicated `/help` page, PIN/2FA endpoints (`/api/auth/pin/*`, `/api/auth/2fa/*`), account restore (`/api/auth/account/restore`), and a data-export endpoint (`/api/users/me/export`) — none of which are linked from, or reachable within, the Android app. A mobile-first user has no path to request their data, delete/restore their account, manage 2FA/PIN, or find help/FAQ content without switching to a browser — undermining both the "feature parity with web" and "add user help section" requirements explicitly called out for this audit.

**FILES:**
- `apps/android/src/routes/settings.tsx`
- `apps/web/app/help/page.tsx` (exists on web, has no Android equivalent)
- `apps/web/app/(app)/settings/page.tsx` (reference for what to port)

**FIX:** Extend Android's Settings screen with sections wired to the already-existing backend endpoints — Privacy (`/api/users/me/privacy`), Security (PIN/2FA endpoints), Data export (`/api/users/me/export` — Preferences-store a signed download link or open it in `@capacitor/browser`), Account deletion/restore (`/api/auth/account/restore`), and a new `/help` route that either renders the same content as web's `app/help/page.tsx` natively or opens it via `Browser.open()` as an interim step. This reuses existing API contracts entirely — no new backend work is required for most of it.

---

### 8. BUG-CAP-08 — Push notification init guard can wedge for the rest of the app session

**Severity: Medium**

In `apps/android/src/lib/push/index.ts`, `initPushNotifications()` sets `initialized = true` as its very first statement, before permissions are checked or granted. If `PushNotifications.checkPermissions()`/`requestPermissions()` resolves to anything other than `'granted'` (e.g. the user taps "Deny"), the function `return`s early — but `initialized` is already `true`. Because this flag is module-scope state that persists for the lifetime of the JS context, if the user later re-enables notification permission from Android's system Settings and switches back to the still-running app (a very common flow — no process kill required), `initPushNotifications()` is never called again productively: the `__root.tsx` effect that calls it only re-runs on `token` change, and the guard silently no-ops even if it did re-run. The user is stuck without push until they fully kill and relaunch the app.

**FILES:**
- `apps/android/src/lib/push/index.ts`

**FIX:** Only set `initialized = true` once registration has actually been requested (move the assignment to just before/after `await PushNotifications.register()`, or track a separate `permissionDeniedAt` state), and re-check `PushNotifications.checkPermissions()` on app-foreground (`App.addListener('appStateChange', ...)`, already used elsewhere in this codebase for `onlineManager`/`focusManager`) so a permission grant made from system Settings is picked up without requiring a cold restart.

---

### 9. BUG-CAP-09 — PWA manifest ships no screenshots despite one existing on disk

**Severity: Low-Medium (PWA/SEO polish)**

`apps/web/public/manifest.json` declares `"screenshots": []`, but `apps/web/public/screenshots/home.png` already exists in the repo. Chrome's richer "Install app" prompt (and some Android app-store-adjacent surfaces that read the web manifest) uses the `screenshots` array to render a preview; with it empty, installs fall back to the plain icon-only prompt, and the asset that was presumably produced for this purpose is unused.

**FILES:**
- `apps/web/public/manifest.json`
- `apps/web/public/screenshots/home.png`

**FIX:** Add a `screenshots` entry referencing `/screenshots/home.png` with its actual pixel dimensions and an appropriate `form_factor` (`"wide"` for desktop, or omit/`"narrow"` for a mobile-shaped capture), and consider adding a second narrow-form-factor screenshot since Android's install UI specifically favors narrow screenshots for phone-shaped installs.

---

### 10. BUG-CAP-10 — Migration runner records checksums but never verifies them

**Severity: Medium (data-integrity / ops hygiene)**

`apps/web/db/migrate.ts`'s `applyMigration()` computes an FNV-1a `checksum()` of each migration file and stores it in `migrations_log`, and the module comment frames this as change detection. But `getAppliedMigrations()` only ever reads back the **filename** set to decide what's pending — the stored checksum is written once and never read/compared again anywhere in the file. If an already-applied migration file is edited later (accidentally, or during a rebase/cherry-pick), the runner has no way to detect or warn about the drift between what's on disk and what was actually run against a given database — the checksum column is currently inert audit trivia, not the "detect a changed migration" safety net its own comment implies.

**FILES:**
- `apps/web/db/migrate.ts`

**FIX:** In `getAppliedMigrations()` (or a new `verifyChecksums()` step run before applying pending migrations), select `(filename, checksum)` pairs from `migrations_log`, recompute the checksum of every already-applied file currently on disk, and fail loudly (`err(...)` + non-zero exit) on any mismatch before proceeding — this is a small, self-contained addition to an already-idempotent, already-well-designed runner.

---

### 11. BUG-CAP-11 — Android app version display is a hardcoded literal

**Severity: Low (correctness / supportability)**

`apps/android/src/routes/settings.tsx` declares `const APP_VERSION = '1.0.0';` and renders it directly, independent of the real `versionName`/`versionCode` set in `apps/android/android/app/build.gradle`. Every future release bump to the native manifest will silently desync from what users (and support staff asking "what version are you on?") actually see in the app.

**FILES:**
- `apps/android/src/routes/settings.tsx`

**FIX:** Read the real value at runtime via `@capacitor/app`'s `App.getInfo()` (already a project dependency — `@capacitor/app` is used elsewhere for `appUrlOpen`/`appStateChange`), which returns the actual `version`/`build` from the installed APK, and drop the hardcoded constant entirely.

---

### 12. BUG-CAP-12 — "Games catalog shows no games" — root cause found, already fixed in migration history, flagged for production verification

**Severity: Informational / operational (not a current code bug)**

This was called out explicitly as a known symptom to investigate. Tracing it fully: `apps/web/db/migrations/0004_seed_games_catalog.sql`'s own header comment documents the exact historical bug — "no migration ever inserted the matching `games` catalog rows … so `/games`, `/games/challenges` and `/g/<slug>` all rendered empty." That migration (and the fuller game-metadata seed already folded into `0001_consolidated_schema.sql`, including `is_public = true`/`is_active = true` defaults confirmed in the `CREATE TABLE games` statement) does insert all 60 catalogue rows, guarded by a real unique index on `games.slug` (`games_slug_unique_idx`) so the `ON CONFLICT` clauses are valid. The discovery API (`app/api/games/route.ts`, `lib/games/repo.ts`) and both the web (`app/(app)/games/page.tsx`) and Android (`routes/games/index.tsx`) client code were traced end-to-end and correctly request/consume this data — including confirming Android's axios response interceptor correctly unwraps the `{success, data, error}` envelope before the page reads `data.games`.

In short: **the code today is correct** and should populate the catalog on any database that has migrations `0001` through at least `0004` applied. If the catalog is still empty in a live environment, the most likely explanations are operational, not code: (a) migrations were not run against that database (`npm run migrate` / `db/migrate.ts` was never invoked, or failed silently), or (b) an admin has explicitly disabled the `feature_games` key-value flag that backs `manifest.features.games` (default is `true`, so this requires an explicit override).

**FILES:**
- `apps/web/db/migrations/0004_seed_games_catalog.sql`
- `apps/web/db/migrations/0001_consolidated_schema.sql`
- `apps/web/lib/games/config.ts`, `apps/web/lib/games/repo.ts`
- `apps/web/app/api/games/route.ts`

**FIX:** No code change required. Run `npx tsx db/migrate.ts --status` (from `apps/web`) against the affected database to confirm `0004_seed_games_catalog.sql` (and later) show as `✓ applied`; if not, run `npx tsx db/migrate.ts`. Separately, confirm the `feature_games` row in the admin key-value config table isn't set to `"false"`. If the catalog is still empty after both checks, that would be a genuinely new bug worth a follow-up investigation with direct database access (which this review did not have).

---

## Rating: current state vs. after fixes

| Dimension | Current | After applying this report's fixes |
|---|---|---|
| **Security (web)** | 9 / 10 — CSRF, rate limiting, webhook signing + replay protection, DB-verified admin checks, RLS, field encryption, and IP-spoofing defenses are all already implemented with clear evidence of prior hardening passes. | 9.5 / 10 — closing the session-management gap (#6) is the main remaining lift. |
| **Security (Android/mobile)** | 6.5 / 10 — solid IAP verify-then-finish pattern and a push-route allowlist, but undermined by non-functional App Links (#3) and the resulting OAuth interception residual risk (#4). | 8.5 / 10 once App Links are wired and the OAuth callback moves to a verified universal link. |
| **Payment/accounting integrity** | 7.5 / 10 — idempotent coin/star credits, SELECT-FOR-UPDATE, unique-constraint double-credit protection are all solid; the subscription-stacking gap (#5) is the one real hole found. | 9 / 10. |
| **Scalability / resilience** | 7 / 10 — sliding-window Redis rate limiting, connection pooling tuned per provider, and a circuit-breaker *class* are all present, but the DB circuit breaker is disconnected (#2), so a degraded database has no fail-fast path today. | 9 / 10 once wired in. |
| **Mobile build correctness** | 6 / 10 — the empty ProGuard rules file (#1) is a release-only landmine that could silently break monetization/notifications the day this ships to the Play Store. | 9 / 10 once keep rules are added and a release-build smoke test is performed. |
| **PWA implementation** | 8.5 / 10 — Serwist config is careful and well-documented (auth routes correctly excluded from caching, `skipWaiting`/`clientsClaim` handled). Only the missing manifest screenshots (#9) knocked points off. | 9.5 / 10. |
| **Feature parity (web ↔ Android)** | 6.5 / 10 — most core social/economy/gaming features are mirrored deliberately and well (guild discovery folded correctly, Business IAP correctly Android-only per Play policy), but Settings/help/account-management parity (#7) is a real gap. | 8.5 / 10. |
| **i18n** | 9.5 / 10 — all 9 locales have identical, complete key structure (2,706 keys each); no missing-translation risk found. | 9.5 / 10 (already excellent). |
| **DB/migrations hygiene** | 7.5 / 10 — idempotent, transactional, well-commented migration runner; only lacking drift detection (#10). | 8.5 / 10. |
| **Overall** | **7.2 / 10** — a genuinely well-engineered, previously-audited codebase with a small number of concrete, high-value gaps concentrated in the Android/Capacitor layer (fitting this branch's focus) and a couple of cross-cutting infrastructure loose ends. | **~9 / 10** after the 12 fixes above are applied. |

---

*Report generated Friday, July 03, 2026 · 12:24 PM UTC — Zobia Social custom bug audit.*
