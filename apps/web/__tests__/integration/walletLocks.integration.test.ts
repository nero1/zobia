import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { schema } from "@/lib/db/schema";
import { createUser } from "./helpers";
import { integrationSetup, closeTestPool } from "./setup";
import { debitCoins } from "@/lib/economy/coins";
const integration = process.env.TEST_DATABASE_URL ? describe : describe.skip;
integration("wallet locks and publication foreign keys", () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  let user: string;
  beforeAll(async () => {
    if (!(await integrationSetup()))
      throw new Error("Integration database unavailable");
    const client = await pool.connect();
    try {
      user = (await createUser(client, { coinBalance: 100 })).id;
    } finally {
      client.release();
    }
  });
  afterAll(async () => {
    if (user) await pool.query("DELETE FROM users WHERE id=$1", [user]);
    await pool.end();
    await closeTestPool();
  });
  it("serializes balance updates without waiting on an unrelated content foreign-key reference", async () => {
    const content = await pool.connect();
    try {
      await content.query("BEGIN");
      await content.query(
        "INSERT INTO notifications(user_id,type,title,reference_id) VALUES($1,'wallet_lock_test','Reference',$2)",
        [user, randomUUID()],
      );
      await drizzle(pool, { schema }).transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL statement_timeout='1500ms'`);
        await debitCoins(
          user,
          10,
          "purchase",
          randomUUID(),
          "Concurrent wallet test",
          null,
          tx,
        );
        const [row] = await tx
          .select({ balance: schema.users.coinBalance })
          .from(schema.users)
          .where(eq(schema.users.id, user));
        expect(Number(row.balance)).toBe(90);
      });
    } finally {
      await content.query("ROLLBACK");
      content.release();
    }
  });
});
