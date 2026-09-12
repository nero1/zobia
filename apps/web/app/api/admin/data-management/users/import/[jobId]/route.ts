export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET  /api/admin/data-management/users/import/:jobId — job status/progress.
 * POST /api/admin/data-management/users/import/:jobId — process the NEXT
 *   batch (500 rows) from the job's stored raw_data, starting at
 *   processed_rows. Never processes more than one batch per request — the
 *   client (web AND Android) is expected to call this repeatedly until
 *   status === 'completed'. This bounded-batch model exists because Vercel
 *   serverless functions have a hard duration limit; a single request
 *   processing millions of rows would time out.
 *
 * Dedupe (by email OR username OR id):
 *   - 'skip'      — leave the existing row untouched, count as skipped.
 *   - 'overwrite' — update the matched row's safe fields (never id/created_at,
 *                   never is_admin/password_hash/totp_secret — a security
 *                   guard against privilege escalation or credential
 *                   clobbering via a crafted import file).
 * Each batch runs inside one db.transaction.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError, notFound, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { writeAuditLog } from "@/lib/audit/auditLog";
import type { TransactionClient } from "@/lib/db/interface";

const BATCH_SIZE = 500;

interface ImportJobRow {
  id: string;
  admin_id: string;
  filename: string | null;
  dedupe_strategy: "skip" | "overwrite";
  raw_data: string;
  total_rows: number;
  processed_rows: number;
  imported_count: number;
  skipped_count: number;
  error_count: number;
  status: "pending" | "processing" | "completed" | "failed";
  errors: Array<{ line: number; message: string }>;
  created_at: string;
  updated_at: string;
}

function pick(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null) return row[k];
  }
  return undefined;
}

/** Find a unique username by appending a numeric suffix if the base is taken (mirrors the OAuth callback's pattern). */
async function uniqueUsername(tx: TransactionClient, base: string): Promise<string> {
  const safeBase = String(base).replace(/[^a-z0-9_]/gi, "").slice(0, 30).toLowerCase() || "user";
  const { rows } = await tx.query<{ username: string }>(
    `SELECT username FROM users WHERE username = $1 OR username ~ ('^' || $1 || '[0-9]+$')`,
    [safeBase]
  );
  const taken = new Set(rows.map((r) => r.username));
  if (!taken.has(safeBase)) return safeBase;
  for (let i = 2; i < 10_000; i++) {
    const candidate = `${safeBase.slice(0, 30 - String(i).length)}${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${safeBase.slice(0, 26)}${Math.random().toString(36).slice(2, 6)}`;
}

interface RowOutcome {
  status: "imported" | "skipped" | "error";
  message?: string;
}

async function processRow(
  tx: TransactionClient,
  rawLine: string,
  dedupeStrategy: "skip" | "overwrite"
): Promise<RowOutcome> {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawLine) as Record<string, unknown>;
  } catch {
    return { status: "error", message: "Invalid JSON" };
  }

  const email = pick(parsed, "email") as string | undefined;
  const username = pick(parsed, "username") as string | undefined;
  const id = pick(parsed, "id") as string | undefined;

  if (!email && !username) {
    return { status: "error", message: "Row has neither email nor username" };
  }

  // Dedupe lookup: match by email OR username OR id.
  const conditions: string[] = [];
  const params: (string)[] = [];
  let idx = 1;
  if (id) { conditions.push(`id = $${idx++}`); params.push(id); }
  if (email) { conditions.push(`email = $${idx++}`); params.push(email); }
  if (username) { conditions.push(`username = $${idx++}`); params.push(username); }

  const { rows: existingRows } = await tx.query<{ id: string; is_admin: boolean }>(
    `SELECT id, is_admin FROM users WHERE ${conditions.join(" OR ")} LIMIT 1`,
    params
  );
  const existing = existingRows[0];

  if (existing) {
    if (dedupeStrategy === "skip") {
      return { status: "skipped" };
    }
    // overwrite: update safe fields only — never id/created_at/is_admin/
    // password_hash/totp_secret/pin_hash (privilege-escalation & credential
    // safety guard for admin-uploaded import files).
    const displayName = pick(parsed, "display_name", "displayName") as string | undefined;
    const plan = pick(parsed, "plan") as string | undefined;
    const city = pick(parsed, "city") as string | undefined;
    const country = pick(parsed, "country") as string | undefined;
    const bio = pick(parsed, "bio") as string | undefined;
    const avatarEmoji = pick(parsed, "avatar_emoji", "avatarEmoji") as string | undefined;
    const isVerified = pick(parsed, "is_verified", "isVerified") as boolean | undefined;

    await tx.query(
      `UPDATE users SET
         display_name = COALESCE($2, display_name),
         plan         = COALESCE($3, plan),
         city         = COALESCE($4, city),
         country      = COALESCE($5, country),
         bio          = COALESCE($6, bio),
         avatar_emoji = COALESCE($7, avatar_emoji),
         is_verified  = COALESCE($8, is_verified),
         updated_at   = NOW()
       WHERE id = $1`,
      [existing.id, displayName ?? null, plan ?? null, city ?? null, country ?? null, bio ?? null, avatarEmoji ?? null, isVerified ?? null]
    );
    return { status: "imported" };
  }

  // Insert new user, mirroring the OAuth-insert defaults (see
  // app/api/auth/google/callback/route.ts's upsertGoogleUser). is_admin is
  // ALWAYS forced false regardless of the imported row's value — importing a
  // file must never grant admin access; promote manually afterward.
  const baseUsername = username ?? (email ? email.split("@")[0].replace(/[^a-z0-9_]/gi, "") : "user");
  const displayName = (pick(parsed, "display_name", "displayName") as string | undefined) ?? username ?? "New User";
  const avatarUrl = pick(parsed, "avatar_url", "avatarUrl") as string | undefined;
  const passwordHash = pick(parsed, "password_hash", "passwordHash") as string | undefined; // already hashed if present (from export-accounts)
  const totpSecret = pick(parsed, "totp_secret", "totpSecret") as string | undefined;
  const isEmailVerified = (pick(parsed, "is_email_verified", "isEmailVerified") as boolean | undefined) ?? false;
  const plan = (pick(parsed, "plan") as string | undefined) ?? "free";

  for (let attempt = 0; attempt < 3; attempt++) {
    const candidateUsername = await uniqueUsername(tx, baseUsername);
    try {
      await tx.query(
        `INSERT INTO users
           (username, email, display_name, avatar_url, password_hash, totp_secret,
            plan, is_email_verified, onboarding_completed, is_admin, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, false, NOW(), NOW())`,
        [
          candidateUsername,
          email ?? null,
          displayName,
          avatarUrl ?? null,
          passwordHash ?? null,
          totpSecret ?? null,
          plan,
          isEmailVerified,
        ]
      );
      return { status: "imported" };
    } catch (insertErr) {
      const pgErr = insertErr as { code?: string };
      if (pgErr.code === "23505" && attempt < 2) continue;
      return { status: "error", message: pgErr.code === "23505" ? "Duplicate email/username" : "Insert failed" };
    }
  }
  return { status: "error", message: "Failed to insert after retries" };
}

async function loadJob(jobId: string): Promise<ImportJobRow | null> {
  const { rows } = await db.query<ImportJobRow>(
    `SELECT * FROM admin_data_import_jobs WHERE id = $1 LIMIT 1`,
    [jobId]
  );
  return rows[0] ?? null;
}

const paramsSchema = z.object({ jobId: z.string().uuid() });

export const GET = withAdminAuth<{ jobId: string }>(async (_req, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const { jobId } = paramsSchema.parse(params);
    const job = await loadJob(jobId);
    if (!job) throw notFound("Import job not found");
    return NextResponse.json({
      jobId: job.id,
      status: job.status,
      totalRows: job.total_rows,
      processedRows: job.processed_rows,
      importedCount: job.imported_count,
      skippedCount: job.skipped_count,
      errorCount: job.error_count,
      errors: job.errors,
    });
  } catch (err) {
    if (err instanceof z.ZodError) return handleApiError(badRequest("Invalid job id"));
    return handleApiError(err);
  }
});

export const POST = withAdminAuth<{ jobId: string }>(async (_req, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const { jobId } = paramsSchema.parse(params);
    const job = await loadJob(jobId);
    if (!job) throw notFound("Import job not found");

    if (job.status === "completed" || job.status === "failed") {
      return NextResponse.json({
        jobId: job.id,
        status: job.status,
        totalRows: job.total_rows,
        processedRows: job.processed_rows,
        importedCount: job.imported_count,
        skippedCount: job.skipped_count,
        errorCount: job.error_count,
        errors: job.errors,
      });
    }

    const lines = job.raw_data.split("\n").filter((l) => l.trim().length > 0);
    const start = job.processed_rows;
    const batch = lines.slice(start, start + BATCH_SIZE);

    let imported = 0;
    let skipped = 0;
    let errored = 0;
    const newErrors: Array<{ line: number; message: string }> = [];

    await db.transaction(async (tx) => {
      for (let i = 0; i < batch.length; i++) {
        const lineNumber = start + i + 1;
        const outcome = await processRow(tx, batch[i], job.dedupe_strategy);
        if (outcome.status === "imported") imported++;
        else if (outcome.status === "skipped") skipped++;
        else {
          errored++;
          if (newErrors.length < 100) newErrors.push({ line: lineNumber, message: outcome.message ?? "Unknown error" });
        }
      }

      const processedRows = start + batch.length;
      const isDone = processedRows >= job.total_rows;

      await tx.query(
        `UPDATE admin_data_import_jobs SET
           processed_rows = $2,
           imported_count = imported_count + $3,
           skipped_count  = skipped_count + $4,
           error_count    = error_count + $5,
           errors         = errors || $6::jsonb,
           status         = $7,
           updated_at     = NOW()
         WHERE id = $1`,
        [
          jobId,
          processedRows,
          imported,
          skipped,
          errored,
          JSON.stringify(newErrors),
          isDone ? "completed" : "processing",
        ]
      );
    });

    const updated = await loadJob(jobId);
    if (!updated) throw notFound("Import job not found");

    if (updated.status === "completed") {
      writeAuditLog({
        actorId: auth.user.sub,
        action: "admin_import_users_job_completed",
        targetId: jobId,
        metadata: {
          totalRows: updated.total_rows,
          importedCount: updated.imported_count,
          skippedCount: updated.skipped_count,
          errorCount: updated.error_count,
        },
      });
    }

    return NextResponse.json({
      jobId: updated.id,
      status: updated.status,
      totalRows: updated.total_rows,
      processedRows: updated.processed_rows,
      importedCount: updated.imported_count,
      skippedCount: updated.skipped_count,
      errorCount: updated.error_count,
      errors: updated.errors,
    });
  } catch (err) {
    if (err instanceof z.ZodError) return handleApiError(badRequest("Invalid job id"));
    return handleApiError(err);
  }
});
