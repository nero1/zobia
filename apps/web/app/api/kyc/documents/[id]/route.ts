export const dynamic = "force-dynamic";

/**
 * GET /api/kyc/documents/[id]
 *   Returns a short-lived signed URL for a KYC document. Only the
 *   document's owner, or an admin/mod (for review), may fetch it.
 *
 * DELETE /api/kyc/documents/[id]
 *   Removes an unattached document the owner uploaded by mistake before
 *   submitting (submission_id IS NULL only — once attached to a submission
 *   it's part of the review record and can't be deleted by the user).
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { isAdminOrModerator } from "@/lib/auth/roles";
import { storage } from "@/lib/storage";

export const GET = withAuth<{ id: string }>(
  async (_req: NextRequest, { auth, params }) => {
    try {
      const userId = auth.user.sub;
      await enforceRateLimit(userId, "user", RATE_LIMITS.apiRead);

      const { rows } = await db.query<{ user_id: string; storage_key: string }>(
        `SELECT user_id, storage_key FROM kyc_documents WHERE id = $1`,
        [params.id]
      );
      const doc = rows[0];
      if (!doc) throw notFound("Document not found");

      if (doc.user_id !== userId && !(await isAdminOrModerator(userId))) {
        throw forbidden("You do not have access to this document.");
      }

      const url = await storage.getSignedUrl(doc.storage_key, 300);
      return NextResponse.json({ success: true, data: { url }, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);

export const DELETE = withAuth<{ id: string }>(
  async (_req: NextRequest, { auth, params }) => {
    try {
      const userId = auth.user.sub;
      await enforceRateLimit(userId, "user", RATE_LIMITS.apiWrite);

      const { rows } = await db.query<{ user_id: string; storage_key: string; submission_id: string | null }>(
        `SELECT user_id, storage_key, submission_id FROM kyc_documents WHERE id = $1`,
        [params.id]
      );
      const doc = rows[0];
      if (!doc || doc.user_id !== userId) throw notFound("Document not found");
      if (doc.submission_id !== null) throw badRequest("This document is already part of a submission and cannot be deleted.", "DOC_ATTACHED");

      await db.query(`DELETE FROM kyc_documents WHERE id = $1`, [params.id]);
      await storage.delete(doc.storage_key, { ignoreNotFound: true }).catch(() => {});

      return NextResponse.json({ success: true, data: { deleted: true }, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
