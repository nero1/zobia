import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { conflict, notFound } from "@/lib/api/errors";
import { insertNotification } from "@/lib/notifications/insert";
export async function taleModerationQueue() {
  const db = await getDb();
  const [stories, chapters, appeals, accounts] = await Promise.all([
    db
      .select()
      .from(schema.tales)
      .where(
        sql`${schema.tales.moderation}='pending' OR EXISTS(SELECT 1 FROM tale_appeals a WHERE a.target_id=${schema.tales.id} AND a.target_type='story' AND a.status='pending')`,
      )
      .orderBy(schema.tales.createdAt)
      .limit(50),
    db
      .select()
      .from(schema.taleChapters)
      .where(
        sql`${schema.taleChapters.moderation}='pending' OR EXISTS(SELECT 1 FROM tale_appeals a WHERE a.target_id=${schema.taleChapters.id} AND a.target_type='chapter' AND a.status='pending')`,
      )
      .orderBy(schema.taleChapters.createdAt)
      .limit(50),
    db
      .select()
      .from(schema.taleAppeals)
      .where(eq(schema.taleAppeals.status, "pending"))
      .orderBy(schema.taleAppeals.createdAt)
      .limit(50),
    db
      .select()
      .from(schema.taleAccountRestrictions)
      .orderBy(schema.taleAccountRestrictions.updatedAt)
      .limit(50),
  ]);
  return { stories, chapters, appeals, accounts };
}
export async function moderateTale(
  staffId: string,
  input: {
    targetType: "story" | "chapter" | "account";
    targetId: string;
    version: number;
    decision:
      | "approved"
      | "rejected"
      | "active"
      | "banned"
      | "suspended"
      | "demonetized";
    reason: string;
    expiresAt?: string | null;
    appealId?: string;
  },
) {
  const db = await getDb();
  let targetAuthor = input.targetId;
  if (input.targetType === "story") {
    const [story] = await db
      .select({ author: schema.tales.authorId })
      .from(schema.tales)
      .where(eq(schema.tales.id, input.targetId));
    if (!story) throw notFound();
    targetAuthor = story.author;
  } else if (input.targetType === "chapter") {
    const [chapter] = await db
      .select({ author: schema.tales.authorId })
      .from(schema.taleChapters)
      .innerJoin(schema.tales, eq(schema.tales.id, schema.taleChapters.taleId))
      .where(eq(schema.taleChapters.id, input.targetId));
    if (!chapter) throw notFound();
    targetAuthor = chapter.author;
  }
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT id FROM users WHERE id IN (${targetAuthor},${staffId}) ORDER BY id FOR NO KEY UPDATE`,
    );
    let authorId: string;
    if (input.targetType === "account") {
      await tx.execute(
        sql`SELECT id FROM users WHERE id=${input.targetId} FOR UPDATE`,
      );
      const [account] = await tx
        .select()
        .from(schema.taleAccountRestrictions)
        .where(eq(schema.taleAccountRestrictions.userId, input.targetId))
        .for("update");
      if ((account?.version ?? 0) !== input.version)
        throw conflict("Restriction changed; refresh the queue.");
      authorId = input.targetId;
      const value = {
        userId: authorId,
        state: input.decision,
        reason: input.reason,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        version: (account?.version ?? 0) + 1,
        updatedAt: new Date(),
      };
      await tx
        .insert(schema.taleAccountRestrictions)
        .values(value)
        .onConflictDoUpdate({
          target: schema.taleAccountRestrictions.userId,
          set: value,
        });
    } else if (input.targetType === "story") {
      const [story] = await tx
        .select()
        .from(schema.tales)
        .where(eq(schema.tales.id, input.targetId))
        .for("update");
      if (!story) throw notFound();
      if (story.version !== input.version)
        throw conflict("Content changed; refresh before deciding.");
      authorId = story.authorId;
      await tx
        .update(schema.tales)
        .set({ moderation: input.decision, moderationReason: input.reason })
        .where(eq(schema.tales.id, story.id));
    } else {
      const [chapter] = await tx
        .select()
        .from(schema.taleChapters)
        .where(eq(schema.taleChapters.id, input.targetId))
        .for("update");
      if (!chapter) throw notFound();
      if (chapter.version !== input.version)
        throw conflict("Content changed; refresh before deciding.");
      const [story] = await tx
        .select({ authorId: schema.tales.authorId })
        .from(schema.tales)
        .where(eq(schema.tales.id, chapter.taleId));
      authorId = story.authorId;
      await tx
        .update(schema.taleChapters)
        .set({ moderation: input.decision, moderationReason: input.reason })
        .where(eq(schema.taleChapters.id, chapter.id));
    }
    if (input.appealId) {
      const [appeal] = await tx
        .select()
        .from(schema.taleAppeals)
        .where(
          and(
            eq(schema.taleAppeals.id, input.appealId),
            eq(schema.taleAppeals.status, "pending"),
          ),
        )
        .for("update");
      if (
        !appeal ||
        appeal.targetId !== input.targetId ||
        appeal.targetType !== input.targetType ||
        appeal.targetVersion !== input.version
      )
        throw conflict("Appeal no longer matches this content version.");
      await tx
        .update(schema.taleAppeals)
        .set({
          status: ["approved", "active"].includes(input.decision)
            ? "accepted"
            : "rejected",
          decisionReason: input.reason,
        })
        .where(eq(schema.taleAppeals.id, appeal.id));
    }
    await tx.insert(schema.taleModerationLog).values({
      staffId,
      targetType: input.targetType,
      targetId: input.targetId,
      decision: input.decision,
      reason: input.reason,
      version: input.version,
    });
    await insertNotification(
      tx,
      authorId,
      "tale_moderation",
      "Tales moderation update",
      input.reason,
      { targetType: input.targetType, targetId: input.targetId },
    );
    return { updated: true };
  });
}
