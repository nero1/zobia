import { and, eq, sql } from "drizzle-orm";
import { taleAuth } from "@/lib/tales/api";
import { getDb, schema } from "@/lib/db/drizzle";
import { taleSetting } from "@/lib/tales/service";
import { getRankForXP } from "@/lib/xp/engine";
export const GET = taleAuth(async (_req, { auth }) => {
  const db = await getDb();
  const [[user], [restriction], usage, minLevel, publishedLimit, draftLimit] =
    await Promise.all([
      db
        .select({ plan: schema.users.plan, xp: schema.users.xpTotal })
        .from(schema.users)
        .where(eq(schema.users.id, auth.user.sub)),
      db
        .select()
        .from(schema.taleAccountRestrictions)
        .where(eq(schema.taleAccountRestrictions.userId, auth.user.sub)),
      db
        .select({
          status: schema.tales.status,
          count: sql<number>`count(*)::int`,
        })
        .from(schema.tales)
        .where(eq(schema.tales.authorId, auth.user.sub))
        .groupBy(schema.tales.status),
      taleSetting("tales_min_level", 2),
      taleSetting("tales_free_published_limit", 10),
      taleSetting("tales_free_draft_limit", 20),
    ]);
  const active =
    restriction &&
    (!restriction.expiresAt || restriction.expiresAt > new Date())
      ? restriction
      : null;
  return {
    canWrite:
      getRankForXP(Number(user.xp)).rankNumber >= minLevel &&
      !["banned", "suspended"].includes(active?.state ?? ""),
    restriction: active,
    minLevel,
    plan: user.plan,
    published: usage.find((u) => u.status === "published")?.count ?? 0,
    drafts: usage.find((u) => u.status === "draft")?.count ?? 0,
    publishedLimit: user.plan === "free" ? publishedLimit : null,
    draftLimit: user.plan === "free" ? draftLimit : null,
  };
});
