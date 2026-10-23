# Attachment implementation status

This is a verification ledger for the October 2026 request. An implemented item is not a claim of live deployment or device testing. The current work is not the complete requested release.

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
| Admin | Searchable categorized configuration and explicit refresh | Central dynamic account-type catalog and custom plan enforcement |
| AI 2 | Weekly quota, reset notice, request idempotency, paid confirmation, failure refunds, help scope and footer | Live model quality and jailbreak evaluation |
| MISC6 | Twenty-seven beginner help guides, public setting interpolation, help search | Runtime tutorial and current-catalog review |
| Blogs | Post discovery, notification routes, published views, private revisions, recoverable editor, discard/save/unpublish, paywall guidance and confirmed prices, atomic unlock earnings, bundles, first-publish notice/badge | Authenticated UI/device review and final parity audit |
| Bookmarks | Private folders/items, permanent plan entitlements and purchased slots, explicit payment, pagination, web/native management and feed controls | Runtime folder and saved-content review |
| i18N | Canonical locale registry, Hindi scaffold, flags/native names, RTL updates, profile selector, English synchronization and drift audit | Full translations and interpolation corrections across non-English catalogs |
| Consolidate PRD | Current feature/maintainer contracts, archived historical notes, one concise current changelog | Final editorial reconciliation against the archive |
| Tales | Story/chapter primitive, discovery, author tools, paywalls, pots, subscriptions, text/cover moderation, appeals, drip and shared web/native UI | Live model, browser and device evaluation; final author/reader parity review |
| Auto Content | Official accounts, leased jobs, provider selection, exact/fuzzy duplicate checks, review/edit queue and transactional forum/wiki/blog/room adapters | Live provider/content-quality evaluation and runtime operator review |

## Validation boundaries

Postgres integration tests use only `TEST_DATABASE_URL`, a disposable database. Provider, browser, APK, and production checks must be reported separately. A passing TypeScript check or Vite bundle does not prove a running Next application, a built APK, correct translations, or configured external providers.

The cloud setup draft has not been published/applied. Required runtime secrets and project configuration are absent. Next production font downloads and GitHub REST requests currently receive HTTP 403 from the environment network policy. Do not bypass runtime validation or invent credentials.


## Latest local verification (2026-10-23)

- Workspace typecheck passed, including the actual Capacitor application project.
- Web unit tests: 531 passed in 49 suites.
- Disposable-Postgres integration tests: 106 passed in 23 suites. Coverage includes escrow rollback, concurrent purchases/unlocks, private revisions, ownership, exact pagination, Tales access/drip/appeals, automation publication/rollback/deduplication, notification references, reward-pot generations and wallet lock compatibility.
- Android tests: 21 passed in 4 files. Capacitor Vite production bundle passed; this is not an APK/device test.
- `git diff --check` passed. No Expo source or dependency lockfile changes.
- Next production/runtime, live AI/storage/realtime/payment providers, browser journeys, APK packaging and device behavior remain unverified here. Runtime secrets and project configuration are absent; Google Fonts/GitHub API policy changes are saved only in an unpublished environment draft.

The dynamic account-type catalog and full non-English translations are not implemented. The locale audit intentionally reports that remaining translation drift instead of presenting English copies as translations.
