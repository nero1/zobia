# Custom Bugs Report — Version 2

**Date and time:** October 24, 2026 — 11:59:44 PM WAT (Africa/Lagos)
**Audited revision:** `35c4e9b1255f4366b2a82baf441a6eb750072e88`
**Status:** Deployment checkpoint requested: finish the current batch, merge its PR, then halt. Findings marked ✅ have been fixed and verified; all other findings remain open for a later batch. This report replaces the previous report.
**Additional review:** 100 independently confirmed findings. Existing IDs are preserved; additional findings are appended.

## Discovered bugs and issues

1: BUG ZOB-V2-001: [High] Realtime signing endpoints accept revoked sessions and stale account access
2: BUG ZOB-V2-002: ✅ [High] Public draft preview accepts revoked sessions and pre-authentication tokens
3: BUG ZOB-V2-003: ✅ [High] Rewarded-ad endpoint grants spendable coins without ad-completion proof
4: BUG ZOB-V2-004: ✅ [High] Rewarded-ad coins are incorrectly booked as fiat Creator Fund revenue
5: BUG ZOB-V2-005: ✅ [High] Creator Fund payout clears the shared pool outside its transaction
6: BUG ZOB-V2-006: ✅ [Medium] Creator Fund percentage arithmetic can round exact kobo amounts down incorrectly
7: BUG ZOB-V2-007: ✅ [High] Short paywalled articles expose their entire body in the preview
8: BUG ZOB-V2-008: ✅ [High] Personal export exceeds PostgreSQL function argument limits
9: BUG ZOB-V2-009: ✅ [High] Personal-export filtering includes credential and internal moderation fields
10: BUG ZOB-V2-010: ✅ [Medium] Personal export omits received messages and indirectly owned records
11: BUG ZOB-V2-011: ✅ [High] Manual payout status changes can restore the same money repeatedly
12: BUG ZOB-V2-012: ✅ [High] Payout approval, rejection and appeal resolution race outside payout locks
13: BUG ZOB-V2-013: [High] Native crypto withdrawals do not integrate with payout settlement and refunds
14: BUG ZOB-V2-014: ✅ [High] Sensitive Star and crypto operations bypass the PIN step-up boundary
15: BUG ZOB-V2-015: ✅ [High] Star gifts have no client-stable idempotency or deterministic lock ordering
16: BUG ZOB-V2-016: ✅ [Medium] Star gift XP caps race and successful gifts can lose their XP work
17: BUG ZOB-V2-017: ✅ [Medium] Coin transfer responses reveal another user’s wallet balance
18: BUG ZOB-V2-018: ✅ [High] Admin refunds can overdraw balances and replay the same refund reference
19: BUG ZOB-V2-019: ✅ [High] An existing authenticator can be replaced without proving the old factor
20: BUG ZOB-V2-020: ✅ [High] Admin APIs accept ordinary OAuth sessions without admin-login assurance
21: BUG ZOB-V2-021: ✅ [High] Password-reset token consumption is racy and other valid reset links survive
22: BUG ZOB-V2-022: ✅ [Medium] Password-reset completion has no brute-force or public-work budget
23: BUG ZOB-V2-023: ✅ [Medium] Password-reset email delivery is detached and has no durable retry
24: BUG ZOB-V2-024: ✅ [Medium] PIN reset/removal leaves earlier PIN verification windows authorized
25: BUG ZOB-V2-025: ✅ [High] Personal export JSON keys are bound with no PostgreSQL type
26: BUG ZOB-V2-026: ✅ [High] Offline messages are not scoped to the account that composed them
27: BUG ZOB-V2-027: ✅ [Medium] Offline message failures are not retried after the advertised backoff
28: BUG ZOB-V2-028: ✅ [High] Authenticated profile lookup ignores privacy and blocking
29: BUG ZOB-V2-029: ✅ [High] Public content resolvers omit private/moderated-owner restrictions
30: BUG ZOB-V2-030: ✅ [High] Hashtag Portal feeds bypass author privacy and parent moderation
31: BUG ZOB-V2-031: ✅ [Medium] Portal chronological pagination truncates history and loses timestamp precision
32: BUG ZOB-V2-032: ✅ [High] New game saves are read through another connection before they commit
33: BUG ZOB-V2-033: ✅ [Medium] Save-slot quotas are not serialized when the existing-save set is empty
34: BUG ZOB-V2-034: ✅ [High] Forum image fees commit before the reply is accepted
35: BUG ZOB-V2-035: ✅ [High] Forum pot claims commit before claimant funds are credited
36: BUG ZOB-V2-036: ✅ [Medium] Reward caps race and reward delivery is not durable across community features
37: BUG ZOB-V2-037: ✅ [High] Account erasure leaves real PIN hashes and newer crypto-wallet identities
38: BUG ZOB-V2-038: [Medium] Public media uploads have no durable orphan/retention lifecycle
39: BUG ZOB-V2-039: ✅ [Medium] Creator Fund scoring narrows BIGINT XP to INTEGER and ignores active standing
40: BUG ZOB-V2-040: [High] Fraud-forced manual review is ignored by the earnings-to-coins payout branch
41: BUG ZOB-V2-041: ✅ [Medium] Cached ad serves reuse a one-use billing receipt across legitimate views
42: BUG ZOB-V2-042: ✅ [High] Paystack transport ignores the circuit breaker cancellation signal
43: BUG ZOB-V2-043: ✅ [Medium] Every standalone database statement incurs a four-command transaction
44: BUG ZOB-V2-044: ✅ [Medium] Request body bounds are absent before JSON and multipart parsing
45: BUG ZOB-V2-045: ✅ [Medium] Search-engine opt-out removes sitemap entries without issuing noindex
46: BUG ZOB-V2-046: ✅ [High] Merch coin settlement contains a masked double-credit of seller proceeds
47: BUG ZOB-V2-047: ✅ [High] External merchandise checkout has no recorded payment intent or fulfillment branch
48: BUG ZOB-V2-048: ✅ [High] Duplicate merchandise purchase APIs write incompatible order contracts
49: BUG ZOB-V2-049: ✅ [High] Merch checkout writes states and earning sources rejected by the baseline
50: BUG ZOB-V2-050: ✅ [Medium] KYC AI review has no durable dispatch or recovery after submission
51: BUG ZOB-V2-051: ✅ [High] KYC approval does not serialize against rejection or document deletion
52: BUG ZOB-V2-052: ✅ [Medium] Google login reactivates deleted accounts without enforcing the restoration deadline
53: BUG ZOB-V2-053: ✅ [Medium] Google login rejects expired suspensions until a cleanup changes the flag
54: BUG ZOB-V2-054: ✅ [Medium] Rich text forces dark typography inside the sitewide light theme
55: BUG ZOB-V2-055: ✅ [Medium] Blog and business CSV exports leave spreadsheet formulas active
56: BUG ZOB-V2-056: ✅ [Medium] Creator earnings summaries replace recorded net amounts with fixed percentages
57: BUG ZOB-V2-057: ✅ [Medium] Schema and save tests miss constraint and real transaction contract failures
58: BUG ZOB-V2-058: ✅ [High] Free merchandise grants still create unfunded withdrawable earnings
59: BUG ZOB-V2-059: ✅ [High] Daily quest progress accepts self-reported activity and pays rewards
60: BUG ZOB-V2-060: ✅ [High] Quest completion can permanently lose its committed coin reward
61: BUG ZOB-V2-061: ✅ [High] Guild quest contribution locks expire before completion decisions
62: BUG ZOB-V2-062: ✅ [High] Referral claims can attach multiple direct inviters to one account
63: BUG ZOB-V2-063: [High] Mobile browser hand-offs discard source-session revocation and impersonation
64: BUG ZOB-V2-064: ✅ [High] A push endpoint can remain owned by multiple accounts on one device
65: BUG ZOB-V2-065: ✅ [Medium] A SQL error aborts an entire DLQ retry batch and prevents retry accounting
66: BUG ZOB-V2-066: ✅ [High] Referral commission retries lose the original crypto settlement asset
67: BUG ZOB-V2-067: ✅ [High] Scheduled business downgrades can overwrite a newer paid upgrade
68: BUG ZOB-V2-068: [High] The gift-tier catalogue exposes instructions reserved for purchasers
69: BUG ZOB-V2-069: [High] Blog gifts debit buyers before seller earnings are durably settled
70: BUG ZOB-V2-070: ✅ [Medium] Several cursors omit or contradict the actual sort keys
71: BUG ZOB-V2-071: ✅ [High] Authenticated Wiki reads expose drafts and bypass Wiki moderation
72: BUG ZOB-V2-072: ✅ [Medium] Concurrent Wiki edits race revision allocation and overwrite stale fields
73: BUG ZOB-V2-073: ✅ [High] A single-use Wiki invitation can admit multiple users concurrently
74: BUG ZOB-V2-074: [High] Sponsored quest budgets and rewards have no corresponding funding reservation
75: BUG ZOB-V2-075: ✅ [Medium] Sponsored quest impression accounting ignores daily caps and paused state
76: BUG ZOB-V2-076: ✅ [Medium] Sponsored impression charges are rounded away by the balance column
77: BUG ZOB-V2-077: ✅ [Medium] Ordinary room members can submit system messages and bypass text moderation
78: BUG ZOB-V2-078: [High] Room Moment sends publish and charge before the room-message transaction
79: BUG ZOB-V2-079: ✅ [Medium] Avatar uploads bypass decoding validation after compression failure
80: BUG ZOB-V2-080: ✅ [Medium] Subscription and referral sweeps load unbounded backlogs into serial work
81: BUG ZOB-V2-081: ✅ [Medium] Mobile hand-off redirect validation accepts protocol-relative numeric hosts
82: BUG ZOB-V2-082: ✅ [High] SOL payment verification attributes received funds to the fee payer
83: BUG ZOB-V2-083: ✅ [High] New crypto purchase quotes accept cached prices with no maximum age
84: BUG ZOB-V2-084: ✅ [Medium] Concurrent stale crypto-price reads trigger duplicate provider refreshes
85: BUG ZOB-V2-085: ✅ [High] Android logout does not revoke the server-side session
86: BUG ZOB-V2-086: ✅ [High] An old Android refresh can overwrite a newly signed-in account
87: BUG ZOB-V2-087: ✅ [Medium] Legacy notification producers collide with the null-reference uniqueness rule
88: BUG ZOB-V2-088: ✅ [Medium] The legacy manifest update API writes settings the application never reads
89: BUG ZOB-V2-089: ✅ [Medium] Cron completion can conceal missing or failed steps
90: BUG ZOB-V2-090: ✅ [Medium] Concurrent username changes can bypass the change cooldown

91: BUG ZOB-V2-091: ✅ [Medium] Personal export stalls when a section has no records

92: BUG ZOB-V2-092: ✅ [Medium] Concurrent quiz submissions race the per-user attempt limit

93: BUG ZOB-V2-093: ✅ [Medium] Poll votes use stale eligibility after closure or moderation

94: BUG ZOB-V2-094: ✅ [High] Coin transfers acknowledge in-flight work and use unstable operation identities

95: BUG ZOB-V2-095: ✅ [High] Merch shipping updates can overwrite newer order state and grow tracking history without a bound

96: BUG ZOB-V2-096: ✅ [High] Google email-conflict recovery accepts accounts without matching the provider identity

97: BUG ZOB-V2-097: ✅ [High] Crawlable profiles expose hidden fields and effectively suspended accounts

98: BUG ZOB-V2-098: ✅ [High] Pinned DNS lookup uses the wrong Node callback shape and breaks Google sign-in

99: BUG ZOB-V2-099: ✅ [Medium] Android OAuth App Links use a fixed domain and placeholder certificate

100: BUG ZOB-V2-100: ✅ [High] Durable commission-intent insertion targets a partial unique index without its predicate

## Detailed findings and proposed fixes

### 1: BUG ZOB-V2-001: [High] Realtime signing endpoints accept revoked sessions and stale account access

**PROBLEM:** Both channel-signing handlers verify JWT signatures without checking the current Redis session or active database account. A logged-out or newly banned user can obtain fresh realtime authorization until JWT expiry, with Ably access then lasting one hour. Room authorization also omits ordinary-room ban/expiry checks.

**FILES:** `apps/web/app/api/realtime/ably-token/route.ts`; `apps/web/app/api/realtime/pusher-auth/route.ts`

**FIX:** Use the shared live authentication boundary and current channel entitlement checks. Bind subscription lifetime and revocation to session and membership changes.

**EVIDENCE:** Local HTTP proof: profile API rejected a revoked session with 401 while realtime signing returned 200.

### 2: BUG ZOB-V2-002: ✅ [High] Public draft preview accepts revoked sessions and pre-authentication tokens

**PROBLEM:** getOptionalServerUser trusts a signed JWT without checking its token type, live session, account or current role. Blog preview enables unpublished access from that result. Both a revoked owner session and a pre_auth token issued before completing 2FA can read the owner’s drafts; stale staff claims are also trusted.

**FILES:** `apps/web/lib/auth/serverUser.ts`; `apps/web/app/b/[slug]/[postSlug]/page.tsx`

**FIX:** Resolve optional viewers through live authentication, reject pre-authentication tokens outside their designated verification endpoint, and check current owner/staff authorization before draft access.

**EVIDENCE:** Local HTTP proof: revoked-session and pre_auth draft requests both returned 200 containing the private draft marker.

**RESOLUTION:** ✅ SSR identity resolution now uses the same live session and database-principal check as authenticated services, rejecting pre-auth and revoked credentials.

**VALIDATION:** Fresh PostgreSQL/source checks rejected both revoked and pre-auth principals.

### 3: BUG ZOB-V2-003: ✅ [High] Rewarded-ad endpoint grants spendable coins without ad-completion proof

**PROBLEM:** An authenticated free/Plus user can POST directly to claim random coins. The handler consumes no provider server-side verification, signed completion receipt or unique impression identity. Daily limits restrict the quantity but do not establish that any ad was viewed or revenue earned.

**FILES:** `apps/web/app/api/economy/rewards/ad-reward/route.ts`

**FIX:** Require trusted, replay-protected ad-completion evidence and persist its one-time reward claim atomically with the ledger credit.

**EVIDENCE:** Local HTTP proof: a rewarded-ad request without completion evidence returned 200 and credited 18 spendable coins.

**RESOLUTION:** ✅ Reward claims require signed view identity, elapsed watch interval and recorded impression, or an account-bound AdMob challenge confirmed by a verified provider signature. Database locking, daily ledger counts and canonical references enforce one credit per proof.

**VALIDATION:** Actual-route PostgreSQL tests reject empty proof, premature claim and absent impression; concurrent valid replays create one reward. AdMob unit tests verify signatures, challenge expiry, unit/owner binding and transaction replay prevention. Browser visibility cannot prove human attention.

### 4: BUG ZOB-V2-004: ✅ [High] Rewarded-ad coins are incorrectly booked as fiat Creator Fund revenue

**PROBLEM:** The reward handler passes coinsAwarded as grossAmountKobo to contributeToCreatorFund. Awarding virtual currency is neither proof of advertising revenue nor a valid coin-to-kobo conversion. This manufactures withdrawable fund liabilities from an unverified client claim.

**FILES:** `apps/web/app/api/economy/rewards/ad-reward/route.ts`; `apps/web/lib/creator/fundContribution.ts`

**FIX:** Fund distributions only from verified, settled advertising revenue, using explicit currency units and a reconciled revenue ledger.

**EVIDENCE:** Source-confirmed argument flow; no provider revenue appears in this path.

**RESOLUTION:** ✅ The reward path no longer contributes virtual Credits to the fiat Creator Fund; only verified monetary revenue sources may fund it.

**VALIDATION:** Actual verified reward claims leave the stored fiat fund balance unchanged.

### 5: BUG ZOB-V2-005: ✅ [High] Creator Fund payout clears the shared pool outside its transaction

**PROBLEM:** The cron reads the pool, distributes in a separate transaction, then unconditionally writes zero. Contributions committed between the read and reset disappear. A zero-recipient distribution or unsuccessful advisory-lock acquisition also returns normally and can erase an undistributed pool.

**FILES:** `apps/web/app/api/cron/daily-economy/route.ts`; `apps/web/lib/creator/fund.ts`

**FIX:** Reserve and decrement the exact distributed amount under the same durable transaction/period lock; preserve newly accrued and undistributed funds.

**EVIDENCE:** Source-confirmed separate SELECT, transaction and unconditional zeroing.

**RESOLUTION:** ✅ Creator Fund distribution locks the current pool, commits payouts with the exact pool decrement and preserves accrued or undistributed balances; repeat-period guards do not clear funds.

**VALIDATION:** Real PostgreSQL payout concurrent with a 700-kobo contribution conserves 1700 kobo; repeated distribution preserves the remaining pool.

### 6: BUG ZOB-V2-006: ✅ [Medium] Creator Fund percentage arithmetic can round exact kobo amounts down incorrectly

**PROBLEM:** Contribution calculation uses Math.floor(grossAmountKobo * percent / 100) despite accepting fractional percentage settings. Binary floating-point representation can produce an amount just below the mathematically exact integer, understating contributions.

**FILES:** `apps/web/lib/creator/fundContribution.ts`

**FIX:** Use Decimal or integer basis points with validated bounds and explicit rounding for every fund calculation.

**EVIDENCE:** Executable counterexample: floor(100000 × 0.29 / 100) returns 289 rather than the exact 290 kobo.

**RESOLUTION:** ✅ Creator Fund contributions use Decimal with exact integer-kobo validation and explicit flooring.

**VALIDATION:** Three contribution tests passed, including the 0.29% rounding counterexample.

### 7: BUG ZOB-V2-007: ✅ [High] Short paywalled articles expose their entire body in the preview

**PROBLEM:** Both preview renderers expose at least 100 words. Paid articles of 100 words or fewer therefore disclose their complete content without purchase. Creation and editing do not enforce a paywall minimum that would make this safe.

**FILES:** `apps/web/lib/public/resolveBlogPost.ts`; `apps/web/app/api/blogs/[slug]/posts/[postSlug]/route.ts`

**FIX:** Bound the preview below the full content length and support an explicit author-provided excerpt; test short and single-paragraph paid articles.

**EVIDENCE:** Source-confirmed Math.max(100, round(wordCount*0.2)).

**RESOLUTION:** ✅ Both public and authenticated previews use a shared preview bounded by the actual article length; short articles cannot be returned in full.

**VALIDATION:** Nine article-length regression cases passed.

### 8: BUG ZOB-V2-008: ✅ [High] Personal export exceeds PostgreSQL function argument limits

**PROBLEM:** The exporter generates one jsonb_build_object call with two arguments per exported column. Users has 133 included columns and rooms has 57, exceeding PostgreSQL’s 100-argument limit. The stream fails when it reaches such a section rather than producing the promised complete export.

**FILES:** `apps/web/lib/export/personal.ts`

**FIX:** Build row JSON through to_jsonb of a safe projection, or merge bounded objects. Execute full exports against the real baseline, including users and owned rooms.

**EVIDENCE:** Inspected export projections: users 133 included columns, rooms 57; real PostgreSQL rejected a 102-argument object with SQLSTATE 54023.

**RESOLUTION:** ✅ The export builds row JSON from reviewed projected columns, removing PostgreSQL function argument limits.

**VALIDATION:** Real PostgreSQL export traversed every section and emitted the final completion record.

### 9: BUG ZOB-V2-009: ✅ [High] Personal-export filtering includes credential and internal moderation fields

**PROBLEM:** The column denylist omits admin_magic_word_hash and pre_auth_session, while the table denylist allows moderation_reports with ai_recommendation, resolution_note and internal risk fields. The manifest claims credentials and internal processing are excluded. These fields become downloadable when the stream-size failure is repaired.

**FILES:** `apps/web/lib/export/personal.ts`

**FIX:** Use explicit, reviewed per-section safe projections. Exclude all authentication secrets and internal moderation/risk decisions by default.

**EVIDENCE:** Export section inspection confirms included sensitive field names; no secret values read.

**RESOLUTION:** ✅ Personal exports use explicit safe field projections; credentials and internal moderation notes are excluded.

**VALIDATION:** A completed export fixture contains the requester’s moderation report while excluding its internal AI/resolution notes and stored authenticator secrets.

### 10: BUG ZOB-V2-010: ✅ [Medium] Personal export omits received messages and indirectly owned records

**PROBLEM:** Ownership discovery omits recipient_id, so recipients do not receive messages they did not send; dm_conversations has no recognized subject column at all. Tale chapters are omitted because ownership exists only through their parent. Wiki pages are selected only by created_by, so a wiki owner cannot export collaborator-authored pages through ownership of the wiki.

**FILES:** `apps/web/lib/export/personal.ts`

**FIX:** Define explicit subject/parent joins and field-level policies for each export section; verify sent/received messages and authored parent-owned content.

**EVIDENCE:** Executed personalExportSections: messages uses sender_id only; dm_conversations and tale_chapters are absent; wiki_pages uses created_by only.

**RESOLUTION:** ✅ Exports include incoming conversations and records owned through parent tales and Wikis.

**VALIDATION:** The complete streamed export contains received current and legacy DM messages, tale chapters, and collaborator-authored pages/revisions under the requester’s Wiki.

### 11: BUG ZOB-V2-011: ✅ [High] Manual payout status changes can restore the same money repeatedly

**PROBLEM:** Status is read before the transaction and never locked or compared during UPDATE. Failure/cancellation always credits gross earnings without earnings_restored checks. Concurrent requests can both refund, and failed→processing→failed can refund repeatedly without re-reserving funds. It can also overwrite an in-flight provider result.

**FILES:** `apps/web/app/api/admin/payouts/[payoutId]/status/route.ts`

**FIX:** Use one locked payout state machine shared by webhook, batch and admin paths; reserve/refund exactly once and compare current state inside the transaction.

**EVIDENCE:** Local HTTP proof: failed→processing→failed returned 200 for all three operations and restored 2,000 kobo against one 1,000-kobo payout.

**RESOLUTION:** ✅ Payout decisions hold the payout lock, reject terminal transitions and restore each reservation once in its original asset.

**VALIDATION:** Actual-route PostgreSQL regression: failed→processing→failed returns 200/400/400 with exactly one refund.

### 12: BUG ZOB-V2-012: ✅ [High] Payout approval, rejection and appeal resolution race outside payout locks

**PROBLEM:** Each handler decides from an unlocked payout snapshot and later updates by ID only. Two rejection requests can both restore earnings; approval can race rejection; two appeal approvals can both debit the creator. Appeal requeue also fails to reconcile earnings_restored/manual-approval state with the batch worker.

**FILES:** `apps/web/app/api/admin/payouts/[payoutId]/approve/route.ts`; `apps/web/app/api/admin/payouts/[payoutId]/reject/route.ts`; `apps/web/app/api/admin/payouts/[payoutId]/appeal/route.ts`

**FIX:** Lock and revalidate the payout before all decisions; atomically apply state and money changes with idempotent audit/notification records.

**EVIDENCE:** Source-confirmed unlocked reads and unconditional writes.

**RESOLUTION:** ✅ Approval, rejection and appeal decisions revalidate state under transaction locks; appealed reservations retain the original asset.

**VALIDATION:** Concurrent actual-route approval/rejection and native appeal tests each produce one successful decision and correct balances.

### 13: BUG ZOB-V2-013: [High] Native crypto withdrawals do not integrate with payout settlement and refunds

**PROBLEM:** Withdrawal debits creator_crypto_balances but creates a pending payout with zero kobo and null net/gross amounts. Approval only accepts awaiting_approval and assumes an encrypted wallet snapshot/USDT equivalent. Manual failure refunds kobo rather than the withdrawn token balance, so a failed token withdrawal cannot recover its funds through the implemented workflow.

**FILES:** `apps/web/app/api/economy/crypto/withdraw/route.ts`; `apps/web/app/api/admin/payouts/[payoutId]/approve/route.ts`; `apps/web/app/api/admin/payouts/[payoutId]/status/route.ts`

**FIX:** Implement a currency-specific crypto payout lifecycle carrying exact token units, address and chain; refund the same asset once and record verified settlement evidence.

**EVIDENCE:** Source-confirmed cross-route currency/status mismatch.

### 14: BUG ZOB-V2-014: ✅ [High] Sensitive Star and crypto operations bypass the PIN step-up boundary

**PROBLEM:** Coin transfers and fiat payouts require recent session-scoped PIN verification, but Star transfers, withdrawal-address replacement and crypto withdrawals require only an active session. A stolen session can change a withdrawal wallet and move value without the extra control used elsewhere.

**FILES:** `apps/web/app/api/economy/stars/gift/route.ts`; `apps/web/app/api/economy/crypto/wallets/route.ts`; `apps/web/app/api/economy/crypto/withdraw/route.ts`

**FIX:** Apply one consistent step-up requirement to all value transfers and payout-destination changes; bind authorization to the session and operation.

**EVIDENCE:** Source-confirmed absence of PIN guards in these handlers.

**RESOLUTION:** ✅ Star gifts and native crypto withdrawals require a fresh session-bound PIN verification; PIN replacement invalidates prior grants.

**VALIDATION:** Actual authenticated routes reject missing PIN grants; concurrent verified Star gifts retain replay safety and the XP cap.

### 15: BUG ZOB-V2-015: ✅ [High] Star gifts have no client-stable idempotency or deterministic lock ordering

**PROBLEM:** Every request generates a fresh transferRef, so retries after a lost response debit again. Transactions lock sender then recipient rather than sorted user IDs; simultaneous opposite transfers can deadlock. Ledger uniqueness cannot deduplicate client retries because every retry has a new reference.

**FILES:** `apps/web/app/api/economy/stars/gift/route.ts`; `apps/web/lib/economy/stars.ts`

**FIX:** Accept a client-stable operation key, bind it to sender/recipient/amount and store one transaction outcome. Lock both accounts in deterministic order.

**EVIDENCE:** Source-confirmed randomUUID per request and sequential debit/credit locks.

**RESOLUTION:** ✅ Star gifts require a stable client key, bind replays to the original recipient and amount, and lock both accounts in a consistent order.

**VALIDATION:** Actual route checks confirmed a replay creates one debit and concurrent reciprocal gifts complete without a lock-order failure.

### 16: BUG ZOB-V2-016: ✅ [Medium] Star gift XP caps race and successful gifts can lose their XP work

**PROBLEM:** The daily XP total is read outside any user-serialized reservation and the award is launched in a detached async function. Concurrent requests can each award the remaining cap, while serverless completion may terminate the task before its ledger/DLQ write.

**FILES:** `apps/web/app/api/economy/stars/gift/route.ts`

**FIX:** Reserve the daily XP budget atomically and enqueue post-gift progress durably in the transfer transaction.

**EVIDENCE:** Source-confirmed separate SUM and void async award.

**RESOLUTION:** ✅ Star gift XP is capped under the sender lock and committed in the same transaction as the transfer.

**VALIDATION:** Concurrent route calls left the sender at exactly the 500-XP daily limit.

### 17: BUG ZOB-V2-017: ✅ [Medium] Coin transfer responses reveal another user’s wallet balance

**PROBLEM:** A sender receives recipientBalance in the transfer response. The recipient only needs to exist and not block the sender; no consent grants access to their private balance. Sending the minimum transfer reveals the target’s full post-transfer wallet balance.

**FILES:** `apps/web/app/api/economy/coins/transfer/route.ts`

**FIX:** Return only sender balance and transfer receipt data; keep recipient balances restricted to the recipient or authorized staff.

**EVIDENCE:** Source-confirmed recipientBalance: credit.balance_after.

**RESOLUTION:** ✅ Transfer responses disclose only the initiating account’s receipt and balance.

**VALIDATION:** Actual authenticated transfer responses and retries never contain the recipient balance.

### 18: BUG ZOB-V2-018: ✅ [High] Admin refunds can overdraw balances and replay the same refund reference

**PROBLEM:** Sufficient funds are checked before the transaction; the subsequent debit has no balance predicate or row lock protecting that check. Concurrent refunds can make coin_balance negative because the schema has no nonnegative check. referenceId is not used to deduplicate the debit or bind an original refundable purchase.

**FILES:** `apps/web/app/api/admin/refunds/route.ts`

**FIX:** Lock and validate the original refundable transaction and remaining amount, use the shared debit primitive and enforce a unique refund operation/reference.

**EVIDENCE:** Verified pre-transaction balance read, unconditional subtraction, no refund-reference deduplication and no nonnegative coin-balance CHECK in the baseline.

**RESOLUTION:** ✅ Refunds lock the account, resolve live or archived purchase aliases to the canonical ledger ID, reject excess amounts and use the shared debit operation. A repeated refund reference can produce only one debit.

**VALIDATION:** Actual admin-route PostgreSQL tests reject refunding more than the remaining balance; simultaneous ledger-ID and purchase-reference aliases debit exactly 20 coins once.

### 19: BUG ZOB-V2-019: ✅ [High] An existing authenticator can be replaced without proving the old factor

**PROBLEM:** Any active session can GET a new pending secret and POST a code generated from it. Neither step refuses an already-enabled account nor requires its existing authenticator, password or fresh step-up. A stolen authenticated session can replace the victim’s second factor and then disable it.

**FILES:** `apps/web/app/api/auth/2fa/setup/route.ts`

**FIX:** Separate initial enrollment from factor replacement; require the existing factor or a reviewed recovery procedure for replacement, with transactional state checks and session revocation.

**EVIDENCE:** Local HTTP proof: an already-enabled authenticator was replaced using only the existing session and a code from the newly issued secret; both setup calls returned 200.

**RESOLUTION:** ✅ Enabled TOTP enrollment rejects factor replacement; successful setup uses a database compare-and-set and re-enrollment requires the proven disable/recovery path.

**VALIDATION:** Actual authenticated setup route rejects replacement and leaves the existing factor unchanged.

### 20: BUG ZOB-V2-020: ✅ [High] Admin APIs accept ordinary OAuth sessions without admin-login assurance

**PROBLEM:** withAdminAuth checks active session and database role but never requires session.adminSession or completed mandatory admin 2FA. OAuth can issue an ordinary session for an admin identity, and generic 2FA-disable/setup routes do not enforce staff enrollment. These sessions can call admin APIs without the separate password-plus-TOTP gate.

**FILES:** `apps/web/lib/api/middleware.ts`; `apps/web/app/api/auth/google/callback/route.ts`; `apps/web/app/api/auth/telegram/callback/route.ts`; `apps/web/app/api/auth/2fa/disable/route.ts`

**FIX:** Require explicit server-recorded admin authentication assurance for privileged APIs and prevent generic flows from disabling mandatory staff factors.

**EVIDENCE:** Local HTTP proof: an admin-identity session created with adminSession=false successfully called the payout administration endpoint (200).

**RESOLUTION:** ✅ Admin routes require the live session’s administrator assurance flag in addition to current database roles.

**VALIDATION:** An ordinary admin session was denied, an assured session succeeded, and removing its database admin role immediately denied it.

### 21: BUG ZOB-V2-021: ✅ [High] Password-reset token consumption is racy and other valid reset links survive

**PROBLEM:** The token’s unused/expiry checks occur before bcrypt and outside the transaction. Concurrent requests can both pass and overwrite the password; the token UPDATE is unconditional. Other outstanding reset tokens for the same user are not invalidated after success.

**FILES:** `apps/web/app/api/auth/password-reset/route.ts`

**FIX:** Lock or atomically claim a valid token, update the password and revoke all outstanding reset tokens in one transaction; use a security version to revoke sessions reliably.

**EVIDENCE:** Source-confirmed unlocked token read and unconditional updates.

**RESOLUTION:** ✅ Password reset serializes on the account, consumes the token once, invalidates all outstanding reset links and advances the database credential cutoff.

**VALIDATION:** Concurrent same-token resets produce one success; a second outstanding link is rejected and old sessions fail the credential cutoff.

### 22: BUG ZOB-V2-022: ✅ [Medium] Password-reset completion has no brute-force or public-work budget

**PROBLEM:** POST reset requests are throttled, but public PATCH completion has no per-IP/global limiter. Invalid requests trigger database lookups, and a valid token can be replayed concurrently to trigger expensive bcrypt before consumption. This exposes an unauthenticated resource-exhaustion path.

**FILES:** `apps/web/app/api/auth/password-reset/route.ts`

**FIX:** Add bounded IP/global and token/account budgets before lookup and hashing; combine with atomic token consumption.

**EVIDENCE:** Source-confirmed PATCH contains no enforceRateLimit.

**RESOLUTION:** ✅ Reset completion applies bounded streamed input, IP/global request budgets and a per-token attempt limit before expensive password work.

**VALIDATION:** Actual public reset requests with repeated invalid proof reach the 429 work budget; concurrent valid reset consumption remains correct.

### 23: BUG ZOB-V2-023: ✅ [Medium] Password-reset email delivery is detached and has no durable retry

**PROBLEM:** sendResetEmail is started without awaiting or persisting delivery work, yet the route returns success. Serverless termination or provider errors can lose the only recovery message; logs do not provide retryable recovery. The new restore-email queue does not cover this flow.

**FILES:** `apps/web/app/api/auth/password-reset/route.ts`

**FIX:** Persist a reset-email delivery job before acknowledging, process it with bounded retries and dead-letter monitoring, and keep responses enumeration-safe.

**EVIDENCE:** Source-confirmed unawaited sendResetEmail(...).catch after token insertion.

**RESOLUTION:** ✅ Reset issuance stores encrypted delivery intent atomically with its token; leased retries retain delivery failures and expose exhausted work to DLQ monitoring.

**VALIDATION:** Actual delivery failure leaves an encrypted pending task with one attempt; no raw reset token is present in persisted payload.

### 24: BUG ZOB-V2-024: ✅ [Medium] PIN reset/removal leaves earlier PIN verification windows authorized

**PROBLEM:** Reset clears only the caller’s pin_ok key and removal clears none. Other sessions that previously verified the old PIN retain authorization for sensitive operations until TTL expiry, even after the account owner resets/removes that PIN.

**FILES:** `apps/web/app/api/auth/pin/reset/route.ts`; `apps/web/app/api/auth/pin/remove/route.ts`; `apps/web/lib/auth/pinGuard.ts`

**FIX:** Version PIN authorizations per account and rotate the version on changes, or revoke all existing PIN grants/sessions as part of the security update.

**EVIDENCE:** Source-confirmed per-session deletion only on reset; no deletion on remove.

**RESOLUTION:** ✅ PIN grants are bound to a fingerprint of the current stored PIN hash.

**VALIDATION:** Changing the PIN hash in PostgreSQL immediately invalidated the previously accepted Redis verification grant.

### 25: BUG ZOB-V2-025: ✅ [High] Personal export JSON keys are bound with no PostgreSQL type

**PROBLEM:** Each JSON field name is bound as an uncast parameter to variadic jsonb_build_object. PostgreSQL cannot infer its type, so the export fails on its first data-section query, even when no rows match. The live source-executing export reproduced could not determine data type of parameter $1.

**FILES:** `apps/web/lib/export/personal.ts`

**FIX:** Give generated key parameters explicit text types or use a safe row-JSON projection; run the entire stream against PostgreSQL.

**EVIDENCE:** Reproduced using personalExportStream with a dedicated local fixture.

**RESOLUTION:** ✅ Export pagination parameters have explicit types matching each subject column and cursor.

**VALIDATION:** Real PostgreSQL export completed for a newly inserted fixture account.

### 26: BUG ZOB-V2-026: ✅ [High] Offline messages are not scoped to the account that composed them

**PROBLEM:** The persistent queue stores no sender/account ID and clearQueue has no callers. On the next authenticated layout mount, all pending entries are sent using the current cookie. Switching from account A to B can send A’s private draft to its recipient as B.

**FILES:** `apps/web/lib/offline/messageQueue.ts`; `apps/web/lib/offline/useOfflineSync.ts`; `apps/web/components/offline/OfflineSyncProvider.tsx`

**FIX:** Namespace queue records by account, verify the current owner before every send and cancel/purge the prior account’s queue on logout/switch.

**EVIDENCE:** Source-confirmed global IndexedDB store, absent owner field and unused clearQueue.

**RESOLUTION:** ✅ Offline records and all queue management are account-scoped; migration drops ownerless rows. Sends carry their queue owner and the DM server rejects a principal mismatch, closing the cookie-switch race.

**VALIDATION:** Real Chromium verifies migration, partitioned reads/retry/clear and account switching; the actual DM route rejects a different queue owner with 409.

### 27: BUG ZOB-V2-027: ✅ [Medium] Offline message failures are not retried after the advertised backoff

**PROBLEM:** A failed message is changed back to pending and the loop waits, but it never revisits that message or schedules another flush. With connectivity remaining online, the message waits indefinitely until another mount/online event rather than retrying after the delay.

**FILES:** `apps/web/lib/offline/useOfflineSync.ts`

**FIX:** Schedule a cancellable per-message retry/next-attempt deadline and drain due work until sent or exhausted.

**EVIDENCE:** Source-confirmed one pending snapshot and no retry scheduling after the loop.

**RESOLUTION:** ✅ The retry loop schedules due work with bounded exponential backoff/jitter, honors transient failures, stops permanent failures and cancels on account change/unmount. Queue writes acknowledge committed transactions only, with bounded retention and storage.

**VALIDATION:** Real Chromium shows a failed send retrying automatically after backoff and then leaving the queue; aborted writes are rejected and owner storage caps hold.

### 28: BUG ZOB-V2-028: ✅ [High] Authenticated profile lookup ignores privacy and blocking

**PROBLEM:** The endpoint returns bio, city and profile fields to any signed-in caller without checking profile_private, profile_hidden_sections, friendship or user_blocks. It also omits is_banned. The stricter public profile route can therefore be bypassed through this API.

**FILES:** `apps/web/app/api/users/[userId]/route.ts`

**FIX:** Centralize profile visibility/field projection and apply it to every SSR/API/native read, including block and account-standing rules.

**EVIDENCE:** Local HTTP proof: an unrelated signed-in account received 200 with the private profile’s city.

**RESOLUTION:** ✅ Profile lookup enforces database account standing, private-profile friendship, blocks in both directions and hidden bio/avatar/XP projections.

**VALIDATION:** Actual authenticated route tests reject an unrelated reader, allow an accepted friend, reject that friend after blocking and exclude a banned account.

### 29: BUG ZOB-V2-029: ✅ [High] Public content resolvers omit private/moderated-owner restrictions

**PROBLEM:** The room resolver checks active/type/deletion but not is_public, room moderation or owner standing; the public page includes gated room types. Blog/Tweet public reads similarly omit private/banned/suspended owner checks. Content excluded from the corrected feed/sitemap remains readable through direct public URLs.

**FILES:** `apps/web/lib/public/resolveRoom.ts`; `apps/web/lib/public/resolveBlog.ts`; `apps/web/lib/public/resolveTweet.ts`; `apps/web/app/r/[slug]/page.tsx`

**FIX:** Use one reviewed public-visibility policy for direct pages, resolvers, feeds and discovery, with appropriate handling for paid previews versus private resources.

**EVIDENCE:** Local source-executing proof: resolvePublicRoom returned an is_public=false, is_banned=true, suspended-status room anonymously.

**RESOLUTION:** ✅ Direct room, blog and Tweet resolution uses shared owner privacy/standing checks. Rooms additionally require public visibility, active status and clear moderation flags.

**VALIDATION:** Actual PostgreSQL resolvers reject private/banned/suspended/hidden-section owners and private, banned, suspended-flag or suspended-status rooms while preserving active public content.

### 30: BUG ZOB-V2-030: ✅ [High] Hashtag Portal feeds bypass author privacy and parent moderation

**PROBLEM:** fetchTaggedFeed reads public content directly from hashtag joins without the final visibleFeedItems authorization used by Home. Private/banned authors and posts under suspended/deleted blogs or wikis can remain visible in public Portal results.

**FILES:** `apps/web/lib/portals/content.ts`; `apps/web/app/h/[slug]/page.tsx`

**FIX:** Apply the same final author, parent and viewer authorization to all Portal feeds and auxiliary content lists before serialization.

**EVIDENCE:** Source-confirmed branch filters and absence of final visibility recheck.

**RESOLUTION:** ✅ Portal branches enforce owner visibility and parent moderation; room/classroom and guild cards also reject local bans/suspensions and private owners.

**VALIDATION:** Real tagged feeds and rich cards reject moderated rooms/guilds, private authors, and published children of banned Wikis or suspended blogs.

### 31: BUG ZOB-V2-031: ✅ [Medium] Portal chronological pagination truncates history and loses timestamp precision

**PROBLEM:** Every source branch is capped before the chronological cursor is applied, so older tagged items beyond PER_TYPE_LIMIT become unreachable. Cursor timestamps are also round-tripped through Date.toISOString, losing PostgreSQL microseconds and risking skipped rows.

**FILES:** `apps/web/lib/portals/content.ts`

**FIX:** Push a precise compound cursor into every branch and keep raw database timestamp precision and a content-type tie-breaker.

**EVIDENCE:** Source-confirmed branch LIMIT precedes outer cursor and Date conversion.

**RESOLUTION:** ✅ Chronological cursors are applied inside every content branch before its limit and use a stable timestamp/type/ID ordering with full PostgreSQL microsecond precision.

**VALIDATION:** Fresh PostgreSQL pagination reads all 65 microsecond-spaced tagged tweets exactly once across five pages.

### 32: BUG ZOB-V2-032: ✅ [High] New game saves are read through another connection before they commit

**PROBLEM:** upsertSave inserts inside a transaction and then calls getSaveForUser through the global database. A separate connection cannot see the uncommitted row, so it reports Save not found and rolls the insert back. A pool size of one instead stalls waiting for the occupied connection.

**FILES:** `apps/web/lib/games/saves.ts`

**FIX:** Read the created save through the transaction client or return the required joined data before commit; test using a real pool.

**EVIDENCE:** Real pooled PostgreSQL execution: upsertSave for a new slot threw NOT_FOUND / Save not found before committing.

**RESOLUTION:** ✅ New saves are read through their insertion transaction.

**VALIDATION:** Actual PostgreSQL upsertSave returned the new save before transaction commit.

### 33: BUG ZOB-V2-033: ✅ [Medium] Save-slot quotas are not serialized when the existing-save set is empty

**PROBLEM:** The quota check locks existing save rows rather than a stable user row. When no rows exist, concurrent first-save transactions acquire no conflicting lock and can all pass the slot-count check. Locking a snapshot of existing saves also does not protect against phantoms. This remains after repairing the separate new-save read failure.

**FILES:** `apps/web/lib/games/saves.ts`

**FIX:** Lock a persistent per-user row/advisory key before count and insert, shared with save reconciliation and downgrade cleanup.

**EVIDENCE:** Source-confirmed SELECT game_saves FOR UPDATE with no user lock.

**RESOLUTION:** ✅ New saves and reconciliation lock the stable account row before reading the slot set, including the first-save case.

**VALIDATION:** Two concurrent first saves on a one-slot plan permit exactly one save against real PostgreSQL.

### 34: BUG ZOB-V2-034: ✅ [High] Forum image fees commit before the reply is accepted

**PROBLEM:** createReply charges image Credits/Stars in one committed transaction, then creates the reply in another. A locked/deleted thread or later insert failure rejects the post while keeping its image charge.

**FILES:** `apps/web/lib/bbforum/service.ts`; `apps/web/lib/bbforum/repo.ts`

**FIX:** Include image debit, reply insertion and related counters in the same transaction; use an operation key for retry-safe charging.

**EVIDENCE:** Source-confirmed chargeImageCost transaction precedes repo.createReply lock/check.

**RESOLUTION:** ✅ Image fees and reply insertion now use the same transaction, so a locked/deleted thread or later insert failure rolls the charge back.

**VALIDATION:** Real PostgreSQL regression charges an image then exercises the actual locked-thread insert; rejection leaves the original wallet balance intact.

### 35: BUG ZOB-V2-035: ✅ [High] Forum pot claims commit before claimant funds are credited

**PROBLEM:** A reply transaction reserves a pot claim and increments its claimed count, but the actual coin credit is a detached post-commit call with only logging on failure. Serverless termination or a transient ledger error can permanently consume an escrow share without paying its claimant.

**FILES:** `apps/web/lib/bbforum/repo.ts`; `apps/web/lib/bbforum/service.ts`

**FIX:** Credit the claimant inside the claim transaction or persist a unique durable payout job atomically with the claim; reconcile claimed versus paid totals.

**EVIDENCE:** Source-confirmed tryClaimPot precedes unawaited creditCoins after commit.

**RESOLUTION:** ✅ Pot credit and claim counters commit atomically with the reply. Expiry refunds re-lock current pot state and atomically mark refunded; refunded pots cannot issue new claims.

**VALIDATION:** Concurrent actual repository replies by one claimant produce one 50-credit claim and one wallet credit.

### 36: BUG ZOB-V2-036: ✅ [Medium] Reward caps race and reward delivery is not durable across community features

**PROBLEM:** BBForum, Answers, Wiki, Polls and Quizzes read rolling earned totals separately from the later credit transaction. Concurrent successful actions can each consume the same remaining reward budget. Rewards are also detached or log-only after content commits, so valid rewards can be lost without a durable retry.

**FILES:** `apps/web/lib/bbforum/service.ts`; `apps/web/lib/forum/service.ts`; `apps/web/lib/wiki/service.ts`; `apps/web/lib/polls/service.ts`; `apps/web/lib/quizzes/service.ts`

**FIX:** Centralize atomic per-user reward-budget reservations and persist unique reward operations with the underlying action; apply one durable settlement contract across these features.

**EVIDENCE:** Expanded source review confirmed the same separate SUM/headroom and later credit pattern in all five services, plus detached reward dispatch.

**RESOLUTION:** ✅ All five community services persist unique reward intents in their action transaction. The shared worker locks the account, includes archived earnings in rolling caps and settles coins and XP atomically with replay protection.

**VALIDATION:** Real PostgreSQL concurrent delivery tests for BBForum, Answers, Wiki, Polls and Quizzes each award exactly the 100-credit cap; rolling back an action removes its reward intent.

### 37: BUG ZOB-V2-037: ✅ [High] Account erasure leaves real PIN hashes and newer crypto-wallet identities

**PROBLEM:** Deletion clears users.pin_hash and legacy creator wallet rows, but authentication uses user_pins and crypto payouts use user_crypto_wallets. Neither of those tables is erased by the 30-day purge. Public avatar storage objects are also never queued for erasure, leaving personally identifying assets after row anonymization.

**FILES:** `apps/web/lib/users/anonymizeAccount.ts`; `apps/web/lib/users/purgeDeleted.ts`; `apps/web/lib/db/schema.ts`

**FIX:** Inventory all identity/credential/media stores and erase or explicitly retain them by purpose; queue public personal-media erasure and test the final purged state across actual tables.

**EVIDENCE:** Source-confirmed deletes target legacy fields/tables rather than these active stores.

**RESOLUTION:** ✅ Erasure deletes the actual user_pins and user_crypto_wallets records, clears avatar identity and atomically queues managed media deletion.

**VALIDATION:** Real account-erasure regression verifies deleted PIN/wallet rows, cleared avatar URL, deletion standing and the durable avatar deletion task.

### 38: BUG ZOB-V2-038: [Medium] Public media uploads have no durable orphan/retention lifecycle

**PROBLEM:** Uploads publish immutable objects before a content record exists. Abandoned drafts and failed content creation leave no durable reservation or deletion job, and repeated replacements accumulate objects indefinitely. The new erasure queue only tracks private identity uploads.

**FILES:** `apps/web/lib/uploads/uploadImage.ts`; `apps/web/app/api/tweets/uploads/image/route.ts`; `apps/web/app/api/forum/uploads/image/route.ts`; `apps/web/app/api/tales/uploads/image/route.ts`

**FIX:** Track reservations and live references for public uploads, enforce user byte/count budgets and garbage-collect unattached/replaced objects after a safe grace period.

**EVIDENCE:** Source-confirmed storage upload returns URL without reservation/reference metadata in SQL.

### 39: BUG ZOB-V2-039: ✅ [Medium] Creator Fund scoring narrows BIGINT XP to INTEGER and ignores active standing

**PROBLEM:** The XP aggregate is explicitly cast to INTEGER despite the live XP ledger being BIGINT. A creator with more than the 32-bit range can abort the entire distribution query. Eligibility also excludes deleted users but not banned or currently suspended creators.

**FILES:** `apps/web/lib/creator/fund.ts`

**FIX:** Keep wide sums exact and apply current monetization/account-standing eligibility consistently before calculating allocations.

**EVIDENCE:** Source-confirmed SUM(amount)::INTEGER and eligibility predicates.

**RESOLUTION:** ✅ Creator Fund XP aggregation preserves wide values, normalizes with Decimal, and excludes banned or effectively suspended creators.

**VALIDATION:** Actual PostgreSQL scoring accepted a three-billion-XP fixture and allocated exact integer kobo without the INTEGER overflow.

### 40: BUG ZOB-V2-040: [High] Fraud-forced manual review is ignored by the earnings-to-coins payout branch

**PROBLEM:** needsManualApproval includes fraudResult.forceManual, but the coins branch executes before that decision affects the payout. It immediately debits earnings, credits spendable coins and returns fraudFlagged=false/requiresManualApproval=false even when fraud checks forced review.

**FILES:** `apps/web/app/api/creator/payouts/route.ts`; `apps/web/lib/fraud/payouts.ts`

**FIX:** Apply fraud/hold decisions before every payout/conversion branch and preserve truthful review state and exact reservation records.

**EVIDENCE:** Source-confirmed conditional ordering and hard-coded false flags in coins branch.

### 41: BUG ZOB-V2-041: ✅ [Medium] Cached ad serves reuse a one-use billing receipt across legitimate views

**PROBLEM:** Clients reuse a served ad and its receipt for five minutes. Billing correctly deduplicates that receipt ID per impression/click, so subsequent legitimate impressions/clicks reported during the cache lifetime are acknowledged as duplicates and never counted/billed.

**FILES:** `apps/web/lib/ads/clientServe.ts`; `apps/android/src/lib/ads/clientServe.ts`; `apps/web/lib/ads/serve.ts`

**FIX:** Separate cached creative data from impression authorization; issue bounded fresh view receipts or an audited multi-view token protocol without allowing replay fraud.

**EVIDENCE:** Source-confirmed five-minute cache and canonical receipt-ID deduplication.

**RESOLUTION:** ✅ Creative caches consume bounded bundles of distinct signed view receipts. Web and Android no longer reuse whole served responses through generic read caches; every mounted view consumes a fresh identity.

**VALIDATION:** Receipt-pool tests verify unique consumption, exhaustion/refill signaling, expiry and account-change clearing; web cache tests pass and Android typecheck passes.

### 42: BUG ZOB-V2-042: ✅ [High] Paystack transport ignores the circuit breaker cancellation signal

**PROBLEM:** The breaker aborts its signal on deadline but waits for the operation’s definitive result. paystackRequest passes an async function that ignores that signal and calls fetch without a transport timeout. A stalled provider request can therefore occupy the entire serverless invocation instead of respecting the configured call deadline.

**FILES:** `apps/web/lib/payments/paystack.ts`; `apps/web/lib/payments/circuit.ts`

**FIX:** Pass the breaker signal through every provider request and body read, with bounded transport timeouts and idempotent uncertain-result reconciliation.

**EVIDENCE:** Source-confirmed execute(async () => fetch without signal).

**RESOLUTION:** ✅ Paystack requests combine the circuit breaker cancellation signal with their transport deadline.

**VALIDATION:** The real request helper receives a breaker abort while fetch is pending and rejects immediately with the breaker deadline.

### 43: BUG ZOB-V2-043: ✅ [Medium] Every standalone database statement incurs a four-command transaction

**PROBLEM:** The pool wrapper turns an ordinary query into BEGIN, set_config, the query and COMMIT, with serial awaits while holding a connection. Routes with multiple separate queries multiply round trips and pool occupancy. This is a measurable architectural overhead, rather than a demonstrated capacity failure; its impact grows with database latency and constrained connection budgets.

**FILES:** `apps/web/lib/db/circuit.ts`; `apps/web/lib/db/drizzle.ts`

**FIX:** Batch related work under one explicitly managed transaction/context and avoid redundant context round trips where role/RLS guarantees already apply; measure per-request statements and pool wait time.

**EVIDENCE:** Source-confirmed four serialized commands for each pool.query.

**RESOLUTION:** ✅ Transaction-local RLS context and timeouts are established in the same simple-protocol command as BEGIN; normal standalone queries use three wire commands rather than four, and related mutations share explicit transactions.

**VALIDATION:** Real PostgreSQL instrumentation verifies three commands, active server context and timeout, context cleanup after commit, and successful rollback/reuse after SQL failure.

### 44: BUG ZOB-V2-044: ✅ [Medium] Request body bounds are absent before JSON and multipart parsing

**PROBLEM:** Upload handlers materialize req.formData before checking file.size; validateBody and several direct routes call req.json without a streaming byte limit. Oversized requests can consume memory before field validation rejects them. Vercel’s external request cap reduces exposure there, but supported self-hosted PostgreSQL deployments have no equivalent application-level bound.

**FILES:** `apps/web/app/api/kyc/documents/route.ts`; `apps/web/app/api/forum/uploads/image/route.ts`; `apps/web/app/api/tweets/uploads/image/route.ts`; `apps/web/app/api/tales/uploads/image/route.ts`; `apps/web/lib/api/middleware.ts`; `apps/web/app/api/friends/route.ts`

**FIX:** Enforce byte and multipart bounds while reading, limit structured metadata depth/size, and require explicit edge limits on every supported deployment before allocating full request bodies.

**EVIDENCE:** Expanded review verified formData-before-size ordering, unbounded validateBody req.json, and direct req.json paths; deployment-conditional resource issue.

**RESOLUTION:** ✅ JSON and multipart readers now enforce actual streamed-byte limits before parsing, with a read deadline and JSON nesting/node bounds; route parsers use the shared readers.

**VALIDATION:** Five request-body regression tests passed, including a false Content-Length and deeply nested JSON.

### 45: BUG ZOB-V2-045: ✅ [Medium] Search-engine opt-out removes sitemap entries without issuing noindex

**PROBLEM:** The setting is presented as Exclude from search engines, but the public profile query/metadata never reads sitemap_opt_out and does not emit noindex. Removing a URL from a sitemap does not stop indexing through other links or keep an already indexed profile out of search.

**FILES:** `apps/web/app/u/[username]/page.tsx`; `apps/web/app/api/users/me/privacy/route.ts`; `shared/i18n/locales/en.json`

**FIX:** Emit robots noindex for opted-out public profiles and make the UI promise match the actual privacy contract; retain sitemap exclusion as an additional measure.

**EVIDENCE:** Source-confirmed setting label and omitted metadata field.

**RESOLUTION:** ✅ Public profile metadata emits noindex when the stored sitemap opt-out is enabled, while retaining the canonical visible profile route.

**VALIDATION:** Real profile projection reads the opt-out flag; the metadata serializer maps it directly to robots.index=false rather than merely omitting a sitemap entry.

### 46: BUG ZOB-V2-046: ✅ [High] Merch coin settlement contains a masked double-credit of seller proceeds

**PROBLEM:** The coin branch debits the buyer once but both increases the seller’s withdrawable earnings and credits seller coins for the same net proceeds. Current schema constraints reject the transaction before these credits execute. Fixing those contract failures alone would activate an inflation path; the settlement logic must be corrected together.

**FILES:** `apps/web/app/api/merch/purchase/route.ts`

**FIX:** Choose one settlement asset per order and post one balanced accounting transaction. Fix the masked logic with the contract failures, and reconcile any historical orders from deployments that allowed these values.

**EVIDENCE:** Verified both seller credit paths in the same transaction. Currently blocked by invalid processing status and merch_sale earnings source; no successful double-credit claimed.

**RESOLUTION:** ✅ Both credit checkout routes use one transactional service and credit only the seller earnings asset; the duplicate seller coin credit is removed.

**VALIDATION:** Five concurrent retries create one order and one buyer debit; the seller receives exactly 85 kobo and zero coins for an Icon-tier 101-kobo sale.

### 47: BUG ZOB-V2-047: ✅ [High] External merchandise checkout has no recorded payment intent or fulfillment branch

**PROBLEM:** The merch checkout creates a merch_orders row and calls the provider without a matching payments intent. Hardened charge handling now rejects missing intents, and there is no merch fulfillment branch. A customer can complete external payment while the order remains unfulfilled and its webhook exhausts retries.

**FILES:** `apps/web/app/api/merch/purchase/route.ts`; `apps/web/lib/payments/paystackWebhookHandler.ts`; `apps/web/lib/payments/index.ts`

**FIX:** Persist the immutable merch payment intent first and implement idempotent, currency/amount-verified stock, order and seller fulfillment for both external providers.

**EVIDENCE:** Source-confirmed initializePayment call and absence of payments insert/merch handler.

**RESOLUTION:** ✅ External checkout records a deterministic immutable payment intent and awaiting-payment order before HTTP. Verified settlement atomically consumes stock, advances the order and credits one configured seller asset; failures remain in the monitored durable inbox.

**VALIDATION:** Real-source checks verify pre-HTTP intent persistence, reused checkout URLs, concurrent webhook replay, stock-failure rollback/recovery and native settlement without a second fiat credit.

### 48: BUG ZOB-V2-048: ✅ [High] Duplicate merchandise purchase APIs write incompatible order contracts

**PROBLEM:** The generic purchase path omits creator_id and writes price_kobo/creator_net_kobo; seller listings and receipt settlement instead rely on creator_id, amount_kobo and creator_share_kobo. After the generic path’s constraint failures are repaired, these records can still disappear from seller views or lack the values required for correct settlement. Free grants additionally force completed status without physical-delivery handling.

**FILES:** `apps/web/app/api/merch/purchase/route.ts`; `apps/web/app/api/merch/[creatorId]/products/[productId]/purchase/route.ts`; `apps/web/app/api/merch/orders/[orderId]/confirm-receipt/route.ts`

**FIX:** Consolidate both endpoints behind one purchase/order service and migrate legacy shapes to a single typed, tested settlement contract.

**EVIDENCE:** Verified conflicting insert projections, seller filtering and receipt field reads. Generic coin orders use processing; only the free branch forces completed.

**RESOLUTION:** ✅ Both purchase endpoints use the same credit order service; external intents carry the same canonical seller, store, gross, net and fee fields. The additive upgrade backfills the legacy aliases without creating new earnings.

**VALIDATION:** Real credit and external purchases populate the settlement fields; concurrent physical receipt confirmations settle the stored quote once. Free physical orders retain delivery state and zero financial value.

### 49: BUG ZOB-V2-049: ✅ [High] Merch checkout writes states and earning sources rejected by the baseline

**PROBLEM:** Coin and free purchases insert status processing, which merch_orders_status_check rejects. They also insert creator_earnings.source_type=merch_sale, while the allowed value is merch. Valid purchases fail and roll back before settlement; loosening just the status constraint would reveal the second failure.

**FILES:** `apps/web/app/api/merch/purchase/route.ts`; `apps/web/db/migrations/0001_consolidated_schema.sql`

**FIX:** Align the shared typed order/earnings state machine with the canonical schema and exercise every payment branch against the real migrated database.

**EVIDENCE:** Real PostgreSQL rejected processing with merch_orders_status_check and merch_sale with creator_earnings_source_type_check (SQLSTATE 23514).

**RESOLUTION:** ✅ Merch services use supported pending/completed states and merch earnings; the portable baseline and upgrade explicitly add awaiting_payment for unfunded checkout intents.

**VALIDATION:** Credit, free, Paystack-intent and native settlement fixtures pass against the fresh baseline; final versus additive-upgrade catalog parity preserves existing balances.

### 50: BUG ZOB-V2-050: ✅ [Medium] KYC AI review has no durable dispatch or recovery after submission

**PROBLEM:** Tier 1 submission persists ai_review, then starts review without awaiting or durably queuing it. Invocation termination or an exception only produces a log; pending-submission guards prevent another submission. The document fetch also has no deadline. A successfully charged application can remain stuck indefinitely.

**FILES:** `apps/web/lib/kyc/service.ts`

**FIX:** Persist a unique review job with the submission, process with bounded document fetches and retry/backoff, and expose aged-review monitoring and manual recovery.

**EVIDENCE:** Verified submitTier1 detached runTier1AiReview call and its only error-log handler; searched all review callers.

**RESOLUTION:** ✅ International submissions enqueue AI review in the same transaction as submission and fee; successful BVN callbacks atomically enqueue the configured review mode. Leased durable delivery can recover failed or interrupted dispatch.

**VALIDATION:** Real PostgreSQL queued-review execution completes the job and routes missing evidence to manual review; stale review execution cannot reopen a terminal decision.

### 51: BUG ZOB-V2-051: ✅ [High] KYC approval does not serialize against rejection or document deletion

**PROBLEM:** approveSubmission reads identity/tier before its transaction, updates submission by ID without checking status or affected rows, and then raises user verification unconditionally. Concurrent rejection can leave a rejected submission with a verified user; deletion between the read and update can still award verification after the supporting submission is gone.

**FILES:** `apps/web/lib/kyc/service.ts`

**FIX:** Lock the submission and active user, enforce allowed review transitions, and update verification only after a successful conditional transition with documents still present.

**EVIDENCE:** Verified approveSubmission and rejectSubmission use independent snapshots and unconditional updates.

**RESOLUTION:** ✅ KYC decisions lock the account and submission together; conflicting terminal decisions fail, late AI/provider updates cannot resurrect a decision, and actual-fee refunds are durably queued once.

**VALIDATION:** Fresh PostgreSQL regression verifies concurrent approve/reject yields one decision, duplicate cancellation refunds one original fee and late AI cannot reopen cancellation.

### 52: BUG ZOB-V2-052: ✅ [Medium] Google login reactivates deleted accounts without enforcing the restoration deadline

**PROBLEM:** An existing Google-linked account is selected including soft-deleted rows, then deleted_at is cleared without checking its age. If anonymization has not completed, Google login can restore an account outside the advertised restoration window, unlike the dedicated restore flow.

**FILES:** `apps/web/app/api/auth/google/callback/route.ts`; `apps/web/lib/auth/restore.ts`

**FIX:** Share the same deadline and account-standing restoration policy across all login/recovery methods; make restoration and purge mutually exclusive.

**EVIDENCE:** Verified upsertGoogleUser deleted_at branch contains no elapsed-time predicate.

**RESOLUTION:** ✅ Google account restoration requires deletion within 30 days and an unpurged record, with the deadline rechecked by the conditional update.

**VALIDATION:** Real account-service tests reject a 31-day-deleted account without clearing deletion and restore a one-day-deleted account.

### 53: BUG ZOB-V2-053: ✅ [Medium] Google login rejects expired suspensions until a cleanup changes the flag

**PROBLEM:** Google login treats any is_suspended=true as blocked without comparing suspended_until. The live authentication boundary accepts an elapsed temporary suspension. A user can therefore remain unable to sign in after the stated end time even though an existing session is usable.

**FILES:** `apps/web/app/api/auth/google/callback/route.ts`; `apps/web/lib/api/middleware.ts`

**FIX:** Evaluate effective suspension from the current end time consistently in login and request authorization; cleanup should not determine whether a suspension has expired.

**EVIDENCE:** Verified both Google account-match branches call throwBlockedAccountError solely from the boolean flag.

**RESOLUTION:** ✅ Google account lookup evaluates suspension expiry consistently for linked accounts and verified-email linking.

**VALIDATION:** Real account-service tests allow an expired suspension and reject an active suspension with ACCOUNT_SUSPENDED.

### 54: BUG ZOB-V2-054: ✅ [Medium] Rich text forces dark typography inside the sitewide light theme

**PROBLEM:** Blog and public wiki content always use prose-invert, while their containers use semantic background/card colors that become nearly white in light mode. Inverted typography keeps light paragraph and heading colors, producing low contrast and breaking the sitewide theme contract.

**FILES:** `apps/web/components/blogs/PostBody.tsx`; `apps/web/app/w/[slug]/[pageSlug]/page.tsx`; `apps/web/app/globals.css`

**FIX:** Use the default typography palette in light mode and scope its inverted palette to the dark theme; verify text, headings, links, code and quotes in every supported theme.

**EVIDENCE:** Chromium with the actual production CSS: light background rgb(250,250,250), paragraph rgb(209,213,219), heading rgb(255,255,255).

**RESOLUTION:** ✅ Rich text uses the normal typography palette in light mode and dark:prose-invert in dark mode, through the existing sitewide semantic theme tokens.

**VALIDATION:** Chromium using newly compiled production Tailwind CSS verifies paragraph, heading, link, code and quote contrast in light/dark modes for default, Reddit, Facebook and Christmas themes.

### 55: BUG ZOB-V2-055: ✅ [Medium] Blog and business CSV exports leave spreadsheet formulas active

**PROBLEM:** These CSV encoders only quote fields and double embedded quotes. User-controlled post titles/page names beginning with spreadsheet formula prefixes remain executable formulas when opened by common spreadsheet applications. The hardened export helper used elsewhere is bypassed.

**FILES:** `apps/web/app/api/blogs/[slug]/stats/export/route.ts`; `apps/web/app/api/business/pages/stats/export/route.ts`

**FIX:** Apply a shared spreadsheet-safe cell encoder to every textual field and test formula prefixes, whitespace/control characters, quoting and delimiters.

**EVIDENCE:** Verified both local toCsv escape implementations only replace double quotes; CSV quoting does not neutralize formulas.

**RESOLUTION:** ✅ Blog and business CSV exports use the shared spreadsheet-safe cell encoder.

**VALIDATION:** Shared CSV escaping regression suite passed.

### 56: BUG ZOB-V2-056: ✅ [Medium] Creator earnings summaries replace recorded net amounts with fixed percentages

**PROBLEM:** The dashboard sums gross earnings, then reconstructs net/fees with fixed 80/20 or 70/30 splits instead of summing stored net_amount_kobo and platform_fee_kobo. Creator Fund entries have no such fee, and other configured splits and per-entry rounding can differ. Reported earnings consequently disagree with the accounting ledger.

**FILES:** `apps/web/app/api/creator/earnings/route.ts`; `apps/web/lib/creator/fund.ts`

**FIX:** Aggregate recorded gross, net and fee columns directly using exact units; display historical effective rates instead of recomputing past settlements.

**EVIDENCE:** Verified gross-only SQL projection and splitForStream fallback; Creator Fund records zero platform fee.

**RESOLUTION:** ✅ Creator summaries aggregate recorded gross, net and fees exactly using Decimal, with range checks before JSON conversion.

**VALIDATION:** Actual creator earnings API reports the stored 173-kobo net on a 999-kobo sale instead of an assumed percentage.

### 57: BUG ZOB-V2-057: ✅ [Medium] Schema and save tests miss constraint and real transaction contract failures

**PROBLEM:** The blocking schema check compares table/column names and types but not constraints, nullability, defaults or relationships. Save tests use a shared fake client, hiding visibility differences between transaction and global connections. These gaps allow broken merch writes and new-save creation to pass the current suite.

**FILES:** `apps/web/db/check-schema.ts`; `apps/web/lib/games/__tests__/saves.test.ts`; `apps/web/lib/games/saves.ts`

**FIX:** Add focused migrated-PostgreSQL contract tests for actual writes, transaction visibility and constraints, and extend schema checks to the guarantees the application relies on.

**EVIDENCE:** Verified schema checker implementation and fake-client test setup; actual PostgreSQL reproduced the save failure despite passing unit tests.

**RESOLUTION:** ✅ Schema checks now compare the full catalog contract, and isolated PostgreSQL regressions exercise real transaction visibility, constraints and financial routes. The actual upgrade runner and portable role/grant variants are also checked.

**VALIDATION:** Fresh 318-table contract checks, actual migration adoption/rerun with preserved wallet data, plain non-superuser PostgreSQL and Supabase-style explicit-grant/RLS tests pass.

### 58: BUG ZOB-V2-058: ✅ [High] Free merchandise grants still create unfunded withdrawable earnings

**PROBLEM:** When the payment context marks merchandise free, the branch records the original nonzero product price as revenue and increments seller available earnings without any buyer debit or provider payment. This is currently masked by the invalid processing/merch_sale writes; repairing those alone would enable unfunded seller balances.

**FILES:** `apps/web/app/api/merch/purchase/route.ts`

**FIX:** Make free grants explicitly zero-value settlements, or debit an authorized subsidy budget atomically; never recognize unfunded withdrawable earnings.

**EVIDENCE:** Verified decision.isFree branch inserts positive creator earnings and increments availableEarningsKobo without a funding debit. Latent behind the merch constraint failure.

**RESOLUTION:** ✅ Free merch grants record zero price, gross, fee and seller share, and create no earnings, funded XP or referral value.

**VALIDATION:** A real free digital order creates no debit, seller earning or XP task; physical free grants use the same zero-value order constructor and retain delivery state.

### 59: BUG ZOB-V2-059: ✅ [High] Daily quest progress accepts self-reported activity and pays rewards

**PROBLEM:** An authenticated caller can increment any quest in their assigned deck by up to 100 without performing its required action. The handler does not verify action type, server events or a completion proof. Server-only game/reward protections are bypassed by calling this generic endpoint directly.

**FILES:** `apps/web/app/api/quests/daily/[questId]/progress/route.ts`; `apps/web/lib/quests/questEngine.ts`

**FIX:** Make progress derive from verified server actions and state. Remove arbitrary client increments for valuable quests, and uniquely bind each counted event to its action, user and quest.

**EVIDENCE:** Local HTTP proof: increment=100 completed a send_text_message quest and credited 50 coins without sending a message.

**RESOLUTION:** ✅ The client progress endpoint returns 410; verified server actions are the only progress producers.

**VALIDATION:** Actual authenticated request with increment=100 returns 410 and cannot advance the assigned quest.

### 60: BUG ZOB-V2-060: ✅ [High] Quest completion can permanently lose its committed coin reward

**PROBLEM:** The completion flag commits before the coin credit. Credit failures are logged and ignored, but the response still reports coins_awarded. A retry sees completed=true and returns without retrying the missing credit. Invocation termination between those operations has the same effect.

**FILES:** `apps/web/lib/quests/questEngine.ts`

**FIX:** Credit coins in the completion transaction or atomically persist a unique durable reward task; return the actual settlement state and reconcile missing credits.

**EVIDENCE:** Local proof: credit failed at the wallet cap, response reported 50 coins, and retry after releasing headroom awarded zero with no credit.

**RESOLUTION:** ✅ Quest completion atomically records a durable uniquely keyed reward intent, preserves user XP in the transaction and reports unpaid coins as zero until settlement.

**VALIDATION:** Wallet-cap regression leaves a pending reward, then releases headroom and retries twice; exactly 50 coins are paid once.

### 61: BUG ZOB-V2-061: ✅ [High] Guild quest contribution locks expire before completion decisions

**PROBLEM:** The quest SELECT FOR UPDATE runs outside the later contribution transaction, so its lock has already been released when the decision is applied. Concurrent callers can advance an already-completed quest and repeat guild-XP awards. The daily cap is also read before the transaction, and week_end/is_active are never enforced. Coin-ledger deduplication does not protect guild XP or contribution counts.

**FILES:** `apps/web/app/api/guilds/[guildId]/quests/[questId]/contribute/route.ts`

**FIX:** Lock and revalidate the quest inside the transaction, enforce its active interval and membership, atomically reserve daily headroom, and transition completion once.

**EVIDENCE:** Verified separate locked SELECT and transaction, unconditional counter/XP updates and unused selected weekEnd.

**RESOLUTION:** ✅ Guild contribution locks and revalidates guild, active membership, quest interval and daily headroom inside the write transaction; completion and guild XP happen once, and member rewards are durably queued with that decision.

**VALIDATION:** Concurrent actual-route contributions yield one completion and 10 guild XP; expired quests and members who have left are rejected.

### 62: BUG ZOB-V2-062: ✅ [High] Referral claims can attach multiple direct inviters to one account

**PROBLEM:** Every new referral code creates another tier-1 row before conditionally setting users.referred_by. Later claims leave the original users.referred_by unchanged while adding other direct inviters and reporting success. The streak-qualification sweep rewards those extra rows, allowing one recruit to generate multiple supposedly one-time referral bonuses.

**FILES:** `apps/web/app/api/referrals/claim/route.ts`; `apps/web/app/api/cron/daily-economy/route.ts`

**FIX:** Serialize claims on the recruited user and reject a different existing referrer before inserting any rows. Enforce one direct referrer per recruit and prevent indirect self/cyclic edges.

**EVIDENCE:** Local HTTP proof: claiming two different codes returned 200 twice and created two tier-1 referral rows for one account.

**RESOLUTION:** ✅ Referral claims lock current participants, validate ancestry in a retryable serializable transaction, and enforce one direct inviter with a partial unique index. Legacy duplicate claims are preserved as private reconciliation tasks rather than silently discarded.

**VALIDATION:** Concurrent codes select one canonical inviter and a cyclic follow-up is rejected. The real migration runner preserves the canonical inviter and quarantines its duplicate while keeping the existing wallet unchanged.

### 63: BUG ZOB-V2-063: [High] Mobile browser hand-offs discard source-session revocation and impersonation

**PROBLEM:** A hand-off code stores only userId. Consumption creates an unrelated session without checking whether the originating session remains active or carrying its impersonation provenance and expiry. A code minted before logout can restore access afterward; an impersonation hand-off becomes an ordinary refreshable session without the actor check or impersonation lifetime.

**FILES:** `apps/web/app/api/auth/mobile-bridge/route.ts`; `apps/web/app/api/auth/mobile-bridge/consume/route.ts`; `apps/web/lib/auth/session.ts`

**FIX:** Bind codes to the source session, provenance, expiry and intended destination; revalidate them on consumption and preserve all security restrictions. Require a browser-bound hand-off intent.

**EVIDENCE:** Local proofs: consumption after source revocation created a session accepted by /auth/me; an impersonation hand-off lost impersonated_by. The access TTL remained 900 seconds; the defect is lost provenance and refresh restrictions.

### 64: BUG ZOB-V2-064: ✅ [High] A push endpoint can remain owned by multiple accounts on one device

**PROBLEM:** Registration only removes device rows belonging to the current user and upserts by user_id/token. The same native token can remain registered to an earlier account when logout cleanup fails or is skipped. A later account on that device can receive private pushes belonging to the earlier one.

**FILES:** `apps/web/app/api/users/push-token/route.ts`; `apps/android/src/lib/push/index.ts`; `apps/web/lib/notifications/push.ts`

**FIX:** Make each delivery endpoint have one current account owner, transfer ownership atomically on registration, and persist/retry logout unregister work or bind registration to active device sessions.

**EVIDENCE:** Local HTTP proof: registering the same Android token/device for two accounts returned 200 twice; both account-owner rows remained.

**RESOLUTION:** ✅ A unique canonical delivery-endpoint ownership key serializes account transfer; old-account unregister remains scoped to its own row.

**VALIDATION:** Two concurrent authenticated registrations of one native endpoint leave one owner; the prior account cannot unregister the new owner’s endpoint.

### 65: BUG ZOB-V2-065: ✅ [Medium] A SQL error aborts an entire DLQ retry batch and prevents retry accounting

**PROBLEM:** Both retry workers process a batch inside one PostgreSQL transaction and catch individual SQL errors without rolling back to a savepoint. PostgreSQL then rejects the attempted retry_count update with 25P02. The entire batch rolls back, including earlier successes, and the poison record never progresses toward its retry limit or permanent-failure alert.

**FILES:** `apps/web/lib/xp/safeAwardXP.ts`; `apps/web/lib/referrals/commissions.ts`

**FIX:** Use a transaction per item or savepoints around each item, record failure after recovering transaction state, and isolate poison records without blocking unrelated work.

**EVIDENCE:** Fresh migrated database proof: an award overflow produced 25P02 in the catch path and left retry_count at zero.

**RESOLUTION:** ✅ XP and commission retry batches recover each failing item with savepoints, update retry accounting after rollback and isolate failure alerts.

**VALIDATION:** Real SQL overflow/wallet-cap failures leave poison items at retry_count=1 while unrelated healthy items resolve in the same batch.

### 66: BUG ZOB-V2-066: ✅ [High] Referral commission retries lose the original crypto settlement asset

**PROBLEM:** The initial commission call receives currency, chain and expected base units for native crypto settlement. recordFailedCommission does not persist that context, and retryFailedCommissions calls the award function without it. Retry therefore follows the coin branch instead. A partially completed native commission can also receive a coin credit under a different ledger uniqueness boundary.

**FILES:** `apps/web/lib/referrals/commissions.ts`; `apps/web/lib/payments/paystackWebhookHandler.ts`; `apps/web/db/migrations/0001_consolidated_schema.sql`

**FIX:** Persist or reconstruct the immutable settlement context from the verified payment, reserve one commission operation across asset ledgers, and retry the originally selected asset only.

**EVIDENCE:** Verified capturedReferral.crypto passed initially, omitted from the failed_commissions record, and absent from the retry call.

**RESOLUTION:** ✅ Commission retries reconstruct crypto context from the saved payment and freeze settlement mode and recipients. Existing asset-ledger entries infer legacy settlement; conflicting assets/recipients fail closed for reconciliation.

**VALIDATION:** A partially recorded SOL commission retries without a coin credit or duplicate native credit; later referral-graph changes do not redirect the frozen commission.

### 67: BUG ZOB-V2-067: ✅ [High] Scheduled business downgrades can overwrite a newer paid upgrade

**PROBLEM:** The downgrade sweep snapshots due accounts, deactivates resources in separate committed statements, then updates the tier by ID only. It never locks/rechecks the downgrade schedule. A concurrent upgrade that clears the schedule can still lose its tier and pages, while a mid-sweep failure leaves partial deactivation.

**FILES:** `apps/web/lib/business/downgradeSweep.ts`; `apps/web/lib/plans/playSubscription.ts`

**FIX:** Serialize on the same user/account locks as activation, recheck the due schedule, and commit tier/resource changes atomically with an auditable transition.

**EVIDENCE:** Verified unbounded due snapshot, absence of a transaction or conditional schedule check, and unconditional final account update.

**RESOLUTION:** ✅ Scheduled downgrades lock current account state, recheck owner/target/deadline, and apply resource cleanup and notification in one transaction.

**VALIDATION:** Real queued cleanup preserves a newer upgrade, rejects changed ownership, and repeated valid delivery applies one tier change and notification.

### 68: BUG ZOB-V2-068: [High] The gift-tier catalogue exposes instructions reserved for purchasers

**PROBLEM:** The catalogue serializes the full benefit_config, including custom_reward.textInstructions. The separate reveal endpoint checks purchase ownership, but an unpaid reader can obtain the same instructions directly from the listing. This listing is currently authenticated by middleware; anonymous access is not required for the bypass.

**FILES:** `apps/web/lib/blogs/repo.ts`; `apps/web/lib/blogs/service.ts`; `apps/web/app/api/blogs/[slug]/gifts/route.ts`

**FIX:** Use a public catalogue projection that excludes buyer-only instructions and other fulfillment secrets; reveal those fields only after checking an active purchase.

**EVIDENCE:** Local HTTP proof: an unrelated, unpaid signed-in user received the buyer-only marker in the gift catalogue (200).

### 69: BUG ZOB-V2-069: [High] Blog gifts debit buyers before seller earnings are durably settled

**PROBLEM:** sendGift commits the buyer debit, purchase and benefit fulfillment, then invokes creditGiftEarnings separately. Settlement failure is only logged and the request still succeeds. There is no durable earnings retry job, so a temporary failure or invocation termination leaves the seller unpaid after a completed sale.

**FILES:** `apps/web/lib/blogs/service.ts`

**FIX:** Post seller proceeds in the purchase transaction or persist an immutable, unique settlement task with it; reconcile purchase funding, benefits and proceeds.

**EVIDENCE:** Verified post-transaction creditGiftEarnings call with a log-only catch and no recorded retry intent.

### 70: BUG ZOB-V2-070: ✅ [Medium] Several cursors omit or contradict the actual sort keys

**PROBLEM:** Wiki/friend queries filter by UUID but sort by title, timestamps or popularity; UUIDs are not ordered by those values. Forum pagination omits pinned ordering from its cursor. Notifications use only a timestamp, so tied rows are skipped. Lists can repeat rows, terminate early or permanently omit records even without concurrent edits.

**FILES:** `apps/web/lib/wiki/repo.ts`; `apps/web/app/api/friends/route.ts`; `apps/web/lib/bbforum/repo.ts`; `apps/web/app/api/notifications/route.ts`

**FIX:** Use a complete stable cursor matching each ORDER BY, with an ID tie-breaker and exact timestamp precision; bound random lists separately.

**EVIDENCE:** Real Wiki pagination returned A with hasMore=true then no second page despite B/C existing. HTTP notification pagination skipped the second of two equal-timestamp rows.

**RESOLUTION:** ✅ Wiki, friend, forum and notification keysets now encode every actual sort key plus an ID tie-breaker. Timestamp keys preserve PostgreSQL microseconds; random discovery returns a bounded sample without a cursor.

**VALIDATION:** Real PostgreSQL/API checks cover alphabetical and discovery Wiki sorts, accepted friends with tied timestamps, pinned forum order and equal-microsecond notifications without skipped or repeated records.

### 71: BUG ZOB-V2-071: ✅ [High] Authenticated Wiki reads expose drafts and bypass Wiki moderation

**PROBLEM:** The page API loads a wiki without requiring a readable moderation status and loads the page without requiring published status. It returns the full page before any read-entitlement check; canManage/canContribute are merely response flags. Any signed-in user can read drafts under a banned wiki through the API despite stricter public-page rules.

**FILES:** `apps/web/app/api/wiki/[slug]/pages/[pageSlug]/route.ts`; `apps/web/lib/wiki/repo.ts`

**FIX:** Create a shared viewer-aware Wiki read policy for status, publication and owner/collaborator exceptions, and apply it before reading/serializing page bodies.

**EVIDENCE:** Local HTTP proof: an unrelated account received 200 containing a draft marker from a banned wiki.

**RESOLUTION:** ✅ Page content, revision history and page listings share moderation/read checks; unpublished page bodies and histories require management or active collaboration entitlement.

**VALIDATION:** Actual authenticated page/history routes reject banned Wikis and drafts for unrelated users against fresh PostgreSQL.

### 72: BUG ZOB-V2-072: ✅ [Medium] Concurrent Wiki edits race revision allocation and overwrite stale fields

**PROBLEM:** updatePage reads the current page before its transaction, merges omitted fields from that stale row, and allocates MAX(revision_number)+1 without locking the page. Parallel edits can choose the same revision and fail on uniqueness, or overwrite a newer body/title with stale values when editing a different field.

**FILES:** `apps/web/lib/wiki/service.ts`

**FIX:** Lock and read the current page inside the edit transaction, require an expected revision, and allocate the next revision under that lock; return an actionable conflict for stale edits.

**EVIDENCE:** Verified pre-transaction page read, unlocked MAX query and unique (page_id,revision_number) database index.

**RESOLUTION:** ✅ Edits and restores require the displayed revision number, lock the current page and merge omitted fields only from that locked row. Editors preserve their original revision and local draft during background refreshes and show actionable conflicts.

**VALIDATION:** Real concurrent partial edits with the same expected revision produce one success, one conflict and one new revision without losing an omitted field; web/Android contracts carry expectedRevision.

### 73: BUG ZOB-V2-073: ✅ [High] A single-use Wiki invitation can admit multiple users concurrently

**PROBLEM:** acceptInvite checks used_at and expiry before its transaction, then unconditionally marks the invitation used and grants collaboration. Two users with the same open invitation can both pass the precheck and receive access; used_by_user_id records only the last writer.

**FILES:** `apps/web/lib/wiki/service.ts`

**FIX:** Lock or atomically consume the invitation with unused/expiry/recipient predicates, and create collaboration only for the successful consumer in the same transaction.

**EVIDENCE:** Real pooled PostgreSQL proof: two concurrent acceptInvite calls both succeeded and created two active collaborators from one single-use invite.

**RESOLUTION:** ✅ Invite consumption atomically checks unused state, expiry and recipient inside the collaboration transaction; a shared Wiki lock rechecks active state before admission.

**VALIDATION:** Two concurrent real PostgreSQL consumers of an open single-use invite produce one success and exactly one collaborator.

### 74: BUG ZOB-V2-074: [High] Sponsored quest budgets and rewards have no corresponding funding reservation

**PROBLEM:** Business creation accepts totalBudgetCredits and rewardCoins as declared numbers without reserving an advertiser wallet/payment. Impression processing only increments the declared spent counter, and the shadow quest pays the configured coin reward on completion. Moderation approval controls publication but supplies no accounting funding, so campaigns and rewards can create unfunded obligations.

**FILES:** `apps/web/app/api/business/sponsored-quests/route.ts`; `apps/web/lib/quests/sponsoredQuestPacing.ts`; `apps/web/lib/quests/questEngine.ts`

**FIX:** Reserve an actual advertiser/subsidy balance atomically, post impression charges and reward liabilities against it, and refuse rewards or campaign growth beyond funded headroom.

**EVIDENCE:** Traced creation, shadow-template sync, impression accounting and reward credit; no wallet debit, escrow reservation or linked payment funds these budgets.

### 75: BUG ZOB-V2-075: ✅ [Medium] Sponsored quest impression accounting ignores daily caps and paused state

**PROBLEM:** Candidate selection checks daily spending and campaign eligibility before the debit, but recordSponsoredQuestImpression only conditionally enforces total budget. Concurrent deck generation can overspend a daily cap; a pause or moderation change between selection and debit does not prevent billing/distribution.

**FILES:** `apps/web/lib/quests/sponsoredQuestPacing.ts`; `apps/web/lib/quests/questEngine.ts`

**FIX:** Reserve daily and total headroom and recheck current campaign/time/moderation eligibility atomically with the impression and deck assignment.

**EVIDENCE:** Real helper execution accepted an inactive campaign impression and spent 0.50 credits against a 0.10 daily cap.

**RESOLUTION:** ✅ Impression accounting locks and revalidates campaign state, dates and daily/total headroom, then persists the charge and event in one transaction. Deck assignment and billing share a transaction, with a regular-quest fallback when billing fails.

**VALIDATION:** Real PostgreSQL tests reject paused campaigns and allow exactly one of two concurrent impressions when only one fits the daily cap.

### 76: BUG ZOB-V2-076: ✅ [Medium] Sponsored impression charges are rounded away by the balance column

**PROBLEM:** Allowed positive CPM values can produce charges smaller than 0.01 credit. spent_credits has scale two while event costs have scale four. For CPM=1, adding a 0.001-credit impression repeatedly rounds the spent counter back to its prior value, allowing distribution without consuming the intended budget.

**FILES:** `apps/web/lib/quests/sponsoredQuestPacing.ts`; `apps/web/app/api/admin/sponsored-quests/route.ts`; `apps/web/db/migrations/0001_consolidated_schema.sql`

**FIX:** Represent balances and charges in one sufficiently precise integer subunit, or accumulate exact residuals; reject unrepresentable prices and migrate/reconcile existing counters.

**EVIDENCE:** Real PostgreSQL/helper proof: a 0.001-credit charge left spent_credits at 0.50 while recording another impression.

**RESOLUTION:** ✅ Sponsored balances, caps and event charges share six-decimal precision; Decimal arithmetic derives and compares the exact CPM charge. The portable baseline and additive upgrade match.

**VALIDATION:** Real PostgreSQL preserves two .001-credit charges as .002; fresh-versus-upgraded catalog parity and existing account balances are verified.

### 77: BUG ZOB-V2-077: ✅ [Medium] Ordinary room members can submit system messages and bypass text moderation

**PROBLEM:** The client schema accepts system and gift message types from ordinary members. Auto-moderation, duplicate/bot checks and public link filtering run only for text. Selecting system can persist unfiltered text and links through the same posting endpoint without any staff/system authorization.

**FILES:** `apps/web/app/api/rooms/[roomId]/messages/route.ts`

**FIX:** Reserve system/gift event creation for trusted server services and staff operations. Validate each client-sendable message type and apply appropriate moderation to all user-controlled text.

**EVIDENCE:** Local nonstaff HTTP proof: messageType=system returned 201 and persisted an unfiltered https://example.invalid link.

**RESOLUTION:** ✅ Client room messages can no longer create system or gift events; trusted gift services retain event creation. Text and Moment content traverse moderation.

**VALIDATION:** Actual authenticated room-send calls with either server-only event type return 400 before persistence.

### 78: BUG ZOB-V2-078: [High] Room Moment sends publish and charge before the room-message transaction

**PROBLEM:** The route calls createMoment in its own committed transaction before inserting the room message. A later message failure leaves a published Moment and any charge behind. Two concurrent retries with the same message key can both create/charge Moments before one message insert loses the uniqueness race.

**FILES:** `apps/web/app/api/rooms/[roomId]/messages/route.ts`; `apps/web/lib/moments/service.ts`

**FIX:** Make Moment creation, charging and room-message insertion one transaction or one durable idempotent operation keyed to the client request; compensate unavoidable external steps explicitly.

**EVIDENCE:** Verified independent createMoment transaction before the enclosing insert, with no shared operation key or compensation.

### 79: BUG ZOB-V2-079: ✅ [Medium] Avatar uploads bypass decoding validation after compression failure

**PROBLEM:** The shared raster compressor rejects invalid or unsupported data, but the avatar route catches every failure and uploads the original bytes with the client-supplied image MIME type. The MIME whitelist therefore does not guarantee a valid decoded image, bounded normalized dimensions or stripped metadata on this path.

**FILES:** `apps/web/app/api/users/me/avatar/route.ts`; `apps/web/lib/storage/compress.ts`

**FIX:** Reject failed decoding, validate actual file signatures/dimensions and normalize supported avatars before public storage; use a known safe fallback image instead of the unvalidated input.

**EVIDENCE:** Verified the catch returns rawBuffer and sourceMimeType directly to storage.upload.

**RESOLUTION:** ✅ Avatar decoding/compression failure returns INVALID_IMAGE and cannot fall back to unvalidated source bytes.

**VALIDATION:** Actual multipart upload of non-image bytes labeled image/png returns 400 before storage or charging.

### 80: BUG ZOB-V2-080: ✅ [Medium] Subscription and referral sweeps load unbounded backlogs into serial work

**PROBLEM:** Subscription/downgrade sweeps select all due accounts, while referral qualification locks and updates every matching referral before processing rewards. There is no batch limit, resumable cursor or invocation time budget. Growing backlogs hold large transactions or require more serial work than one serverless invocation can finish.

**FILES:** `apps/web/lib/plans/subscriptionSweep.ts`; `apps/web/lib/business/downgradeSweep.ts`; `apps/web/app/api/cron/daily-economy/route.ts`

**FIX:** Process bounded keyset/lease batches with a time budget, checkpoint progress and durably enqueue follow-up work; keep transactions limited to each account or small batch.

**EVIDENCE:** Verified uncapped candidate SELECTs and the all-referrals qualification transaction. This is structural analysis, not a claimed load-test failure; CRON frequency is outside scope.

**RESOLUTION:** ✅ Maintenance scans enqueue at most 100 account jobs and persist keyset continuations; each account runs independently. Referral qualification commits durable reward intents atomically.

**VALIDATION:** Real 101-account backlog crosses the persisted continuation without duplicates, preserves renewals, and concurrent referral qualification survives a failed credit with exactly one eventual reward.

### 81: BUG ZOB-V2-081: ✅ [Medium] Mobile hand-off redirect validation accepts protocol-relative numeric hosts

**PROBLEM:** SAFE_REDIRECT_RE permits repeated leading slashes and numeric host strings. new URL interprets //3405803856 as the external host 203.0.113.80, not an application path. The consumed code is not bound to the allowed path used when minting it, so the mint allowlist does not prevent this open redirect.

**FILES:** `apps/web/app/api/auth/mobile-bridge/consume/route.ts`; `apps/web/app/api/auth/mobile-bridge/route.ts`

**FIX:** Bind the approved destination to the code, require exactly one leading slash, and verify the resolved URL origin equals the application origin before redirecting.

**EVIDENCE:** Local redirect-only HTTP proof: replacing the minted /kyc destination with //3405803856 returned 302 Location: http://203.0.113.80/. The redirect was not followed.

**RESOLUTION:** ✅ Browser hand-off codes bind the destination path; consumption rejects mismatches and protocol-relative paths and checks the resolved same origin before creating credentials.

**VALIDATION:** A real minted code with //3405803856 returns 400 without a redirect; the matching path redirects to the application and can be consumed only once.

### 82: BUG ZOB-V2-082: ✅ [High] SOL payment verification attributes received funds to the fee payer

**PROBLEM:** The adapter treats the receiving account’s net balance increase as a transfer and reports accountKeys[0], the fee payer, as its sender. It never validates the actual transfer source. Fee-sponsored or multi-signer transactions can be attributed to the wrong wallet, undermining the account ownership check and rejecting legitimate source-wallet proofs.

**FILES:** `apps/web/lib/payments/crypto/chains/solana.ts`; `apps/web/lib/payments/crypto/index.ts`

**FIX:** Parse supported native transfer instructions, validate their source/signers/destination and exact amount, and bind the ownership proof to that source. Define explicit handling for multi-transfer and sponsored transactions.

**EVIDENCE:** Mocked finalized-transaction proof executing the real adapter reported the sponsor as sender even though the parsed transfer source was another signer. No live chain transaction was submitted.

**RESOLUTION:** ✅ SOL proof reads finalized parsed System Program transfers, attributes the actual signed source, sums exact same-source instructions and rejects ambiguous/unsupported transfers.

**VALIDATION:** Six adapter tests cover sponsored fee payers, exact sums, mixed sources, unsigned/unsafe amounts, delta-only false proofs and failed transactions.

### 83: BUG ZOB-V2-083: ✅ [High] New crypto purchase quotes accept cached prices with no maximum age

**PROBLEM:** When the live price request fails, getUsdPrice returns any cached price regardless of age. computeExpectedAmount uses it to price new purchases without rejecting stale-cache. A long outage and market movement can therefore sell fiat-valued credits/plans for an obsolete token amount. Preserving an existing quote does not justify creating new stale quotes.

**FILES:** `apps/web/lib/payments/crypto/priceFeed.ts`; `apps/web/lib/payments/crypto/index.ts`

**FIX:** Enforce an explicit maximum age and price-deviation policy for new quotes, use independently validated fallbacks or a time-bounded operator override, and pause new quotes when trustworthy pricing is unavailable.

**EVIDENCE:** Actual source execution under a simulated provider outage returned a 60-day-old cached BNB price as usable stale-cache; no live price/provider request occurred.

**RESOLUTION:** ✅ New quotes enforce a 15-minute maximum price age, bounded operator overrides and a price-deviation guard.

**VALIDATION:** Seven price-feed tests passed, including rejecting a 60-day-old cache during an outage.

### 84: BUG ZOB-V2-084: ✅ [Medium] Concurrent stale crypto-price reads trigger duplicate provider refreshes

**PROBLEM:** Each reader independently fetches a stale or missing price. There is no per-token single-flight promise or cross-instance refresh lease, so simultaneous quote requests fan out to the same free provider, trigger rate limits and drive the stale-price fallback.

**FILES:** `apps/web/lib/payments/crypto/priceFeed.ts`

**FIX:** Coalesce refreshes per token and use a bounded distributed refresh lease where multiple instances share the cache, with jitter and an explicit freshness policy.

**EVIDENCE:** Actual source execution with a stubbed provider: five concurrent stale BNB reads issued five provider requests.

**RESOLUTION:** ✅ Refreshes share one promise per token and a bounded Redis lease across instances.

**VALIDATION:** The concurrent-reader regression confirmed five callers issue one provider request.

### 85: BUG ZOB-V2-085: ✅ [High] Android logout does not revoke the server-side session

**PROBLEM:** The Android Logout action calls clearAuth, which removes local tokens/cache and attempts push cleanup but never invokes the backend logout endpoint. The Redis session and rotated refresh credential remain valid, so a copied token can continue to access the account after the user signs out.

**FILES:** `apps/android/src/routes/settings.tsx`; `apps/android/src/lib/auth/store.ts`; `apps/web/app/api/auth/logout/route.ts`

**FIX:** Revoke the authenticated server session before clearing local credentials when online, persist a safe retry/revocation strategy for offline sign-out, and clear local state regardless of network success.

**EVIDENCE:** Traced the Logout action and clearAuth implementation; no /auth/logout call exists anywhere in active Android source.

**RESOLUTION:** ✅ Native logout stores a bounded Keystore-backed revocation intent and retries after network failures; the server accepts signed refresh proof when access credentials have expired and revokes the source session.

**VALIDATION:** Three native retry tests cover offline recovery, concurrent enqueue and server failure; actual server logout revokes both source and derived browser access using refresh proof.

### 86: BUG ZOB-V2-086: ✅ [High] An old Android refresh can overwrite a newly signed-in account

**PROBLEM:** refreshAccessToken is single-flight but not bound to an account/session generation. A response started for account A writes tokens and background user data after logout or a switch to B. It can restore A’s credentials into secure storage and the shared client while the UI/cache owner belongs to B.

**FILES:** `apps/android/src/lib/api/client.ts`; `apps/android/src/lib/auth/store.ts`

**FIX:** Capture a session generation and source refresh credential, cancel or discard results when either changes, and apply token/profile writes atomically only to the initiating account.

**EVIDENCE:** Temporary Vitest proof executing the real client: switch cached identity from A to B while A refresh waits; resolving A’s response replaced B with ACCOUNT_A_REFRESHED.

**RESOLUTION:** ✅ Native refreshes and profile writes are bound to a session generation and serialized with account transitions; stale responses are discarded.

**VALIDATION:** Three native client tests passed, including a delayed account-A refresh after switching to B.

### 87: BUG ZOB-V2-087: ✅ [Medium] Legacy notification producers collide with the null-reference uniqueness rule

**PROBLEM:** These producers directly insert notifications without a reference_id. The baseline unique index permits only one null-reference notification per user/type. Later distinct challenge notifications hit a uniqueness error and are silently caught, so legitimate new events are lost for as long as the first row remains.

**FILES:** `apps/web/app/api/nemesis/challenge/route.ts`; `apps/web/app/api/nemesis/challenge/[challengeId]/accept/route.ts`; `apps/web/lib/nemesis/nemesisEngine.ts`; `apps/web/db/migrations/0001_consolidated_schema.sql`

**FIX:** Use the shared notification helper with a stable event-specific reference, populate the canonical content/metadata fields and distinguish intentional event deduplication from unrelated later events.

**EVIDENCE:** Verified direct inserts omit reference_id and the notifications_type_null_ref_unique index; a local duplicate insert reproduced that constraint error.

**RESOLUTION:** ✅ Independent null-reference notifications no longer collide; challenge producers use stable event references and canonical notification fields.

**VALIDATION:** Fresh baseline accepts three distinct notifications of the same user/type with null references; final catalog verification confirms the legacy uniqueness rule is absent.

### 88: BUG ZOB-V2-088: ✅ [Medium] The legacy manifest update API writes settings the application never reads

**PROBLEM:** The admin PUT endpoint returns success after writing a merged manifest into app_settings. The active loader reads x_manifest instead and does not read that app_settings document. Cache invalidation reloads the original values, so feature/payment/moderation edits made through this supported endpoint have no effect.

**FILES:** `apps/web/app/api/manifest/[key]/route.ts`; `apps/web/lib/manifest/index.ts`

**FIX:** Remove the obsolete API or validate/map its edits into the canonical x_manifest transaction and invalidate the correct caches; return the effective persisted configuration.

**EVIDENCE:** Verified the endpoint writes appSettings key manifest, while the manifest loader only loads x_manifest and has no app_settings read.

**RESOLUTION:** ✅ The obsolete manifest writer returns 410 and points callers to the canonical validated admin configuration endpoint.

**VALIDATION:** Actual assured-admin PUT returns 410 instead of pretending to persist an unused app_settings manifest.

### 89: BUG ZOB-V2-089: ✅ [Medium] Cron completion can conceal missing or failed steps

**PROBLEM:** runStep returns without checkpointing when its successful predicate is false, but does not retain that failure in the lease. finish(true) can still mark the whole run completed. Some callers also catch a step failure and only log it without adding to errors, preventing the incomplete run from being retried.

**FILES:** `apps/web/lib/cron/lease.ts`; `apps/web/app/api/cron/daily-platform/route.ts`

**FIX:** Track failed/missing step state inside the lease, require live lease ownership at every checkpoint/completion, and propagate failed steps into the final outcome.

**EVIDENCE:** Verified runStep false branch returns normally; daily-platform export pruning catches and logs without updating errors before finish.

**RESOLUTION:** ✅ Cron leases retain failed-step state and verify lease ownership before completion; export-prune errors enter the run error list.

**VALIDATION:** Real PostgreSQL check confirmed finish(true) cannot complete a run with an unsuccessful step.

### 90: BUG ZOB-V2-090: ✅ [Medium] Concurrent username changes can bypass the change cooldown

**PROBLEM:** Eligibility and cooldown are checked before the username-change transaction. The locked re-read only checks the current username, so two changes can both pass the old cooldown state and commit different names in succession. The unique username constraint protects name collisions, not the per-account change interval.

**FILES:** `apps/web/lib/username/service.ts`; `apps/web/lib/username/eligibility.ts`

**FIX:** Recheck the current cooldown and eligibility under the user lock using the same transaction before any debit or rename.

**EVIDENCE:** Verified pre-transaction checkUsernameChangeEligibility and locked SELECT limited to username.

**RESOLUTION:** ✅ Eligibility and availability are rechecked under the user lock using preloaded configuration.

**VALIDATION:** Concurrent real PostgreSQL username changes allowed exactly one rename and rejected the second under cooldown.

### 91: BUG ZOB-V2-091: ✅ [Medium] Personal export stalls when a section has no records

**PROBLEM:** A pull-driven export returned without emitting bytes or closing after an empty section. The stream consumer could wait indefinitely instead of requesting another pull, preventing completion for ordinary accounts with empty tables.

**FILES:** `apps/web/lib/export/personal.ts`

**FIX:** Continue scanning empty sections within the same pull until a record is emitted or the completion marker is written.

**EVIDENCE:** Fresh PostgreSQL export regression reaches the completion marker across all empty and populated sections.

**RESOLUTION:** ✅ The exporter scans empty sections in the same stream pull until it can emit records or close with the completion marker.

**VALIDATION:** Actual personal export completes across every empty and populated section on the fresh PostgreSQL baseline.

### 92: BUG ZOB-V2-092: ✅ [Medium] Concurrent quiz submissions race the per-user attempt limit

**PROBLEM:** The attempt count was read before the insertion transaction. Concurrent submissions could both pass the configured maximum or collide on attempt numbering, making the limit and error behavior unreliable.

**FILES:** `apps/web/lib/quizzes/service.ts`

**FIX:** Serialize submissions on the account and re-read the active quiz and attempt count inside the insertion transaction.

**EVIDENCE:** Source-confirmed pre-transaction count; focused regression pending.

**RESOLUTION:** ✅ Quiz submission locks the account, rechecks the active quiz and counts attempts inside the same transaction as the attempt and durable reward intent.

**VALIDATION:** Actual service PostgreSQL test sends two concurrent submissions with a one-attempt limit; exactly one succeeds and one attempt exists.

### 93: BUG ZOB-V2-093: ✅ [Medium] Poll votes use stale eligibility after closure or moderation

**PROBLEM:** Vote eligibility, closing time and existing votes were checked before the transaction. A poll could close or be moderated before votes and rewards were committed.

**FILES:** `apps/web/lib/polls/service.ts`

**FIX:** Lock and revalidate the active poll, closing time, selected options and prior votes in the vote transaction.

**EVIDENCE:** Source-confirmed eligibility reads outside the write transaction; focused regression pending.

**RESOLUTION:** ✅ Vote insertion locks and rechecks active poll state, closing time, options and existing votes in the write transaction.

**VALIDATION:** Actual service PostgreSQL tests reject a closed poll and allow one of two concurrent votes with one voter count and reward intent.

### 94: BUG ZOB-V2-094: ✅ [High] Coin transfers acknowledge in-flight work and use unstable operation identities

**PROBLEM:** The transfer route returns success whenever a Redis processing key exists, even if the first transaction later fails. The wallet omits a client operation UUID, so an hourly fallback suppresses legitimate identical transfers and can let a retry across the hour boundary debit twice. Existing ledger retries also accept changed amounts without confirming the original operation.

**FILES:** `apps/web/app/api/economy/coins/transfer/route.ts`; `apps/web/lib/economy/coins.ts`; `apps/web/app/(app)/wallet/page.tsx`

**FIX:** Require a client-stable UUID and expected account, bind the operation to immutable sender/recipient/amount/fee values, return success only from committed ledger state and atomically persist reward work.

**EVIDENCE:** Source-confirmed processing-key early success and missing wallet UUID; focused concurrent database regressions are being run.

**RESOLUTION:** ✅ Transfers require account-bound UUID operation identities, lock both accounts, and replay committed ledger pairs. The wallet retains its operation identity through uncertain retries.

**VALIDATION:** Concurrent replays credit once; changed amount and account are rejected; insufficient-fund retries do not falsely report success and can succeed once funded.

### 95: BUG ZOB-V2-095: ✅ [High] Merch shipping updates can overwrite newer order state and grow tracking history without a bound

**PROBLEM:** Shipping, delivery and tracking handlers authorize against an unlocked order snapshot and later update by ID only. A stale request can regress a delivered/completed order or append updates after fulfillment changes. Tracking arrays accept an unlimited number of individually bounded notes, causing persistent row growth.

**FILES:** `apps/web/app/api/merch/orders/[orderId]/ship/route.ts`; `apps/web/app/api/merch/orders/[orderId]/deliver/route.ts`; `apps/web/app/api/merch/orders/[orderId]/tracking/route.ts`

**FIX:** Serialize fulfillment changes on the current order, enforce seller ownership and funded state under the lock, keep retries monotonic, commit notifications with transitions and cap retained tracking events while preserving delivery progress.

**EVIDENCE:** Confirmed unlocked prechecks and unconditional ID-only updates in all three source handlers, with unbounded JSONB concatenation in tracking.

**RESOLUTION:** ✅ Shipping, delivery and tracking serialize current order state and seller authorization; transitions and notifications commit together. Retries cannot regress completed orders, and history is capped at 100 events with room reserved for delivery.

**VALIDATION:** Real concurrent shipping transitions once; wrong sellers fail; completed orders remain completed; tracking replay deduplicates and a full history still allows delivery and receipt confirmation.

### 96: BUG ZOB-V2-096: ✅ [High] Google email-conflict recovery accepts accounts without matching the provider identity

**PROBLEM:** The existing-email branch returns an account whenever google_id is populated without checking the incoming subject matches it. An unverified-email collision falls through to insertion, then the unique-email recovery branch returns that existing account without provider identity or current standing checks. Linking also updates by user ID alone, allowing competing subjects to overwrite each other.

**FILES:** `apps/web/app/api/auth/google/callback/route.ts`; `apps/web/lib/auth/googleAccount.ts`

**FIX:** Reject identities that require explicit linking, compare-and-set verified linking, and recover signup collisions only through the exact Google subject with current account standing checks.

**EVIDENCE:** Confirmed unconditional populated-google_id return, unverified-account insertion fallback and email-only uniqueness recovery in the callback source.

**RESOLUTION:** ✅ Google identity lookup rejects unverified or differently linked accounts, compare-and-sets verified linking, and recovers signup conflicts only by the same provider subject with current standing checks.

**VALIDATION:** Real PostgreSQL tests reject incompatible identities, allow one concurrent link winner and recover concurrent same-subject signup into one account.

### 97: BUG ZOB-V2-097: ✅ [High] Crawlable profiles expose hidden fields and effectively suspended accounts

**PROBLEM:** The public profile query omits effective suspension and hidden-field projection. Bio, avatar and XP can remain in anonymous HTML, Open Graph metadata and JSON-LD even after the authenticated API hides them, and suspended profiles remain crawlable.

**FILES:** `apps/web/app/u/[username]/page.tsx`; `apps/web/lib/public/resolveProfile.ts`

**FIX:** Apply the shared account-standing policy and project hidden fields before constructing any HTML, metadata or structured data.

**EVIDENCE:** Confirmed the public select and serializers read raw bio/avatar/XP without profile_hidden_sections and omit suspension predicates.

**RESOLUTION:** ✅ The crawlable profile page uses a safe shared projection before constructing HTML, metadata or JSON-LD; effective suspensions and hidden bio/avatar/XP settings are honored.

**VALIDATION:** Real profile lookup hides all three fields, rejects an active suspension, accepts an expired suspension and retains the search opt-out flag.

### 98: BUG ZOB-V2-098: ✅ [High] Pinned DNS lookup uses the wrong Node callback shape and breaks Google sign-in

**PROBLEM:** safeFetch always returns a scalar address from its custom DNS callback. Node automatic address-family selection requests all=true and expects an address array; receiving a scalar makes net.connect read an undefined address. Production Google token/profile requests fail with Invalid IP address: undefined.

**FILES:** `apps/web/lib/security/ssrf.ts; apps/web/lib/auth/google.ts`

**FIX:** Return the correct scalar or array callback shape according to lookup options while retaining the exact validated IP, TLS hostname and private-address checks.

**EVIDENCE:** The supplied Vercel production callback log matches Node’s emitLookup failure; the source callback ignores options.all.

**RESOLUTION:** ✅ Pinned DNS lookup returns the address-array shape for Node all=true and the scalar shape otherwise, retaining the validated IP and TLS hostname. This shared backend fix covers web/PWA and Vite/Capacitor OAuth.

**VALIDATION:** Ten focused tests cover IPv4/IPv6 callback forms, a stable pin, invalid pin rejection and continued blocking of private/metadata destinations.

### 99: BUG ZOB-V2-099: ✅ [Medium] Android OAuth App Links use a fixed domain and placeholder certificate

**PROBLEM:** The native manifest only registers zobia.org while the Vite OAuth callback follows VITE_WEB_BASE_URL. Deployments on zobia.vercel.app or another domain cannot return through that verified App Link. The published assetlinks file also contains a placeholder instead of a real signing fingerprint.

**FILES:** `apps/android/android/app/src/main/AndroidManifest.xml; apps/android/android/app/build.gradle; apps/web/public/.well-known/assetlinks.json; .github/workflows/android-build.yml`

**FIX:** Build the native App Link hostname from the configured HTTPS website origin, publish configured real certificate fingerprints, and expose the test APK fingerprint in the GitHub run summary.

**EVIDENCE:** Confirmed the hardcoded manifest hostname, default Vite website origin and placeholder fingerprint in the shipped association file.

**RESOLUTION:** ✅ The Vite/Capacitor manifest now takes its host from the configured HTTPS website origin. The web association endpoint publishes validated signing fingerprints, and the APK workflow exposes its actual debug signing SHA-256 in the run summary. Deployment still requires the operator to configure that fingerprint and rebuild the APK.

**VALIDATION:** GitHub Android build 40140550797 passed, including APK compilation, Gradle signing fingerprint extraction and artifact upload. Five association helper tests passed; the production endpoint smoke test returned the configured normalized certificate and native package. Physical-device Google sign-in remains a deployment check.

### 100: BUG ZOB-V2-100: ✅ [High] Durable commission-intent insertion targets a partial unique index without its predicate

**PROBLEM:** The new durable referral-intent insert uses ON CONFLICT(payment_id), but the database enforces uniqueness only where payment_id IS NOT NULL. PostgreSQL cannot infer that partial index without the predicate and aborts verified coin-payment fulfillment before its transaction commits.

**FILES:** `apps/web/lib/payments/paystackWebhookHandler.ts`; `apps/web/__tests__/integration/hardening.integration.test.ts`

**FIX:** Include the matching non-null predicate in the conflict target and verify real payment fulfillment/replay against the final schema. Give the RLS test its own ledger fixture so an earlier failure cannot hide behind test ordering.

**EVIDENCE:** Full PostgreSQL integration run reproduced SQLSTATE 42P10 on the durable intent insert. This defect was discovered in the remediation batch before publication.

**RESOLUTION:** ✅ The durable commission-intent conflict target includes payment_id IS NOT NULL, matching the partial unique index. RLS verification now seeds its own independent live ledger record.

**VALIDATION:** The real verified-payment/replay and RLS tests pass in the focused 11-test PostgreSQL hardening suite after reproducing the original 42P10 failure.

## Ratings and brief review

Ratings are engineering judgments, not a certification. Scores show **audited base → this verified batch → projected after every remaining fix**. Live deployment/provider checks still depend on the user's configured services.

- **Security: 4/10 → 7/10 → 8.5/10.** Live authorization, factor proof and Google transport/identity handling are substantially improved; open realtime and hand-off verification remains listed.
- **Accounting and data integrity: 4/10 → 6.5/10 → 8.5/10.** Durable rewards, locked payouts and unified merch settlement are verified. Sponsored funding and remaining payout verification are still open.
- **Performance and hosting efficiency: 6/10 → 7.5/10 → 8/10.** Bounded pagination/workers and fewer database context round trips help; public-upload retention remains open.
- **Structure and maintainability: 6/10 → 7.5/10 → 8.5/10.** Shared purchase, authorization, export and task services reduce divergent behavior.
- **Implementation and user experience: 5/10 → 7.5/10 → 8.5/10.** Broken saves/exports, rich-text contrast and authentication paths are repaired; production sign-in and device linking need deployment configuration.
- **Overall: 4.5/10 → 7/10 → 8.5/10.** This is a deployment checkpoint with explicitly retained open findings, not completion of the entire remediation plan.

## Review scope and concise validation

The initial audit and additional deep review identified **100 findings: 58 High and 42 Medium**. High includes important integrity failures and explicitly identified latent financial defects. No currently reachable Critical exploit is asserted. Entries describe distinct defects; related defects in one subsystem may share a coordinated fix.

The initial three passes and this additional deep review covered (1) source/schema inventory and trust-boundary scans, (2) manual tracing of authorization, payments, privacy, persistence and failure paths, and (3) adversarial local reproductions and cross-checks against the migrated PostgreSQL schema, current tests and production CSS. The active web, Android and shared source inventory contains 1,993 TypeScript/TSX files; discontinued Expo code was excluded. The inventory count does not imply every line was manually inspected three times.

Reviewed areas included sessions and role assurance, RLS/grants and database portability, exact-value accounting, payout/webhook idempotency, race conditions, content visibility and SEO, upload/input boundaries, offline account isolation, erasure/export portability, queue/retry behavior, pooling/caching, and theme/accessibility integration. CRON frequency was excluded as requested. No new grant defect or exposed live key is asserted without supporting evidence.

The earlier checks for this same revision passed 590 unit tests and 145 integration tests. The audit used focused HTTP, real PostgreSQL, stubbed-provider and temporary Vitest reproductions. Remediation evidence appears with each resolved finding. New checks confirmed quest/referral abuse, lost rewards, session hand-off failures, shared push ownership, Wiki/gift visibility, invite races, pagination loss, DLQ failure accounting, crypto pricing/attribution and a native token-refresh race. Passing existing suites do not disprove these findings.

Financial/provider analysis used source tracing and isolated local fixtures; no live payment was initiated. Findings marked as masked explain their blocking condition and do not claim a successful exploit through that condition. Pool/concurrency recommendations are based on observed command structure; thousands-user load capacity and future zero-cost operation were not established by this audit.

Remediation progress: **91/100 fixed and verified**. This batch is being prepared for the user’s requested deployment checkpoint; unresolved findings remain open and are not claimed fixed.

---

**Version 2 — Audit signature: Codex — October 24, 2026 — 11:59:44 PM WAT (Africa/Lagos)**

End of complete Version 2 report.
