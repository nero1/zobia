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
import {eq,sql} from "drizzle-orm";
import {queueObjectDeletion} from "@/lib/storage/deletionQueue";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { requireFeatureEnabled } from "@/lib/manifest";
import { storage } from "@/lib/storage";

const ALLOWED_DOC_TYPES = new Set([
  "govt_id_front", "govt_id_back", "proof_of_address", "selfie", "nin_slip", "liveness_selfie",
]);
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const MAX_SIZE_BYTES = 4 * 1024 * 1024; // Leaves multipart overhead below the Vercel request cap.

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
    if (file.size > MAX_SIZE_BYTES) throw badRequest("File must be under 4MB.", "FILE_TOO_LARGE");

    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = file.type === "application/pdf" ? "pdf" : file.type.split("/")[1];
    const docId = randomUUID();
    const key = `kyc/${userId}/${docId}.${ext}`;

    const orm=await getDb();
    await orm.transaction(async tx=>{
      await tx.execute(sql`SELECT id FROM users WHERE id=${userId} FOR UPDATE`);
      const count=await tx.execute<{n:number}>(sql`SELECT count(*)::int n FROM kyc_documents WHERE user_id=${userId} AND submission_id IS NULL`);
      if(count.rows[0].n>=10)throw badRequest("Remove an unused document before uploading another.","DOCUMENT_QUOTA");
      await tx.insert(schema.kycDocuments).values({id:docId,submissionId:null,userId,docType,storageKey:key,contentType:file.type,sizeBytes:file.size,uploadState:'uploading'});
      // Persist cleanup before contacting storage, covering crashes and ambiguous uploads.
      await queueObjectDeletion(tx,key,86400);
    });
    try {
      await storage.upload(key,buffer,{contentType:file.type,isPublic:false,maxSizeBytes:MAX_SIZE_BYTES,metadata:{userId,docType}});
      await orm.transaction(async tx=>{
        const updated=await tx.update(schema.kycDocuments).set({uploadState:'ready'}).where(eq(schema.kycDocuments.id,docId)).returning({id:schema.kycDocuments.id});
        if(!updated.length)throw new Error('Upload reservation expired');
        await tx.execute(sql`DELETE FROM object_deletion_tasks WHERE storage_key=${key}`);
      });
    }catch(error){
      await orm.transaction(async tx=>{
        await tx.delete(schema.kycDocuments).where(eq(schema.kycDocuments.id,docId));
        await queueObjectDeletion(tx,key);
      });
      throw error;
    }

    return NextResponse.json({ success: true, data: { id: docId, docType }, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
