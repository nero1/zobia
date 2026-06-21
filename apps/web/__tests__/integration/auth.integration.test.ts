/**
 * Integration tests: Auth flow
 *
 * Covers:
 * - Users table accepts a new user registration row
 * - Duplicate username is rejected (unique constraint)
 * - Duplicate email is rejected (unique constraint)
 * - Soft-delete: deleted_at IS NULL filter on user lookups
 *
 * NOTE: Session tests were removed in BUG-SC-01 — the `sessions` DB table was
 * dropped (migration 0020). All auth sessions are stored in Redis. Session
 * behaviour is covered by unit tests in lib/auth/__tests__/session.test.ts
 * and the mock Redis layer in test/setup/redis.ts.
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

describe("Auth flow [integration]", () => {
  it("inserts a new user and retrieves it by id", async () => {
    if (!dbAvailable) return;
    const { client, rollback } = await createTestTransaction();
    try {
      const user = await createUser(client);
      const { rows } = await client.query(
        "SELECT id, username, email FROM users WHERE id = $1 AND deleted_at IS NULL",
        [user.id]
      );
      expect(rows).toHaveLength(1);
      expect((rows[0] as { username: string }).username).toBe(user.username);
    } finally {
      await rollback();
    }
  });

  it("enforces unique username constraint", async () => {
    if (!dbAvailable) return;
    const { client, rollback } = await createTestTransaction();
    try {
      const user = await createUser(client);
      await expect(
        client.query(
          `INSERT INTO users (id, username, display_name, email, created_at, updated_at)
           VALUES ($1, $2, 'Dupe', $3, NOW(), NOW())`,
          [uuid(), user.username, `dupe+${uuid()}@test.com`]
        )
      ).rejects.toThrow(/unique/i);
    } finally {
      await rollback();
    }
  });

  it("enforces unique email constraint", async () => {
    if (!dbAvailable) return;
    const { client, rollback } = await createTestTransaction();
    try {
      const user = await createUser(client);
      await expect(
        client.query(
          `INSERT INTO users (id, username, display_name, email, created_at, updated_at)
           VALUES ($1, $2, 'Dupe', $3, NOW(), NOW())`,
          [uuid(), `dupe_${uuid()}`, user.email]
        )
      ).rejects.toThrow(/unique/i);
    } finally {
      await rollback();
    }
  });

  // Session DB tests removed — the `sessions` table was dropped in migration 0020
  // (BUG-SC-01). Auth sessions are now exclusively stored in Redis.
  // See: lib/auth/__tests__/session.test.ts for unit-level session coverage.

  it("soft-deleted users are invisible to application queries", async () => {
    if (!dbAvailable) return;
    const { client, rollback } = await createTestTransaction();
    try {
      const user = await createUser(client);

      // Soft-delete the user
      await client.query(
        `UPDATE users SET deleted_at = NOW() WHERE id = $1`,
        [user.id]
      );

      // Standard app query should not find the deleted user
      const { rows } = await client.query(
        `SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL`,
        [user.id]
      );
      expect(rows).toHaveLength(0);

      // But the row still exists
      const { rows: allRows } = await client.query(
        `SELECT id FROM users WHERE id = $1`,
        [user.id]
      );
      expect(allRows).toHaveLength(1);
    } finally {
      await rollback();
    }
  });
});
