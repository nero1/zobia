export const dynamic = "force-dynamic";

/**
 * POST /api/kyc/documents
 *
 * Upload a single KYC document (govt ID, proof of address, selfie, NIN
 * slip). Stored privately in object storage — never publicly readable, only
 * via a short-lived signed URL served through GET /api/kyc/documents/[id].
 *
 * The uploaded row starts detached (submission_id = NULL); the tier1/2/3
 * submission routes attach a batch of document ids to the new submission
 * row in the same transaction that creates it (see lib/kyc/service.ts).
 *
 * multipart/form-data body: { file: File, docType: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { requireFeatureEnabled } from "@/lib/manifest";
import { storage } from "@/lib/storage";

const ALLOWED_DOC_TYPES = new Set([
  "govt_id_front", "govt_id_back", "proof_of_address", "selfie", "nin_slip", "liveness_selfie",
]);
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MiB

export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await requireFeatureEnabled("kyc");
    const userId = auth.user.sub;
    await enforceRateLimit(userId, "user", RATE_LIMITS.apiWrite);

    const form = await req.formData();
    const file = form.get("file");
    const docType = form.get("docType");

    if (!(file instanceof File)) throw badRequest("A file is required.", "FILE_REQUIRED");
    if (typeof docType !== "string" || !ALLOWED_DOC_TYPES.has(docType)) {
      throw badRequest("Invalid document type.", "INVALID_DOC_TYPE");
    }
    if (!ALLOWED_MIME.has(file.type)) throw badRequest("Only JPEG, PNG, WebP or PDF files are accepted.", "INVALID_FILE_TYPE");
    if (file.size > MAX_SIZE_BYTES) throw badRequest("File must be under 10MB.", "FILE_TOO_LARGE");

    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = file.type === "application/pdf" ? "pdf" : file.type.split("/")[1];
    const docId = randomUUID();
    const key = `kyc/${userId}/${docId}.${ext}`;

    const result = await storage.upload(key, buffer, {
      contentType: file.type,
      isPublic: false,
      maxSizeBytes: MAX_SIZE_BYTES,
      metadata: { userId, docType },
    });

    await db.query(
      `INSERT INTO kyc_documents (id, submission_id, user_id, doc_type, storage_key, content_type, size_bytes, created_at)
       VALUES ($1, NULL, $2, $3, $4, $5, $6, NOW())`,
      [docId, userId, docType, result.key, file.type, file.size]
    ).catch(async (err) => {
      // Roll back the upload if the DB insert fails, so we don't leak orphaned objects.
      await storage.delete(result.key, { ignoreNotFound: true }).catch(() => {});
      throw err;
    });

    return NextResponse.json({ success: true, data: { id: docId, docType }, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
