/**
 * Integration tests: Auth flow
 *
 * Covers:
 * - Users table accepts a new user registration row
 * - Duplicate username is rejected (unique constraint)
 * - Duplicate email is rejected (unique constraint)
 * - Session creation and lookup
 * - Session expiry semantics (expired sessions not fetched for active auth)
 * - Soft-delete: deleted_at IS NULL filter on user lookups
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

  it("creates a session and retrieves it by refresh token hash", async () => {
    if (!dbAvailable) return;
    const { client, rollback } = await createTestTransaction();
    try {
      const user = await createUser(client);
      const sessionId = uuid();
      const tokenHash = "hashed_refresh_token_abc";
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      await client.query(
        `INSERT INTO sessions (id, user_id, refresh_token_hash, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [sessionId, user.id, tokenHash, expiresAt]
      );

      const { rows } = await client.query(
        `SELECT s.id, s.user_id, u.username
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.refresh_token_hash = $1 AND s.expires_at > NOW() AND u.deleted_at IS NULL`,
        [tokenHash]
      );
      expect(rows).toHaveLength(1);
      expect((rows[0] as { username: string }).username).toBe(user.username);
    } finally {
      await rollback();
    }
  });

  it("expired sessions are not returned by active-session query", async () => {
    if (!dbAvailable) return;
    const { client, rollback } = await createTestTransaction();
    try {
      const user = await createUser(client);
      const sessionId = uuid();
      const pastExpiry = new Date(Date.now() - 60_000).toISOString(); // 1 min ago

      await client.query(
        `INSERT INTO sessions (id, user_id, refresh_token_hash, expires_at)
         VALUES ($1, $2, 'expired_token_hash', $3)`,
        [sessionId, user.id, pastExpiry]
      );

      const { rows } = await client.query(
        `SELECT id FROM sessions WHERE refresh_token_hash = 'expired_token_hash' AND expires_at > NOW()`,
        []
      );
      expect(rows).toHaveLength(0);
    } finally {
      await rollback();
    }
  });

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
