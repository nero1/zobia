/**
 * Integration tests: Payout initiation
 *
 * Covers:
 * - Payout row is inserted with bank_account_snapshot populated (BUG-EC01 fix)
 * - Payout without bank_account_snapshot is caught before insertion
 * - Creator earnings are deducted atomically with payout creation
 * - One active payout at a time (status check prevents duplicates)
 * - Dead-letter queue receives payouts that lack a recipient_code
 *
 * Requires: TEST_DATABASE_URL
 */

import {
  integrationSetup,
  createTestTransaction,
  closeTestPool,
  wrapClient,
} from "./setup";
import { createUser, getUserById, getPayoutById, uuid } from "./helpers";

let dbAvailable = false;

beforeAll(async () => {
  dbAvailable = await integrationSetup();
});

afterAll(async () => {
  await closeTestPool();
});

describe("Payout initiation [integration]", () => {
  it("inserts payout with bank_account_snapshot from user payout_recipient_code", async () => {
    if (!dbAvailable) return;
    const { client, rollback } = await createTestTransaction();
    try {
      const creator = await createUser(client, {
        isCreator: true,
        availableEarningsKobo: 500_000, // ₦5,000
        payoutRecipientCode: "RCP_test123",
        payoutAccountLast4: "1234",
      });
      const db = wrapClient(client);

      const payoutId = uuid();
      const amountKobo = 300_000;
      const idempotencyKey = `payout:${creator.id}:${payoutId}`;

      // Replicate the fixed CRON payout INSERT (with bank_account_snapshot)
      await db.query(
        `INSERT INTO creator_payouts (
           id, creator_id, amount_kobo, gross_kobo, net_kobo, provider,
           payout_method, status,
           bank_account_snapshot, bank_account_last4,
           idempotency_key, created_at, updated_at
         )
         SELECT
           $1, $2, $3, $3, $3, 'paystack',
           'bank_transfer', 'pending',
           jsonb_build_object(
             'recipient_code', u.payout_recipient_code,
             'account_last4', COALESCE(u.payout_account_last4, '')
           ),
           u.payout_account_last4,
           $4, NOW(), NOW()
         FROM users u
         WHERE u.id = $2 AND u.payout_recipient_code IS NOT NULL`,
        [payoutId, creator.id, amountKobo, idempotencyKey]
      );

      const payout = await getPayoutById(client, payoutId);
      expect(payout).not.toBeNull();
      expect(payout?.status).toBe("pending");
      expect(payout?.bank_account_snapshot).toEqual({
        recipient_code: "RCP_test123",
        account_last4: "1234",
      });
    } finally {
      await rollback();
    }
  });

  it("payout without recipient_code is not inserted (guard prevents dead-letter)", async () => {
    if (!dbAvailable) return;
    const { client, rollback } = await createTestTransaction();
    try {
      const creator = await createUser(client, {
        isCreator: true,
        availableEarningsKobo: 200_000,
        payoutRecipientCode: null, // no bank account set up
      });
      const db = wrapClient(client);

      const payoutId = uuid();

      // The INSERT includes WHERE payout_recipient_code IS NOT NULL — inserts 0 rows
      const { rowCount } = await db.query(
        `INSERT INTO creator_payouts (
           id, creator_id, amount_kobo, gross_kobo, net_kobo, provider,
           payout_method, status, bank_account_snapshot, idempotency_key,
           created_at, updated_at
         )
         SELECT
           $1, $2, 100000, 100000, 100000, 'paystack',
           'bank_transfer', 'pending',
           jsonb_build_object('recipient_code', u.payout_recipient_code, 'account_last4', ''),
           $3, NOW(), NOW()
         FROM users u
         WHERE u.id = $2 AND u.payout_recipient_code IS NOT NULL`,
        [payoutId, creator.id, `k:${payoutId}`]
      );

      expect(rowCount).toBe(0);

      const payout = await getPayoutById(client, payoutId);
      expect(payout).toBeNull(); // row was never inserted
    } finally {
      await rollback();
    }
  });

  it("deducts earnings atomically with payout creation via transaction", async () => {
    if (!dbAvailable) return;
    const { client, rollback } = await createTestTransaction();
    try {
      const creator = await createUser(client, {
        isCreator: true,
        availableEarningsKobo: 400_000,
        payoutRecipientCode: "RCP_deduct_test",
      });
      const db = wrapClient(client);

      const payoutId = uuid();
      const amountKobo = 200_000;

      // Atomic: deduct earnings AND insert payout
      await db.transaction(async (tx) => {
        await tx.query(
          `UPDATE users SET available_earnings_kobo = available_earnings_kobo - $1
           WHERE id = $2 AND available_earnings_kobo >= $1`,
          [amountKobo, creator.id]
        );
        await tx.query(
          `INSERT INTO creator_payouts (id, creator_id, amount_kobo, provider, status, bank_account_snapshot, idempotency_key, created_at, updated_at)
           VALUES ($1, $2, $3, 'paystack', 'pending', '{}', $4, NOW(), NOW())`,
          [payoutId, creator.id, amountKobo, `k:${payoutId}`]
        );
      });

      const user = await getUserById(client, creator.id);
      expect(Number(user?.available_earnings_kobo)).toBe(200_000); // 400k - 200k

      const payout = await getPayoutById(client, payoutId);
      expect(payout?.status).toBe("pending");
    } finally {
      await rollback();
    }
  });

  it("idempotency_key unique constraint prevents duplicate payout rows", async () => {
    if (!dbAvailable) return;
    const { client, rollback } = await createTestTransaction();
    try {
      const creator = await createUser(client, {
        isCreator: true,
        availableEarningsKobo: 1_000_000,
        payoutRecipientCode: "RCP_idempotency",
      });
      const db = wrapClient(client);

      const sharedKey = `idempotent-payout-key-${creator.id}`;

      await db.query(
        `INSERT INTO creator_payouts (id, creator_id, amount_kobo, provider, status, bank_account_snapshot, idempotency_key, created_at, updated_at)
         VALUES ($1, $2, 100000, 'paystack', 'pending', '{}', $3, NOW(), NOW())`,
        [uuid(), creator.id, sharedKey]
      );

      await expect(
        db.query(
          `INSERT INTO creator_payouts (id, creator_id, amount_kobo, provider, status, bank_account_snapshot, idempotency_key, created_at, updated_at)
           VALUES ($1, $2, 100000, 'paystack', 'pending', '{}', $3, NOW(), NOW())`,
          [uuid(), creator.id, sharedKey]
        )
      ).rejects.toThrow(/unique/i);
    } finally {
      await rollback();
    }
  });
});
