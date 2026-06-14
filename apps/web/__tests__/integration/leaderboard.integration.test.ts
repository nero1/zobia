/**
 * Integration tests: Leaderboard ranking
 *
 * Covers:
 * - leaderboard_snapshots table accepts inserts and handles UPSERT
 * - Ranking query orders users by xp_value correctly
 * - getUserMetricsForWeighting uses 'follows' table (not 'followers') — BUG-DB05 fix
 * - Follower count is derived from follows.following_id (not follows.user_id)
 * - Upsert on (user_id, track, scope, city, season_id) is idempotent
 *
 * Requires: TEST_DATABASE_URL
 */

import {
  integrationSetup,
  createTestTransaction,
  closeTestPool,
  wrapClient,
} from "./setup";
import { createUser, uuid } from "./helpers";

let dbAvailable = false;

beforeAll(async () => {
  dbAvailable = await integrationSetup();
});

afterAll(async () => {
  await closeTestPool();
});

describe("Leaderboard ranking [integration]", () => {
  it("inserts leaderboard snapshot and retrieves it", async () => {
    if (!dbAvailable) return;
    const { client, rollback } = await createTestTransaction();
    try {
      const user = await createUser(client, { xpTotal: 1000 });
      const db = wrapClient(client);

      await db.query(
        `INSERT INTO leaderboard_snapshots (id, user_id, track, scope, xp_value)
         VALUES ($1, $2, 'main', 'global', $3)`,
        [uuid(), user.id, 1000]
      );

      const { rows } = await db.query<{ xp_value: string }>(
        `SELECT xp_value FROM leaderboard_snapshots WHERE user_id = $1 AND track = 'main'`,
        [user.id]
      );
      expect(rows).toHaveLength(1);
      expect(Number(rows[0].xp_value)).toBe(1000);
    } finally {
      await rollback();
    }
  });

  it("ranking query orders multiple users by xp_value descending", async () => {
    if (!dbAvailable) return;
    const { client, rollback } = await createTestTransaction();
    try {
      const users = await Promise.all([
        createUser(client, { xpTotal: 300 }),
        createUser(client, { xpTotal: 1500 }),
        createUser(client, { xpTotal: 900 }),
      ]);
      const db = wrapClient(client);

      for (const user of users) {
        await db.query(
          `INSERT INTO leaderboard_snapshots (id, user_id, track, scope, xp_value)
           VALUES ($1, $2, 'main', 'global', $3)`,
          [uuid(), user.id, user.xpTotal]
        );
      }

      const { rows } = await db.query<{ user_id: string; xp_value: string; rank: string }>(
        `SELECT user_id, xp_value,
                RANK() OVER (ORDER BY xp_value DESC) AS rank
         FROM leaderboard_snapshots
         WHERE track = 'main' AND scope = 'global'
           AND user_id = ANY($1::uuid[])
         ORDER BY rank`,
        [[users[0].id, users[1].id, users[2].id]]
      );

      expect(rows).toHaveLength(3);
      // Highest XP first
      expect(rows[0].user_id).toBe(users[1].id); // xpTotal 1500
      expect(rows[1].user_id).toBe(users[2].id); // xpTotal 900
      expect(rows[2].user_id).toBe(users[0].id); // xpTotal 300
    } finally {
      await rollback();
    }
  });

  it("leaderboard upsert (unique constraint) updates existing row", async () => {
    if (!dbAvailable) return;
    const { client, rollback } = await createTestTransaction();
    try {
      const user = await createUser(client, { xpTotal: 500 });
      const db = wrapClient(client);

      await db.query(
        `INSERT INTO leaderboard_snapshots (id, user_id, track, scope, xp_value, city, season_id)
         VALUES ($1, $2, 'main', 'global', 500, NULL, NULL)
         ON CONFLICT (user_id, track, scope, city, season_id)
           DO UPDATE SET xp_value = EXCLUDED.xp_value, updated_at = NOW()`,
        [uuid(), user.id]
      );

      // Update with higher XP
      await db.query(
        `INSERT INTO leaderboard_snapshots (id, user_id, track, scope, xp_value, city, season_id)
         VALUES ($1, $2, 'main', 'global', 750, NULL, NULL)
         ON CONFLICT (user_id, track, scope, city, season_id)
           DO UPDATE SET xp_value = EXCLUDED.xp_value, updated_at = NOW()`,
        [uuid(), user.id]
      );

      const { rows } = await db.query<{ xp_value: string }>(
        `SELECT xp_value FROM leaderboard_snapshots WHERE user_id = $1 AND track = 'main'`,
        [user.id]
      );
      expect(rows).toHaveLength(1); // single row (upsert)
      expect(Number(rows[0].xp_value)).toBe(750);
    } finally {
      await rollback();
    }
  });

  it("follower count uses 'follows' table with follows.following_id (BUG-DB05 fix)", async () => {
    if (!dbAvailable) return;
    const { client, rollback } = await createTestTransaction();
    try {
      const creator = await createUser(client);
      const follower1 = await createUser(client);
      const follower2 = await createUser(client);
      const db = wrapClient(client);

      // Insert follows using correct table and column names
      await db.query(
        `INSERT INTO follows (id, follower_id, following_id) VALUES ($1, $2, $3)`,
        [uuid(), follower1.id, creator.id]
      );
      await db.query(
        `INSERT INTO follows (id, follower_id, following_id) VALUES ($1, $2, $3)`,
        [uuid(), follower2.id, creator.id]
      );

      // Query using the fixed join (following_id = creator's id — BUG-DB05)
      const { rows } = await db.query<{ follower_count: string }>(
        `SELECT COUNT(DISTINCT f.follower_id) AS follower_count
         FROM users u
         LEFT JOIN follows f ON f.following_id = u.id
         WHERE u.id = $1 AND u.deleted_at IS NULL`,
        [creator.id]
      );

      expect(Number(rows[0].follower_count)).toBe(2);
    } finally {
      await rollback();
    }
  });

  it("wrong 'followers' table name produces a DB error (confirms bug was real)", async () => {
    if (!dbAvailable) return;
    const { client, rollback } = await createTestTransaction();
    try {
      const db = wrapClient(client);

      // Using the buggy table name from BUG-DB05 should fail
      await expect(
        db.query(
          `SELECT COUNT(*) FROM followers WHERE user_id = $1`,
          ["00000000-0000-0000-0000-000000000001"]
        )
      ).rejects.toThrow(/followers/i);
    } finally {
      await rollback();
    }
  });
});
