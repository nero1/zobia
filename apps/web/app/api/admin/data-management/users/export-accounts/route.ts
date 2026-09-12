export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/admin/data-management/users/export-accounts
 *
 * Full-account portability export — NOT the granular CSV/TSV/XLSX export
 * (see ../export/route.ts). This is the "move users between installs"
 * feature: streams one JSON object per line (NDJSON) of complete user rows,
 * suitable for re-import via ../import/route.ts on a separate deployment.
 *
 * By default, secrets (passwordHash, pinHash, totpSecret, adminMagicWordHash)
 * are stripped. Pass `includeCredentials: true` to keep them so imported
 * accounts remain login-capable on the destination install.
 *
 * ⚠️ SENSITIVITY: with includeCredentials=true, the exported file contains
 * password hashes and TOTP secrets for every matched user — treat it like a
 * database backup (encrypt at rest, transfer over TLS only, delete promptly
 * after import). This is why it is a separate, explicitly-flagged export
 * path rather than a field option on the granular export above.
 *
 * Body: { filters?: {...}, includeCredentials?: boolean }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { writeAuditLog } from "@/lib/audit/auditLog";
import { EXPORT_CONTENT_TYPES } from "@/lib/export/tabular";
import { exportFiltersSchema, buildFilterConditions } from "@/lib/admin/userExport";

const BATCH_SIZE = 5000;

const bodySchema = z.object({
  filters: exportFiltersSchema.optional(),
  includeCredentials: z.boolean().optional().default(false),
});

// Columns never emitted, even with includeCredentials=true — these are
// either internal-only (RLS/session plumbing) or have no cross-install
// meaning (guildId, referredBy point at IDs local to this database).
const ALWAYS_STRIP = new Set(["admin_magic_word_hash"]);
// Additionally stripped unless includeCredentials=true.
const CREDENTIAL_FIELDS = new Set(["password_hash", "pin_hash", "totp_secret"]);

export const POST = withAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const body = await validateBody(req, bodySchema);
    const filters = body.filters ?? {};
    const { clauses, params, nextParamIdx } = buildFilterConditions(filters, 1);
    const whereClauses = ["u.deleted_at IS NULL", ...clauses];

    writeAuditLog({
      actorId: auth.user.sub,
      action: "admin_export_accounts",
      metadata: {
        filters,
        includeCredentials: body.includeCredentials,
        // High-sensitivity action — recorded loudly in the audit trail.
        sensitivity: body.includeCredentials ? "high_credentials_included" : "standard",
      },
    });

    const encoder = new TextEncoder();
    let cursor: { createdAt: string; id: string } | null = null;

    const stream = new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        const idxClauses = [...whereClauses];
        const idxParams = [...params];
        let idx = nextParamIdx;
        if (cursor) {
          idxClauses.push(`(u.created_at, u.id) < ($${idx}, $${idx + 1})`);
          idxParams.push(cursor.createdAt, cursor.id);
          idx += 2;
        }

        const { rows } = await db.query<{ row: Record<string, unknown>; created_at: string; id: string }>(
          `SELECT row_to_json(u) AS row, u.created_at, u.id
           FROM users u
           WHERE ${idxClauses.join(" AND ")}
           ORDER BY u.created_at DESC, u.id DESC
           LIMIT $${idx}`,
          [...idxParams, BATCH_SIZE]
        );

        if (rows.length === 0) {
          controller.close();
          return;
        }

        let chunk = "";
        for (const r of rows) {
          const obj = { ...r.row };
          for (const key of Object.keys(obj)) {
            if (ALWAYS_STRIP.has(key)) delete obj[key];
            else if (!body.includeCredentials && CREDENTIAL_FIELDS.has(key)) delete obj[key];
          }
          chunk += JSON.stringify(obj) + "\n";
        }
        controller.enqueue(encoder.encode(chunk));

        const last = rows[rows.length - 1];
        cursor = { createdAt: last.created_at, id: last.id };

        if (rows.length < BATCH_SIZE) {
          controller.close();
        }
      },
    });

    const filename = `accounts-export-${new Date().toISOString().slice(0, 10)}.ndjson`;
    return new NextResponse(stream, {
      status: 200,
      headers: {
        "Content-Type": EXPORT_CONTENT_TYPES.ndjson,
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
});
