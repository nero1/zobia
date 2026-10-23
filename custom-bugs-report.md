# Custom bugs report
Date and time: 2026-10-23 — 09:30:03 PM WAT (Africa/Lagos)

## Discovered issues

Status updated after remediation (98 original findings plus 12 additional findings): ✅ means the code fix has been implemented on `fix/forensic-hardening`. Final build and release checks are still in progress; this does not mean the changes have been deployed. Findings and their original reproduction evidence below describe the pre-fix code. The FIX paragraphs record the remediation requirements.

Verification summary: unit, database integration, live API security and web/Android type checks passed before the latest edge-case changes; final regression checks are ongoing.

1: BUG ZOB-001: ✅ [Critical] Phone verification records are exposed through Supabase grants without RLS
2: BUG ZOB-002: ✅ [Critical] A crypto transaction can fund multiple independent purchases
3: BUG ZOB-003: ✅ [Critical] Native BNB verification accepts transfers to the wrong recipient
4: BUG ZOB-004: ✅ [Critical] BEP-20 Approval logs can be mistaken for token payments
5: BUG ZOB-005: ✅ [High] Crypto deposits are not bound to the buyer or checkout time
6: BUG ZOB-006: ✅ [High] Solana payments use confirmed state while treating it as final
7: BUG ZOB-007: ✅ [High] Crypto confirmation overwrites the saved receiving address with the sender
8: BUG ZOB-008: ✅ [High] Webhook replay markers suppress retries after unsuccessful processing
9: BUG ZOB-009: ✅ [High] Webhook errors are acknowledged without durable recovery records
10: BUG ZOB-010: ✅ [High] Payout webhooks look up a different identifier from the one stored
11: BUG ZOB-011: ✅ [High] Payout status transitions can regress and conflict with restored earnings
12: BUG ZOB-012: ✅ [High] Star purchases violate the deployed payment-type constraint
13: BUG ZOB-013: ✅ [High] Underpayment handling writes a status rejected by PostgreSQL
14: BUG ZOB-014: ✅ [High] Fulfillment changes purchased terms when the store catalog changes
15: BUG ZOB-015: ✅ [High] Ledger archival makes reconciliation calculate false balances
16: BUG ZOB-016: ✅ [High] Archiving ledger rows removes their idempotency protection
17: BUG ZOB-017: ✅ [High] Balance reconciliation can overwrite a concurrent legitimate transaction
18: BUG ZOB-018: ✅ [Medium] The configured reconciliation threshold is always ignored
19: BUG ZOB-019: ✅ [Medium] Large reconciliation runs repeatedly restart before reaching later users
20: BUG ZOB-020: ✅ [High] Revoked or banned access tokens still authorize many mutations and private reads
21: BUG ZOB-021: ✅ [High] Email administration trusts the JWT admin claim without a live role check
22: BUG ZOB-022: ✅ [High] Several staff authorization paths omit banned and suspended account checks
23: BUG ZOB-023: ✅ [Medium] Staff middleware treats expired suspensions as still active
24: BUG ZOB-024: ✅ [High] Token refresh can recreate a session that was revoked during the refresh
25: BUG ZOB-025: ✅ [High] Refresh returns new credentials even when persisting rotation fails
26: BUG ZOB-026: ✅ [High] Refreshing an impersonation session removes its 15-minute cap
27: BUG ZOB-027: ✅ [Medium] Refreshing a short session can shorten the shared session-index lifetime
28: BUG ZOB-028: ✅ [High] Browser account restoration calls the wrong URL and never installs auth cookies
29: BUG ZOB-029: ✅ [High] Account restoration bypasses two-factor and account-standing gates
30: BUG ZOB-030: ✅ [Medium] Restore tokens are consumed before the account update succeeds
31: BUG ZOB-031: ✅ [High] Browser CSRF middleware blocks the legitimate Telegram bot webhook
32: BUG ZOB-032: ✅ [High] Telegram polling joins a nonexistent sessions table and cannot return refresh credentials
33: BUG ZOB-033: ✅ [High] Telegram bot login bypasses the main login eligibility and 2FA policy
34: BUG ZOB-034: ✅ [High] Nine Drizzle columns do not exist in the consolidated database
35: BUG ZOB-035: ✅ [High] RLS context is optional, inconsistent, and contains recursive policies
36: BUG ZOB-036: ✅ [High] Private KYC uploads are sent to the same public storage destination
37: BUG ZOB-037: ✅ [High] Supabase storage derives the wrong service URL for pooled connections
38: BUG ZOB-038: ✅ [Medium] Selecting S3 still targets Cloudflare R2
39: BUG ZOB-039: ✅ [High] User-controlled Web Push endpoints bypass outbound SSRF protection
40: BUG ZOB-040: ✅ [Medium] The SSRF denylist allows nonpublic address ranges
41: BUG ZOB-041: ✅ [Medium] SSRF hostname validation rejects legitimate names and IPv6-only hosts
42: BUG ZOB-042: ✅ [High] Redirect handling forwards credentials across origins and preserves secret POST bodies
43: BUG ZOB-043: ✅ [Medium] safeFetch creates an unmanaged connection agent for every arbitrary URL
44: BUG ZOB-044: ✅ [Medium] Several outbound requests have no complete operation deadline
45: BUG ZOB-045: ✅ [Medium] Help search injects unsanitized PostgreSQL headlines into HTML
46: BUG ZOB-046: ✅ [High] AI-generated KYC confidence can directly authorize identity approval
47: BUG ZOB-047: ✅ [Medium] KYC model outputs containing names are copied into general AI logs
48: BUG ZOB-048: ✅ [Medium] Invalid image decoding fails open and publishes the original bytes
49: BUG ZOB-049: ✅ [Medium] SVG sanitization removes required attributes but retains external paint URLs
50: BUG ZOB-050: ✅ [Medium] Media URL validation checks the hostname but not the scheme
51: BUG ZOB-051: ✅ [Medium] Upload limits exceed the Vercel function request-body ceiling
52: BUG ZOB-052: ✅ [High] Public CSP reports can cause unbounded database writes and payload retention
53: BUG ZOB-053: ✅ [Medium] Expensive public read endpoints lack an effective bot budget
54: BUG ZOB-054: ✅ [High] Fallback forwarded-IP selection trusts the wrong proxy-chain element
55: BUG ZOB-055: ✅ [Medium] General write limiters undercount across instances and fail open on Redis errors
56: BUG ZOB-056: ✅ [Medium] Health reports valid REST-backed Redis configuration as unhealthy
57: BUG ZOB-057: ✅ [Medium] User data exports silently omit most history and feature data
58: BUG ZOB-058: ✅ [Medium] Export download URLs do not expire and duplicate private data in the database
59: BUG ZOB-059: ✅ [Medium] Concurrent export requests bypass the daily limit
60: BUG ZOB-060: ✅ [High] Delimited exports ignore backpressure and cancellation
61: BUG ZOB-061: ✅ [Medium] CSV and TSV exports allow spreadsheet formula injection
62: BUG ZOB-062: ✅ [Medium] Admin export cursors lose database timestamp precision
63: BUG ZOB-063: ✅ [Medium] New and Friends feeds paginate only a fixed initial slice per content type
64: BUG ZOB-064: ✅ [High] Feed aggregation bypasses privacy, block and moderation visibility filters
65: BUG ZOB-065: ✅ [Medium] For You interest personalization never affects the generated tiers
66: BUG ZOB-066: ✅ [Medium] Cache misses can stampede the database across serverless instances
67: BUG ZOB-067: ✅ [Medium] Portal invalidation can be undone by an older in-flight rebuild
68: BUG ZOB-068: ✅ [Medium] Pusher connection listeners accumulate after component unmount
69: BUG ZOB-069: ✅ [High] The PWA caches authenticated HTML and RSC without account isolation
70: BUG ZOB-070: ✅ [High] Account deletion retains personal identifiers with no implemented purge lifecycle
71: BUG ZOB-071: ✅ [Medium] KYC object cleanup loses its retry source and detached uploads have no quota
72: BUG ZOB-072: ✅ [High] Deletion removes KYC evidence but preserves the verified KYC tier
73: BUG ZOB-073: ✅ [High] Concurrent first game scores can both earn a personal-best reward
74: BUG ZOB-074: ✅ [High] Client-reported scores directly control rewards and wager outcomes
75: BUG ZOB-075: ✅ [High] Game milestone claims commit before their reward bundle is paid
76: BUG ZOB-076: ✅ [Medium] An explicit zero game reward falls back to the platform default
77: BUG ZOB-077: ✅ [High] A failed challenge-round update leaves a scored play that cannot be retried
78: BUG ZOB-078: ✅ [Medium] Phone verification updates and consumption race with replacement requests
79: BUG ZOB-079: ✅ [Medium] Contact lookup matches unverified phone numbers without discovery consent
80: BUG ZOB-080: ✅ [Medium] Profile hreflang tags advertise routes that do not exist
81: BUG ZOB-081: ✅ [Medium] The sitemap silently drops older content and omits blog articles
82: BUG ZOB-082: ✅ [Medium] Important custom dialogs lack complete keyboard focus management
83: BUG ZOB-083: ✅ [High] Schema consistency CI can pass while the runtime schema is incompatible
84: BUG ZOB-084: ✅ [Medium] The security tests contain stale routes and tests that pass without exercising protections
85: BUG ZOB-085: ✅ [Medium] Database access still bypasses typed Drizzle query coverage in active paths
86: BUG ZOB-086: ✅ [High] Daily job claims mark work complete before work succeeds
87: BUG ZOB-087: ✅ [Medium] Audit writes can be dropped after serverless responses
88: BUG ZOB-088: ✅ [Medium] Email delivery failures are swallowed as successful security operations
89: BUG ZOB-089: ✅ [High] Circuit-breaker timeouts do not cancel the underlying operation
90: BUG ZOB-090: ✅ [Medium] Drizzle transactions bypass the database circuit breaker
91: BUG ZOB-091: ✅ [Medium] Silent refresh accepts a backslash-based external redirect
92: BUG ZOB-092: ✅ [Medium] Web realtime callbacks retain stale render state
93: BUG ZOB-093: ✅ [Medium] Push registration has no active-subscription cardinality limit
94: BUG ZOB-094: ✅ [Medium] One invalid database import row aborts its entire batch
95: BUG ZOB-095: ✅ [Medium] Concurrent import workers process the same checkpoint twice
96: BUG ZOB-096: ✅ [High] Clients can fabricate billable ad impressions without a served-ad proof
97: BUG ZOB-097: ✅ [High] Ad billing can exceed remaining budget and ignores daily budgets
98: BUG ZOB-098: ✅ [Medium] Failed ad-event writes are acknowledged as fully recorded

99: BUG ZOB-099: ✅ Browser two-factor screen did not exchange the opaque OAuth pre-auth code
100: BUG ZOB-100: ✅ Referral commission tier used a text database type despite numeric comparisons
101: BUG ZOB-101: ✅ Archived XP amounts were narrower than live ledger amounts
102: BUG ZOB-102: ✅ Admin pre-auth middleware blocked the login and TOTP bootstrap endpoints
103: BUG ZOB-103: ✅ Manual crypto intents omitted the provider reference required for fulfillment
104: BUG ZOB-104: ✅ Coin purchase endpoint accepted star packs without recording the star quantity
105: BUG ZOB-105: ✅ Admin payout retry re-reserved gross funds and retained the restored-earnings flag
106: BUG ZOB-106: ✅ Healthy database circuits counted business and constraint errors as outages
107: BUG ZOB-107: ✅ Malformed proxy-depth configuration could return an undefined client address
108: BUG ZOB-108: ✅ XP award retries could credit the same reference after archival
109: BUG ZOB-109: ✅ Repeated worker crashes could avoid retry limits in recovery and cleanup queues
110: BUG ZOB-110: ✅ Fresh baseline qualified extension functions with the public schema

## Detailed findings

1: BUG ZOB-001: ✅ [Critical] Phone verification records are exposed through Supabase grants without RLS

The baseline grants anon SELECT and authenticated full CRUD on phone_verification_codes but never enables RLS there. In a fresh baseline, SET ROLE anon successfully read a pending phone number and code hash. Authenticated Data API clients can modify verification records belonging to other users. The hash uses only the public user ID and six-digit code, so exposure also permits cheap offline guessing.

FILES: `apps/web/db/migrations/0001_consolidated_schema.sql`; `apps/web/lib/phone/verification.ts`

FIX: Revoke anon/authenticated access to verification secrets. Keep this table server-only with explicit service grants and restrictive RLS as defense in depth. Use a secret HMAC for codes, short expiry, atomic consumption, and role-based negative-access tests. Conditional grants can remain portable without creating Supabase roles.

VALIDATION: Reproduced in PostgreSQL.

2: BUG ZOB-002: ✅ [Critical] A crypto transaction can fund multiple independent purchases

submitTransactionHash records a hash against a payment but never reserves it globally. payments.tx_hash has a nonunique index; provider_transaction_id is not unique either. Two payment rows with different references accepted the same hash in PostgreSQL. Each payment has its own fulfillment guard, allowing one valid deposit to be credited repeatedly.

FILES: `apps/web/lib/payments/crypto/index.ts`; `apps/web/app/api/economy/crypto/confirm/route.ts`; `apps/web/db/migrations/0001_consolidated_schema.sql`

FIX: Atomically reserve a chain transaction and the specific transfer/log being consumed. Enforce uniqueness in PostgreSQL, bind it to the payment, and make verification plus fulfillment concurrency-safe. Test concurrent claims from the same and different accounts.

VALIDATION: Reproduced database invariant failure; fulfillment traced.

3: BUG ZOB-003: ✅ [Critical] Native BNB verification accepts transfers to the wrong recipient

The native BNB branch returns tx.to without comparing it with expectedTo. verifyPayment checks status, value and confirmations but never checks transfer.to. A source-executing isolated fixture returned success for a historical transfer to a different recipient. An adequately funded transfer to an attacker-controlled wallet can therefore satisfy the native-payment checks.

FILES: `apps/web/lib/payments/crypto/chains/bsc.ts`; `apps/web/lib/payments/crypto/index.ts`

FIX: Validate the actual recipient, chain, native/token asset and successful receipt against an immutable server quote before fulfillment. Reject mismatched recipients inside both the chain adapter and shared verifier.

VALIDATION: Reproduced with mocked chain response; adapter branch verified.

4: BUG ZOB-004: ✅ [Critical] BEP-20 Approval logs can be mistaken for token payments

The token branch selects a receipt log by contract address and topics[2] recipient but does not validate topics[0] against the Transfer event signature. ERC-20 Approval has the same indexed owner/spender shape and a numeric data field. Approving the platform address can match these checks without transferring tokens.

FILES: `apps/web/lib/payments/crypto/chains/bsc.ts`

FIX: Decode and validate the exact Transfer ABI event, contract, recipient, amount and log index. Reject other event signatures and malformed logs. Reserve the verified transfer identity when fulfilling the payment.

VALIDATION: Reproduced: adapter accepted an ABI-encoded Approval log as a successful transfer using a mocked receipt.

5: BUG ZOB-005: ✅ [High] Crypto deposits are not bound to the buyer or checkout time

The caller supplies senderAddress, which is only format-checked. The verifier does not compare transfer.from with a proven wallet owner and does not enforce blockTime against checkout creation or expiry. Even after duplicate-hash prevention, an observer can race to claim an unclaimed public deposit for their own purchase.

FILES: `apps/web/lib/payments/crypto/index.ts`; `apps/web/app/api/economy/crypto/confirm/route.ts`

FIX: Bind checkout to a wallet proven by a signed challenge or use unique deposit addresses/payment identifiers. Verify the actual transfer sender where applicable, quote validity and payment creation window. Handle custodial and multi-instruction payments explicitly.

VALIDATION: Code-confirmed.

6: BUG ZOB-006: ✅ [High] Solana payments use confirmed state while treating it as final

The connection and getParsedTransaction use confirmed commitment. SOLANA_MIN_CONFIRMATIONS is one, and confirmation lookup failures default to that passing value. Slot distance is used as confirmation count. Consequently fulfillment can happen without finalized commitment, and a transient slot RPC failure can still produce an accepted result.

FILES: `apps/web/lib/payments/crypto/chains/solana.ts`; `apps/web/lib/payments/crypto/chains/index.ts`

FIX: Require finalized commitment for irreversible fulfillment and fail pending when finality cannot be established. Do not turn RPC failures into passing confirmation counts; test forked, missing and delayed transactions.

VALIDATION: Code-confirmed.

7: BUG ZOB-007: ✅ [High] Crypto confirmation overwrites the saved receiving address with the sender

Checkout stores the quoted receiving address in payments.wallet_address, but submitTransactionHash overwrites that column with senderAddress. storedCryptoQuote subsequently presents the same column as receivingAddress when resuming a payment. Verification also reads the current configured destination instead of the saved quote, so wallet configuration changes can invalidate legitimate pending payments.

FILES: `apps/web/lib/payments/crypto/index.ts`; `apps/web/lib/payments/crypto/storedQuote.ts`; `apps/web/app/api/economy/crypto/pending/route.ts`

FIX: Use separate immutable receiving-address and observed-sender columns. Verify against the saved chain, contract and destination, and ensure resumed quotes retain the original payment instructions.

VALIDATION: Code-confirmed.

8: BUG ZOB-008: ✅ [High] Webhook replay markers suppress retries after unsuccessful processing

The Redis NX marker is written before handlePaystackWebhookPayload. If processing fails, including a transient error returned as HTTP 500, the marker remains for 24 hours. The provider retry then receives a duplicate success response without reprocessing the failed payment.

FILES: `apps/web/app/api/economy/webhooks/paystack/route.ts`

FIX: Use a durable inbox with received/processing/completed states, a recoverable lease and an atomic completion transition. A failed attempt must remain retryable; financial idempotency must live in PostgreSQL, independently of Redis.

VALIDATION: Code-confirmed.

9: BUG ZOB-009: ✅ [High] Webhook errors are acknowledged without durable recovery records

Only three network error codes return 500. Database breaker errors, deadlocks, serialization failures and other processing failures are acknowledged with 200 and an alert. The route never inserts failed_webhooks, although the retry worker reads that table. This leaves legitimate paid events without a durable retry path.

FILES: `apps/web/app/api/economy/webhooks/paystack/route.ts`; `apps/web/app/api/cron/daily-platform/route.ts`

FIX: Persist the verified payload before acknowledging delivery. Classify retryable failures broadly, use bounded exponential backoff with jitter, and dead-letter exhausted events with queue-depth monitoring and an operator replay action.

VALIDATION: Code-confirmed.

10: BUG ZOB-010: ✅ [High] Payout webhooks look up a different identifier from the one stored

attemptTransfer stores transfer.transfer_code as creator_payouts.provider_reference. processTransferEvent instead compares provider_reference with event.data.reference, which is the merchant reference passed as the idempotency key. Normal success/failure webhook events therefore fail to find their payout, delaying completion and failure recovery.

FILES: `apps/web/lib/payments/payouts.ts`; `apps/web/lib/payments/paystackWebhookHandler.ts`

FIX: Store merchant reference and provider transfer code separately, enforce their intended uniqueness, and match webhook fields consistently. Test real-shaped provider responses from initiation through webhook reconciliation.

VALIDATION: Code-confirmed.

11: BUG ZOB-011: ✅ [High] Payout status transitions can regress and conflict with restored earnings

processTransferEvent locks a payout but does not select or validate its current status before applying success or failure. A delayed failure can overwrite completed and schedule another attempt; delayed success can overwrite a reversed/restored payout without compensating the refunded balance. Redis deduplication does not enforce event ordering or permanent terminal states.

FILES: `apps/web/lib/payments/paystackWebhookHandler.ts`; `apps/web/lib/payments/payouts.ts`

FIX: Define a provider-aware payout state machine under one row lock. Require valid current-state transitions, reconcile ambiguous events against the provider, and make transfers, refunds and compensation mutually consistent and durably idempotent.

VALIDATION: Code-confirmed.

12: BUG ZOB-012: ✅ [High] Star purchases violate the deployed payment-type constraint

Both paid and free star purchase paths write payment_type=star_purchase. The baseline payments_payment_type_check excludes that value. A local insert failed with PostgreSQL 23514, so checkout can initialize externally and then fail while recording the payment.

FILES: `apps/web/app/api/economy/stars/purchase/route.ts`; `apps/web/db/migrations/0001_consolidated_schema.sql`

FIX: Align the database payment-type contract with every actual checkout type. Validate and persist an idempotent pending intent before external initialization, then finalize the provider reference safely. Add a real database star-checkout test.

VALIDATION: Reproduced in PostgreSQL.

13: BUG ZOB-013: ✅ [High] Underpayment handling writes a status rejected by PostgreSQL

The pack-underpayment branch writes status=underpaid, but payments_status_check does not allow it. Catching that statement error inside the transaction does not restore the transaction: later statements remain aborted and the intended status/alert cannot commit. Webhook acknowledgment and replay-marker behavior can then conceal the unresolved payment.

FILES: `apps/web/lib/payments/paystackWebhookHandler.ts`; `apps/web/db/migrations/0001_consolidated_schema.sql`

FIX: Use an allowed, explicit review status and a coherent payment state machine. Never swallow a PostgreSQL statement error inside a transaction without a savepoint or rollback. Test the complete underpayment branch against the baseline.

VALIDATION: Code-confirmed.

14: BUG ZOB-014: ✅ [High] Fulfillment changes purchased terms when the store catalog changes

processChargeSuccess reloads current store_items prices and grant amounts rather than honoring an immutable checkout snapshot. Editing or deleting a pack between initialization and payment changes fulfillment or its underpayment decision. Subscription/business branches also do not consistently validate actual currency and amount against the persisted intent.

FILES: `apps/web/lib/payments/paystackWebhookHandler.ts`; `apps/web/app/api/economy/coins/purchase/route.ts`; `apps/web/app/api/economy/stars/purchase/route.ts`

FIX: Snapshot server-approved price, currency, product and grant quantities when creating the payment. Fulfill only that snapshot after matching provider amount, currency, reference and account; treat catalog changes as applying to future checkouts.

VALIDATION: Code-confirmed.

15: BUG ZOB-015: ✅ [High] Ledger archival makes reconciliation calculate false balances

Archival moves old ledger rows out of the live tables. Both balance audit implementations sum only live ledger rows. A correct wallet consequently appears inconsistent after archival, and reconcile-balances can overwrite it when the missing historical amount falls within its automatic correction threshold.

FILES: `apps/web/app/api/cron/archive-ledgers/route.ts`; `apps/web/app/api/cron/reconcile-balances/route.ts`; `apps/web/app/api/cron/daily-platform/route.ts`

FIX: Reconcile against live plus archived history, or maintain verified opening-balance checkpoints. Make archival and accounting readers share one tested historical contract; never automatically correct money from an incomplete ledger.

VALIDATION: Code-confirmed.

16: BUG ZOB-016: ✅ [High] Archiving ledger rows removes their idempotency protection

Coin/star duplicate lookup and unique reference indexes apply only to the live ledger. Archival deletes those rows, and the helpers do not consult the archive. Replaying a previously used business reference after archival can therefore apply the same credit or debit again.

FILES: `apps/web/app/api/cron/archive-ledgers/route.ts`; `apps/web/lib/economy/coins.ts`; `apps/web/lib/economy/stars.ts`

FIX: Keep durable operation deduplication independent of hot ledger retention, or enforce uniqueness across the full history. Test replay after archival, including refunds, rewards, transfers and delayed administrative retries.

VALIDATION: Code-confirmed.

17: BUG ZOB-017: ✅ [High] Balance reconciliation can overwrite a concurrent legitimate transaction

The CTE reads a consistent snapshot, but the later correction UPDATE is a separate operation with no lock or comparison against the observed balance. A legitimate transfer or reward committed between those statements can be overwritten by the stale ledger sum. Audit records and correction counters are also written before correction success is known.

FILES: `apps/web/app/api/cron/reconcile-balances/route.ts`

FIX: Recheck under the same account lock used by wallet mutations, inside one transaction, or use a compare-and-swap update and retry changed rows. Record correction evidence only with the successfully committed change.

VALIDATION: Code-confirmed.

18: BUG ZOB-018: ✅ [Medium] The configured reconciliation threshold is always ignored

getManifestValue returns string or null, but reconcile-balances accepts its threshold only when typeof value is number. Normal configured values therefore always fall back to 50, leaving the financial auto-correction limit different from the administrator setting.

FILES: `apps/web/app/api/cron/reconcile-balances/route.ts`; `apps/web/lib/manifest/index.ts`

FIX: Parse the stored string explicitly, validate an integer within a safe range, and use the documented manifest key consistently. Test nondefault, zero, missing and invalid values.

VALIDATION: Code-confirmed.

19: BUG ZOB-019: ✅ [Medium] Large reconciliation runs repeatedly restart before reaching later users

The job stops after 200 batches of 500 users and returns stoppedAtCursor, but every invocation initializes lastId to the zero UUID and accepts no continuation cursor. Installations above 100,000 users cannot progress past the initial range by simply rerunning it.

FILES: `apps/web/app/api/cron/reconcile-balances/route.ts`

FIX: Persist a resumable checkpoint or accept a validated continuation token. Advance it only after successful batches and expose incomplete coverage in monitoring. Bound each invocation by elapsed time as well as row count.

VALIDATION: Code-confirmed.

20: BUG ZOB-020: ✅ [High] Revoked or banned access tokens still authorize many mutations and private reads

withAuth checks session liveness and account standing only for a path regex. Blog unlocks, bookmark purchases, game costs/wagers, ordinary messages and many other mutations fall outside it; most private GETs do too. These continue accepting a signed token after logout/revocation until its configured access expiry. Their wallet helpers do not independently reject banned/suspended accounts.

FILES: `apps/web/lib/api/middleware.ts`; `apps/web/app/api/blogs/[slug]/posts/[postSlug]/unlock/route.ts`; `apps/web/app/api/games/[slug]/start/route.ts`; `apps/web/lib/bookmarks/service.ts`

FIX: Apply live revocation/account checks to all mutations and sensitive private reads through explicit route policies, rather than a partial regex. Enforce account eligibility again at financial service boundaries and test every spending route with a revoked session.

VALIDATION: Code-confirmed.

21: BUG ZOB-021: ✅ [High] Email administration trusts the JWT admin claim without a live role check

Email-settings GET/PUT use withAuth and auth.user.is_admin, rather than withAdminAuth or a database admin lookup. The path does not trigger ordinary live verification. A demoted or revoked administrator holding an unexpired token can still change platform email controls.

FILES: `apps/web/app/api/admin/email-settings/route.ts`; `apps/web/lib/api/middleware.ts`

FIX: Use the live admin authorization boundary for every administrative operation. Require an active account, live session and current database role; inventory routes to prevent weaker local checks from bypassing it.

VALIDATION: Code-confirmed.

22: BUG ZOB-022: ✅ [High] Several staff authorization paths omit banned and suspended account checks

getStaffRoles filters deleted users but not banned/suspended ones. Support authorization and several manual admin/moderator routes rely on this weaker role lookup or equivalent queries, while withAuth does not check their session/account standing. A banned staff account whose role flags remain set can retain privileged access until token expiry.

FILES: `apps/web/lib/auth/roles.ts`; `apps/web/lib/support/staffAuth.ts`; `apps/web/app/api/admin/rooms/route.ts`; `apps/web/app/api/admin/guilds/route.ts`; `apps/web/app/api/admin/leaderboards/[userId]/route.ts`

FIX: Centralize active-staff authorization with current role and live-session checks. Reuse it for staff reads, support actions, profile visibility exceptions and administrative mutations; reject suspended/banned actors consistently.

VALIDATION: Code-confirmed.

23: BUG ZOB-023: ✅ [Medium] Staff middleware treats expired suspensions as still active

withAdminAuth, withModeratorOrAdminAuth and withAdModeratorOrAdminAuth reject any is_suspended flag without reading suspended_until. Ordinary withAuth and refresh correctly distinguish expired suspensions. Staff can remain locked out after their suspension ends until another path happens to clear the stale flag.

FILES: `apps/web/lib/api/middleware.ts`

FIX: Use one account-standing helper that evaluates suspension expiry consistently. Perform any cleanup conditionally without making a stale boolean the source of truth.

VALIDATION: Code-confirmed.

24: BUG ZOB-024: ✅ [High] Token refresh can recreate a session that was revoked during the refresh

refreshAccessToken reads the session before acquiring its refresh lock, then performs database work and later unconditionally SETEXs the record. Session revocation does not coordinate with that lock or use a generation check. Logout or session eviction between the read and write can therefore be undone by the refresh.

FILES: `apps/web/lib/auth/session.ts`

FIX: Use an atomic compare-and-swap rotation against the current session hash/generation and an existence check. Coordinate revocation with durable user/session generations so a stale worker cannot recreate revoked state.

VALIDATION: Code-confirmed.

25: BUG ZOB-025: ✅ [High] Refresh returns new credentials even when persisting rotation fails

The pipeline that stores the rotated refresh hash and expiry ends with catch(() => {}). The function then updates its local cache and returns new tokens. If Redis persistence failed, the new refresh token may not match server state and the previous token remains current; subsequent refresh can trigger reuse detection and revoke otherwise valid sessions.

FILES: `apps/web/lib/auth/session.ts`

FIX: Require successful authoritative rotation before returning credentials. Inspect pipeline command errors, keep rotation atomic and make transient persistence failure retryable without publishing an uncommitted token pair.

VALIDATION: Code-confirmed.

26: BUG ZOB-026: ✅ [High] Refreshing an impersonation session removes its 15-minute cap

createSession caps impersonated sessions at 900 seconds, but refreshAccessToken selects ordinary role TTLs and carries impersonatedBy forward without checking the original administrator. Refreshing before expiry expands the session lifetime and can preserve impersonation after the administrator loses permission.

FILES: `apps/web/lib/auth/session.ts`; `apps/web/app/api/admin/users/[userId]/impersonate/route.ts`

FIX: Persist an absolute impersonation expiry and originating authorization context. Cap every refresh to the remaining lifetime and revalidate the administrator; prohibit financial or identity-sensitive impersonated actions according to an explicit policy.

VALIDATION: Code-confirmed.

27: BUG ZOB-027: ✅ [Medium] Refreshing a short session can shorten the shared session-index lifetime

Session creation extends user_sessions TTL only when necessary, but refresh unconditionally calls EXPIRE with that session refreshTtl. Mixed session lifetimes, including short impersonation sessions, can expire the shared index while longer session records still exist. Bulk revocation and session listing then lose those orphaned records.

FILES: `apps/web/lib/auth/session.ts`

FIX: Extend the index to at least the maximum remaining session lifetime atomically. Maintain membership and session expiry together, and test mixed role/impersonation lifetimes and bulk logout.

VALIDATION: Code-confirmed.

28: BUG ZOB-028: ✅ [High] Browser account restoration calls the wrong URL and never installs auth cookies

The page calls apiClient.patch("/auth/account/restore"), but this client is rooted at the site origin, not /api. Even with the URL corrected, the route returns token strings without setting browser cookies, and the client response interceptor only passes responses through. The page assumes automatic token storage and redirects into an unauthenticated session.

FILES: `apps/web/app/auth/restore/page.tsx`; `apps/web/lib/api/client.ts`; `apps/web/app/api/auth/account/restore/route.ts`

FIX: Use the correct API URL and explicitly establish the browser cookie session through the standard login contract. Update auth state only after server-confirmed installation; test restore from a signed-out browser through the first protected navigation.

VALIDATION: Code-confirmed.

29: BUG ZOB-029: ✅ [High] Account restoration bypasses two-factor and account-standing gates

completeAccountRestore clears deleted_at and calls createSession directly. It neither verifies banned/suspended status nor requires configured TOTP. A restore email token can therefore produce a full privileged session for a two-factor-enabled account, including a deleted account that remains banned.

FILES: `apps/web/lib/auth/restore.ts`; `apps/web/app/api/auth/account/restore/route.ts`

FIX: Use the same account eligibility and step-up authentication flow as normal login. Restoration should reactivate eligible accounts but issue only a pre-auth challenge until all required factors have passed.

VALIDATION: Code-confirmed.

30: BUG ZOB-030: ✅ [Medium] Restore tokens are consumed before the account update succeeds

The Redis used-token marker is written before the database update and is not released or converted into retryable state on database failure. A temporary database outage burns the link for up to 48 hours. Separate tokens also lack a deletion-generation binding, so an unused older link can apply to a later deletion of the same account.

FILES: `apps/web/lib/auth/restore.ts`

FIX: Bind tokens to a specific restoration/deletion generation and consume them transactionally with the state transition. Use a recoverable claim if Redis must participate, with explicit retry semantics.

VALIDATION: Code-confirmed.

31: BUG ZOB-031: ✅ [High] Browser CSRF middleware blocks the legitimate Telegram bot webhook

All /api/auth mutation routes undergo Origin validation. Telegram bot delivery has no browser Origin or Bearer token, so /api/auth/telegram/bot is rejected before its secret-header verifier runs. Unlike the Paystack endpoints, this server-to-server callback has no CSRF exemption.

FILES: `apps/web/middleware.ts`; `apps/web/app/api/auth/telegram/bot/route.ts`

FIX: Explicitly route server-to-server callbacks to their own authenticated boundary. Exempt only the exact webhook path from browser CSRF and require the Telegram secret plus durable update deduplication.

VALIDATION: Code-confirmed.

32: BUG ZOB-032: ✅ [High] Telegram polling joins a nonexistent sessions table and cannot return refresh credentials

The status endpoint LEFT JOINs public.sessions, which does not exist in the consolidated baseline. Its refresh_token source is also never written by the bot flow: bot approval stores only an access token in telegram_login_states while sessions actually live in Redis. The daily cleanup still queries this missing table too.

FILES: `apps/web/app/api/auth/telegram/status/route.ts`; `apps/web/app/api/auth/telegram/bot/route.ts`; `apps/web/app/api/cron/daily-platform/route.ts`

FIX: Replace the legacy join with a short-lived, single-use exchange-code flow backed by the real session store. Deliver a complete token pair through the authenticated exchange and remove obsolete SQL cleanup.

VALIDATION: Missing relation confirmed in PostgreSQL; flow traced.

33: BUG ZOB-033: ✅ [High] Telegram bot login bypasses the main login eligibility and 2FA policy

After receiving a valid bot command, the bot handler upserts a user and immediately calls createSession. Its selected user fields omit bans, suspensions and TOTP, and account creation does not enforce the signup/provider toggles used by the main callback. Correcting webhook reachability alone would expose this alternate authentication path.

FILES: `apps/web/app/api/auth/telegram/bot/route.ts`; `apps/web/app/api/auth/telegram/callback/route.ts`

FIX: Funnel every identity-provider login through one signup, account-standing and 2FA policy. Return pre-auth challenges when required and consume pending login state atomically.

VALIDATION: Code-confirmed.

34: BUG ZOB-034: ✅ [High] Nine Drizzle columns do not exist in the consolidated database

Live catalog comparison found missing push_tickets.token, telegram_login_states.expires_at, guilds.below_minimum_days, guild_wars.resolved_at, guild_alliances.wars_drawn, seasons.status, store_items.slug, sponsored_quests.updated_at and failed_webhooks.max_attempts. Explicit selects against five examples returned 42703. Active guild settlement, season rewards and push receipt code reference missing columns; broad Drizzle selects can also include latent missing fields.

FILES: `apps/web/lib/db/schema.ts`; `apps/web/db/migrations/0001_consolidated_schema.sql`; `apps/web/lib/notifications/push.ts`; `apps/web/lib/guilds/warEngine.ts`; `apps/web/lib/seasons/seasonEngine.ts`

FIX: Reconcile each table against actual business logic, not comments. Decide the correct canonical columns and transitions, migrate safely, regenerate mappings and compare the complete deployed catalog against Drizzle in CI. Verify all nine affected table contracts.

VALIDATION: Reproduced catalog diff and SQL errors.

35: BUG ZOB-035: ✅ [High] RLS context is optional, inconsistent, and contains recursive policies

Handlers normally call getDb directly; none invoke auth.withRLS. That helper sets app.current_user_id, while KYC policies require app.user_id/admin/system settings. A restricted-role fixture with the helper GUC could read its payments but not its own KYC row. Selecting group_chat_members produced 42P17 because its policy queries itself. Broad PUBLIC service/blank-context policies further weaken isolation when privileges are granted.

FILES: `apps/web/lib/api/middleware.ts`; `apps/web/lib/db/drizzle.ts`; `apps/web/db/migrations/0001_consolidated_schema.sql`

FIX: Define explicit portable application roles and one transaction-scoped identity contract. Apply it consistently, remove self-recursive membership checks using carefully scoped helpers, and restrict service policies by role. Test non-BYPASSRLS users and adversarial cross-account access, not only superuser fixtures.

VALIDATION: Reproduced KYC denial and RLS recursion.

36: BUG ZOB-036: ✅ [High] Private KYC uploads are sent to the same public storage destination

The KYC route requests isPublic:false, but both storage adapters ignore that option and use the same bucket and public URL construction as public media. With the normal public-media bucket/CDN configuration, a signed-download API does not make KYC objects private. Opaque object names are not access control.

FILES: `apps/web/lib/storage/providers/r2.ts`; `apps/web/lib/storage/providers/supabase-storage.ts`; `apps/web/app/api/kyc/documents/route.ts`

FIX: Use separate private storage buckets or equivalent enforced object policies. Make privacy a mandatory adapter contract, never return a public URL for private objects, set private cache headers and verify unauthenticated object requests are denied.

VALIDATION: Code-confirmed; exposure depends on bucket configuration.

37: BUG ZOB-037: ✅ [High] Supabase storage derives the wrong service URL for pooled connections

getStorageBaseUrl ignores the configured SUPABASE_URL and only recognizes direct @db.<ref>.supabase.co database hosts. Pooler URLs fall back to NEXT_PUBLIC_APP_URL/storage/v1, sending storage requests and authorization to the application host. The adapter also falls back to the application JWT secret when the storage service key is absent.

FILES: `apps/web/lib/storage/providers/supabase-storage.ts`; `apps/web/lib/env.ts`

FIX: Require an explicit validated Supabase project URL and storage service credential. Do not infer service endpoints from pooler URLs or reuse app signing keys. Test direct and pooled database configurations with independent storage selection.

VALIDATION: Code-confirmed.

38: BUG ZOB-038: ✅ [Medium] Selecting S3 still targets Cloudflare R2

The s3 provider simply constructs R2StorageAdapter, whose endpoint is always https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com and region is auto. There is no S3 endpoint or AWS region configuration path, so selecting the advertised S3 option cannot connect to a normal S3 bucket.

FILES: `apps/web/lib/storage/index.ts`; `apps/web/lib/storage/providers/r2.ts`

FIX: Implement a real S3 adapter or a validated configurable S3-compatible endpoint/region abstraction. Advertise only functioning providers and run the same privacy, signed-URL and deletion contract tests for each.

VALIDATION: Code-confirmed.

39: BUG ZOB-039: ✅ [High] User-controlled Web Push endpoints bypass outbound SSRF protection

Push registration accepts any bounded string for a web subscription. The sender later JSON-parses it and passes its endpoint directly to web-push, without endpoint-host allowlisting, private-address validation or DNS pinning. An authenticated attacker can register a crafted subscription and induce outbound requests when notifications are generated.

FILES: `apps/web/app/api/users/push-token/route.ts`; `apps/web/lib/notifications/webPush.ts`

FIX: Validate subscription shape and permitted push-service HTTPS origins on registration and again before sending. Reject internal/nonpublic destinations and redirects, impose request deadlines and cap active subscriptions per account/device.

VALIDATION: Code-confirmed SSRF boundary; no internal-network probe performed.

40: BUG ZOB-040: ✅ [Medium] The SSRF denylist allows nonpublic address ranges

PRIVATE_RANGES omits ranges such as 100.64.0.0/10 and most of 0.0.0.0/8. Only the exact 0.0.0.0 hostname is separately blocked. These destinations can pass validation even though they are unsuitable as arbitrary public fetch targets, particularly in private/VPN deployments.

FILES: `apps/web/lib/security/ssrf.ts`

FIX: Use a maintained address-classification implementation with an explicit globally routable policy for both IP families. Test special-use ranges, alternate literal encodings and mapped IPv6 before connecting.

VALIDATION: Code-confirmed; reachability depends on deployment network.

41: BUG ZOB-041: ✅ [Medium] SSRF hostname validation rejects legitimate names and IPv6-only hosts

isPrivateIp applies startsWith("fc")/startsWith("fd") to every hostname rather than only parsed IPv6 addresses. A mocked-DNS fixture rejected https://fcdn.example as a private IP before DNS. Public IPv6 literals/AAAA-only sites are also not supported because the resolver requires an A record.

FILES: `apps/web/lib/security/ssrf.ts`

FIX: Parse IP literals before applying address-range rules and handle DNS names separately. Support validated IPv6 addresses with the correct dispatcher address family, or explicitly document and report unsupported destinations.

VALIDATION: False-positive hostname reproduced.

42: BUG ZOB-042: ✅ [High] Redirect handling forwards credentials across origins and preserves secret POST bodies

Headers are stripped only when hostname changes, so an HTTPS-to-HTTP or port-changing redirect retains credentials. An isolated execution forwarded Authorization and a POST secret body to HTTP on the same host at another port. Cross-host redirects remove selected headers but still replay the body, including OAuth/CAPTCHA/mail secrets.

FILES: `apps/web/lib/security/ssrf.ts`; `apps/web/lib/security/captcha.ts`; `apps/web/lib/notifications/email.ts`; `apps/web/lib/auth/google.ts`

FIX: Compare full origins, prohibit HTTPS downgrade, and use redirect:error for credential-bearing provider requests. Apply proper 301/302/303 method semantics where redirects are intentional; never forward sensitive bodies to unapproved destinations.

VALIDATION: Reproduced with mocked HTTP responses.

43: BUG ZOB-043: ✅ [Medium] safeFetch creates an unmanaged connection agent for every arbitrary URL

Every nonallowlisted fetch allocates an UndiciAgent, but no path closes or destroys it. Redirect responses and oversized-header rejections also leave bodies undrained. Repeated link previews create avoidable pools and socket lifetimes instead of reusing bounded resources, amplifying memory/connection pressure.

FILES: `apps/web/lib/security/ssrf.ts`; `apps/web/app/api/messages/link-preview/route.ts`

FIX: Own dispatcher lifecycles explicitly: reuse a bounded safe pool where feasible or close per-request agents in finally after consuming/canceling bodies. Drain or cancel redirect/error responses and test resource counts under repeated failures.

VALIDATION: Code-confirmed.

44: BUG ZOB-044: ✅ [Medium] Several outbound requests have no complete operation deadline

safeFetch has a size bound but no default deadline for DNS, headers and streamed body. Image classification fetches, CAPTCHA and email callers supply no AbortSignal. A peer that stalls without exceeding the byte limit can occupy the function until the hosting deadline, delaying authentication or moderation and consuming resources.

FILES: `apps/web/lib/security/ssrf.ts`; `apps/web/lib/ai/vision.ts`; `apps/web/lib/notifications/email.ts`; `apps/web/lib/security/captcha.ts`

FIX: Enforce an overall deadline, propagate cancellation through DNS/connect/body reads and use bounded retries with jitter only for safely repeatable operations. Distinguish timeout from permanent validation failure.

VALIDATION: Code-confirmed.

45: BUG ZOB-045: ✅ [Medium] Help search injects unsanitized PostgreSQL headlines into HTML

searchDocs returns ts_headline over raw body_markdown and only interpolates variables before clients use dangerouslySetInnerHTML. PostgreSQL preserved an img/onerror payload in a local query. Unlike normal document rendering, search bypasses the Markdown sanitization pipeline. Web CSP may block inline execution, but native rendering and HTML injection remain exposed.

FILES: `apps/web/lib/help/service.ts`; `apps/web/app/help/search/page.tsx`; `apps/android/src/routes/help/search.tsx`

FIX: Strip/escape source markup before highlighting, or sanitize headline output using a tiny allowlist containing only safe emphasis tags. Render highlights as structured text where possible and test both web and Android sinks.

VALIDATION: Raw HTML preservation reproduced in PostgreSQL.

46: BUG ZOB-046: ✅ [High] AI-generated KYC confidence can directly authorize identity approval

Untrusted submitted names and document images enter model prompts. Model-generated scores feed finalizeAiReview, which can call approveSubmission without an independent authoritative identity result or mandatory human review. The name-match boolean is not required when using the score. This makes prompt manipulation and ordinary model errors security-sensitive approval inputs.

FILES: `apps/web/lib/kyc/aiNameMatch.ts`; `apps/web/lib/kyc/geminiVision.ts`; `apps/web/lib/kyc/service.ts`

FIX: Treat model output as untrusted triage evidence. Require authoritative verification and hard per-signal thresholds for automatic approval, or human review; constrain name inputs, validate strict output schemas and test adversarial text embedded in names/documents.

VALIDATION: Code-confirmed trust-boundary risk; successful model exploit not asserted.

47: BUG ZOB-047: ✅ [Medium] KYC model outputs containing names are copied into general AI logs

The KYC model response includes extractedName and document notes. classifyImage writes the first 500 characters of the raw response to ai_call_log.result_preview and includes it in attempts. This duplicates identity information outside the dedicated encrypted KYC records and their deletion path.

FILES: `apps/web/lib/ai/vision.ts`; `apps/web/lib/ai/monitoring.ts`; `apps/web/lib/kyc/geminiVision.ts`

FIX: Redact structured KYC outputs before logging. Store only decision codes, timing, confidence and restricted correlation identifiers; include any necessary personal-data audit records in explicit access, retention and erasure controls.

VALIDATION: Code-confirmed.

48: BUG ZOB-048: ✅ [Medium] Invalid image decoding fails open and publishes the original bytes

compressImage catches decoding failures and returns the original buffer labeled image/jpeg. Upload validation checks client MIME and size, not successful decoding. A local fixture published unchanged "not an image" bytes as JPEG. Malformed files and disguised active formats therefore bypass the intended raster normalization and corrupt media behavior.

FILES: `apps/web/lib/storage/compress.ts`; `apps/web/lib/uploads/uploadImage.ts`

FIX: Reject decode/format failures, validate file signatures and dimensions, and re-encode accepted rasters. Separate a genuinely optional optimization failure from an invalid upload; never manufacture a MIME type for unvalidated original bytes.

VALIDATION: Reproduced by executing compressImage.

49: BUG ZOB-049: ✅ [Medium] SVG sanitization removes required attributes but retains external paint URLs

The HTML parser normalizes SVG attribute names while the allowlist uses mixed case, causing viewBox and similar attributes to be dropped. A local execution removed viewBox but preserved fill="url(https://attacker.example/a)". Valid artwork can render incorrectly, and external resource references remain available in rendering contexts that honor them.

FILES: `apps/web/lib/uploads/sanitizeSvg.ts`; `apps/web/lib/uploads/imageValidation.ts`

FIX: Use an SVG-aware sanitizer with preserved attribute casing, strict local fragment-only paint references and explicit complexity limits, or rasterize safely. Test viewBox, gradients, clipping, external URLs and direct-document rendering.

VALIDATION: Reproduced sanitizer output; external fetching is rendering-context dependent.

50: BUG ZOB-050: ✅ [Medium] Media URL validation checks the hostname but not the scheme

isAllowedMediaUrl accepts any URL whose hostname matches configuration and returns true for all input when the allowlist is empty. Executing it accepted javascript://app.example/... and http://app.example/... for an HTTPS app host. Callers cannot rely on this helper as a safe media-URL boundary.

FILES: `apps/web/lib/security/mediaUrl.ts`

FIX: Require HTTPS, reject credentials and unexpected ports, validate canonical URL parsing, and fail closed outside an explicit development mode. Keep storage ownership/path validation separate from hostname validation.

VALIDATION: Reproduced validator acceptance; script execution not asserted.

51: BUG ZOB-051: ✅ [Medium] Upload limits exceed the Vercel function request-body ceiling

KYC accepts 10 MiB files and admin import accepts approximately 50 MiB, both through route-handler request bodies. These exceed the Vercel function payload ceiling of approximately 4.5 MB before multipart overhead. The platform rejects them before application validation, so documented in-app limits and failure messages cannot work as implemented.

FILES: `apps/web/app/api/kyc/documents/route.ts`; `apps/web/app/api/admin/data-management/users/import/route.ts`

FIX: Use authenticated direct-to-storage uploads with narrow short-lived policies, then process bounded object references. Otherwise cap complete request size below the hosting limit and show the actual limit in every client.

VALIDATION: Deployment constraint; no Vercel upload attempted.

52: BUG ZOB-052: ✅ [High] Public CSP reports can cause unbounded database writes and payload retention

The public endpoint reads the full request and loops through an arbitrary report array, persisting raw metadata. It has no rate limit or batch/body cap. Its in-memory deduplication clears at 200 keys and unique attacker-supplied URLs bypass it, enabling database/log bloat and excessive serverless work. Null array elements also throw during normalization.

FILES: `apps/web/app/api/security/csp-report/route.ts`; `apps/web/lib/alerts/dispatch.ts`

FIX: Bound body size, report count and field lengths; validate every item, rate-limit by trusted origin/IP with a global budget, redact URL secrets and sample/aggregate reports. Await or durably enqueue accepted batches.

VALIDATION: Code-confirmed.

53: BUG ZOB-053: ✅ [Medium] Expensive public read endpoints lack an effective bot budget

Help search and health perform database work without route rate limiting. Public pages use a dynamic root layout and profile metadata/body can repeat database reads. Anonymous request floods can therefore consume free-tier database/Redis/function quotas independently of authenticated local read limits.

FILES: `apps/web/app/api/help/search/route.ts`; `apps/web/app/api/health/route.ts`; `apps/web/app/layout.tsx`; `apps/web/app/u/[username]/page.tsx`

FIX: Add bounded public-read budgets, cache safe shared responses and deduplicate repeated per-render reads. Separate cheap liveness from dependency readiness and measure bot traffic against explicit free-tier resource budgets.

VALIDATION: Code-confirmed.

54: BUG ZOB-054: ✅ [High] Fallback forwarded-IP selection trusts the wrong proxy-chain element

The fallback index is ips.length - trustedProxyCount - 1. With one trusted reverse proxy appending the real client to attacker-supplied X-Forwarded-For, [spoofed, actual] selects spoofed. With multiple normal hops it can select a shared proxy and lock out unrelated users. The Vercel-specific header avoids this only when present.

FILES: `apps/web/lib/security/rateLimit.ts`

FIX: Define and enforce the trusted proxy boundary precisely, use a validated proxy-address parser and reject untrusted forwarding headers. Test direct traffic, one proxy with attacker-supplied prefixes, multiple proxies and malformed proxy-count configuration.

VALIDATION: Code-confirmed.

55: BUG ZOB-055: ✅ [Medium] General write limiters undercount across instances and fail open on Redis errors

apiWrite and several monetary/AI work paths do not set bypassL1. The fast path increments only local counters, so requests skipped on one instance are absent from the shared count. Redis failures allow these requests without even a bounded local fallback. This weakens anti-spam, AI-cost and financial-event abuse controls under scale or outage.

FILES: `apps/web/lib/security/rateLimit.ts`; `apps/web/app/api/ads/events/route.ts`; `apps/web/app/api/help/ask-ai/route.ts`

FIX: Use exact shared, fail-closed budgets for costly or sensitive writes and bounded local fallback for lower-risk traffic. Explicitly classify every route; reserve approximate limits for genuinely inexpensive reads.

VALIDATION: Code-confirmed.

56: BUG ZOB-056: ✅ [Medium] Health reports valid REST-backed Redis configuration as unhealthy

The readiness endpoint requires process.env.REDIS_URL even though the Redis adapter supports Upstash REST credentials without that variable. A working supported configuration can pass redis.ping and still return HTTP 503 because the configuration check hardcodes a different backend shape.

FILES: `apps/web/app/api/health/route.ts`; `apps/web/lib/redis/index.ts`; `apps/web/lib/env.ts`

FIX: Validate configuration through the selected adapter/environment schema. Report backend-specific readiness independently from liveness, with bounded dependency checks and no credential details.

VALIDATION: Code-confirmed.

57: BUG ZOB-057: ✅ [Medium] User data exports silently omit most history and feature data

The export includes only the latest 1,000 sent messages and 500 coin entries, plus a small profile/friends/guild/quest subset. It omits older/archived history, stars, authored content, purchases and numerous other user records without a truncation manifest. This is not a complete portability export for an established account.

FILES: `apps/web/app/api/users/me/export/route.ts`

FIX: Define a versioned personal-data inventory and export all applicable records in bounded pages, including historical partitions. Disclose exclusions and provide counts/checksums so users can verify completeness.

VALIDATION: Code-confirmed.

58: BUG ZOB-058: ✅ [Medium] Export download URLs do not expire and duplicate private data in the database

The entire export is base64-encoded into a data: URL stored in data_export_requests. expiresAt is only metadata: copying that URL preserves access forever, independently of account deletion or scheduled request cleanup. Base64 also expands and duplicates private message/profile data in PostgreSQL.

FILES: `apps/web/app/api/users/me/export/route.ts`; `apps/web/app/api/cron/daily-platform/route.ts`

FIX: Store encrypted private export objects with authorized, expiring download access and delete them on expiry/account deletion. Keep request rows as small metadata, and explain that already downloaded files cannot be remotely revoked.

VALIDATION: Code-confirmed.

59: BUG ZOB-059: ✅ [Medium] Concurrent export requests bypass the daily limit

checkExportRateLimit performs a SELECT before an independent INSERT, without a user lock or unique time-window reservation. Concurrent requests can all pass the check and produce duplicate export payloads and work. A failed export also leaves a pending request that consumes the limit until expiry.

FILES: `apps/web/app/api/users/me/export/route.ts`

FIX: Atomically reserve a per-user export window, reuse an existing active job and track retryable failures. Generate the export through bounded durable work rather than duplicating synchronous requests.

VALIDATION: Code-confirmed.

60: BUG ZOB-060: ✅ [High] Delimited exports ignore backpressure and cancellation

DelimitedStreamWriter enqueues directly and never checks desiredSize or implements pull/cancel. The route launches a producer that fetches every batch regardless of client consumption. Large or abandoned downloads can buffer the full export, continue database work, and leave background errors outside the response lifecycle.

FILES: `apps/web/lib/export/tabular.ts`; `apps/web/app/api/admin/data-management/users/export/route.ts`

FIX: Produce one bounded page from stream pull or use a properly backpressured Node stream. Propagate cancellation to queries, stop producers on disconnect, cap export duration and surface stream failures without silently returning truncated success.

VALIDATION: Code-confirmed.

61: BUG ZOB-061: ✅ [Medium] CSV and TSV exports allow spreadsheet formula injection

escapeDelimitedValue handles delimiters/quotes but does not neutralize leading spreadsheet formula characters. A local test preserved =HYPERLINK(...) as an executable spreadsheet cell, even though CSV quoting was correct. Exported attacker-controlled names and similar fields can therefore become formulas when an administrator opens the file.

FILES: `apps/web/lib/export/tabular.ts`; `apps/web/app/api/admin/data-management/users/export/route.ts`

FIX: Provide a spreadsheet-safe export mode that neutralizes formula prefixes, including whitespace/control-character variants. Preserve a separate raw machine-readable format for exact data portability.

VALIDATION: Reproduced escaping output; spreadsheet execution not run.

62: BUG ZOB-062: ✅ [Medium] Admin export cursors lose database timestamp precision

fetchBatch converts pg timestamp values using String(Date), which loses fractional seconds. The account export also types pg dates as strings without preserving PostgreSQL microseconds. A keyset boundary can consequently skip or repeat users sharing the boundary time, undermining large exports and recovery completeness.

FILES: `apps/web/app/api/admin/data-management/users/export/route.ts`; `apps/web/app/api/admin/data-management/users/export-accounts/route.ts`

FIX: Select an exact UTC timestamp string with microsecond precision, or paginate by a stable unique key. Preserve the full ordering tuple across pages and test many rows created within the same second/millisecond.

VALIDATION: Code-confirmed.

63: BUG ZOB-063: ✅ [Medium] New and Friends feeds paginate only a fixed initial slice per content type

fetchNewPage limits each UNION branch to its newest 50 rows, and fetchFriendsPage to 30, before applying the outer cursor. Later pages keep querying those same fixed windows, so older content becomes unreachable even when it exists. An outer cursor alone does not make the branch-level limits paginated.

FILES: `apps/web/lib/feed/aggregator.ts`

FIX: Apply the validated composite cursor inside each source branch before its limit, then merge/order the results. Include a content-type tie-breaker and test traversal beyond each branch cap without duplicates or omissions.

VALIDATION: Code-confirmed.

64: BUG ZOB-064: ✅ [High] Feed aggregation bypasses privacy, block and moderation visibility filters

Candidate and recency source queries do not consistently check parent entity visibility, classroom is_public, room discoverability, banned authors or user blocks. The final personalization step merely reorders/slices and does not reauthorize cached content. Hidden/private entities and newly removed content can therefore remain discoverable through feed titles, descriptions and media.

FILES: `apps/web/lib/feed/aggregator.ts`; `apps/web/app/api/feed/route.ts`

FIX: Centralize content visibility predicates and enforce them in candidate construction and immediately before serving cached items. Filter blocked/muted relationships and invalidate removed content promptly. Test private parents, banned authors and post-cache moderation changes.

VALIDATION: Code-confirmed.

65: BUG ZOB-065: ✅ [Medium] For You interest personalization never affects the generated tiers

personalizeAndPaginate adjusts scores only for interest and recency tiers. computeCandidatePool builds boosted, organic_popular, organic_trending, business and in_house tiers, so the normal cached pool contains no eligible tier. Interest weights are read from the database but do not change that pool ordering.

FILES: `apps/web/lib/feed/aggregator.ts`

FIX: Implement the intended interest tier or apply bounded interest weighting to the actual eligible tiers. Test two users with opposing interests against the same pool and verify distinct, stable pagination.

VALIDATION: Code-confirmed.

66: BUG ZOB-066: ✅ [Medium] Cache misses can stampede the database across serverless instances

Cache recomputation is single-flighted only within one process. Shared expiry or Redis outage causes every cold/warm instance to rebuild expensive multi-table pools or portal sections independently. Each caller also reaches Redis before joining the local in-flight recomputation. This magnifies connection and CPU pressure during peak traffic or cache loss.

FILES: `apps/web/lib/feed/cache.ts`; `apps/web/lib/portals/cache.ts`

FIX: Use a bounded distributed recompute lease, stale-while-revalidate data, expiry jitter and a cheap degraded response. Join local in-flight reads early and load-test shared expiry/outage against the actual free-tier connection budget.

VALIDATION: Code-confirmed.

67: BUG ZOB-067: ✅ [Medium] Portal invalidation can be undone by an older in-flight rebuild

invalidatePortalCache removes memory and Redis values but does not invalidate or version _inflight. A build started before an edit can finish afterward and republish the old payload for the full TTL. Requests after invalidation can also join that stale build.

FILES: `apps/web/lib/portals/cache.ts`; `apps/web/lib/portals/page.ts`

FIX: Associate fills with a generation/version and publish only if still current. Invalidate in-flight ownership, and coordinate distributed versions for edits that must promptly remove private or moderated content.

VALIDATION: Code-confirmed.

68: BUG ZOB-068: ✅ [Medium] Pusher connection listeners accumulate after component unmount

The web Pusher branch binds an anonymous state_change listener to a shared connection on each hook mount. Cleanup removes channel bindings but never unbinds that connection listener. Repeated navigation retains closures and multiplies connection callbacks; independently unsubscribing a shared channel can also disrupt another hook using it.

FILES: `apps/web/lib/realtime/useRealtimeChannel.ts`

FIX: Retain named listener references and remove them in cleanup. Reference-count shared channel subscriptions, and derive live status from successful channel authorization/attachment rather than transport connectivity alone.

VALIDATION: Code-confirmed.

69: BUG ZOB-069: ✅ [High] The PWA caches authenticated HTML and RSC without account isolation

After explicit API exclusions, the worker spreads Serwist defaultCache, which caches same-origin HTML/RSC and other pages by URL. Protected server-rendered classroom and other pages are not excluded or account-keyed, and logout code does not purge these browser caches. Offline/fallback responses can retain a previous account's rendered private content.

FILES: `apps/web/app/sw.ts`; `apps/web/lib/auth/sessionExpiredBus.ts`; `apps/web/lib/classroom/home.ts`

FIX: Use NetworkOnly for authenticated/admin documents and RSC, or design an explicit account-isolated offline store with secure ownership changes and deletion. Purge private worker caches on logout/expiry and test account switching while offline.

VALIDATION: Code-confirmed.

70: BUG ZOB-070: ✅ [High] Account deletion retains personal identifiers with no implemented purge lifecycle

anonymizeUserAccount retains email, phone, provider identifiers and other user data, but never schedules the pending_deletion_at lifecycle described in its comments; no implementing purge path was found. It also clears legacy users.push_token rather than deleting current user_push_tokens. Accounts can remain recoverable and identifiable indefinitely.

FILES: `apps/web/lib/users/anonymizeAccount.ts`; `apps/web/app/api/users/me/route.ts`; `apps/web/app/api/cron/daily-users/route.ts`

FIX: Implement an explicit deletion grace-period state and a verified purge worker covering the real personal-data inventory, push subscriptions, exports and related stores. Retain only necessary accounting records with documented minimization and restoration rules.

VALIDATION: Code-confirmed.

71: BUG ZOB-071: ✅ [Medium] KYC object cleanup loses its retry source and detached uploads have no quota

Document deletion commits database removal before best-effort storage deletion; failures are swallowed and the storage key is no longer retained for retry. Detached KYC uploads also have no per-user count/storage quota or discovered age-based cleanup. Abandoned uploads and failed erasures can accumulate sensitive objects indefinitely.

FILES: `apps/web/lib/users/anonymizeAccount.ts`; `apps/web/app/api/kyc/documents/[id]/route.ts`; `apps/web/app/api/kyc/documents/route.ts`; `apps/web/lib/storage/providers/r2.ts`

FIX: Persist object-deletion tasks transactionally before removing records, inspect provider per-object failures and retry through a monitored queue. Add upload quotas and bounded cleanup for unattached objects, with reference checks before deletion.

VALIDATION: Code-confirmed.

72: BUG ZOB-072: ✅ [High] Deletion removes KYC evidence but preserves the verified KYC tier

Account anonymization deletes kyc_submissions, kyc_documents and creator_kyc, but does not reset users.kyc_tier. Restoration reactivates the same user without re-verification. A restored account can therefore retain the authority associated with a KYC tier whose underlying evidence and approval records were erased.

FILES: `apps/web/lib/users/anonymizeAccount.ts`; `apps/web/lib/auth/restore.ts`; `apps/web/lib/kyc/service.ts`

FIX: Reset or suspend verification-derived eligibility when its evidence is deleted. Define lawful minimal retention versus mandatory re-verification, and make restored-account payout/financial gates enforce that state.

VALIDATION: Code-confirmed.

73: BUG ZOB-073: ✅ [High] Concurrent first game scores can both earn a personal-best reward

finalizeScore SELECTs game_best_scores FOR UPDATE, but when no row exists that locks nothing. Two distinct first sessions can both read previousBest=-1, both decide they won and then serialize only at the upsert. The distinct play references permit both reward grants even when the second score is not a new best.

FILES: `apps/web/lib/games/sessions.ts`; `apps/web/lib/games/leaderboard.ts`

FIX: Create/lock the per-user game score row before comparing, or perform one conditional atomic upsert that returns whether the best actually improved. Test concurrent first scores in both high/low arrival orders.

VALIDATION: Code-confirmed.

74: BUG ZOB-074: ✅ [High] Client-reported scores directly control rewards and wager outcomes

The score endpoint checks ownership, nonce, elapsed time and numeric bounds, but does not verify actual gameplay. A client can wait out min_play_seconds and submit chosen increasing scores to earn rewards or win a wager. Single-use nonces prevent duplicate submissions, not fabricated results.

FILES: `apps/web/lib/games/sessions.ts`; `apps/web/lib/games/challenges.ts`; `apps/web/app/api/games/[slug]/score/route.ts`

FIX: Keep untrusted games nonfinancial, cap and risk-score rewards, or verify deterministic gameplay/server-issued challenges before awarding value. For wagers, require authoritative result verification and dispute/fraud controls; test direct scripted score submission.

VALIDATION: Code-confirmed.

75: BUG ZOB-075: ✅ [High] Game milestone claims commit before their reward bundle is paid

checkPlayMilestones inserts game_milestone_claims outside a reward transaction, then calls grantGamingReward. Without a transaction client, individual coin/star failures are logged and swallowed. A crash or failed component leaves the milestone permanently claimed with missing or partial rewards, and later checks skip it.

FILES: `apps/web/lib/games/rewards.ts`

FIX: Atomically record the claim and all monetary grants, or persist a durable payable state with idempotent retry per component. Do not mark a milestone complete until its promised bundle is settled.

VALIDATION: Code-confirmed.

76: BUG ZOB-076: ✅ [Medium] An explicit zero game reward falls back to the platform default

Per-win credits and XP use game.reward_credits_per_win || cfg.defaultRewardCredits and the XP equivalent. Configuring zero to disable a reward therefore enables the default instead. This can issue unintended currency or XP for games intended to have no payout.

FILES: `apps/web/lib/games/sessions.ts`

FIX: Distinguish an unset override from an explicit zero using nullish/default semantics and schema validation. Test zero, positive and absent overrides for every reward component.

VALIDATION: Code-confirmed.

77: BUG ZOB-077: ✅ [High] A failed challenge-round update leaves a scored play that cannot be retried

The play is marked counted in a committed transaction, then recordChallengeRoundPlay runs afterward with errors swallowed. A database failure leaves the challenge round unadvanced while the nonce is already consumed; resubmitting the score is rejected. This can strand wager settlement until unrelated timeout handling intervenes.

FILES: `apps/web/lib/games/sessions.ts`; `apps/web/lib/games/challenges.ts`

FIX: Commit challenge progress with the score when feasible, or write a durable outbox task in the score transaction and retry it idempotently. Provide reconciliation for counted challenge plays missing round progress.

VALIDATION: Code-confirmed.

78: BUG ZOB-078: ✅ [Medium] Phone verification updates and consumption race with replacement requests

confirmPhoneVerification reads the pending row without locking, increments attempts using a stale value, updates the user and deletes by user_id in separate statements. Concurrent verification or resend can lose attempts, accept an older code or delete a newly issued verification record. Passing a transaction client does not itself establish the required row lock.

FILES: `apps/web/lib/phone/verification.ts`

FIX: Lock the pending generation and atomically validate/increment/consume it with the user update. Use conditional generation/hash predicates and atomic attempt counters. Serialize resend and completion consistently.

VALIDATION: Code-confirmed.

79: BUG ZOB-079: ✅ [Medium] Contact lookup matches unverified phone numbers without discovery consent

The query matches phone_number but never requires phone_verified_at. With verification disabled, arbitrary self-entered numbers become discoverable identity matches. A claimed number can therefore associate an unrelated account with someone's address-book contact; there is also no per-user contact-discovery opt-out in this query.

FILES: `apps/web/app/api/users/contacts/cross-reference/route.ts`; `apps/web/lib/phone/verification.ts`

FIX: Require verified ownership before phone-based matching and enforce a dedicated discovery preference. Normalize on the server and constrain enumeration through privacy-preserving matching and shared budgets.

VALIDATION: Code-confirmed.

80: BUG ZOB-080: ✅ [Medium] Profile hreflang tags advertise routes that do not exist

generateMetadata emits non-English alternates such as /fr/u/username. There is no locale route segment or middleware locale rewrite; language is selected by cookie instead. These alternate URLs encounter default authentication gating or missing routes rather than the advertised public translated profile.

FILES: `apps/web/app/u/[username]/page.tsx`; `apps/web/middleware.ts`; `apps/web/app/robots.ts`

FIX: Implement actual localized canonical routes and reciprocal hreflang, or remove nonexistent alternates and expose the current cookie-localized URL honestly. Verify every emitted alternate as an anonymous crawler.

VALIDATION: Code-confirmed.

81: BUG ZOB-081: ✅ [Medium] The sitemap silently drops older content and omits blog articles

Each entity query is capped, generally at 2,000, without a sitemap index or continuation. Blog roots are emitted but published blog article URLs are not enumerated. As content grows, older profiles/entities and long-form articles lose sitemap discovery despite having crawlable canonical pages.

FILES: `apps/web/app/sitemaps/sitemap.ts`; `apps/web/app/sitemap.xml/route.ts`; `apps/web/lib/seo/sitemaps.ts`; `apps/web/middleware.ts`; `apps/web/app/b/[slug]/[postSlug]/page.tsx`

FIX: Generate sharded, index-backed sitemaps using stable keyset pagination. Include indexable articles and the actual public Tales routes, respect privacy/moderation status and allow anonymous crawler access to robots.txt, the index and every shard. Validate emitted URLs as an anonymous visitor.

VALIDATION: Code-confirmed.

82: BUG ZOB-082: ✅ [Medium] Important custom dialogs lack complete keyboard focus management

These custom overlays do not provide a consistent focus trap, initial focus, background inertness and focus restoration contract. CryptoPaymentDialog declares aria-modal but installs no keyboard/focus handling. Keyboard and screen-reader users can navigate behind the modal or lose their place during financial/account actions.

FILES: `apps/web/components/wallet/CryptoPaymentDialog.tsx`; `apps/web/components/settings/CancelPlanModal.tsx`; `apps/web/components/profile/AvatarCropModal.tsx`; `apps/android/src/components/settings/CancelPlanModal.tsx`

FIX: Introduce an accessible shared dialog primitive with focus containment/restoration, Escape behavior, labels and announced status/errors. Reuse it across clients and verify keyboard-only and screen-reader flows.

VALIDATION: Code-confirmed.

83: BUG ZOB-083: ✅ [High] Schema consistency CI can pass while the runtime schema is incompatible

The named schema-consistency job runs TypeScript and drizzle-kit check with continue-on-error, but does not compare the live baseline catalog with every Drizzle column. Existing portability tests verify selected role grants and schema creation, not application behavior under restricted roles. The reproduced missing columns and phone exposure coexist with passing tests.

FILES: `.github/workflows/integration-tests.yml`; `apps/web/lib/db/schema.ts`; `apps/web/db/test-baseline-portability.ts`

FIX: Build the baseline in CI, compare every modeled column/type/constraint and run meaningful authorization/checkout contracts under real runtime roles. Make required checks blocking and trigger them for shared code, migration tooling and lockfile changes too.

VALIDATION: Code-confirmed.

84: BUG ZOB-084: ✅ [Medium] The security tests contain stale routes and tests that pass without exercising protections

The suite targets /api/auth/login, which has no route in this checkout, and many authenticated cases return normally when credentials are absent. Several injection assertions only reject HTTP 500, so 401/404/405 can pass without executing a protected query. The transfer flood assertion also omits the current PIN requirement.

FILES: `security-tests/auth.security.test.ts`; `security-tests/ratelimit.security.test.ts`; `security-tests/injection.security.test.ts`; `apps/web/package.json`

FIX: Provision isolated accounts/tokens and a local server automatically. Fail or explicitly skip missing prerequisites, verify the intended handler was reached, and assert security invariants and side effects rather than only status-code absence.

VALIDATION: Code-confirmed.

85: BUG ZOB-085: ✅ [Medium] Database access still bypasses typed Drizzle query coverage in active paths

The public profile uses the legacy db.query adapter; administrative exports access orm.$client and raw pg queries directly. Rank-up and discrepancy archive tables are also absent from the exported Drizzle schema. Thus the stated 100% Drizzle coverage target is not met, and some critical data paths evade compile-time schema contracts.

FILES: `apps/web/app/u/[username]/page.tsx`; `apps/web/app/api/admin/data-management/users/export/route.ts`; `apps/web/app/api/admin/data-management/users/export-accounts/route.ts`; `apps/web/lib/db/schema.ts`

FIX: Inventory executable data access and explicitly distinguish typed builders, parameterized Drizzle SQL and direct pg. Migrate ordinary queries, model required archives and reserve reviewed low-level access for justified tooling with equivalent contract tests.

VALIDATION: Code-confirmed.

86: BUG ZOB-086: ✅ [High] Daily job claims mark work complete before work succeeds

checkCronIdempotency records the current date before any job steps run. Individual steps catch errors, and a process can also terminate after the claim. Retrying the same invocation then reports already ran, even when financial, cleanup or notification steps never completed. This is a recovery/idempotency defect, independent of scheduling frequency.

FILES: `apps/web/lib/cron/auth.ts`; `apps/web/app/api/cron/daily-core/route.ts`; `apps/web/app/api/cron/daily-users/route.ts`; `apps/web/app/api/cron/daily-platform/route.ts`

FIX: Track job/step state with recoverable leases, completion checkpoints and idempotent effects. Mark completion only after successful committed work, and allow retries to resume failed steps without duplicating completed ones.

VALIDATION: Code-confirmed.

87: BUG ZOB-087: ✅ [Medium] Audit writes can be dropped after serverless responses

writeAuditLog returns void and starts an untracked promise chain. Callers return their responses without awaiting it or registering it with a platform lifecycle facility. Serverless suspension/termination can drop the audit record even after a sensitive financial or account action has succeeded.

FILES: `apps/web/lib/audit/auditLog.ts`; `apps/web/app/api/economy/crypto/withdraw/route.ts`; `apps/web/app/api/admin/data-management/users/export/route.ts`

FIX: Write required audit evidence in the same transaction as the action, or commit a durable outbox entry. Use after/waitUntil only for genuinely best-effort work and monitor delivery failures explicitly.

VALIDATION: Code-confirmed.

88: BUG ZOB-088: ✅ [Medium] Email delivery failures are swallowed as successful security operations

postToMailgun logs HTTP/network failures but resolves normally, and sendEmail also silently no-ops without configuration or when the platform toggle is off. initiateAccountRestore consequently returns true after some failed or skipped sends. Callers cannot distinguish delivered/queued security messages from unavailable delivery, and no durable retry is created.

FILES: `apps/web/lib/notifications/email.ts`; `apps/web/lib/auth/restore.ts`

FIX: Return explicit queued/delivered/failed outcomes, persist security-message retry tasks and monitor provider failures. Keep public anti-enumeration responses uniform while recording an honest internal outcome and offering a safe recovery path.

VALIDATION: Code-confirmed.

89: BUG ZOB-089: ✅ [High] Circuit-breaker timeouts do not cancel the underlying operation

withTimeout rejects its outer promise but does not abort fn. An isolated fixture rejected after 5 ms and still completed the callback afterward. Payment HTTP requests and legacy multi-statement transactions can continue after the caller receives an error, creating ambiguous commits and overlapping retries; statement timeouts do not bound a whole transaction.

FILES: `apps/web/lib/payments/circuit.ts`; `apps/web/lib/payments/paystack.ts`; `apps/web/lib/db/providers/supabase.ts`

FIX: Propagate abort/deadline support to network and database work, and make uncertain completion explicit. Never automatically replay nonidempotent callbacks after an ambiguous timeout; reconcile provider/transaction state first.

VALIDATION: Reproduced callback continuing after timeout.

90: BUG ZOB-090: ✅ [Medium] Drizzle transactions bypass the database circuit breaker

wrapPoolWithCircuitBreaker wraps pool.query only. Drizzle transactions check out clients using pool.connect and execute client.query, bypassing that wrapper; adapter.transaction protection does not apply to orm.transaction. Most financial mutations use the latter, so connection failures and long transaction work do not share the intended fail-fast protection.

FILES: `apps/web/lib/db/circuit.ts`; `apps/web/lib/db/drizzle.ts`; `apps/web/lib/db/providers/supabase.ts`

FIX: Protect transaction acquisition and the complete transaction lifecycle at a shared boundary without double-counting statements or aborting ambiguously. Apply checkout deadlines, safe cancellation and bounded half-open probes, and test the actual Drizzle transaction path.

VALIDATION: Code-confirmed.

91: BUG ZOB-091: ✅ [Medium] Silent refresh accepts a backslash-based external redirect

isSafeRelativePath accepts /\attacker.example because its second character is not a forward slash. The subsequent WHATWG new URL normalizes the backslash and resolves to https://attacker.example/. The push-notification path guard similarly accepts protocol-relative // URLs. These guards do not guarantee the same-origin destination their callers assume.

FILES: `apps/web/app/api/auth/silent-refresh/route.ts`; `apps/web/app/sw.ts`

FIX: Parse against the canonical origin and require the resulting origin to match exactly. Reject protocol-relative paths, backslashes and encoded variants before redirects/navigation, and share one tested redirect validator.

VALIDATION: External resolution reproduced with the runtime URL parser.

92: BUG ZOB-092: ✅ [Medium] Web realtime callbacks retain stale render state

The web hook effect depends only on channel while deliver captures onEvent from its creation render. Replacing the callback, even with a changed useCallback dependency, does not update the listener. Android already uses a current callback ref. Long-lived web subscriptions can therefore apply obsolete selection, permissions or component state.

FILES: `apps/web/lib/realtime/useRealtimeChannel.ts`; `apps/android/src/lib/realtime/useRealtimeChannel.ts`

FIX: Keep the latest callback in a ref and invoke that ref from stable subscription listeners, as the Android hook does. Test callback replacement without changing the channel and ensure cleanup still removes the correct listener.

VALIDATION: Code-confirmed.

93: BUG ZOB-093: ✅ [Medium] Push registration has no active-subscription cardinality limit

The upsert key is user_id plus token, so every distinct token creates a row; the ten-per-minute request limit is not a storage limit. No per-account/device cap or stale-registration sweep was found. Invalid but parseable Web Push entries can return generic errors rather than unregistered and remain in every future fan-out.

FILES: `apps/web/app/api/users/push-token/route.ts`; `apps/web/lib/notifications/push.ts`; `apps/web/lib/notifications/webPush.ts`

FIX: Enforce bounded active registrations per device/account and reclaim old replacements atomically. Track last successful use and bounded failure counts, remove invalid subscriptions, and cap notification fan-out work.

VALIDATION: Code-confirmed.

94: BUG ZOB-094: ✅ [Medium] One invalid database import row aborts its entire batch

processRow catches INSERT errors and retries or returns a row-level error, but all rows share one PostgreSQL transaction without savepoints. A constraint violation leaves that transaction aborted, so later rows and the final job-progress UPDATE fail. The batch rolls back and retries encounter the same bad row instead of recording it and advancing.

FILES: `apps/web/app/api/admin/data-management/users/import/[jobId]/route.ts`

FIX: Validate rows before database work and isolate database failures using savepoints or bounded per-row transactions. Roll back the failed statement before retrying uniqueness allocation, and persist accurate progress/error results.

VALIDATION: Code-confirmed.

95: BUG ZOB-095: ✅ [Medium] Concurrent import workers process the same checkpoint twice

The job and processed_rows checkpoint are loaded before the batch transaction without a job-row lock, lease or conditional claim. Two POSTs can process the same range, increment counters twice or race inserts/overwrites. Setting processedRows to the same value does not prevent duplicated effects or inaccurate accounting.

FILES: `apps/web/app/api/admin/data-management/users/import/[jobId]/route.ts`

FIX: Acquire a recoverable per-job lease or lock/checkpoint inside the transaction before selecting the batch. Commit row outcomes and cursor advancement together, with idempotent row identities and concurrency tests.

VALIDATION: Code-confirmed.

96: BUG ZOB-096: ✅ [High] Clients can fabricate billable ad impressions without a served-ad proof

recordAdEvents accepts a creative ID and arbitrary optional clientEventId, then bills the campaign without verifying a prior serve, placement match, actual impression or campaign eligibility. New event IDs bypass deduplication. A bot account can drain a visible creative campaign budget through fabricated reports, including reports after the campaign was paused.

FILES: `apps/web/app/api/ads/events/route.ts`; `apps/web/lib/ads/serve.ts`

FIX: Issue short-lived server-signed impression receipts bound to viewer, creative, placement and campaign state. Require and consume them atomically, enforce independent per-viewer/global fraud budgets and validate campaign eligibility at billing time.

VALIDATION: Code-confirmed.

97: BUG ZOB-097: ✅ [High] Ad billing can exceed remaining budget and ignores daily budgets

Billing checks only remaining > 0, then adds a full CPM impression cost; it does not require remaining >= cost. The serving and billing paths never enforce daily_budget_credits, and server billing does not enforce frequency_cap_per_user_per_day. Configured campaign spending limits therefore do not form reliable monetary bounds.

FILES: `apps/web/lib/ads/serve.ts`; `apps/web/lib/ads/repo.ts`

FIX: Atomically reserve no more than the available total and daily budgets, with an explicit last-impression rounding rule. Enforce per-viewer frequency controls server-side and derive campaign completion from committed budget state.

VALIDATION: Code-confirmed.

98: BUG ZOB-098: ✅ [Medium] Failed ad-event writes are acknowledged as fully recorded

recordAdEvents catches and logs each transaction failure without returning failed events. The route always reports recorded=body.events.length. The client can discard a batch whose impressions, costs and statistics never committed, creating lost billing/audit events with no durable retry path.

FILES: `apps/web/lib/ads/serve.ts`; `apps/web/app/api/ads/events/route.ts`

FIX: Return per-event committed/duplicate/retryable outcomes or persist an event inbox before acknowledgment. Let clients retry stable required event IDs and monitor unresolved billing-event depth.

VALIDATION: Code-confirmed.

99: BUG ZOB-099: ✅ Browser two-factor screen did not exchange the opaque OAuth pre-auth code

The remediation review confirmed this additional failure in the affected implementation. The code fix has been implemented on the remediation branch.

FILES: `apps/web/app/auth/2fa/page.tsx`; `apps/web/app/api/auth/pre-auth-token/route.ts`

FIX: Exchange the one-use pre-auth code before submitting the second factor; bound and rate-limit the exchange.

100: BUG ZOB-100: ✅ Referral commission tier used a text database type despite numeric comparisons

The remediation review confirmed this additional failure in the affected implementation. The code fix has been implemented on the remediation branch.

FILES: `apps/web/lib/db/schema.ts`; `apps/web/db/upgrades/2026-10-23-forensic-hardening.sql`

FIX: Align the final database type and Drizzle model with integer referral tiers.

101: BUG ZOB-101: ✅ Archived XP amounts were narrower than live ledger amounts

The remediation review confirmed this additional failure in the affected implementation. The code fix has been implemented on the remediation branch.

FILES: `apps/web/db/migrations/0001_consolidated_schema.sql`; `apps/web/lib/db/schema.ts`

FIX: Use bigint for live and archived XP amounts and base amounts.

102: BUG ZOB-102: ✅ Admin pre-auth middleware blocked the login and TOTP bootstrap endpoints

The remediation review confirmed this additional failure in the affected implementation. The code fix has been implemented on the remediation branch.

FILES: `apps/web/middleware.ts`; `apps/web/app/api/admin/auth`

FIX: Allow only the exact pre-auth routes through the outer JWT gate while retaining CSRF, rate limits and database account-standing checks.

103: BUG ZOB-103: ✅ Manual crypto intents omitted the provider reference required for fulfillment

The remediation review confirmed this additional failure in the affected implementation. The code fix has been implemented on the remediation branch.

FILES: `apps/web/lib/payments/crypto/index.ts`; `apps/web/db/upgrades/2026-10-23-forensic-hardening.sql`

FIX: Save the immutable intent reference and backfill existing crypto intents with missing references.

104: BUG ZOB-104: ✅ Coin purchase endpoint accepted star packs without recording the star quantity

The remediation review confirmed this additional failure in the affected implementation. The code fix has been implemented on the remediation branch.

FILES: `apps/web/app/api/coins/purchase/route.ts`

FIX: Restrict this endpoint to valid coin packs and preserve the saved grant quantity.

105: BUG ZOB-105: ✅ Admin payout retry re-reserved gross funds and retained the restored-earnings flag

The remediation review confirmed this additional failure in the affected implementation. The code fix has been implemented on the remediation branch.

FILES: `apps/web/app/api/admin/payouts/dlq/[dlqId]/retry/route.ts`; `apps/web/lib/payments/payouts.ts`

FIX: Re-reserve only previously refunded net earnings, clear the restoration flag atomically and reject ambiguous or terminal payouts.

106: BUG ZOB-106: ✅ Healthy database circuits counted business and constraint errors as outages

The remediation review confirmed this additional failure in the affected implementation. The code fix has been implemented on the remediation branch.

FILES: `apps/web/lib/db/circuit.ts`

FIX: Count connection, shutdown, resource and timeout failures toward availability; propagate business failures without opening a healthy circuit.

107: BUG ZOB-107: ✅ Malformed proxy-depth configuration could return an undefined client address

The remediation review confirmed this additional failure in the affected implementation. The code fix has been implemented on the remediation branch.

FILES: `apps/web/lib/security/rateLimit.ts`

FIX: Validate the proxy count and selected address, falling back to the bounded unknown identity on malformed input.

108: BUG ZOB-108: ✅ XP award retries could credit the same reference after archival

The remediation review confirmed this additional failure in the affected implementation. The code fix has been implemented on the remediation branch.

FILES: `apps/web/lib/xp/safeAwardXP.ts`

FIX: Check the complete live-plus-archive history before inserting the idempotent award, including the dead-letter retry path.

109: BUG ZOB-109: ✅ Repeated worker crashes could avoid retry limits in recovery and cleanup queues

The remediation review confirmed this additional failure in the affected implementation. The code fix has been implemented on the remediation branch.

FILES: `apps/web/lib/games/progress.ts`; `apps/web/lib/notifications/restoreQueue.ts`; `apps/web/lib/storage/deletionQueue.ts`

FIX: Consume retry attempts when claiming a lease, retain ownership checks and surface exhausted work to monitoring.

110: BUG ZOB-110: ✅ Fresh baseline qualified extension functions with the public schema

The remediation review confirmed this additional failure in the affected implementation. The code fix has been implemented on the remediation branch.

FILES: `apps/web/db/migrations/0001_consolidated_schema.sql`; `apps/web/db/test-baseline-portability.ts`

FIX: Resolve extension objects through their discovered namespaces; verify installation with extensions outside public.

## Review scope and verification

Checkout: `nero1/zobia`, branch `main`, commit `8311ff3975fefa33b27ed7331e360e917a175116`. No existing custom bugs report was present in the checkout to revalidate. This file is the new consolidated report. Application code and migrations were unchanged during the original audit; they have since been updated on the remediation branch.

The three passes were: (1) repository-wide file inventory and static searches for trust boundaries, data access, unsafe sinks, concurrency, caching and resource ownership; (2) end-to-end tracing of authentication, money movement, callbacks, schema/RLS, uploads, exports and clients; (3) counterexample checks, local reproductions and comparison with existing tests. Comments were treated as leads, not evidence. For example, returned ApiError objects were excluded as a finding after confirming middleware handles them correctly.

The inventory contained 2,328 tracked files, including 1,256 TypeScript and 898 TSX files. Critical paths received detailed manual review; repository-wide searches are not equivalent to three manual line-by-line readings of every file. Generated/binary assets were inventoried rather than audited as application source. These are all findings substantiated in this review, not a claim that no additional defects exist.

Completed checks: web TypeScript compilation passed; 547 web unit tests passed across 50 suites; 133 PostgreSQL integration tests passed across 28 suites; 25 Android tests passed across 5 files. A fresh PostgreSQL baseline applied successfully. Independent catalog inspection found the nine missing Drizzle columns. Isolated PostgreSQL fixtures reproduced anonymous phone-record access, star-purchase constraint rejection, duplicate transaction hashes, missing KYC visibility with the helper GUC and recursive membership RLS. Fixtures were local and disposable, with synthetic data.

Additional source-executing fixtures reproduced wrong-recipient crypto acceptance with mocked chain responses, Approval-log acceptance by the BSC adapter, credential/body forwarding on a downgrade redirect, SVG attribute loss, permissive media-scheme validation, invalid-raster fail-open behavior and noncanceling breaker timeouts. PostgreSQL preserved raw HTML in Help headlines. A WHATWG URL check confirmed the redirect guard bypass documented in the numbered findings.

Production credentials, real payments, live provider/webhook deliveries, Vercel deployment behavior, on-chain exploits, browser exploit execution, load tests at thousands of concurrent users and production backup restoration were not exercised. AI prompt manipulation is identified as a code-confirmed authorization risk, not a demonstrated successful model exploit. Network-dependent findings explicitly state relevant deployment conditions. No cron-frequency recommendation is included.

## Original audit ratings and projected remediation ratings

Findings: 98 total — 4 critical, 47 high, 47 medium.

- Security: **3/10 currently → 8/10 after validated remediation**. Useful HMAC checks, parameterized queries, live admin wrappers, token signing and sanitizers exist, but critical grant/crypto failures and inconsistent authorization boundaries dominate the risk.
- Accounting/payment integrity: **3/10 → 8/10**. Decimal/BigInt arithmetic and transactional ledgers are valuable foundations; payment proof, state transitions, archival, recovery and concurrency need correction before money movement is dependable.
- Performance/scalability: **5/10 → 8/10**. Shared pools, bounded candidate sets and local caches help, but herd behavior, unbounded export production, public work budgets and resource cleanup make thousands of concurrent users unproven.
- Structure/maintainability: **6/10 → 8/10**. Domain modules and adapters are useful, but duplicated authorization/data contracts and schema drift undermine them. A smaller set of enforced shared boundaries would improve reliability.
- Implementation/testing: **4/10 → 8/10**. Passing tests are substantial but miss real baseline failures and important negative/concurrent cases. CI needs executable schema, role and end-to-end contracts.
- Overall: **4/10 currently → approximately 8/10** after the listed work passes regression, adversarial, restoration and representative load testing. The projected scores are conditional engineering estimates, not a security certification or zero-cost guarantee.

## Recommended review order

First review grants/private storage and all crypto payment proofs; then webhook/payout recovery and ledger/reconciliation integrity; then authentication/session/restore consistency. Follow with schema/RLS contracts, uploads/exports and privacy retention, feed/caching/resource limits, and accessibility/SEO. The user approved remediation; the fixes are now implemented and undergoing final release checks.

Explicit Supabase grants and portable PostgreSQL SQL are compatible: guard provider-specific grants on role existence and keep core schema/application policies independent of Supabase Auth. Grants must match the actual access model; applying anon/authenticated CRUD indiscriminately is unsafe. Existing explicit private-table revocations and service-role grants are useful and should be preserved while correcting the exposed verification table.

Backup/recovery is not established by a users-only export. A complete restore exercise should separately verify schema, settings, accounting history, object storage, encryption-key availability, identity-provider configuration and post-restore reconciliation. No repository-only review can confirm production backup availability or hosting quota headroom.

Report signature: Codex forensic review and remediation — 2026-10-23 — 09:30:03 PM WAT (Africa/Lagos)
