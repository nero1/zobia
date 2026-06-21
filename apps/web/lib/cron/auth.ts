import { timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";

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
  db: import("@/lib/db/interface").DatabaseAdapter
): Promise<boolean> {
  const runDate = new Date().toISOString().slice(0, 10);
  try {
    const { rowCount } = await db.query(
      `INSERT INTO cron_state (key, value_ts, updated_at)
       VALUES ($1, $2::date::timestamptz, NOW())
       ON CONFLICT (key) DO UPDATE
         SET value_ts = $2::date::timestamptz, updated_at = NOW()
         WHERE cron_state.value_ts < $2::date::timestamptz`,
      [key, runDate]
    );
    return (rowCount ?? 0) > 0;
  } catch {
    // Fail-closed: if the idempotency check fails, block the CRON run rather
    // than allowing a double-run that could double-send emails, double-pay, etc.
    return false;
  }
}
