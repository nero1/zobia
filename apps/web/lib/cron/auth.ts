import { timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { schema, type DbOrTx } from "@/lib/db/drizzle";

export function validateCronSecret(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return false;
  try {
    const a = Buffer.from(token);
    const b = Buffer.from(cronSecret);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function checkCronIdempotency(
  key: string,
  db: DbOrTx
): Promise<boolean> {
  const runDate = new Date().toISOString().slice(0, 10);
  try {
    const result = await db
      .insert(schema.cronState)
      .values({
        key,
        valueTs: sql`${runDate}::date::timestamptz`,
        updatedAt: sql`NOW()`,
      })
      .onConflictDoUpdate({
        target: schema.cronState.key,
        set: {
          valueTs: sql`${runDate}::date::timestamptz`,
          updatedAt: sql`NOW()`,
        },
        setWhere: sql`${schema.cronState.valueTs} < ${runDate}::date::timestamptz`,
      });
    return (result.rowCount ?? 0) > 0;
  } catch {
    // Fail-closed: if the idempotency check fails, block the CRON run rather
    // than allowing a double-run that could double-send emails, double-pay, etc.
    return false;
  }
}
