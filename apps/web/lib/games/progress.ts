import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/drizzle";
import { checkPlayMilestones } from "./rewards";
import { recordChallengeRoundPlay } from "./challenges";
import { raiseAlert } from "@/lib/alerts/dispatch";
export async function processGameProgress(playId: string) {
  const db = await getDb(),
    token = randomUUID();
  const claim = await db.execute<{ attempts: number }>(
    sql`UPDATE game_progress_tasks SET attempts=attempts+1,lease_token=${token},available_at=NOW()+INTERVAL '2 minutes' WHERE play_id=${playId} AND completed_at IS NULL AND attempts<10 AND available_at<=NOW() RETURNING attempts`,
  );
  if (!claim.rows.length) return;
  try {
    const play = await db.execute<{
      user_id: string;
      challenge_round_id: string | null;
      score: string;
    }>(
      sql`SELECT user_id,challenge_round_id,score::text FROM game_plays WHERE id=${playId} AND counted`,
    );
    const row = play.rows[0];
    if (!row) throw new Error("Counted play missing");
    await checkPlayMilestones(row.user_id);
    if (row.challenge_round_id)
      await recordChallengeRoundPlay(
        row.challenge_round_id,
        row.user_id,
        playId,
        Number(row.score),
      );
    await db.execute(
      sql`UPDATE game_progress_tasks SET completed_at=NOW(),lease_token=NULL WHERE play_id=${playId} AND lease_token=${token}`,
    );
  } catch (error) {
    const delay = Math.round(
      Math.min(3600, 30 * 2 ** claim.rows[0].attempts) *
        (0.8 + Math.random() * 0.4),
    );
    await db.execute(
      sql`UPDATE game_progress_tasks SET available_at=NOW()+(${delay}*INTERVAL '1 second'),lease_token=NULL WHERE play_id=${playId} AND lease_token=${token}`,
    );
    throw error;
  }
}
export async function retryGameProgress() {
  const db = await getDb();
  const due = await db.execute<{ play_id: string }>(
    sql`SELECT play_id FROM game_progress_tasks WHERE completed_at IS NULL AND attempts<10 AND available_at<=NOW() LIMIT 100`,
  );
  for (const row of due.rows)
    try {
      await processGameProgress(row.play_id);
    } catch {
      /* Persisted for retry. */
    }
  const depth = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int n FROM game_progress_tasks WHERE completed_at IS NULL AND attempts>=10`,
  );
  if (depth.rows[0].n)
    await raiseAlert(db, {
      type: "game_progress_dlq",
      category: "financial",
      priorityLevel: 2,
      title: "Game settlement needs review",
      message: `${depth.rows[0].n} scored plays exhausted progress retries.`,
      dedupeKey: "game-progress:dlq",
    });
  await db.execute(
    sql`DELETE FROM game_progress_tasks WHERE completed_at<NOW()-INTERVAL '30 days'`,
  );
  return { attempted: due.rows.length, dead: depth.rows[0].n };
}
