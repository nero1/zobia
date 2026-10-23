import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { randomUUID } from "crypto";
import { schema } from "@/lib/db/schema";
import { createUser } from "./helpers";
import { integrationSetup, closeTestPool } from "./setup";
jest.mock("@/lib/db/drizzle", () => ({
  ...jest.requireActual("@/lib/db/drizzle"),
  getDb: jest.fn(),
}));
import { getDb } from "@/lib/db/drizzle";
import {
  fundContentTreasury,
  claimContentTreasuryReward,
  closeContentTreasury,
  fundRoomReward,
  claimRoomRewardOnGift,
  closeRoomReward,
} from "@/lib/contentTreasury";
const integration = process.env.TEST_DATABASE_URL ? describe : describe.skip;
integration("reward pot generations and first funding", () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const users: string[] = [];
  const targets: string[] = [];
  let owner: string;
  let reader: string;
  beforeAll(async () => {
    if (!(await integrationSetup()))
      throw new Error("Integration database unavailable");
    (getDb as jest.Mock).mockResolvedValue(drizzle(pool, { schema }));
    const client = await pool.connect();
    try {
      owner = (
        await createUser(client, { coinBalance: 1000, starBalance: 1000 })
      ).id;
      reader = (await createUser(client)).id;
      users.push(owner, reader);
    } finally {
      client.release();
    }
  });
  afterAll(async () => {
    await pool.query(
      "DELETE FROM content_treasuries WHERE content_id=ANY($1::uuid[])",
      [targets],
    );
    for (const id of users)
      await pool.query("DELETE FROM users WHERE id=$1", [id]);
    await pool.end();
    await closeTestPool();
  });
  it("serializes initial funding and preserves old claims while permitting a new funding cycle", async () => {
    const id = randomUUID();
    targets.push(id);
    const before = Number(
      (await pool.query("SELECT coin_balance FROM users WHERE id=$1", [owner]))
        .rows[0].coin_balance,
    );
    const results = await Promise.allSettled([
      fundContentTreasury(owner, "tale", id, 100, 2, "tale_treasury_fund"),
      fundContentTreasury(owner, "tale", id, 100, 2, "tale_treasury_fund"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      Number(
        (
          await pool.query("SELECT coin_balance FROM users WHERE id=$1", [
            owner,
          ])
        ).rows[0].coin_balance,
      ),
    ).toBe(before - 100);
    expect(
      (
        await claimContentTreasuryReward(
          "tale",
          id,
          reader,
          "share",
          "tale_treasury_reward",
          true,
        )
      )?.amount,
    ).toBe(50);
    expect(
      await claimContentTreasuryReward(
        "tale",
        id,
        reader,
        "share",
        "tale_treasury_reward",
        true,
      ),
    ).toBeNull();
    await closeContentTreasury(owner, "tale", id, "tale_treasury_refund");
    await fundContentTreasury(owner, "tale", id, 100, 2, "tale_treasury_fund");
    expect(
      (
        await claimContentTreasuryReward(
          "tale",
          id,
          reader,
          "share",
          "tale_treasury_reward",
          true,
        )
      )?.amount,
    ).toBe(50);
    await closeContentTreasury(owner, "tale", id, "tale_treasury_refund");
    expect(
      Number(
        (
          await pool.query("SELECT coin_balance FROM users WHERE id=$1", [
            owner,
          ])
        ).rows[0].coin_balance,
      ),
    ).toBe(before - 100);
    const claims = (
      await pool.query(
        "SELECT c.generation FROM content_treasury_claims c JOIN content_treasuries t ON t.id=c.treasury_id WHERE t.content_id=$1 ORDER BY c.generation",
        [id],
      )
    ).rows;
    expect(claims.map((r) => r.generation)).toEqual([0, 1]);
  });
  it("does not overwrite funded room rewards and supports gift claims in subsequent cycles", async () => {
    const room = randomUUID();
    targets.push(room);
    const input = {
      ownerId: owner,
      roomId: room,
      title: "Room reward",
      maxClaimants: 2,
      rewardAction: "stars" as const,
      amount: 100,
    };
    await fundRoomReward(input);
    await expect(
      fundRoomReward({
        ...input,
        rewardAction: "custom_text",
        customInstructions: "Different reward",
      }),
    ).rejects.toMatchObject({ code: "TREASURY_ALREADY_EXISTS" });
    expect(
      (await claimRoomRewardOnGift(room, reader, randomUUID()))?.amount,
    ).toBe(50);
    await closeRoomReward(room);
    await fundRoomReward(input);
    expect(
      (await claimRoomRewardOnGift(room, reader, randomUUID()))?.amount,
    ).toBe(50);
    await closeRoomReward(room);
    await closeRoomReward(room);
    expect(
      Number(
        (
          await pool.query("SELECT star_balance FROM users WHERE id=$1", [
            owner,
          ])
        ).rows[0].star_balance,
      ),
    ).toBe(900);
  });
});
