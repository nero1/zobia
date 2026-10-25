# Custom Bugs Report — Version 3

**Date and time:** October 25, 2026 — 10:58:50 PM WAT (Africa/Lagos)
**Audited starting revision:** `3814f279` (main after PR #566).
**Admin policy:** 2FA is optional and off by default. Existing enabled factors are preserved; changing this policy requires no migration. Reminder dismissal is local to the account and device.

**Status:** Fresh review: twelve confirmed findings. All twelve findings are fixed and verified. Release checks are recorded with the pull request. This replaces v2; earlier findings and fixes remain in Git history. No production database was changed.

## Discovered bugs and issues

1: BUG ZOB-V3-001: ✅ [High] Custom staff endpoints bypass administrator two-factor session assurance

2: BUG ZOB-V3-002: ✅ [Medium] Public Tales responses include private moderation explanations

3: BUG ZOB-V3-003: ✅ [High] Story comment feeds expose comments attached to unpublished or locked chapters

4: BUG ZOB-V3-004: ✅ [Medium] Tales page cursors can be reused under a different search or account

5: BUG ZOB-V3-005: ✅ [Medium] Chapter publication performs unbounded subscriber notification fan-out

6: BUG ZOB-V3-006: ✅ [Medium] Google Play purchase identifiers can alter provider URL paths and queries

7: BUG ZOB-V3-007: ✅ [Low] Support queue page sizes accept negative, nonnumeric and fractional values

8: BUG ZOB-V3-008: ✅ [Medium] TikTok short-link resolution follows unchecked outbound redirects

9: BUG ZOB-V3-009: ✅ [Medium] Missing Tales story URLs render a successful page containing a client error

10: BUG ZOB-V3-010: ✅ [High] Two-factor disable can falsely succeed after concurrent authenticator changes

11: BUG ZOB-V3-011: ✅ [Medium] Tales discovery and subscriber paging lack matching ordered indexes

12: BUG ZOB-V3-012: ✅ [Medium] Google-only administrators are sent to an unusable password-based admin login

## Detailed findings and fixes

### 1: BUG ZOB-V3-001: ✅ [High] Custom staff endpoints bypass administrator two-factor session assurance

**PROBLEM:** For accounts with 2FA enabled, several room, guild and support admin handlers use withAuth plus database role checks rather than the elevated admin wrapper. An ordinary OAuth session for an admin account can therefore exercise those staff privileges. Conditional KYC/profile/guild staff views also check roles without session assurance.

**FILES:** `/workspace/zobia/apps/web/lib/api/middleware.ts`; `/workspace/zobia/apps/web/lib/auth/roles.ts`; `/workspace/zobia/apps/web/lib/support/staffAuth.ts`; `/workspace/zobia/apps/web/lib/support/service.ts`; `/workspace/zobia/apps/web/app/api/kyc/documents/[id]/route.ts`; conditional profile and guild staff-view routes

**FIX:** Enforce admin-session assurance before custom admin handlers and provide explicit session-aware staff-role lookup for privileged views. Check the live per-account 2FA setting: ordinary sessions may administer when it is off; when enabled, all staff entry points require verified assurance. Preserve ordinary moderator/support access and deny impersonated admin access.

**VALIDATION:** Real PostgreSQL/API contracts accept ordinary-admin sessions by default, reject them after explicit 2FA enrollment, accept verified sessions and pure moderators, and retain live role/revocation checks.

### 2: BUG ZOB-V3-002: ✅ [Medium] Public Tales responses include private moderation explanations

**PROBLEM:** Story responses return the complete story row, including moderationReason. Chapter reads likewise spread the full chapter row even when its body is locked. Chapter-list responses already limit moderation explanations to owners, but these other responses expose them to ordinary readers and guests.

**FILES:** `/workspace/zobia/apps/web/lib/tales/service.ts`

**FIX:** Omit moderation explanations from non-owner story and chapter responses while retaining them in owner/editor views.

**VALIDATION:** Fixtures place private markers in story and chapter moderation reasons; public and locked-reader responses omit them while the owner retains access.

### 3: BUG ZOB-V3-003: ✅ [High] Story comment feeds expose comments attached to unpublished or locked chapters

**PROBLEM:** The comment query checks story visibility and hidden flags but does not enforce the visibility or purchase boundary of its chapter. A guest or unpaid reader can retrieve comments associated with a draft, scheduled or paywalled chapter.

**FILES:** `/workspace/zobia/apps/web/lib/tales/service.ts`

**FIX:** Require referenced chapters to be publicly published and approved. Apply the same guest/free-first-chapter and authenticated unlock rules as chapter reading; preserve the owner view.

**VALIDATION:** Actual comment queries hide draft and paid-chapter markers, show the free first-chapter comment, and reveal the paid comment only after an idempotent purchase.

### 4: BUG ZOB-V3-004: ✅ [Medium] Tales page cursors can be reused under a different search or account

**PROBLEM:** Discovery cursors carry a tab and sort position but omit the search and viewer scope. Reusing a cursor after changing search or account can silently skip matching results or continue from another result set.

**FILES:** `/workspace/zobia/apps/web/lib/tales/service.ts`; `/workspace/zobia/apps/web/lib/api/pageCursor.ts`

**FIX:** Use the existing scoped cursor codec with tab, normalized search and viewer identity. Keep exact PostgreSQL timestamps for chronological keysets and deterministic ID tie-breaking.

**VALIDATION:** Pagination traverses 65 microsecond-spaced stories without duplicates or omissions; cursor reuse under another search or account returns 400.

### 5: BUG ZOB-V3-005: ✅ [Medium] Chapter publication performs unbounded subscriber notification fan-out

**PROBLEM:** Publication limits chapters but loads every subscriber for each chapter into memory and inserts all notifications in one transaction. A popular author can exceed serverless execution or memory limits, rolling back the notification work repeatedly.

**FILES:** `/workspace/zobia/apps/web/lib/tales/service.ts`; `/workspace/zobia/apps/web/lib/tales/notifications.ts`; `/workspace/zobia/apps/web/lib/tasks/outbox.ts`

**FIX:** Queue notification delivery transactionally in the existing durable outbox. Process at most 500 recipients per page, schedule continuations atomically, and use stable chapter references for duplicate suppression. Recheck content eligibility during delivery.

**VALIDATION:** A 1,001-subscriber fixture sends 500 notifications in the first task and drains the remainder through continuations; completed-task replay creates no duplicates.

### 6: BUG ZOB-V3-006: ✅ [Medium] Google Play purchase identifiers can alter provider URL paths and queries

**PROBLEM:** Provider verification, consume, acknowledge and cancellation URLs interpolate purchase tokens directly into URL paths. A token containing slash, query or fragment characters changes the requested provider resource; dot segments can be normalized by URL parsers. No successful fraudulent payment is asserted.

**FILES:** `/workspace/zobia/apps/web/lib/payments/googlePlayVerify.ts`; `/workspace/zobia/apps/web/lib/payments/__tests__/googlePlayPaths.test.ts`

**FIX:** Encode every provider path component and reject dot-only or malformed Unicode identifiers before sending credentials. Keep provider failures out of interpolated private logs.

**VALIDATION:** Mocked provider calls exercise all five operations and verify fixed origin, single-segment tokens and empty query/fragment fields. Dot segments and malformed Unicode send no request.

### 7: BUG ZOB-V3-007: ✅ [Low] Support queue page sizes accept negative, nonnumeric and fractional values

**PROBLEM:** The queue route applies parseInt and an upper cap without a positive lower bound or integer validation. Invalid values can reach Drizzle LIMIT, producing database errors rather than a useful client validation response.

**FILES:** `/workspace/zobia/apps/web/app/api/admin/support/tickets/route.ts`; `/workspace/zobia/apps/web/lib/support/service.ts`

**FIX:** Validate page size as an integer from 1 through 100, default to 50, and retain a defensive service-level range check.

**VALIDATION:** The actual authenticated support queue returns 400 for a negative page size instead of submitting an invalid LIMIT.

### 8: BUG ZOB-V3-008: ✅ [Medium] TikTok short-link resolution follows unchecked outbound redirects

**PROBLEM:** Short-link resolution uses native fetch with redirect-follow after checking only the first hostname. Redirect destinations and their DNS/IP addresses are not revalidated. This is a missing defense against unsafe provider redirects, not proof of an available public TikTok open redirect.

**FILES:** `/workspace/zobia/apps/web/lib/tweets/service.ts`; `/workspace/zobia/apps/web/lib/security/ssrf.ts`

**FIX:** Use the existing pinned-address safe fetcher, permit only explicitly named HTTPS TikTok redirect hosts, reject private DNS destinations and credential forwarding, and retain the validated final URL.

**VALIDATION:** Mock redirect chains accept the named public destination and reject metadata/private, off-host, HTTP downgrade and credential-bearing cross-origin requests before contacting the unsafe destination.

### 9: BUG ZOB-V3-009: ✅ [Medium] Missing Tales story URLs render a successful page containing a client error

**PROBLEM:** The public slug page renders the client Tales view without verifying that the story exists. Unknown, removed or unavailable stories therefore render the ordinary page and rely on a later API error instead of the framework not-found response.

**FILES:** `/workspace/zobia/apps/web/app/t/[tweetId]/page.tsx`

**FIX:** Resolve public story availability on the server before rendering. Invoke the existing notFound boundary for a real 404 and propagate infrastructure failures rather than disguising them as missing content. Retain legacy tweet resolution.

**VALIDATION:** Production HTTP reaches the framework 404 boundary and renders the not-found page with noindex, without rendering the ordinary Tales client page. Next.js streamed responses can retain HTTP 200; this is recorded rather than claimed as a universal transport-status change.

### 10: BUG ZOB-V3-010: ✅ [High] Two-factor disable can falsely succeed after concurrent authenticator changes

**PROBLEM:** The disable endpoint ignores the affected-row count, so a concurrent authenticator change can produce a false success response even though the factor remains enabled.

**FILES:** `/workspace/zobia/apps/web/app/api/auth/2fa/disable/route.ts`; `/workspace/zobia/apps/web/scripts/check-v3-contract.ts`

**FIX:** Require an enabled authenticator, valid unused code and unchanged secret in the atomic update. Return a conflict when no row changes. Administrators can explicitly disable their own factor under the revised opt-in policy.

**VALIDATION:** A real PostgreSQL row lock pauses disable at its final update; another connection replaces the authenticator, then releases the lock. Disable returns 409 and preserves the new factor.

### 11: BUG ZOB-V3-011: ✅ [Medium] Tales discovery and subscriber paging lack matching ordered indexes

**PROBLEM:** The discovery index orders published_at while discovery queries order created_at, requiring extra sorting. Mine pages lack an author/creation-time index. The subscriber primary key begins with user_id, so author-scoped fan-out cannot use an efficient author-first ordered range as subscription history grows.

**FILES:** `/workspace/zobia/apps/web/db/migrations/0001_consolidated_schema.sql`; `/workspace/zobia/apps/web/db/upgrades/2026-10-25-v3-query-indexes.sql`; `/workspace/zobia/apps/web/lib/db/schema.ts`

**FIX:** Match the existing discovery index to the actual chronological order and add author-first indexes for Mine and subscriber pages. Include the definitions in the final-state baseline, verified upgrade chain and Drizzle models.

**VALIDATION:** Isolated fresh/upgrade catalogs match and preserve a fixture wallet balance. PostgreSQL query-plan checks verify the ordered discovery and author/subscriber access paths.

### 12: BUG ZOB-V3-012: ✅ [Medium] Google-only administrators are sent to an unusable password-based admin login

**PROBLEM:** Ordinary Google sessions lack administrator assurance, while the admin entry page requires a local password that Google-only accounts do not have. This leaves manually promoted Google users unable to complete the admin flow despite their valid site session.

**FILES:** `/workspace/zobia/apps/web/lib/auth/googleAdmin.ts`; `/workspace/zobia/apps/web/app/api/auth/admin-session/route.ts`; `/workspace/zobia/apps/web/app/(admin)/gate44/login/page.tsx`; `/workspace/zobia/apps/android/src/components/admin/AdminGuard.tsx`; `/workspace/zobia/shared/ui/GoogleAdminVerification.tsx`

**FIX:** Allow normal sessions while account 2FA is off (the default), with a themed dismissible reminder linking to existing Security settings. When explicitly enabled, require server-verified Google provenance plus authenticator verification. Rotate to a new privileged session ID after proof, keep the old token unprivileged, enforce live database roles and replay/rate limits, and share the themed flow across active clients. No local password is required.

**VALIDATION:** Real PostgreSQL/Redis contracts cover first-time enrollment without a password, cookie and native token delivery, SID rotation, old-token denial, refreshed tokens, signed Google pre-auth, role removal and revoked source sessions. Production mobile/dark-mode browser checks verify ordinary-session admin entry, per-account reminder dismissal across reloads, navigation to existing 2FA settings and no logout or request loop. Setup instructions now describe the Google flow.

## Ratings and brief review

Engineering judgments, **current baseline before v3 fixes → after these fixes**:

- **Security: 8/10 → 8.7/10.** Session assurance now covers custom staff paths and conditional views; content and outbound-request boundaries are stronger.
- **Accounting/data integrity: 8.5/10 → 8.6/10.** Purchase URL handling is hardened and chapter purchase retries retain one debit. Existing financial regression contracts are rechecked; no new money-creation defect is asserted.
- **Performance/scalability: 7.8/10 → 8.3/10.** Notification fan-out has bounded durable pages and discovery cursors are scoped. These checks do not establish thousands-user capacity or guaranteed zero-cost operation.
- **Structure/maintainability: 8/10 → 8.3/10.** Changes reuse shared authorization, cursor, outbox, notification and SSRF facilities. Index upgrades are portable PostgreSQL and covered by Drizzle; no parallel styling system is introduced.
- **Implementation/UX/SEO: 8.3/10 → 8.5/10.** Invalid paging input is handled predictably and unavailable stories use the server not-found boundary.
- **Overall: 8.1/10 → 8.5/10.** This is a measured improvement in the reviewed paths, not a security certification.

## Review scope and evidence

Three passes covered (1) inventory and source scans, (2) manual trust-boundary/data-flow tracing, and (3) adversarial local reproductions, fix review and regression checks. The inventory contains 2,154 active-project files, including tests/configuration; this does not mean every line was manually read three times. Discontinued Expo, dependency/generated code and CRON frequency were excluded.

Review areas included live sessions, role assurance, account restoration, administrator and staff APIs, payment/webhook processing, exact accounting, database access and pooling, RLS/grants and migration compatibility, private/public content projection, cursor pagination, caching, queues/DLQ and retries, upload/request boundaries, SSRF and path handling, rendered HTML/JSON-LD sanitization, shared client flows and SEO. Existing safe behavior was retained rather than reported as a new defect. No exposed live key, reachable RCE or MEV vulnerability is asserted without evidence.

Tests use isolated local PostgreSQL databases, fixture Redis sessions and mocked external providers. No live payment or production migration was initiated. Physical-device/provider configuration and production load limits require deployment evidence; an audit cannot prove the absence of all future bugs.

**Remediation progress:** 12/12 fixed and verified.

---

**Version 3 — Audit signature: Codex — October 25, 2026 — 10:58:50 PM WAT (Africa/Lagos)**
