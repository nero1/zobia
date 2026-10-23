# Attachment implementation status

This is a verification ledger for the October 2026 request. An implemented item is not a claim of live deployment or device testing. The requested code changes are implemented across web/PWA and Capacitor. Checks requiring live credentials, human language/content review or physical devices remain separate.

| Attachment | Implemented in this checkout | Remaining |
| --- | --- | --- |
| Wallet | Ledger timestamp compatibility and invalid limit handling | Runtime smoke test |
| Feed | Larger image cards and compact text cards on web and Capacitor | Visual/device review |
| Rooms | Deterministic message cursors, polling watermark, initial scroll, sending-state recovery, classroom enrolment on messages/presence/realtime, private cache scope and session cover | Authenticated browser/device and provider tests |
| Challenges | 48-hour default, daily cap, eligible opponents, private recent badges, inactive friend notice, status tabs, pagination, per-viewer archive, 90-day cleanup, atomic escrow and settlement, activity quests | Runtime UX review |
| Recents | Level 2 privacy control, reciprocal visibility and settings notice | Device review |
| Quests | Eligibility filtering and action links | Runtime review of each action destination |
| Tips | Quest-based XP suggestions, live progress toward Level 2, dismiss/next controls | Runtime review |
| Menus | Grouped user navigation and searchable grouped web/Capacitor admin navigation | Runtime navigation review |
| Admin | Searchable categorized configuration, explicit refresh, cost-sorted regular/business account catalog, transactional product editing, checkout/store mapping and inherited entitlement enforcement | Final operator review |
| AI 2 | Weekly quota, reset notice, request idempotency, paid confirmation, failure refunds, help scope and footer | Live model quality and jailbreak evaluation |
| MISC6 | Twenty-seven beginner help guides, public setting interpolation, help search | Runtime tutorial and current-catalog review |
| Blogs | Post discovery, notification routes, published views, private revisions, recoverable editor, discard/save/unpublish, paywall guidance and confirmed prices, atomic unlock earnings, bundles, first-publish notice/badge | Authenticated UI/device review |
| Bookmarks | Private folders/items, permanent plan entitlements and purchased slots, explicit payment, pagination, web/native management and feed controls | Runtime folder and saved-content review |
| i18N | Canonical locale registry, flags/native names, RTL, profile selector, full key/interpolation coverage for Arabic, Hindi, French, Hausa, Amharic, Portuguese, Swahili, Zulu and Nigerian Pidgin; shared/web parity tooling | Native-language review |
| Consolidate PRD | Current feature/maintainer contracts, archived historical notes, one concise current changelog | Maintainer review of the consolidated requirements |
| Tales | Story/chapter primitive, discovery, author tools, paywalls, pots, subscriptions, text/cover moderation, appeals, drip and shared web/native UI | Live model, browser and device evaluation |
| Auto Content | Official accounts, leased jobs, provider selection, exact/fuzzy duplicate checks, review/edit queue and transactional forum/wiki/blog/room adapters | Live provider/content-quality evaluation and runtime operator review |

## Validation boundaries

Postgres integration tests use only `TEST_DATABASE_URL`, a disposable database. Provider, browser, APK, and production checks must be reported separately. A passing TypeScript check or Vite bundle does not prove a running Next application, a built APK, correct translations, or configured external providers.

The setup draft is separate from running configuration. Live application/provider credentials are absent. GitHub and font access now work: PR #548 is merged, its Android APK and integration CI passed, and a local Next production build passed. The build used `SKIP_ENV_VALIDATION=1` only for compilation; this does not establish runtime/provider readiness. Do not invent credentials.


## Latest verification (2026-10-23)

- Workspace typecheck passed, including the actual Capacitor application project.
- Web unit tests: 547 passed in 50 suites.
- Disposable-Postgres integration tests: 133 passed in 28 suites, including renewal/expiry serialization, purchase replay ownership, transactional rollback and provider lifecycle handling.
- Android tests: 25 passed in 5 files. Capacitor Vite production bundle passed.
- Local Next production build passed with compilation-only environment validation bypass. APK packaging and integration CI passed on merged PR #548; the continuation runs the same CI before merge.
- All nine non-English catalogs have all 5,537 canonical keys, matching interpolation and no obsolete keys or unresolved translation markers. Shared/Capacitor and web catalogs match. Technical labels, names and natural Pidgin borrowings can match English; language quality still warrants native-speaker review. Eight catalogs used machine-assisted translation; Pidgin messages were authored/reviewed directly.
- `git diff --check` passed. No discontinued Expo source changes.
- Repository-level HTTP security suites are discoverable by the security command; execution requires a running configured server/test-account tokens. They were not run against production.
- Authenticated browser/device journeys and live AI/storage/realtime/payment integrations require configured project/provider credentials. They were not exercised by compilation or mocked-provider tests.

The account catalog keeps product identity separate from canonical entitlement tiers. Custom regular/business products inherit their selected tier across existing feature gates; the central panel edits shared tier settings.

## Account catalog and billing continuation

- `/gate44/accounts` and Capacitor `/admin/accounts` manage Free, paid and business products in price order. Revision checks reject stale edits; product identity and inherited tier are immutable. Custom products use the existing tier checks, not an unknown plan string that could bypass quotas.
- Google Play product mappings retain retired IDs for purchase restoration. Verified purchase tokens are globally bound to an owner and product before wallet credit or entitlement activation. Personal and business expiry follows Google's verified period; business activation, reporting and notification writes are atomic.
- Web/PWA checkout handles redirect, free-context and crypto responses. Crypto payments can be resumed from Wallet using the original quoted base units. The wallet now reads the API's actual `paymentUrl` field.
- Cancelled subscriptions are included in expiry cleanup. Migration 0039 fixes an older database constraint that rejected the sweep's `grace`/`lapsed` states. Invoke `/api/cron/daily-economy` through the existing scheduler for period-end cleanup; not running cron leaves cleanup pending.
- Former migrations 0037–0039 (account products/store mappings, global Play receipts and subscription lifecycle states) are now included in the single final-state `0001_consolidated_schema.sql` baseline.
- Expiry cleanup rechecks billing state under account locks; renewal cannot lose its new entitlement or saved data to a stale candidate. Cleanup failures roll the transition back. Paystack lifecycle events match the actual provider subscription, preserve period-end access, and share monthly-bonus deduplication with checkout/cron.


## Migration consolidation

All former 0001–0039 SQL files are consolidated into one declarative baseline: 309 tables and 809 reference rows. A scratch database built from the old chain and databases built from the new SQL have matching final application schemas and reference data. Supabase-style role tests preserve client grants/policies, add explicit server grants and confirm that broad inherited defaults do not expose private receipts. A non-superuser owner installs the schema without platform roles and tolerates an unavailable monitoring extension. Existing extension namespaces are supported without moving provider-owned objects. Seven runner integration checks cover installation/adoption/concurrency/rollback and refuse partial histories or changed files. Existing live databases were not changed. See [database instructions](../apps/web/db/README.md).
