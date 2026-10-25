import { QUEST_ACTION_TYPES } from "@zobia/shared/utils";
import { createHash, randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema, type DbOrTx } from "@/lib/db/drizzle";
import { badRequest, conflict, forbidden, notFound } from "@/lib/api/errors";
import { checkAndDebit, creditCoins } from "@/lib/economy/coins";
import { enqueueTask, type DurableTask } from "@/lib/tasks/outbox";
const MICRO = 1000000n;
type Quest = typeof schema.sponsoredQuests.$inferSelect;
export const fundingMicros = (value: Decimal.Value) => {
  const amount = new Decimal(value);
  if (
    !amount.isFinite() ||
    amount.isNegative() ||
    amount.decimalPlaces() > 6 ||
    amount.gt(1_000_000_000)
  )
    throw badRequest("Invalid sponsored budget precision or size");
  return BigInt(amount.mul(1000000).toFixed(0));
};
export function sponsoredFundingQuote(
  reward: number | null,
  applications: number | null,
  budget: Decimal.Value,
) {
  if (
    !Number.isSafeInteger(reward) ||
    reward! <= 0 ||
    reward! > 100000 ||
    !Number.isSafeInteger(applications) ||
    applications! < 1 ||
    applications! > 1000
  )
    throw badRequest(
      "Campaign rewards must be 1–100,000 Credits and applications 1–1,000",
    );
  const micros = fundingMicros(budget),
    marketing = (micros + MICRO - 1n) / MICRO,
    application = BigInt(reward!) * BigInt(applications!);
  return { marketing, application, total: marketing + application };
}
export async function fundSponsoredQuest(
  tx: DbOrTx,
  questId: string,
  payerId: string,
  maxReserveCoins?: number,
) {
  // Lock the wallet before the campaign; beneficiary settlement follows this order too.
  await tx
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.id, payerId))
    .for("no key update");
  const [quest] = await tx
    .select()
    .from(schema.sponsoredQuests)
    .where(eq(schema.sponsoredQuests.id, questId))
    .for("update");
  if (!quest || quest.deletedAt) throw notFound("Campaign not found");
  const [existing] = await tx
    .select()
    .from(schema.sponsoredQuestFunding)
    .where(eq(schema.sponsoredQuestFunding.questId, questId));
  if (existing) {
    if (existing.payerId !== payerId)
      throw forbidden("Campaign funding belongs to another wallet");
    return existing;
  }
  if (!quest.deadline || quest.deadline <= new Date())
    throw badRequest("Extend the campaign deadline before funding it");
  if (quest.businessAccountId) {
    const [business] = await tx
      .select({ status: schema.businessAccounts.status })
      .from(schema.businessAccounts)
      .where(eq(schema.businessAccounts.id, quest.businessAccountId));
    if (business?.status !== "active")
      throw forbidden("The business account must be active");
  }
  if (quest.creatorSharePercent + quest.platformSharePercent !== 100)
    throw badRequest("Campaign shares must sum to 100");
  const paid = await tx.execute<{ n: string; total: string }>(
    sql`SELECT COUNT(*)::text total,COUNT(*) FILTER(WHERE status IN ('paid','rejected'))::text n FROM sponsored_quest_applications WHERE quest_id=${questId}`,
  );
  if (Number(paid.rows[0].total) > (quest.maxApplications ?? 0))
    throw badRequest(
      "Raise the legacy application limit to cover existing applicants before funding",
    );
  const slots = Math.max(
    0,
    (quest.maxApplications ?? 0) - Number(paid.rows[0].n),
  );
  const quote = sponsoredFundingQuote(
    quest.rewardCoins,
    quest.maxApplications,
    quest.isDailyQuestEligible
      ? Decimal.max(
          0,
          new Decimal(quest.totalBudgetCredits).minus(quest.spentCredits),
        )
      : 0,
  );
  const application = BigInt(quest.rewardCoins!) * BigInt(slots),
    total = quote.marketing + application;
  if (maxReserveCoins !== undefined && total > BigInt(maxReserveCoins))
    throw conflict("The campaign quote increased; review it again");
  if (total > 0n)
    await checkAndDebit(
      payerId,
      Number(total),
      "sponsored_quest_funding",
      `sponsored-funding:${questId}`,
      "Sponsored campaign reserve",
      { questId },
      tx,
    );
  const [funding] = await tx
    .insert(schema.sponsoredQuestFunding)
    .values({
      questId,
      payerId,
      reservedCoins: total,
      marketingBalanceMicros: quote.marketing * MICRO,
      applicationBalanceCoins: application,
    })
    .returning();
  await tx
    .update(schema.sponsoredQuests)
    .set({
      fundedByUserId: payerId,
      ...(quest.pauseReason === "funding_required"
        ? {
            autoPaused: false,
            pauseReason: null,
            isActive: quest.moderationStatus === "approved",
          }
        : {}),
    })
    .where(eq(schema.sponsoredQuests.id, questId));
  return funding;
}
/** A retry of the same client operation returns the same funded campaign. */
export async function createFundedSponsoredQuest(
  db: DbOrTx,
  values: typeof schema.sponsoredQuests.$inferInsert,
  payerId: string,
  operationKey: string,
) {
  fundingMicros(values.totalBudgetCredits ?? 0);
  const cpm = new Decimal(values.cpmCredits ?? 500);
  if (
    !cpm.isFinite() ||
    cpm.lte(0) ||
    cpm.decimalPlaces() > 2 ||
    cpm.gt(1000000)
  )
    throw badRequest("Invalid sponsored CPM");

  if (
    values.isDailyQuestEligible &&
    values.targetAction &&
    !QUEST_ACTION_TYPES.includes(
      values.targetAction as (typeof QUEST_ACTION_TYPES)[number],
    )
  )
    throw badRequest("Choose a supported daily quest action");
  const hash = createHash("sha256")
    .update(`sponsored-campaign:v1:${payerId}:${operationKey}`)
    .digest("hex");
  const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${id},74))`,
    );
    const [existing] = await tx
      .select()
      .from(schema.sponsoredQuests)
      .where(eq(schema.sponsoredQuests.id, id));
    if (existing) {
      const normal = (value: unknown) =>
        value instanceof Date
          ? value.toISOString()
          : value === undefined
            ? null
            : value;
      for (const [key, value] of Object.entries(values)) {
        const prior = existing[key as keyof Quest];
        const same =
          ["totalBudgetCredits", "dailyBudgetCredits", "cpmCredits"].includes(
            key,
          ) &&
          prior != null &&
          value != null
            ? new Decimal(String(prior)).eq(String(value))
            : JSON.stringify(normal(prior)) === JSON.stringify(normal(value));
        if (!same)
          throw conflict(
            `Campaign request key was reused with different ${key}`,
            "IDEMPOTENCY_CONFLICT",
          );
      }
      const [funding] = await tx
        .select()
        .from(schema.sponsoredQuestFunding)
        .where(eq(schema.sponsoredQuestFunding.questId, id));
      if (funding?.payerId !== payerId)
        throw conflict("Campaign funding changed");
      return { id };
    }
    await tx.insert(schema.sponsoredQuests).values({ ...values, id });
    await fundSponsoredQuest(tx, id, payerId);
    return { id };
  });
}
/** Monetary terms remain immutable after funding; increasing the marketing
 * budget requires an additional debit from the original payer's own wallet. */
export async function updateFundedSponsoredQuest(
  db: DbOrTx,
  questId: string,
  patch: Partial<typeof schema.sponsoredQuests.$inferInsert>,
  actorId: string,
  options: {
    addBudgetCredits?: number;
    expectedOwner?: string;
    expectedBusinessOwner?: string;
  } = {},
) {
  return db.transaction(async (tx) => {
    await tx
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, actorId))
      .for("no key update");
    const [quest] = await tx
      .select()
      .from(schema.sponsoredQuests)
      .where(eq(schema.sponsoredQuests.id, questId))
      .for("update");
    if (!quest) throw notFound("Campaign not found");
    if (
      options.expectedOwner &&
      (quest.ownerUserId !== options.expectedOwner ||
        quest.deletedAt ||
        quest.autoPaused ||
        quest.flagStatus === "flagged" ||
        quest.moderationStatus !== "approved")
    )
      throw forbidden("Campaign management authority changed");
    if (options.expectedBusinessOwner) {
      const [owner] = quest.businessAccountId
        ? await tx
            .select({ userId: schema.businessAccounts.userId })
            .from(schema.businessAccounts)
            .where(eq(schema.businessAccounts.id, quest.businessAccountId))
        : [];
      if (
        owner?.userId !== options.expectedBusinessOwner ||
        quest.deletedAt ||
        quest.moderationStatus === "approved"
      )
        throw forbidden("Only your pending or rejected campaign can be edited");
    }
    if (options.addBudgetCredits !== undefined) {
      const extra = fundingMicros(options.addBudgetCredits);
      if (extra <= 0n) throw badRequest("A positive top-up is required");
      patch = {
        ...patch,
        totalBudgetCredits: new Decimal(quest.totalBudgetCredits)
          .plus(options.addBudgetCredits)
          .toFixed(6),
      };
    }

    const [funding] = await tx
      .select()
      .from(schema.sponsoredQuestFunding)
      .where(eq(schema.sponsoredQuestFunding.questId, questId))
      .for("update");
    if (funding) {
      for (const key of [
        "rewardCoins",
        "maxApplications",
        "creatorSharePercent",
        "platformSharePercent",
        "cpmCredits",
        "isDailyQuestEligible",
        "targetAction",
        "targetValue",
      ] as const) {
        if (
          patch[key] !== undefined &&
          (key === "cpmCredits"
            ? !new Decimal(String(patch[key])).eq(String(quest[key]))
            : String(patch[key]) !== String(quest[key]))
        )
          throw badRequest(
            "Funded reward, application and action terms are immutable; create a new campaign",
            "SPONSORED_TERMS_IMMUTABLE",
          );
      }
      if (
        patch.isActive &&
        ((funding.marketingClosed && quest.isDailyQuestEligible) ||
          funding.applicationsClosed)
      )
        throw badRequest(
          "This funded campaign has closed; create a new campaign",
        );
      if (patch.totalBudgetCredits !== undefined) {
        const next = fundingMicros(patch.totalBudgetCredits),
          previous = fundingMicros(quest.totalBudgetCredits);
        if (next < previous)
          throw badRequest("Cancel the campaign to refund unused budget");
        if (next > previous) {
          if (funding.payerId !== actorId)
            throw forbidden(
              "Only the original payer can fund a budget increase",
            );
          if (funding.marketingClosed || !quest.isDailyQuestEligible)
            throw badRequest("The marketing reserve is closed or disabled");
          const extra =
            (next + MICRO - 1n) / MICRO - (previous + MICRO - 1n) / MICRO;
          if (extra)
            await checkAndDebit(
              actorId,
              Number(extra),
              "sponsored_quest_funding",
              `sponsored-topup:${questId}:${next}`,
              "Sponsored campaign budget increase",
              { questId },
              tx,
            );
          await tx
            .update(schema.sponsoredQuestFunding)
            .set({
              reservedCoins: sql`${schema.sponsoredQuestFunding.reservedCoins}+${extra}`,
              marketingBalanceMicros: sql`${schema.sponsoredQuestFunding.marketingBalanceMicros}+${extra * MICRO}`,
            })
            .where(eq(schema.sponsoredQuestFunding.questId, questId));
        }
      }
    } else if (patch.isActive)
      throw badRequest(
        "Explicitly fund this legacy campaign before activating it",
        "SPONSORED_FUNDING_REQUIRED",
      );
    await tx
      .update(schema.sponsoredQuests)
      .set(patch)
      .where(eq(schema.sponsoredQuests.id, questId));
  });
}
export async function consumeSponsoredDailyReward(
  tx: DbOrTx,
  questId: string,
  userId: string,
  day: string,
) {
  await tx
    .select({ id: schema.sponsoredQuests.id })
    .from(schema.sponsoredQuests)
    .where(eq(schema.sponsoredQuests.id, questId))
    .for("update");
  const [claim] = await tx
    .update(schema.sponsoredDailyReservations)
    .set({ state: "paid" })
    .where(
      and(
        eq(schema.sponsoredDailyReservations.questId, questId),
        eq(schema.sponsoredDailyReservations.userId, userId),
        eq(schema.sponsoredDailyReservations.assignedDate, day),
        eq(schema.sponsoredDailyReservations.state, "reserved"),
      ),
    )
    .returning({ amount: schema.sponsoredDailyReservations.rewardCoins });
  if (!claim)
    throw badRequest(
      "This sponsored reward has no live funding reservation",
      "SPONSORED_REWARD_UNFUNDED",
    );
  return Number(claim.amount);
}
export async function deliverSponsoredRefund(task: DurableTask) {
  const { questId, part, amount, payerId } = task.payload;
  if (
    typeof questId !== "string" ||
    !["marketing", "applications"].includes(String(part)) ||
    typeof payerId !== "string" ||
    typeof amount !== "number" ||
    !Number.isSafeInteger(amount) ||
    amount <= 0
  )
    throw new Error("Invalid sponsored refund intent");
  const db = await getDb();
  const [funding] = await db
    .select()
    .from(schema.sponsoredQuestFunding)
    .where(eq(schema.sponsoredQuestFunding.questId, questId));
  if (
    !funding ||
    funding.payerId !== payerId ||
    !funding[part === "marketing" ? "marketingClosed" : "applicationsClosed"]
  )
    throw new Error("Sponsored refund authority is unavailable");
  await db.transaction((tx) =>
    creditCoins(
      payerId,
      amount,
      "sponsored_quest_refund",
      `sponsored-refund:${questId}:${part}`,
      "Unused sponsored campaign reserve",
      { questId, part },
      tx,
    ),
  );
}
/** Return expired daily reservations and close unused reserves in bounded,
 * replay-safe transactions; committed refund intents survive delivery failure. */
export async function sweepSponsoredFunding(
  continuationKey: string = randomUUID(),
) {
  const db = await getDb();
  let more = false;
  const due = await db.execute<{
    quest_id: string;
  }>(sql`SELECT f.quest_id FROM sponsored_quest_funding f JOIN sponsored_quests q ON q.id=f.quest_id WHERE
 EXISTS(SELECT 1 FROM sponsored_daily_reservations r WHERE r.quest_id=f.quest_id AND r.state='reserved' AND r.assigned_date<(NOW() AT TIME ZONE 'UTC')::date)
 OR ((q.deleted_at IS NOT NULL OR COALESCE(q.ends_at,q.deadline)<=NOW()) AND NOT f.marketing_closed AND NOT EXISTS(SELECT 1 FROM sponsored_daily_reservations r WHERE r.quest_id=f.quest_id AND r.state='reserved'))
 OR ((q.deleted_at IS NOT NULL OR q.deadline<=NOW()) AND NOT f.applications_closed AND NOT EXISTS(SELECT 1 FROM sponsored_quest_applications a WHERE a.quest_id=f.quest_id AND a.status IN ('completed','approved')))
 ORDER BY f.quest_id LIMIT 11`);
  for (const row of due.rows.slice(0, 10))
    await db.transaction(async (tx) => {
      const [q] = await tx
        .select()
        .from(schema.sponsoredQuests)
        .where(eq(schema.sponsoredQuests.id, row.quest_id))
        .for("update");
      const [f] = await tx
        .select()
        .from(schema.sponsoredQuestFunding)
        .where(eq(schema.sponsoredQuestFunding.questId, row.quest_id))
        .for("update");
      const released = await tx.execute<{ reward_coins: string }>(
        sql`UPDATE sponsored_daily_reservations SET state='released' WHERE id IN(SELECT id FROM sponsored_daily_reservations WHERE quest_id=${q.id} AND state='reserved' AND assigned_date<(NOW() AT TIME ZONE 'UTC')::date ORDER BY id LIMIT 100 FOR UPDATE) RETURNING reward_coins::text`,
      );
      if (released.rows.length === 100) more = true;
      const returned = released.rows.reduce(
        (sum, item) => sum + BigInt(item.reward_coins),
        0n,
      );
      if (returned) {
        f.marketingBalanceMicros += returned * MICRO;
        await tx
          .update(schema.sponsoredQuests)
          .set({
            spentCredits: sql`${schema.sponsoredQuests.spentCredits}-${returned}`,
          })
          .where(eq(schema.sponsoredQuests.id, q.id));
      }
      const outstanding = await tx
        .select({ id: schema.sponsoredDailyReservations.id })
        .from(schema.sponsoredDailyReservations)
        .where(
          and(
            eq(schema.sponsoredDailyReservations.questId, q.id),
            eq(schema.sponsoredDailyReservations.state, "reserved"),
          ),
        )
        .limit(1);
      const closeMarketing =
        !!q.deletedAt ||
        (!!(q.endsAt ?? q.deadline) && (q.endsAt ?? q.deadline)! <= new Date());
      let refund = 0n;
      const schedule = async (
        part: "marketing" | "applications",
        amount: bigint,
      ) => {
        if (!amount) return;
        refund += amount;
        await enqueueTask(
          tx,
          "sponsored_refund",
          `sponsored-refund:${q.id}:${part}`,
          null,
          { questId: q.id, part, amount: Number(amount), payerId: f.payerId },
        );
      };
      if (closeMarketing && !f.marketingClosed && !outstanding.length) {
        f.marketingClosed = true;
        await schedule("marketing", f.marketingBalanceMicros / MICRO);
        f.roundingMicros = f.marketingBalanceMicros % MICRO;
        f.marketingBalanceMicros = 0n;
      }
      if (
        (q.deletedAt || (q.deadline && q.deadline <= new Date())) &&
        !f.applicationsClosed
      ) {
        // Unfinished applications cannot submit after closure; completed work keeps
        // its reserve until an administrator approves or rejects it.
        await tx
          .update(schema.sponsoredQuestApplications)
          .set({ status: "rejected", updatedAt: new Date() })
          .where(
            and(
              eq(schema.sponsoredQuestApplications.questId, q.id),
              sql`${schema.sponsoredQuestApplications.status} IN ('pending','applied','accepted')`,
            ),
          );
        const open = await tx.execute(
          sql`SELECT 1 FROM sponsored_quest_applications WHERE quest_id=${q.id} AND status IN ('completed','approved') LIMIT 1`,
        );
        if (!open.rows.length) {
          f.applicationsClosed = true;
          await schedule("applications", f.applicationBalanceCoins);
          f.applicationBalanceCoins = 0n;
        }
      }
      await tx
        .update(schema.sponsoredQuestFunding)
        .set({
          marketingBalanceMicros: f.marketingBalanceMicros,
          applicationBalanceCoins: f.applicationBalanceCoins,
          marketingClosed: f.marketingClosed,
          applicationsClosed: f.applicationsClosed,
          roundingMicros: f.roundingMicros,
          refundedCoins: sql`${schema.sponsoredQuestFunding.refundedCoins}+${refund}`,
        })
        .where(eq(schema.sponsoredQuestFunding.questId, q.id));
    });
  // A full page or partially released campaign needs another bounded delivery.
  if (more || due.rows.length >= 10)
    await enqueueTask(
      db,
      "sponsored_maintenance",
      `sponsored-maintenance:${continuationKey}`,
      null,
      {},
    );
  return { processed: Math.min(10, due.rows.length) };
}
