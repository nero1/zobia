import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { randomUUID } from "crypto";
import { schema } from "@/lib/db/schema";
import { createUser } from "./helpers";
import { integrationSetup, closeTestPool } from "./setup";
import {
  insertNotification,
  insertNotificationBatch,
} from "@/lib/notifications/insert";
const integration = process.env.TEST_DATABASE_URL ? describe : describe.skip;
integration("notification event references", () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  let user: string;
  beforeAll(async () => {
    if (!(await integrationSetup()))
      throw new Error("Integration database unavailable");
    const client = await pool.connect();
    try {
      user = (await createUser(client)).id;
    } finally {
      client.release();
    }
  });
  afterAll(async () => {
    if (user) await pool.query("DELETE FROM users WHERE id=$1", [user]);
    await pool.end();
    await closeTestPool();
  });
  it("stores distinct events of the same type, while stable references deduplicate retries", async () => {
    const db = drizzle(pool, { schema });
    await insertNotification(db, user, "blog_new_post", "First", "One");
    await insertNotification(db, user, "blog_new_post", "Second", "Two");
    const reference = randomUUID();
    await insertNotificationBatch(
      db,
      [user],
      "tale_new_chapter",
      "Chapter",
      "Text",
      {},
      reference,
    );
    await insertNotificationBatch(
      db,
      [user],
      "tale_new_chapter",
      "Chapter",
      "Text",
      {},
      reference,
    );
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM notifications WHERE user_id=$1",
          [user],
        )
      ).rows[0].n,
    ).toBe(3);
  });
});
