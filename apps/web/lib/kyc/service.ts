/**
 * lib/kyc/service.ts
 *
 * Core business logic for the identity KYC feature (Tiers 1-3).
 *
 * Tier 1 — Nigeria: Paystack BVN identity validation (async, resolved via
 *   webhook) + a submitted ID/NIN slip, cross-checked by AI name-match.
 * Tier 1 — non-Nigeria: submitted government ID + proof of address (+ a
 *   selfie for a lightweight AI liveness heuristic), reviewed by AI or a
 *   human depending on the admin's `kyc.tier1ReviewMode` setting.
 * Tier 2: a public YouTube statement video + government ID + a selfie for
 *   the same AI liveness heuristic. Always queued for manual review — see
 *   the "can this be done free?" note below.
 * Tier 3: manual, bank-grade physical KYC. This tier is inherently a human
 *   process (someone has to physically verify the applicant) — the API here
 *   only records the request and lets the applicant choose whether to reuse
 *   their Tier 1 address or supply an updated one; an admin/mod schedules and
 *   completes the physical check out-of-band and marks it approved/rejected.
 *
 * ON "CAN THIS BE DONE FOR FREE":
 *   Paystack BVN validation and the DeepSeek/Gemini AI calls used here are
 *   the platform's existing paid-but-already-budgeted providers — no new
 *   vendor is introduced. What is NOT free, and NOT implemented here, is a
 *   certified biometric liveness/anti-spoof SDK (Onfido, Smile Identity, AWS
 *   Rekognition Liveness, etc) — those charge per check. Instead this module
 *   implements a *heuristic* liveness signal: an AI vision pass over a selfie
 *   image (lib/kyc/geminiVision.ts) that flags obvious spoofing (photo-of-a-
 *   photo, screen glare, stock imagery) but is explicitly NOT a certified
 *   liveness product. Every AI-touched submission can be, and low-confidence
 *   ones always are, escalated to a human moderator — see
 *   `finalizeAiReview` below. If the business later wants certified liveness,
 *   swap the `analyzeSelfieLiveness` call for a real vendor SDK; every other
 *   piece of this flow (storage, review queue, notifications, tier gating)
 *   stays the same.
 */

import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import type { TransactionClient } from "@/lib/db/interface";
import { loadManifest } from "@/lib/manifest";
import { checkAndDebit, creditCoins } from "@/lib/economy/coins";
import { insertNotification } from "@/lib/notifications/insert";
import { encryptField, decryptField } from "@/lib/security/fieldEncryption";
import { badRequest, conflict, notFound } from "@/lib/api/errors";
import { compareNames } from "@/lib/kyc/aiNameMatch";
import { analyzeDocument } from "@/lib/kyc/geminiVision";
import { storage } from "@/lib/storage";
import { createCustomer, validateCustomerIdentity } from "@/lib/payments/paystack";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DocumentRef {
  id: string;
  docType: string;
}

export interface SubmitTier1NigeriaInput {
  bvn: string;
  accountNumber: string;
  bankCode: string;
  firstName: string;
  lastName: string;
  documentIds: string[]; // uploaded govt_id_front / nin_slip document ids
}

export interface SubmitTier1InternationalInput {
  citizenshipCountry: string; // ISO-3166-1 alpha-2, != "NG"
  idType: string;
  idNumber: string;
  submittedFullName: string;
  documentIds: string[]; // govt_id_front(+back), proof_of_address, selfie
}

export interface SubmitTier2Input {
  videoUrl: string; // YouTube URL
  documentIds: string[]; // govt_id_front(+back), selfie (liveness heuristic)
}

export interface SubmitTier3Input {
  reusePreviousAddress: boolean;
  updatedAddress?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isYouTubeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return /(^|\.)youtube\.com$/.test(u.hostname) || u.hostname === "youtu.be";
  } catch {
    return false;
  }
}

async function getAccountType(userId: string): Promise<"individual" | "business"> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM business_accounts WHERE user_id = $1 LIMIT 1`,
    [userId]
  );
  return rows[0] ? "business" : "individual";
}

async function assertNoActiveSubmission(userId: string, tier: number): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM kyc_submissions
     WHERE user_id = $1 AND tier = $2 AND status IN ('pending', 'ai_review', 'manual_review')
     LIMIT 1`,
    [userId, tier]
  );
  if (rows[0]) throw conflict("You already have a Tier " + tier + " verification in progress.", "KYC_ALREADY_PENDING");
}

async function getApprovedTierCount(userId: string, tier: number): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM kyc_submissions WHERE user_id = $1 AND tier = $2 AND status = 'approved' LIMIT 1`,
    [userId, tier]
  );
  return !!rows[0];
}

async function chargeCredits(userId: string, submissionId: string, costCredits: number): Promise<void> {
  if (costCredits <= 0) return;
  try {
    const entry = await checkAndDebit(
      userId,
      costCredits,
      "kyc_verification_fee",
      submissionId,
      "KYC verification fee",
      { submissionId }
    );
    await db.query(
      `UPDATE kyc_submissions SET credit_ledger_reference_id = $1, updated_at = NOW() WHERE id = $2`,
      [entry.id, submissionId]
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "INSUFFICIENT_BALANCE") {
      throw badRequest(`This verification costs ${costCredits} credits. Top up your balance and try again.`, "INSUFFICIENT_CREDITS");
    }
    throw err;
  }
}

async function refundCredits(userId: string, submissionId: string, costCredits: number): Promise<void> {
  if (costCredits <= 0) return;
  await creditCoins(userId, costCredits, "refund", submissionId, "KYC submission cancelled/rejected — fee refunded").catch((err) => {
    logger.error({ err: err instanceof Error ? err.message : String(err), submissionId }, "[kyc] Credit refund failed");
  });
}

async function attachDocuments(tx: TransactionClient, submissionId: string, userId: string, documentIds: string[]): Promise<void> {
  if (documentIds.length === 0) return;
  await tx.query(
    `UPDATE kyc_documents SET submission_id = $1 WHERE id = ANY($2::uuid[]) AND user_id = $3 AND submission_id IS NULL`,
    [submissionId, documentIds, userId]
  );
}

async function alertAdmins(type: string, message: string, metadata: Record<string, unknown>): Promise<void> {
  await db.query(
    `INSERT INTO system_alerts (type, severity, message, metadata, created_at)
     VALUES ($1, 'low', $2, $3::jsonb, NOW())`,
    [type, message, JSON.stringify(metadata)]
  ).catch(() => {});
}

async function notifyUser(userId: string, type: string, title: string, body: string, metadata?: Record<string, unknown>): Promise<void> {
  await insertNotification(db, userId, type, title, body, metadata).catch(() => {});
}

/**
 * Runs an INSERT INTO kyc_submissions and converts a unique-violation on
 * kyc_submissions_one_active_per_tier_idx (23505) into the same
 * KYC_ALREADY_PENDING conflict assertNoActiveSubmission's pre-check returns,
 * instead of letting a raw 500 bubble up on a double-submit race.
 */
async function runInsertOrActiveConflict<T>(tier: number, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if ((err as { code?: string })?.code === "23505") {
      throw conflict("You already have a Tier " + tier + " verification in progress.", "KYC_ALREADY_PENDING");
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Tier 1 — Nigeria (BVN via Paystack)
// ---------------------------------------------------------------------------

export async function submitTier1Nigeria(userId: string, input: SubmitTier1NigeriaInput): Promise<{ submissionId: string }> {
  const manifest = await loadManifest();
  if (!manifest.features.kyc) throw badRequest("KYC verification is currently unavailable.", "KYC_DISABLED");
  await assertNoActiveSubmission(userId, 1);

  const { rows: userRows } = await db.query<{ email: string; display_name: string }>(
    `SELECT email, display_name FROM users WHERE id = $1`,
    [userId]
  );
  const user = userRows[0];
  if (!user?.email) throw badRequest("A verified email is required before starting KYC.", "EMAIL_REQUIRED");

  const accountType = await getAccountType(userId);
  const submissionId = randomUUID();

  await runInsertOrActiveConflict(1, () =>
    db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO kyc_submissions
           (id, user_id, tier, status, account_type, citizenship_country, review_mode,
            bvn_last4, id_type, submitted_full_name, credits_charged, submitted_at)
         VALUES ($1, $2, 1, 'pending', $3, 'NG', $4, $5, $6, $7, $8, NOW())`,
        [
          submissionId, userId, accountType, manifest.kyc.tier1ReviewMode,
          input.bvn.slice(-4), "bvn_slip", `${input.firstName} ${input.lastName}`.trim(),
          manifest.kyc.costCredits,
        ]
      );
      await attachDocuments(tx, submissionId, userId, input.documentIds);
    })
  );

  try {
    await chargeCredits(userId, submissionId, manifest.kyc.costCredits);
  } catch (err) {
    await db.query(`DELETE FROM kyc_submissions WHERE id = $1`, [submissionId]);
    throw err;
  }

  try {
    const customer = await createCustomer(user.email, input.firstName, input.lastName);
    await db.query(
      `UPDATE kyc_submissions SET paystack_customer_code = $1, paystack_verification_status = 'pending', updated_at = NOW() WHERE id = $2`,
      [customer.customer_code, submissionId]
    );
    await validateCustomerIdentity(customer.customer_code, {
      country: "NG",
      type: "bank_account",
      accountNumber: input.accountNumber,
      bankCode: input.bankCode,
      bvn: input.bvn,
      firstName: input.firstName,
      lastName: input.lastName,
    });
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err), submissionId }, "[kyc] Paystack BVN validation request failed");
    await db.query(
      `UPDATE kyc_submissions SET status = 'manual_review', paystack_verification_status = 'failed', ai_notes = 'Paystack BVN request failed — routed to manual review.', updated_at = NOW() WHERE id = $1`,
      [submissionId]
    );
  }

  await notifyUser(userId, "kyc_submitted", "KYC submitted", "Your Tier 1 verification is under review. This can take a few days.", { submissionId, tier: 1 });
  return { submissionId };
}

/** Called by the Paystack webhook handler once BVN validation resolves. */
export async function handleBvnIdentificationResult(params: {
  paystackCustomerCode: string;
  success: boolean;
  bvnLast4: string | null;
  failureReason: string | null;
}): Promise<void> {
  const { rows } = await db.query<{ id: string; user_id: string; submitted_full_name: string | null; review_mode: string }>(
    `SELECT id, user_id, submitted_full_name, review_mode FROM kyc_submissions
     WHERE paystack_customer_code = $1 AND status IN ('pending', 'ai_review')
     ORDER BY submitted_at DESC LIMIT 1`,
    [params.paystackCustomerCode]
  );
  const submission = rows[0];
  if (!submission) {
    logger.warn({ customerCode: params.paystackCustomerCode }, "[kyc] BVN webhook for unknown/already-resolved submission");
    return;
  }

  await db.query(
    `UPDATE kyc_submissions SET paystack_verification_status = $1, bvn_last4 = COALESCE($2, bvn_last4), updated_at = NOW() WHERE id = $3`,
    [params.success ? "success" : "failed", params.bvnLast4, submission.id]
  );

  if (!params.success) {
    await rejectSubmission(submission.id, null, params.failureReason ?? "BVN identity validation failed.");
    return;
  }

  // Paystack confirmed the BVN/bank-account owner matches the submitted name.
  // Layer the AI ID-document cross-check on top before finalizing.
  await runTier1AiReview(submission.id);
}

// ---------------------------------------------------------------------------
// Tier 1 — non-Nigeria
// ---------------------------------------------------------------------------

export async function submitTier1International(userId: string, input: SubmitTier1InternationalInput): Promise<{ submissionId: string }> {
  const manifest = await loadManifest();
  if (!manifest.features.kyc) throw badRequest("KYC verification is currently unavailable.", "KYC_DISABLED");
  // Defense-in-depth: the route boundary (app/api/kyc/tier1/route.ts) already
  // validates and uppercases citizenshipCountry via a Zod refine+transform,
  // but callers of this service function aren't guaranteed to go through it.
  if (input.citizenshipCountry === "NG") {
    throw badRequest("Nigerian citizens must use the BVN verification flow.", "USE_NIGERIA_FLOW");
  }
  await assertNoActiveSubmission(userId, 1);
  if (input.documentIds.length === 0) throw badRequest("Upload your government ID and proof of address first.", "DOCUMENTS_REQUIRED");

  const accountType = await getAccountType(userId);
  const submissionId = randomUUID();
  const initialStatus = manifest.kyc.tier1ReviewMode === "ai" ? "ai_review" : "manual_review";

  await runInsertOrActiveConflict(1, () =>
    db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO kyc_submissions
           (id, user_id, tier, status, account_type, citizenship_country, review_mode,
            id_type, id_number_encrypted, submitted_full_name, credits_charged, submitted_at)
         VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
        [
          submissionId, userId, initialStatus, accountType,
          input.citizenshipCountry, manifest.kyc.tier1ReviewMode,
          input.idType, encryptField(input.idNumber), input.submittedFullName,
          manifest.kyc.costCredits,
        ]
      );
      await attachDocuments(tx, submissionId, userId, input.documentIds);
    })
  );

  try {
    await chargeCredits(userId, submissionId, manifest.kyc.costCredits);
  } catch (err) {
    await db.query(`DELETE FROM kyc_submissions WHERE id = $1`, [submissionId]);
    throw err;
  }

  await notifyUser(userId, "kyc_submitted", "KYC submitted", "Your Tier 1 verification is under review. This can take a few days.", { submissionId, tier: 1 });

  if (initialStatus === "ai_review") {
    // Fire-and-forget — the submitter already got the "under review" notice above.
    runTier1AiReview(submissionId).catch((err) =>
      logger.error({ err: err instanceof Error ? err.message : String(err), submissionId }, "[kyc] AI review failed")
    );
  } else {
    await alertAdmins("kyc_submission", `New Tier 1 KYC submission awaiting manual review`, { submissionId, userId });
  }

  return { submissionId };
}

// ---------------------------------------------------------------------------
// AI review (Tier 1)
// ---------------------------------------------------------------------------

async function fetchDocumentBuffer(storageKey: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  try {
    const url = await storage.getSignedUrl(storageKey, 300);
    const res = await fetch(url);
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    return { buffer, contentType: res.headers.get("content-type") ?? "image/jpeg" };
  } catch {
    return null;
  }
}

/**
 * Runs the AI pass for a Tier 1 submission: OCRs the ID document, compares
 * the extracted name against the submitted name (and, for Nigeria, treats
 * the already-confirmed Paystack BVN match as a second name-match signal),
 * and finalizes (auto-approve / escalate / reject) based on the manifest's
 * confidence thresholds.
 */
export async function runTier1AiReview(submissionId: string): Promise<void> {
  const { rows } = await db.query<{
    id: string; user_id: string; submitted_full_name: string | null;
    citizenship_country: string | null; paystack_verification_status: string | null;
  }>(
    `SELECT id, user_id, submitted_full_name, citizenship_country, paystack_verification_status
     FROM kyc_submissions WHERE id = $1`,
    [submissionId]
  );
  const submission = rows[0];
  if (!submission) return;

  const { rows: docs } = await db.query<{ id: string; doc_type: string; storage_key: string }>(
    `SELECT id, doc_type, storage_key FROM kyc_documents WHERE submission_id = $1`,
    [submissionId]
  );
  const idDoc = docs.find((d) => d.doc_type === "govt_id_front" || d.doc_type === "nin_slip");

  let documentConfidence = 0;
  let nameMatchScore = submission.paystack_verification_status === "success" ? 1 : 0;
  const notes: string[] = [];
  if (submission.paystack_verification_status === "success") notes.push("Paystack confirmed BVN/bank-account name match.");

  if (idDoc) {
    const file = await fetchDocumentBuffer(idDoc.storage_key);
    if (file) {
      const analysis = await analyzeDocument(file.buffer, file.contentType, `Citizenship: ${submission.citizenship_country ?? "unknown"}`);
      if (analysis) {
        documentConfidence = analysis.tamperingSuspected ? Math.min(analysis.confidence, 0.3) : analysis.confidence;
        notes.push(analysis.notes);
        if (analysis.extractedName && submission.submitted_full_name) {
          const match = await compareNames(analysis.extractedName, submission.submitted_full_name);
          // Keep the stronger of the two independent name-match signals — a
          // BVN-confirmed match (1.0) shouldn't be dragged down by a shakier
          // OCR read of the physical document, but a strong ID match still
          // counts when there's no BVN signal (non-Nigeria submissions).
          nameMatchScore = Math.max(nameMatchScore, match.score);
          notes.push(`ID name match: ${match.reasoning}`);
        }
      } else {
        notes.push("AI document analysis unavailable — escalating to manual review.");
      }
    } else {
      notes.push("Could not fetch document for AI analysis — escalating to manual review.");
    }
  } else if (submission.paystack_verification_status !== "success") {
    notes.push("No ID document on file for AI review.");
  }

  const combined = idDoc ? (nameMatchScore + documentConfidence) / 2 : nameMatchScore;
  await finalizeAiReview(submission.id, submission.user_id, combined, nameMatchScore, documentConfidence, notes.join(" "));
}

async function finalizeAiReview(
  submissionId: string,
  userId: string,
  combinedScore: number,
  nameMatchScore: number,
  documentConfidence: number,
  notes: string
): Promise<void> {
  const manifest = await loadManifest();
  await db.query(
    `UPDATE kyc_submissions
     SET ai_name_match_score = $1, ai_document_confidence = $2, ai_provider = 'deepseek/gemini', ai_notes = $3, updated_at = NOW()
     WHERE id = $4`,
    [nameMatchScore, documentConfidence, notes, submissionId]
  );

  if (combinedScore >= manifest.kyc.aiAutoApproveThreshold) {
    await approveSubmission(submissionId, null);
  } else if (combinedScore < manifest.kyc.aiEscalateBelowThreshold) {
    await db.query(`UPDATE kyc_submissions SET status = 'manual_review', ai_escalated = true, updated_at = NOW() WHERE id = $1`, [submissionId]);
    await notifyUser(userId, "kyc_escalated", "KYC under review", "We need a bit more time to review your verification. This may take a few days.", { submissionId });
    await alertAdmins("kyc_ai_escalation", "AI-reviewed KYC submission escalated to manual review", { submissionId, combinedScore });
  } else {
    // Mid-confidence band: not confident enough to auto-approve, not low enough to
    // treat as likely-fraudulent — still a human call, but not flagged as an escalation.
    await db.query(`UPDATE kyc_submissions SET status = 'manual_review', updated_at = NOW() WHERE id = $1`, [submissionId]);
    await alertAdmins("kyc_submission", "KYC submission awaiting manual review", { submissionId, combinedScore });
  }
}

// ---------------------------------------------------------------------------
// Tier 2 — video statement + ID + liveness heuristic
// ---------------------------------------------------------------------------

export async function submitTier2(userId: string, input: SubmitTier2Input): Promise<{ submissionId: string }> {
  const manifest = await loadManifest();
  if (!manifest.features.kyc) throw badRequest("KYC verification is currently unavailable.", "KYC_DISABLED");
  if (!(await getApprovedTierCount(userId, 1))) throw badRequest("Complete Tier 1 verification first.", "TIER1_REQUIRED");
  if (!isYouTubeUrl(input.videoUrl)) throw badRequest("Video must be a public YouTube URL.", "INVALID_VIDEO_URL");
  await assertNoActiveSubmission(userId, 2);
  if (input.documentIds.length === 0) throw badRequest("Upload your government ID and a selfie.", "DOCUMENTS_REQUIRED");

  const accountType = await getAccountType(userId);
  const submissionId = randomUUID();

  await runInsertOrActiveConflict(2, () =>
    db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO kyc_submissions
           (id, user_id, tier, status, account_type, review_mode, video_url, liveness_status, submitted_at)
         VALUES ($1, $2, 2, 'manual_review', $3, 'manual', $4, 'pending', NOW())`,
        [submissionId, userId, accountType, input.videoUrl]
      );
      await attachDocuments(tx, submissionId, userId, input.documentIds);
    })
  );

  // Tier 2 has no credit fee of its own — the Tier 1 fee already covered the
  // account's verification; Tier 2/3 are escalations of an already-paid identity.
  await notifyUser(userId, "kyc_submitted", "Tier 2 KYC submitted", "Your video statement and ID are under review. This may take a few days.", { submissionId, tier: 2 });

  // Best-effort AI liveness heuristic on the selfie — informational only, this
  // tier is always human-reviewed regardless of the result (see module docblock).
  const selfieDoc = (await db.query<{ storage_key: string }>(
    `SELECT storage_key FROM kyc_documents WHERE submission_id = $1 AND doc_type = 'selfie' LIMIT 1`,
    [submissionId]
  )).rows[0];
  if (selfieDoc) {
    const file = await fetchDocumentBuffer(selfieDoc.storage_key);
    if (file) {
      const analysis = await analyzeDocument(
        file.buffer, file.contentType,
        "This should be a live selfie photo for a liveness/anti-spoof check — flag tamperingSuspected if it looks like a photo of a photo, a screen, or stock imagery."
      );
      if (analysis) {
        await db.query(
          `UPDATE kyc_submissions SET liveness_status = 'manual_review', liveness_score = $1, liveness_notes = $2, updated_at = NOW() WHERE id = $3`,
          [analysis.tamperingSuspected ? Math.min(analysis.confidence, 0.3) : analysis.confidence, analysis.notes, submissionId]
        );
      }
    }
  }

  await alertAdmins("kyc_submission", "New Tier 2 KYC submission awaiting manual review", { submissionId, userId });
  return { submissionId };
}

// ---------------------------------------------------------------------------
// Tier 3 — manual bank-grade physical KYC
// ---------------------------------------------------------------------------

export async function submitTier3(userId: string, input: SubmitTier3Input): Promise<{ submissionId: string }> {
  const manifest = await loadManifest();
  if (!manifest.features.kyc) throw badRequest("KYC verification is currently unavailable.", "KYC_DISABLED");
  if (!(await getApprovedTierCount(userId, 2))) throw badRequest("Complete Tier 2 verification first.", "TIER2_REQUIRED");
  await assertNoActiveSubmission(userId, 3);
  if (!input.reusePreviousAddress && !input.updatedAddress) {
    throw badRequest("Provide an updated address, or choose to reuse your previous address.", "ADDRESS_REQUIRED");
  }

  const accountType = await getAccountType(userId);
  const submissionId = randomUUID();

  await runInsertOrActiveConflict(3, () =>
    db.query(
      `INSERT INTO kyc_submissions
         (id, user_id, tier, status, account_type, review_mode, reuse_previous_address, updated_address, submitted_at)
       VALUES ($1, $2, 3, 'manual_review', $3, 'manual', $4, $5::jsonb, NOW())`,
      [submissionId, userId, accountType, input.reusePreviousAddress, JSON.stringify(input.updatedAddress ?? null)]
    )
  );

  await notifyUser(
    userId, "kyc_submitted", "Tier 3 KYC requested",
    "Your bank-grade physical verification has been requested. An admin will contact you to schedule an in-person/physical check.",
    { submissionId, tier: 3 }
  );
  await alertAdmins("kyc_submission", "New Tier 3 (physical) KYC request — needs scheduling", { submissionId, userId });
  return { submissionId };
}

/**
 * Admin/mod schedules (or reschedules/clears) the in-person physical check
 * for a Tier 3 submission. Only valid while the submission is still
 * in-flight — once approved/rejected/cancelled the record is historical.
 */
export async function scheduleTier3PhysicalCheck(
  submissionId: string,
  scheduledAt: string | null,
  notes: string | null
): Promise<void> {
  const { rows } = await db.query<{ tier: number; status: string }>(
    `SELECT tier, status FROM kyc_submissions WHERE id = $1`,
    [submissionId]
  );
  const submission = rows[0];
  if (!submission) throw notFound("KYC submission not found");
  if (submission.tier !== 3) throw badRequest("Physical-check scheduling only applies to Tier 3 submissions.", "NOT_TIER3");
  if (!["pending", "ai_review", "manual_review"].includes(submission.status)) {
    throw badRequest("This submission has already been finalized.", "KYC_NOT_SCHEDULABLE");
  }

  await db.query(
    `UPDATE kyc_submissions
     SET physical_verification_scheduled_at = $1, physical_verification_notes = $2, updated_at = NOW()
     WHERE id = $3`,
    [scheduledAt, notes, submissionId]
  );
}

// ---------------------------------------------------------------------------
// Approve / reject (shared by AI finalize + admin review routes)
// ---------------------------------------------------------------------------

export async function approveSubmission(submissionId: string, reviewedBy: string | null): Promise<void> {
  const { rows } = await db.query<{ user_id: string; tier: number }>(
    `SELECT user_id, tier FROM kyc_submissions WHERE id = $1`,
    [submissionId]
  );
  const submission = rows[0];
  if (!submission) throw notFound("KYC submission not found");

  const manifest = await loadManifest();

  await db.transaction(async (tx) => {
    await tx.query(
      `UPDATE kyc_submissions SET status = 'approved', reviewed_by = $1, reviewed_at = NOW(), updated_at = NOW() WHERE id = $2`,
      [reviewedBy, submissionId]
    );
    await tx.query(
      `UPDATE users SET kyc_tier = GREATEST(kyc_tier, $1), updated_at = NOW() WHERE id = $2`,
      [submission.tier, submission.user_id]
    );
    if (submission.tier >= manifest.kyc.badgeMinTier) {
      await tx.query(`UPDATE users SET is_verified = true WHERE id = $1`, [submission.user_id]);
    }
  });

  await notifyUser(
    submission.user_id, "kyc_approved", `Tier ${submission.tier} verification approved`,
    submission.tier >= manifest.kyc.badgeMinTier
      ? "You're verified! Your blue checkmark is now live on your profile."
      : "Your verification was approved.",
    { submissionId, tier: submission.tier }
  );
}

export async function rejectSubmission(submissionId: string, reviewedBy: string | null, reason: string): Promise<void> {
  const { rows } = await db.query<{ user_id: string; tier: number; credits_charged: number }>(
    `SELECT user_id, tier, credits_charged FROM kyc_submissions WHERE id = $1`,
    [submissionId]
  );
  const submission = rows[0];
  if (!submission) throw notFound("KYC submission not found");

  await db.query(
    `UPDATE kyc_submissions SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW(), rejection_reason = $2, updated_at = NOW() WHERE id = $3`,
    [reviewedBy, reason, submissionId]
  );

  if (submission.credits_charged > 0) {
    await refundCredits(submission.user_id, submissionId, submission.credits_charged);
  }

  await notifyUser(
    submission.user_id, "kyc_rejected", `Tier ${submission.tier} verification rejected`,
    reason || "Your verification could not be approved. You may resubmit.",
    { submissionId, tier: submission.tier, reason }
  );
}

export async function cancelSubmission(userId: string, submissionId: string): Promise<void> {
  const { rows } = await db.query<{ user_id: string; status: string; credits_charged: number }>(
    `SELECT user_id, status, credits_charged FROM kyc_submissions WHERE id = $1`,
    [submissionId]
  );
  const submission = rows[0];
  if (!submission || submission.user_id !== userId) throw notFound("KYC submission not found");
  if (!["pending", "ai_review", "manual_review"].includes(submission.status)) {
    throw badRequest("This submission can no longer be cancelled.", "KYC_NOT_CANCELLABLE");
  }

  await db.query(`UPDATE kyc_submissions SET status = 'cancelled', updated_at = NOW() WHERE id = $1`, [submissionId]);
  if (submission.credits_charged > 0) {
    await refundCredits(userId, submissionId, submission.credits_charged);
  }
}

/** Decrypts an encrypted PII field for display to an authorized admin/mod. */
export function decryptKycField(ciphertext: string | null): string | null {
  if (!ciphertext) return null;
  return decryptField(ciphertext);
}
