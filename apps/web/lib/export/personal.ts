import { getTableColumns, getTableName, is, sql } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { getDb, schema } from "@/lib/db/drizzle";

const SUBJECT_COLUMNS = new Set([
  "user_id",
  "owner_id",
  "author_id",
  "creator_id",
  "created_by",
  "sender_id",
  "requester_id",
  "addressee_id",
  "follower_id",
  "following_id",
  "blocker_id",
  "blocked_id",
  "reporter_id",
  "challenger_id",
  "opponent_id",
]);
const OMIT_TABLE =
  /^(phone_verification_codes|account_restore_uses|user_push_tokens|admin_|failed_|security_|ai_|automation_jobs|kyc_document_ai_reviews|kyc_verifications|telegram_login_states|data_export_requests|audit_logs|system_alerts|crypto_transfer_claims)/;
const OMIT_COLUMN =
  /(password|secret|token|nonce|code_hash|pin_hash|signature|lease_|raw_|payload|metadata|bank_account_number|recipient_code)/i;
export function personalExportSections() {
  return (Object.values(schema) as unknown[])
    .filter((value): value is PgTable => is(value, PgTable))
    .map((table) => {
      const name = getTableName(table),
        columns = getTableColumns(table);
      const subject = Object.values(columns).filter((c) =>
        SUBJECT_COLUMNS.has(c.name),
      );
      if (name === "users") subject.push(columns.id);
      const config = getTableConfig(table);
      const key = Object.values(columns).filter((c) => c.primary);
      if (!key.length)
        key.push(...config.primaryKeys.flatMap((p) => p.columns));
      return {
        table,
        name,
        subject,
        key,
        columns: Object.values(columns).filter(
          (c) => !OMIT_COLUMN.test(c.name),
        ),
      };
    })
    .filter((s) => s.subject.length && s.key.length && !OMIT_TABLE.test(s.name))
    .sort((a, b) => a.name.localeCompare(b.name));
}
/** Pull-driven NDJSON. A final completion record distinguishes a complete export. */
export function personalExportStream(
  userId: string,
  signal: AbortSignal,
): ReadableStream<Uint8Array> {
  const sections = personalExportSections();
  let section = 0,
    cursor: string | null = null,
    header = false,
    done = false;
  const encoder = new TextEncoder();
  let cancelled = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (cancelled) return;
      try {
        signal.throwIfAborted();
        if (!header) {
          header = true;
          controller.enqueue(
            encoder.encode(
              JSON.stringify({
                type: "manifest",
                format: "zobia-personal-data-v2",
                exportedAt: new Date().toISOString(),
                userId,
                sections: sections.map((s) => s.name),
                exclusions: [
                  "Credentials, delivery tokens, internal risk/moderation processing and raw provider payloads",
                  "Binary attachments are referenced by their stored URLs; identity documents can be downloaded by their owner through /api/kyc/documents/{id}",
                ],
                complete: false,
              }) + "\n",
            ),
          );
          return;
        }
        const current = sections[section];
        if (!current) {
          if (!done) {
            done = true;
            controller.enqueue(
              encoder.encode('{"type":"complete","complete":true}\n'),
            );
          }
          controller.close();
          return;
        }
        const db = await getDb();
        const subject = sql.join(
          current.subject.map((c) => sql`${c}=${userId}::uuid`),
          sql` OR `,
        );
        const key = sql`jsonb_build_array(${sql.join(
          current.key.map((c) => sql`${c}::text`),
          sql`,`,
        )})::text`;
        // Store wide integers/decimals as strings so downstream JSON parsers preserve money.
        const fields = current.columns.flatMap((c) => [
          sql`${c.name}`,
          /^(bigint|numeric|decimal)/.test(c.getSQLType())
            ? sql`${c}::text`
            : sql`${c}`,
        ]);
        const rows = await db.execute<{ key: string; document: string }>(
          sql`SELECT ${key} key,jsonb_build_object(${sql.join(fields, sql`,`)})::text document FROM ${current.table} WHERE (${subject}) AND (${cursor}::text IS NULL OR ${key}>${cursor}) ORDER BY ${key} LIMIT 50`,
        );
        if (cancelled) return;
        if (rows.rows.length) {
          cursor = rows.rows.at(-1)!.key;
          controller.enqueue(
            encoder.encode(
              rows.rows
                .map(
                  (r) =>
                    `{"type":"record","section":${JSON.stringify(current.name)},"data":${r.document}}\n`,
                )
                .join(""),
            ),
          );
        }
        if (rows.rows.length < 50) {
          section++;
          cursor = null;
        }
      } catch (error) {
        if (!cancelled) controller.error(error);
      }
    },
    cancel() {
      cancelled = true;
    },
  });
}
