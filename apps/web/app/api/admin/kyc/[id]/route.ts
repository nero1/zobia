export const dynamic = "force-dynamic";

/**
 * GET /api/admin/kyc/[id]
 *
 * Full detail for a single KYC submission review: decrypted PII fields,
 * AI scores/notes, and short-lived signed URLs for every attached document.
 * Admin or moderator.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withModeratorOrAdminAuth } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { storage } from "@/lib/storage";
import { decryptKycField } from "@/lib/kyc/service";

interface SubmissionDetailRow {
  id: string;
  user_id: string;
  username: string;
  display_name: string;
  email: string;
  tier: number;
  status: string;
  account_type: string;
  citizenship_country: string | null;
  review_mode: string;
  bvn_last4: string | null;
  paystack_verification_status: string | null;
  id_type: string | null;
  id_number_encrypted: string | null;
  submitted_full_name: string | null;
  ai_name_match_score: string | null;
  ai_document_confidence: string | null;
  ai_provider: string | null;
  ai_notes: string | null;
  ai_escalated: boolean;
  video_url: string | null;
  liveness_status: string | null;
  liveness_score: string | null;
  liveness_notes: string | null;
  reuse_previous_address: boolean | null;
  updated_address: unknown;
  physical_verification_scheduled_at: string | null;
  physical_verification_notes: string | null;
  credits_charged: number;
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  submitted_at: string;
}

export const GET = withModeratorOrAdminAuth<{ id: string }>(
  async (_req: NextRequest, { auth, params }) => {
    try {
      await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

      const { rows } = await db.query<SubmissionDetailRow>(
        `SELECT k.*, u.username, u.display_name, u.email
         FROM kyc_submissions k JOIN users u ON u.id = k.user_id
         WHERE k.id = $1`,
        [params.id]
      );
      const submission = rows[0];
      if (!submission) throw notFound("KYC submission not found");

      const { rows: docs } = await db.query<{ id: string; doc_type: string; storage_key: string; created_at: string }>(
        `SELECT id, doc_type, storage_key, created_at FROM kyc_documents WHERE submission_id = $1 ORDER BY created_at ASC`,
        [params.id]
      );

      const documents = await Promise.all(
        docs.map(async (d) => ({
          id: d.id,
          docType: d.doc_type,
          createdAt: d.created_at,
          signedUrl: await storage.getSignedUrl(d.storage_key, 600).catch(() => null),
        }))
      );

      return NextResponse.json({
        success: true,
        data: {
          ...submission,
          id_number: decryptKycField(submission.id_number_encrypted),
          id_number_encrypted: undefined,
          documents,
        },
        error: null,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
