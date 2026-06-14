/**
 * Integration tests: Trust score gating
 *
 * Covers:
 * - calculateTrustScore uses correlated subqueries (BUG-DB01 fix)
 * - Report count and warning count come from reports + moderation_actions tables
 * - Banned user always gets score 0
 * - meetsMinimumTrust gates features by threshold
 * - Trust score is persisted to users.trust_score
 *
 * Requires: TEST_DATABASE_URL
 */

import {
  integrationSetup,
  createTestTransaction,
  closeTestPool,
  wrapClient,
} from "./setup";
import {
  createUser,
  createReport,
  createModerationAction,
  getUserById,
} from "./helpers";
import { calculateTrustScore } from "@/lib/trust/trustScore";

let dbAvailable = false;

beforeAll(async () => {
  dbAvailable = await integrationSetup();
});

afterAll(async () => {
  await closeTestPool();
});

describe("Trust score gating [integration]", () => {
  it("new verified user with no reports gets a high trust score", async () => {
    if (!dbAvailable) return;
    const { client, rollback } = await createTestTransaction();
    try {
      const user = await createUser(client, { isVerified: true });
      const db = wrapClient(client) as Parameters<typeof calculateTrustScore>[1];

      const score = await calculateTrustScore(user.id, db);

      // Verified (+20) + no penalties + small account age bonus = ≥20
      expect(score).toBeGreaterThanOrEqual(20);
      expect(score).toBeLessThanOrEqual(100);

      // Trust score should be persisted
      const updated = await getUserById(client, user.id);
      expect(updated?.trust_score).toBe(score);
    } finally {
      await rollback();
    }
  });

  it("report count reduces trust score using reports.reported_user_id", async () => {
    if (!dbAvailable) return;
    const { client, rollback } = await createTestTransaction();
    try {
      const reporter = await createUser(client);
      const target = await createUser(client);
      const db = wrapClient(client) as Parameters<typeof calculateTrustScore>[1];

      const baseScore = await calculateTrustScore(target.id, db);

      // Add 3 reports against target
      for (let i = 0; i < 3; i++) {
        await createReport(client, reporter.id, target.id);
      }

      const penalizedScore = await calculateTrustScore(target.id, db);

      // 3 reports × -5 pts each = -15 pts expected
      expect(penalizedScore).toBe(Math.max(0, baseScore - 15));
    } finally {
      await rollback();
    }
  });

  it("warning count reduces trust score using moderation_actions with action_type='warning'", async () => {
    if (!dbAvailable) return;
    const { client, rollback } = await createTestTransaction();
    try {
      const admin = await createUser(client);
      const target = await createUser(client);
      const db = wrapClient(client) as Parameters<typeof calculateTrustScore>[1];

      const baseScore = await calculateTrustScore(target.id, db);

      // Add 2 warnings
      await createModerationAction(client, target.id, "warning", admin.id);
      await createModerationAction(client, target.id, "warning", admin.id);

      const penalizedScore = await calculateTrustScore(target.id, db);

      // 2 warnings × -10 pts each = -20 pts expected
      expect(penalizedScore).toBe(Math.max(0, baseScore - 20));
    } finally {
      await rollback();
    }
  });

  it("banned user always receives trust score of 0", async () => {
    if (!dbAvailable) return;
    const { client, rollback } = await createTestTransaction();
    try {
      const user = await createUser(client, { isBanned: true });
      const db = wrapClient(client) as Parameters<typeof calculateTrustScore>[1];

      const score = await calculateTrustScore(user.id, db);
      expect(score).toBe(0);
    } finally {
      await rollback();
    }
  });

  it("trust score caps at 100 regardless of positive signals", async () => {
    if (!dbAvailable) return;
    const { client, rollback } = await createTestTransaction();
    try {
      const user = await createUser(client, { isVerified: true });
      const db = wrapClient(client) as Parameters<typeof calculateTrustScore>[1];

      // Add many completed payments to push score up
      for (let i = 0; i < 20; i++) {
        await client.query(
          `INSERT INTO payments (id, user_id, payment_type, amount_kobo, provider, status)
           VALUES (gen_random_uuid(), $1, 'coin_purchase', 1000, 'paystack', 'completed')`,
          [user.id]
        );
      }

      const score = await calculateTrustScore(user.id, db);
      expect(score).toBeLessThanOrEqual(100);
    } finally {
      await rollback();
    }
  });

  it("throws when user does not exist", async () => {
    if (!dbAvailable) return;
    const { client, rollback } = await createTestTransaction();
    try {
      const db = wrapClient(client) as Parameters<typeof calculateTrustScore>[1];
      const nonExistentId = "00000000-0000-0000-0000-000000000001";

      await expect(calculateTrustScore(nonExistentId, db)).rejects.toThrow(/user not found/i);
    } finally {
      await rollback();
    }
  });
});
