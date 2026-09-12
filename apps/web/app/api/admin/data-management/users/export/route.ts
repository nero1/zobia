export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/admin/data-management/users/export
 *
 * Granular user data export — admin picks the output format, which safe
 * fields to include, and filters. Streams the result (CSV/TSV via
 * lib/export/tabular.ts, XLSX via exceljs's streaming workbook writer) so a
 * multi-million-row export never buffers the whole dataset in memory.
 *
 * Internally pages through matching users via the same keyset (cursor)
 * pagination pattern used by GET /api/admin/users — batches of ~5000,
 * ordered by (created_at DESC, id DESC), never OFFSET.
 *
 * Body: { format: 'csv'|'tsv'|'xlsx', fields: string[], filters?: {...} }
 */

import { NextRequest, NextResponse } from "next/server";
import { Readable, PassThrough } from "node:stream";
import { z } from "zod";
import ExcelJS from "exceljs";
import { db, type SqlParam } from "@/lib/db";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { writeAuditLog } from "@/lib/audit/auditLog";
import { createDelimitedStream, EXPORT_CONTENT_TYPES } from "@/lib/export/tabular";
import {
  ALLOWED_EXPORT_FIELDS,
  FIELD_TO_COLUMN,
  exportFiltersSchema,
  buildFilterConditions,
  type ExportField,
} from "@/lib/admin/userExport";

const BATCH_SIZE = 5000;

const bodySchema = z.object({
  format: z.enum(["csv", "tsv", "xlsx"]),
  fields: z.array(z.enum(ALLOWED_EXPORT_FIELDS)).min(1).max(ALLOWED_EXPORT_FIELDS.length),
  filters: exportFiltersSchema.optional(),
});

type UserRow = Record<string, string | number | boolean | null>;

/** Format a single cell value for output (dates -> ISO string, bigints -> number-safe string). */
function formatCell(field: ExportField, value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (field === "xpTotal" || field === "coinBalance" || field === "starBalance") {
    // bigint columns come back as strings from the driver — keep as string in
    // CSV/TSV to avoid precision loss, but as a number in XLSX cells.
    return typeof value === "string" ? value : String(value);
  }
  return value as string | number | boolean;
}

/** Fetch one page of matching users, keyset-paginated. Returns rows + whether more remain. */
async function fetchBatch(
  selectCols: string,
  whereClauses: string[],
  baseParams: SqlParam[],
  cursor: { createdAt: string; id: string } | null,
  paramIdxStart: number
): Promise<{ rows: UserRow[]; hasMore: boolean; last: { createdAt: string; id: string } | null }> {
  const clauses = [...whereClauses];
  const params = [...baseParams];
  let idx = paramIdxStart;

  if (cursor) {
    clauses.push(`(u.created_at, u.id) < ($${idx}, $${idx + 1})`);
    params.push(cursor.createdAt, cursor.id);
    idx += 2;
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const { rows } = await db.query<UserRow>(
    `SELECT ${selectCols}, u.created_at AS __cursor_created_at, u.id AS __cursor_id
     FROM users u
     ${where}
     ORDER BY u.created_at DESC, u.id DESC
     LIMIT $${idx}`,
    [...params, BATCH_SIZE + 1]
  );

  const hasMore = rows.length > BATCH_SIZE;
  const page = hasMore ? rows.slice(0, BATCH_SIZE) : rows;
  const lastRow = page[page.length - 1];
  const last = lastRow
    ? { createdAt: String(lastRow.__cursor_created_at), id: String(lastRow.__cursor_id) }
    : null;

  return { rows: page, hasMore, last };
}

export const POST = withAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const body = await validateBody(req, bodySchema);
    const fields = body.fields as ExportField[];
    const filters = body.filters ?? {};

    const selectCols = fields.map((f) => `${FIELD_TO_COLUMN[f]} AS "${f}"`).join(", ");

    const baseClauses = ["u.deleted_at IS NULL"];
    const { clauses: filterClauses, params: filterParams, nextParamIdx } = buildFilterConditions(filters, 1);
    const whereClauses = [...baseClauses, ...filterClauses];

    // leaderboardRank: 1 — a single-row export, no pagination needed.
    const isLeaderboardTop1 = filters.leaderboardRank === 1;

    writeAuditLog({
      actorId: auth.user.sub,
      action: "admin_export_users",
      metadata: { format: body.format, fields, filters, scope: isLeaderboardTop1 ? "leaderboard_top1" : "filtered" },
    });

    const filename = `users-export-${new Date().toISOString().slice(0, 10)}.${body.format}`;

    if (body.format === "xlsx") {
      const pass = new PassThrough();
      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: pass });
      const sheet = workbook.addWorksheet("Users");
      sheet.columns = fields.map((f) => ({ header: f, key: f }));

      (async () => {
        try {
          if (isLeaderboardTop1) {
            const { rows } = await db.query<UserRow>(
              `SELECT ${selectCols} FROM users u WHERE ${whereClauses.join(" AND ")} ORDER BY u.xp_total DESC LIMIT 1`,
              filterParams
            );
            for (const row of rows) {
              sheet.addRow(fields.map((f) => formatCell(f, row[f]))).commit();
            }
          } else {
            let cursor: { createdAt: string; id: string } | null = null;
            let hasMore = true;
            while (hasMore) {
              const batch = await fetchBatch(selectCols, whereClauses, filterParams, cursor, nextParamIdx);
              for (const row of batch.rows) {
                sheet.addRow(fields.map((f) => formatCell(f, row[f]))).commit();
              }
              hasMore = batch.hasMore;
              cursor = batch.last;
            }
          }
          await sheet.commit();
          await workbook.commit();
        } catch (streamErr) {
          pass.destroy(streamErr instanceof Error ? streamErr : new Error(String(streamErr)));
        }
      })();

      return new NextResponse(Readable.toWeb(pass) as unknown as ReadableStream, {
        status: 200,
        headers: {
          "Content-Type": EXPORT_CONTENT_TYPES.xlsx,
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    // CSV / TSV
    const delimiter = body.format === "csv" ? "," : "\t";
    const writer = createDelimitedStream(delimiter);
    writer.writeHeader(fields);

    (async () => {
      try {
        if (isLeaderboardTop1) {
          const { rows } = await db.query<UserRow>(
            `SELECT ${selectCols} FROM users u WHERE ${whereClauses.join(" AND ")} ORDER BY u.xp_total DESC LIMIT 1`,
            filterParams
          );
          for (const row of rows) {
            writer.writeRow(fields.map((f) => formatCell(f, row[f])));
          }
        } else {
          let cursor: { createdAt: string; id: string } | null = null;
          let hasMore = true;
          while (hasMore) {
            const batch = await fetchBatch(selectCols, whereClauses, filterParams, cursor, nextParamIdx);
            for (const row of batch.rows) {
              writer.writeRow(fields.map((f) => formatCell(f, row[f])));
            }
            hasMore = batch.hasMore;
            cursor = batch.last;
          }
        }
      } finally {
        writer.close();
      }
    })();

    return new NextResponse(writer.toReadableStream(), {
      status: 200,
      headers: {
        "Content-Type": EXPORT_CONTENT_TYPES[body.format],
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) return handleApiError(badRequest("Invalid export request", { issues: err.issues }));
    return handleApiError(err);
  }
});
