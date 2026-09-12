export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/admin/data-management/users/import
 *
 * Accepts an uploaded account file — NDJSON as produced by
 * ../export-accounts/route.ts, or a plain JSON array — normalizes it to
 * NDJSON, and creates a tracked `admin_data_import_jobs` row. Actual row
 * processing happens later via repeated POSTs to
 * ../import/[jobId]/route.ts (bounded batches — see that route for why).
 *
 * Accepts either multipart/form-data (a `file` field) or a raw text body
 * (Content-Type: application/x-ndjson or application/json).
 *
 * Raw upload is capped at ~50MB since it is stored in a text column
 * (admin_data_import_jobs.raw_data) — larger exports should be split.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { writeAuditLog } from "@/lib/audit/auditLog";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // ~50MB

/** Normalize an uploaded body (NDJSON or JSON array) into NDJSON text. */
function normalizeToNdjson(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw badRequest("File is not valid JSON.");
    }
    if (!Array.isArray(parsed)) throw badRequest("Expected a JSON array of user records.");
    return parsed.map((obj) => JSON.stringify(obj)).join("\n");
  }
  return trimmed;
}

function countNonEmptyLines(ndjson: string): number {
  if (!ndjson) return 0;
  return ndjson.split("\n").filter((l) => l.trim().length > 0).length;
}

export const POST = withAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const contentType = req.headers.get("content-type") ?? "";
    let raw: string;
    let filename: string | null = null;
    let dedupeStrategy: "skip" | "overwrite" = "skip";

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) throw badRequest("Missing `file` field in form data.");
      if (file.size > MAX_UPLOAD_BYTES) {
        throw badRequest(`File too large (max ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB).`);
      }
      filename = file.name;
      raw = await file.text();
      const strategyField = form.get("dedupeStrategy");
      if (strategyField === "overwrite") dedupeStrategy = "overwrite";
    } else {
      raw = await req.text();
      if (Buffer.byteLength(raw, "utf8") > MAX_UPLOAD_BYTES) {
        throw badRequest(`Upload too large (max ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB).`);
      }
      const strategyHeader = req.headers.get("x-dedupe-strategy");
      if (strategyHeader === "overwrite") dedupeStrategy = "overwrite";
    }

    const ndjson = normalizeToNdjson(raw);
    const totalRows = countNonEmptyLines(ndjson);
    if (totalRows === 0) throw badRequest("Uploaded file contains no rows.");

    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO admin_data_import_jobs
         (admin_id, filename, format, dedupe_strategy, raw_data, total_rows, status)
       VALUES ($1, $2, 'ndjson', $3, $4, $5, 'pending')
       RETURNING id`,
      [auth.user.sub, filename, dedupeStrategy, ndjson, totalRows]
    );

    const jobId = rows[0].id;

    writeAuditLog({
      actorId: auth.user.sub,
      action: "admin_import_users_job_created",
      targetId: jobId,
      metadata: { filename, dedupeStrategy, totalRows },
    });

    return NextResponse.json({ jobId, totalRows }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
