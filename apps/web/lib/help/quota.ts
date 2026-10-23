import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { getManifestValue } from "@/lib/manifest";
import { debitCoins, creditCoins } from "@/lib/economy/coins";
import { ApiError, badRequest, conflict } from "@/lib/api/errors";
import { askAi } from "./service";

export function helpWeek(now = new Date()): { startsAt: Date; resetsAt: Date } {
  const startsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  startsAt.setUTCDate(startsAt.getUTCDate() - (startsAt.getUTCDay() + 6) % 7);
  return { startsAt, resetsAt: new Date(startsAt.getTime() + 7 * 86_400_000) };
}

async function configuredInt(key: string, fallback: number) {
  const parsed = Number(await getManifestValue(key) ?? fallback);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export async function askWithQuota(input: { userId: string; requestId: string; question: string; docId?: string; confirmPaid: boolean; confirmedCost?: number }) {
  const orm = await getDb();
  const week = helpWeek();
  // Resolve cached configuration before taking account locks; never hold the
  // entire small connection pool while a manifest refresh needs a connection.
  const [limits, cost] = await Promise.all([
    Promise.all(Object.entries({ free: 20, plus: 50, pro: 100, max: 200 }).map(async ([plan, fallback]) => [plan, await configuredInt(`help_ai_weekly_limit_${plan}`, fallback)] as const)).then(Object.fromEntries),
    configuredInt("help_ai_question_cost_credits", 5),
  ]);
  const reservation = await orm.transaction(async (tx) => {
    // Shared lock with every other wallet mutation; serializes simultaneous questions.
    const [user] = await tx.select({ plan: schema.users.plan }).from(schema.users).where(eq(schema.users.id, input.userId)).for("update");
    if (!user) throw badRequest("User not found");
    const limit = limits[user.plan || "free"] ?? 20;
    const [existing] = await tx.select().from(schema.helpAiRequests).where(and(eq(schema.helpAiRequests.userId, input.userId), eq(schema.helpAiRequests.requestId, input.requestId))).limit(1);
    if (existing) {
      if (existing.question !== input.question || existing.docId !== (input.docId ?? null)) throw conflict("A request ID cannot be reused for another question.");
      if (existing.status === "complete") {
        const [usage] = await tx.select({ count: sql<number>`count(*)::int` }).from(schema.helpAiRequests).where(and(eq(schema.helpAiRequests.userId, input.userId), sql`${schema.helpAiRequests.weekStart} = ${week.startsAt}`, sql`${schema.helpAiRequests.status} IN ('pending', 'complete')`));
        return { cached: existing.answer!, limit, used: usage.count, cost: existing.costCredits };
      }
      throw conflict(existing.status === "pending" ? "Your answer is still being prepared." : "This request failed. Please submit a new question.");
    }
    // Recover reservations left by a terminated worker. Refund before releasing quota.
    const stale = await tx.select().from(schema.helpAiRequests).where(and(eq(schema.helpAiRequests.userId, input.userId), eq(schema.helpAiRequests.status, "pending"), sql`${schema.helpAiRequests.createdAt} < NOW() - INTERVAL '10 minutes'`));
    for (const request of stale) {
      if (request.costCredits > 0) await creditCoins(input.userId, request.costCredits, "refund", `help-ai:${request.id}:refund`, "AI help refund", null, tx);
      await tx.update(schema.helpAiRequests).set({ status: "failed" }).where(eq(schema.helpAiRequests.id, request.id));
    }
    const [usage] = await tx.select({ count: sql<number>`count(*)::int` }).from(schema.helpAiRequests).where(and(eq(schema.helpAiRequests.userId, input.userId), sql`${schema.helpAiRequests.weekStart} = ${week.startsAt}`, sql`${schema.helpAiRequests.status} IN ('pending', 'complete')`));
    const used = usage.count;
    const paid = used >= limit;
    if (paid && (!input.confirmPaid || input.confirmedCost !== cost || cost < 1)) throw new ApiError(403, "HELP_AI_WEEKLY_LIMIT", "Your weekly AI help allowance is used up. Wait for the reset, upgrade, or confirm a paid question.", undefined, undefined, { used, limit, cost, resetsAt: week.resetsAt.toISOString() });
    const [request] = await tx.insert(schema.helpAiRequests).values({ userId: input.userId, requestId: input.requestId, question: input.question, docId: input.docId ?? null, weekStart: week.startsAt, costCredits: paid ? cost : 0 }).returning({ id: schema.helpAiRequests.id });
    if (paid) await debitCoins(input.userId, cost, "support_ticket_cost", `help-ai:${request.id}`, "AI help question", null, tx);
    return { id: request.id, limit, used: used + 1, cost: paid ? cost : 0 };
  });
  if ("cached" in reservation) return { answer: reservation.cached, usage: { used: reservation.used, limit: reservation.limit, cost: reservation.cost, resetsAt: week.resetsAt.toISOString() } };
  let answer: string;
  try {
    answer = await askAi(input.question, input.docId);
  } catch (error) {
    await orm.transaction(async (tx) => {
      await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, input.userId)).for("update");
      const [row] = await tx.select().from(schema.helpAiRequests).where(eq(schema.helpAiRequests.id, reservation.id)).for("update");
      if (row.status !== "pending") return;
      if (row.costCredits > 0) await creditCoins(input.userId, row.costCredits, "refund", `help-ai:${row.id}:refund`, "AI help refund", null, tx);
      await tx.update(schema.helpAiRequests).set({ status: "failed" }).where(eq(schema.helpAiRequests.id, row.id));
    });
    throw error;
  }
  const updated = await orm.update(schema.helpAiRequests).set({ status: "complete", answer }).where(and(eq(schema.helpAiRequests.id, reservation.id), eq(schema.helpAiRequests.status, "pending"))).returning({ id: schema.helpAiRequests.id });
  if (!updated.length) throw conflict("This request timed out and was refunded. Please ask again.");
  return { answer, usage: { used: reservation.used, limit: reservation.limit, cost: reservation.cost, resetsAt: week.resetsAt.toISOString() } };
}
