import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import { getDb, schema, type DbOrTx } from "@/lib/db/drizzle";
import { getManifestValue } from "@/lib/manifest";
import { getRankForXP } from "@/lib/xp/engine";
import { badRequest, conflict, forbidden, notFound } from "@/lib/api/errors";
import { debitCoins, creditCoins } from "@/lib/economy/coins";
import { insertNotificationBatch } from "@/lib/notifications/insert";
import { reviewTale, reviewTaleCover } from "./moderation";

export async function taleSetting(key: string, fallback: number) {
  const n = Number((await getManifestValue(key)) ?? fallback);
  return Number.isSafeInteger(n) && n >= 0 && n <= 1000000 ? n : fallback;
}
function publicAuthor(author: SQL): SQL {
  return sql`EXISTS(SELECT 1 FROM users au WHERE au.id=${author} AND au.deleted_at IS NULL AND au.is_banned=FALSE AND NOT(COALESCE(au.is_suspended,FALSE) AND (au.suspended_until IS NULL OR au.suspended_until>NOW()))) AND NOT EXISTS(SELECT 1 FROM tale_account_restrictions ar WHERE ar.user_id=${author} AND ar.state IN ('banned','suspended') AND (ar.expires_at IS NULL OR ar.expires_at>NOW()))`;
}
export async function taleAccount(userId: string, db?: DbOrTx) {
  const orm = db ?? (await getDb());
  const [user] = await orm
    .select()
    .from(schema.users)
    .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)));
  if (
    !user ||
    user.isBanned ||
    (user.isSuspended &&
      (!user.suspendedUntil || user.suspendedUntil > new Date()))
  )
    throw forbidden("This account cannot use Tales.");
  const [restriction] = await orm
    .select()
    .from(schema.taleAccountRestrictions)
    .where(eq(schema.taleAccountRestrictions.userId, userId));
  const state =
    restriction &&
    (!restriction.expiresAt || restriction.expiresAt > new Date())
      ? restriction.state
      : "active";
  if (["banned", "suspended"].includes(state))
    throw forbidden(
      "Your Tales account is restricted.",
      "TALES_ACCOUNT_RESTRICTED",
    );
  return { user, state };
}
export async function listTales(
  userId: string | undefined,
  tab = "new",
  cursor?: string,
  query?: string,
) {
  const orm = await getDb();
  const conditions: SQL[] = [];
  if (tab === "mine") {
    if (!userId) throw forbidden();
    conditions.push(eq(schema.tales.authorId, userId));
  } else
    conditions.push(
      eq(schema.tales.status, "published"),
      eq(schema.tales.moderation, "approved"),
      publicAuthor(sql`${schema.tales.authorId}`),
    );
  if (tab === "subscribed")
    conditions.push(
      sql`EXISTS(SELECT 1 FROM tale_author_subscriptions s WHERE s.author_id=${schema.tales.authorId} AND s.user_id=${userId ?? null})`,
    );
  if (query?.trim())
    conditions.push(
      sql`(${schema.tales.title} ILIKE ${"%" + query.trim() + "%"} OR ${schema.tales.synopsis} ILIKE ${"%" + query.trim() + "%"})`,
    );
  let after:
    { id: string; score: number; tab: string; seed: string } | undefined;
  if (cursor) {
    try {
      after = JSON.parse(cursor);
      if (
        !after ||
        after.tab !== tab ||
        !/^[0-9a-f-]{36}$/i.test(after.id) ||
        !Number.isFinite(after.score) ||
        !/^[0-9a-f-]{36}$/i.test(after.seed)
      )
        throw new Error();
    } catch {
      throw badRequest("Invalid Tales cursor.");
    }
  }
  const seed = after?.seed ?? randomUUID();
  // MD5 prefix fits exactly in a JS number and keeps random pages stable.
  const score =
    tab === "random"
      ? sql<number>`(('x'||substr(md5(${seed}||${schema.tales.id}::text),1,12))::bit(48)::bigint)::float8`
      : tab === "popular"
        ? sql<number>`${schema.tales.votes}::float8`
        : tab === "trending"
          ? sql<number>`(SELECT count(*)::float8 FROM tale_comments c WHERE c.tale_id=${schema.tales.id} AND c.hidden=FALSE AND c.created_at>NOW()-interval '7 days')`
          : sql<number>`extract(epoch FROM ${schema.tales.createdAt})::float8`;
  if (after)
    conditions.push(
      sql`(${score},${schema.tales.id})<(${after.score},${after.id}::uuid)`,
    );
  const rows = await orm
    .select({
      id: schema.tales.id,
      slug: schema.tales.slug,
      title: schema.tales.title,
      synopsis: schema.tales.synopsis,
      coverUrl: schema.tales.coverUrl,
      authorId: schema.tales.authorId,
      status: schema.tales.status,
      moderation: schema.tales.moderation,
      votes: schema.tales.votes,
      score,
    })
    .from(schema.tales)
    .where(and(...conditions))
    .orderBy(sql`${score} DESC,${schema.tales.id} DESC`)
    .limit(21);
  const last = rows.slice(0, 20).at(-1);
  return {
    tales: rows.slice(0, 20).map(({ score: _score, ...item }) => item),
    nextCursor:
      rows.length > 20 && last
        ? JSON.stringify({ score: last.score, id: last.id, tab, seed })
        : null,
  };
}
export async function getTale(slug: string, userId?: string, db?: DbOrTx) {
  const orm = db ?? (await getDb());
  const [story] = await orm
    .select()
    .from(schema.tales)
    .where(
      and(
        eq(schema.tales.slug, slug),
        sql`(${schema.tales.authorId}=${userId ?? null} OR (${schema.tales.status}='published' AND ${schema.tales.moderation}='approved' AND ${publicAuthor(sql`${schema.tales.authorId}`)}))`,
      ),
    );
  if (!story) throw notFound("Story not found.");
  const owner = story.authorId === userId;
  const chapters = await orm
    .select({
      id: schema.taleChapters.id,
      ordinal: schema.taleChapters.ordinal,
      title: schema.taleChapters.title,
      status: schema.taleChapters.status,
      price: schema.taleChapters.price,
      version: schema.taleChapters.version,
      moderation: schema.taleChapters.moderation,
      moderationReason: schema.taleChapters.moderationReason,
      publishAt: schema.taleChapters.publishAt,
    })
    .from(schema.taleChapters)
    .where(
      and(
        eq(schema.taleChapters.taleId, story.id),
        owner
          ? undefined
          : sql`${schema.taleChapters.status}='published' AND ${schema.taleChapters.moderation}='approved' AND (${schema.taleChapters.publishAt} IS NULL OR ${schema.taleChapters.publishAt}<=NOW())`,
      ),
    )
    .orderBy(schema.taleChapters.ordinal);
  return {
    story,
    chapters: chapters.map((c) => ({
      ...c,
      price: c.ordinal === 1 ? 0 : (c.price ?? story.defaultPrice),
      moderationReason: owner ? c.moderationReason : undefined,
    })),
    isOwner: owner,
  };
}
export async function readTaleChapter(
  slug: string,
  ordinal: number,
  userId?: string,
) {
  const orm = await getDb();
  const { story, isOwner, chapters } = await getTale(slug, userId, orm);
  const [chapter] = await orm
    .select()
    .from(schema.taleChapters)
    .where(
      and(
        eq(schema.taleChapters.taleId, story.id),
        eq(schema.taleChapters.ordinal, ordinal),
        isOwner
          ? undefined
          : sql`${schema.taleChapters.status}='published' AND ${schema.taleChapters.moderation}='approved' AND (${schema.taleChapters.publishAt} IS NULL OR ${schema.taleChapters.publishAt}<=NOW())`,
      ),
    );
  if (!chapter) throw notFound("Chapter not found.");
  const cost = ordinal === 1 ? 0 : (chapter.price ?? story.defaultPrice);
  const [unlock] = userId
    ? await orm
        .select({ id: schema.taleUnlocks.chapterId })
        .from(schema.taleUnlocks)
        .where(
          and(
            eq(schema.taleUnlocks.chapterId, chapter.id),
            eq(schema.taleUnlocks.userId, userId),
          ),
        )
    : [];
  const loginRequired = !isOwner && ordinal > 1 && !userId;
  const locked = !isOwner && (loginRequired || (cost > 0 && !unlock));
  return {
    chapter: { ...chapter, body: locked ? null : chapter.body },
    story: {
      id: story.id,
      title: story.title,
      slug: story.slug,
      authorId: story.authorId,
      commentsEnabled: story.commentsEnabled,
    },
    price: cost,
    locked,
    loginRequired,
    isOwner,
    nextOrdinal: chapters.find((c) => c.ordinal > ordinal)?.ordinal ?? null,
  };
}
export interface StoryInput {
  title: string;
  synopsis: string;
  coverUrl?: string | null;
  defaultPrice: number;
  commentsEnabled: boolean;
  notifySubscribers: boolean;
  status: "draft" | "published";
  version?: number;
}
export async function saveTale(userId: string, input: StoryInput, id?: string) {
  const [account, minLevel, publishedLimit, draftLimit] = await Promise.all([
    taleAccount(userId),
    taleSetting("tales_min_level", 2),
    taleSetting("tales_free_published_limit", 10),
    taleSetting("tales_free_draft_limit", 20),
  ]);
  if (getRankForXP(Number(account.user.xpTotal)).rankNumber < minLevel)
    throw forbidden(
      `Reach Level ${minLevel} to write Tales.`,
      "TALES_LEVEL_REQUIRED",
    );
  if (input.defaultPrice > 0 && account.state === "demonetized")
    throw forbidden("Monetization is disabled for this account.");
  const moderation = await reviewTale(`${input.title}\n${input.synopsis}`);
  if (input.coverUrl) {
    const cover = await reviewTaleCover(input.coverUrl);
    if (cover.moderation !== "approved") Object.assign(moderation, cover);
  }
  const orm = await getDb();
  return orm.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT id FROM users WHERE id=${userId} FOR NO KEY UPDATE`,
    );
    const current = await taleAccount(userId, tx);
    const [old] = id
      ? await tx
          .select()
          .from(schema.tales)
          .where(
            and(eq(schema.tales.id, id), eq(schema.tales.authorId, userId)),
          )
          .for("update")
      : [];
    if (id && !old) throw notFound();
    if (old && input.version !== old.version)
      throw conflict("This story changed. Reload before saving.");
    if (current.user.plan === "free") {
      const [usage] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.tales)
        .where(
          and(
            eq(schema.tales.authorId, userId),
            eq(schema.tales.status, input.status),
            id ? sql`${schema.tales.id}<>${id}` : undefined,
          ),
        );
      if (
        usage.count >=
        (input.status === "published" ? publishedLimit : draftLimit)
      )
        throw forbidden(
          "Your story quota is full. Upgrade or remove an unused story.",
          "TALES_QUOTA_REACHED",
        );
    }
    if (input.status === "published") {
      const [first] = old
        ? await tx
            .select({ id: schema.taleChapters.id })
            .from(schema.taleChapters)
            .where(
              and(
                eq(schema.taleChapters.taleId, old.id),
                eq(schema.taleChapters.ordinal, 1),
                eq(schema.taleChapters.moderation, "approved"),
                eq(schema.taleChapters.status, "published"),
              ),
            )
        : [];
      if (!first)
        throw badRequest(
          "Save a draft and publish an approved first chapter before publishing the story.",
        );
    }
    const patch = {
      title: input.title,
      synopsis: input.synopsis,
      coverUrl: input.coverUrl ?? null,
      defaultPrice: input.defaultPrice,
      commentsEnabled: input.commentsEnabled,
      notifySubscribers: input.notifySubscribers,
      status: input.status,
      ...moderation,
      updatedAt: new Date(),
    };
    if (old) {
      const [saved] = await tx
        .update(schema.tales)
        .set({
          ...patch,
          version: old.version + 1,
          publishedAt:
            input.status === "published"
              ? (old.publishedAt ?? new Date())
              : old.publishedAt,
        })
        .where(eq(schema.tales.id, old.id))
        .returning();
      return saved;
    }
    const storyId = randomUUID();
    const slug = `${
      input.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 60) || "story"
    }-${storyId.slice(0, 8)}`;
    const [saved] = await tx
      .insert(schema.tales)
      .values({ ...patch, id: storyId, slug, authorId: userId })
      .returning();
    return saved;
  });
}
export interface ChapterInput {
  ordinal: number;
  title: string;
  body: string;
  price: number | null;
  status: "draft" | "published" | "scheduled";
  publishAt?: string | null;
  version?: number;
}
export async function saveTaleChapter(
  userId: string,
  slug: string,
  input: ChapterInput,
  id?: string,
) {
  const { story, isOwner } = await getTale(slug, userId);
  if (!isOwner) throw forbidden();
  const account = await taleAccount(userId);
  const minLevel = await taleSetting("tales_min_level", 2);
  if (getRankForXP(Number(account.user.xpTotal)).rankNumber < minLevel)
    throw forbidden("Reach the required level to write chapters.");
  if (input.ordinal === 1 && input.price)
    throw badRequest("Chapter one must be free.");
  if (
    input.status === "scheduled" &&
    (account.user.plan === "free" ||
      !input.publishAt ||
      Date.parse(input.publishAt) <= Date.now())
  )
    throw forbidden(
      "A future publish date and a paid plan are required for drip publishing.",
    );
  if (
    (input.price ?? story.defaultPrice) > 0 &&
    account.state === "demonetized"
  )
    throw forbidden("Monetization is disabled.");
  const moderation = await reviewTale(
    `${story.title}\n${input.title}\n${input.body}`,
  );
  const orm = await getDb();
  return orm.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT id FROM users WHERE id=${userId} FOR NO KEY UPDATE`,
    );
    await taleAccount(userId, tx);
    const [locked] = await tx
      .select()
      .from(schema.tales)
      .where(
        and(eq(schema.tales.id, story.id), eq(schema.tales.authorId, userId)),
      )
      .for("update");
    if (!locked) throw forbidden();
    const [old] = id
      ? await tx
          .select()
          .from(schema.taleChapters)
          .where(
            and(
              eq(schema.taleChapters.id, id),
              eq(schema.taleChapters.taleId, story.id),
            ),
          )
          .for("update")
      : [];
    if (!old) {
      const [duplicate] = await tx
        .select({ id: schema.taleChapters.id })
        .from(schema.taleChapters)
        .where(
          and(
            eq(schema.taleChapters.taleId, story.id),
            eq(schema.taleChapters.ordinal, input.ordinal),
          ),
        );
      if (duplicate) throw conflict("That chapter number is already in use.");
    }
    if (id && !old) throw notFound();
    if (old && (input.version !== old.version || input.ordinal !== old.ordinal))
      throw conflict("The chapter changed. Reload before saving.");
    const patch = {
      title: input.title,
      body: input.body,
      price: input.ordinal === 1 ? 0 : input.price,
      status: input.status,
      publishAt:
        input.status === "scheduled" ? new Date(input.publishAt!) : null,
      ...moderation,
      updatedAt: new Date(),
    };
    if (old) {
      const [chapter] = await tx
        .update(schema.taleChapters)
        .set({ ...patch, version: old.version + 1 })
        .where(eq(schema.taleChapters.id, old.id))
        .returning();
      return chapter;
    }
    const [chapter] = await tx
      .insert(schema.taleChapters)
      .values({ ...patch, taleId: story.id, ordinal: input.ordinal })
      .returning();
    return chapter;
  });
}
export async function publishTaleChapters(userId: string, slug: string) {
  const orm = await getDb();
  return orm.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT id FROM users WHERE id=${userId} FOR NO KEY UPDATE`,
    );
    await taleAccount(userId, tx);
    const { story, isOwner } = await getTale(slug, userId, tx);
    if (!isOwner) throw forbidden();
    const rows = await tx
      .update(schema.taleChapters)
      .set({
        status: "published",
        publishAt: null,
        updatedAt: new Date(),
        version: sql`${schema.taleChapters.version}+1`,
      })
      .where(
        and(
          eq(schema.taleChapters.taleId, story.id),
          eq(schema.taleChapters.moderation, "approved"),
          sql`${schema.taleChapters.status}<>'published'`,
        ),
      )
      .returning({ id: schema.taleChapters.id });
    return { published: rows.length };
  });
}
export async function unlockTaleChapter(
  userId: string,
  slug: string,
  ordinal: number,
  confirmedCost: number,
) {
  const { story } = await getTale(slug, userId);
  const share = Math.min(100, await taleSetting("tales_creator_share_pct", 70));
  const orm = await getDb();
  return orm.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT id FROM users WHERE id IN (${userId},${story.authorId}) ORDER BY id FOR NO KEY UPDATE`,
    );
    const reader = await taleAccount(userId, tx);
    void reader;
    const author = await taleAccount(story.authorId, tx);
    const [liveStory] = await tx
      .select()
      .from(schema.tales)
      .where(
        and(
          eq(schema.tales.id, story.id),
          eq(schema.tales.status, "published"),
          eq(schema.tales.moderation, "approved"),
        ),
      )
      .for("share");
    if (!liveStory) throw notFound();
    const [chapter] = await tx
      .select()
      .from(schema.taleChapters)
      .where(
        and(
          eq(schema.taleChapters.taleId, story.id),
          eq(schema.taleChapters.ordinal, ordinal),
          eq(schema.taleChapters.status, "published"),
          eq(schema.taleChapters.moderation, "approved"),
          sql`(${schema.taleChapters.publishAt} IS NULL OR ${schema.taleChapters.publishAt}<=NOW())`,
        ),
      )
      .for("share");
    if (!chapter) throw notFound();
    const cost = ordinal === 1 ? 0 : (chapter.price ?? liveStory.defaultPrice);
    const [existing] = await tx
      .select()
      .from(schema.taleUnlocks)
      .where(
        and(
          eq(schema.taleUnlocks.userId, userId),
          eq(schema.taleUnlocks.chapterId, chapter.id),
        ),
      );
    if (existing || cost === 0 || userId === story.authorId)
      return { alreadyUnlocked: true, cost: 0 };
    if (author.state === "demonetized")
      throw forbidden("Purchases for this author are unavailable.");
    if (cost !== confirmedCost)
      throw badRequest(
        "Review and confirm the current chapter price.",
        "PRICE_CONFIRMATION_REQUIRED",
      );
    const reference = `tale-unlock:${chapter.id}:${userId}`;
    await debitCoins(
      userId,
      cost,
      "tale_unlock",
      reference,
      "Unlocked a Tales chapter",
      { chapterId: chapter.id },
      tx,
    );
    const proceeds = Math.floor((cost * share) / 100);
    if (proceeds > 0)
      await creditCoins(
        story.authorId,
        proceeds,
        "tale_sale",
        `${reference}:author`,
        "Tales chapter sale",
        { chapterId: chapter.id },
        tx,
      );
    await tx
      .insert(schema.taleUnlocks)
      .values({ userId, chapterId: chapter.id, cost });
    return { alreadyUnlocked: false, cost };
  });
}
export async function runTalePublishing() {
  const orm = await getDb();
  return orm.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: schema.taleChapters.id,
        taleId: schema.taleChapters.taleId,
      })
      .from(schema.taleChapters)
      .where(
        and(
          eq(schema.taleChapters.status, "scheduled"),
          eq(schema.taleChapters.moderation, "approved"),
          sql`${schema.taleChapters.publishAt}<=NOW()`,
          sql`EXISTS(SELECT 1 FROM tales t JOIN users u ON u.id=t.author_id WHERE t.id=${schema.taleChapters.taleId} AND u.plan<>'free' AND COALESCE((SELECT s.ends_at>NOW() FROM subscriptions s WHERE s.user_id=u.id AND s.status='active' ORDER BY s.created_at DESC LIMIT 1),TRUE) AND ${publicAuthor(sql`t.author_id`)})`,
        ),
      )
      .limit(100)
      .for("update", { skipLocked: true });
    if (rows.length)
      await tx
        .update(schema.taleChapters)
        .set({ status: "published", updatedAt: new Date() })
        .where(
          sql`${schema.taleChapters.id} IN (${sql.join(
            rows.map((r) => sql`${r.id}::uuid`),
            sql`,`,
          )})`,
        );
    const notifications = await tx
      .select({
        id: schema.taleChapters.id,
        title: schema.taleChapters.title,
        ordinal: schema.taleChapters.ordinal,
        taleId: schema.tales.id,
        slug: schema.tales.slug,
        authorId: schema.tales.authorId,
      })
      .from(schema.taleChapters)
      .innerJoin(schema.tales, eq(schema.tales.id, schema.taleChapters.taleId))
      .where(
        and(
          eq(schema.taleChapters.status, "published"),
          eq(schema.taleChapters.moderation, "approved"),
          eq(schema.taleChapters.notified, false),
          eq(schema.tales.status, "published"),
          eq(schema.tales.moderation, "approved"),
          eq(schema.tales.notifySubscribers, true),
          publicAuthor(sql`${schema.tales.authorId}`),
        ),
      )
      .limit(100)
      .for("update", { of: schema.taleChapters, skipLocked: true });
    for (const chapter of notifications) {
      const subscribers = await tx
        .select({ id: schema.taleAuthorSubscriptions.userId })
        .from(schema.taleAuthorSubscriptions)
        .where(eq(schema.taleAuthorSubscriptions.authorId, chapter.authorId));
      await insertNotificationBatch(
        tx,
        subscribers.map((s) => s.id),
        "tale_new_chapter",
        "New chapter",
        chapter.title,
        { taleSlug: chapter.slug, ordinal: chapter.ordinal },
      );
      await tx
        .update(schema.taleChapters)
        .set({ notified: true })
        .where(eq(schema.taleChapters.id, chapter.id));
    }
    return { published: rows.length, notified: notifications.length };
  });
}

export async function taleSocial(
  userId: string,
  slug: string,
  input: {
    action: "subscribe" | "vote" | "comment" | "hideComment";
    enabled?: boolean;
    body?: string;
    chapterId?: string;
    commentId?: string;
  },
) {
  const orm = await getDb();
  const { story, isOwner } = await getTale(slug, userId);
  await taleAccount(userId);
  if (input.action === "subscribe") {
    if (story.authorId === userId)
      throw badRequest("You cannot subscribe to yourself.");
    if (input.enabled)
      await orm
        .insert(schema.taleAuthorSubscriptions)
        .values({ userId, authorId: story.authorId })
        .onConflictDoNothing();
    else
      await orm
        .delete(schema.taleAuthorSubscriptions)
        .where(
          and(
            eq(schema.taleAuthorSubscriptions.userId, userId),
            eq(schema.taleAuthorSubscriptions.authorId, story.authorId),
          ),
        );
    return { subscribed: !!input.enabled };
  }
  if (input.action === "hideComment") {
    if (!isOwner) throw forbidden();
    await orm
      .update(schema.taleComments)
      .set({ hidden: input.enabled ?? true })
      .where(
        and(
          eq(schema.taleComments.id, input.commentId!),
          eq(schema.taleComments.taleId, story.id),
        ),
      );
    return { updated: true };
  }
  if (story.status !== "published" || story.moderation !== "approved")
    throw forbidden("Only published stories support reader activity.");
  if (input.action === "vote")
    return orm.transaction(async (tx) => {
      const changed = input.enabled
        ? await tx
            .insert(schema.taleVotes)
            .values({ userId, taleId: story.id })
            .onConflictDoNothing()
            .returning()
        : await tx
            .delete(schema.taleVotes)
            .where(
              and(
                eq(schema.taleVotes.userId, userId),
                eq(schema.taleVotes.taleId, story.id),
              ),
            )
            .returning();
      if (changed.length)
        await tx
          .update(schema.tales)
          .set({
            votes: sql`GREATEST(0,${schema.tales.votes}+${input.enabled ? 1 : -1})`,
          })
          .where(eq(schema.tales.id, story.id));
      return { voted: !!input.enabled };
    });
  if (!story.commentsEnabled)
    throw forbidden("The author has disabled comments.");
  if (input.chapterId) {
    const [chapter] = await orm
      .select({ ordinal: schema.taleChapters.ordinal })
      .from(schema.taleChapters)
      .where(
        and(
          eq(schema.taleChapters.id, input.chapterId),
          eq(schema.taleChapters.taleId, story.id),
        ),
      );
    if (!chapter) throw notFound();
    const access = await readTaleChapter(slug, chapter.ordinal, userId);
    if (access.locked) throw forbidden("Read the chapter before commenting.");
  }
  const { filterProfanity } = await import("@/lib/moderation/contentFilter");
  const text = filterProfanity(input.body ?? "").filtered;
  if (!text.trim() || text.length > 2000)
    throw badRequest("Comment must be between 1 and 2000 characters.");
  const [comment] = await orm
    .insert(schema.taleComments)
    .values({
      userId,
      taleId: story.id,
      chapterId: input.chapterId ?? null,
      body: text,
    })
    .returning();
  return { comment };
}
export async function taleComments(
  slug: string,
  userId?: string,
  cursor?: string,
) {
  const orm = await getDb();
  const { story, isOwner } = await getTale(slug, userId);
  if (!story.commentsEnabled && !isOwner)
    return { comments: [], nextCursor: null };
  let after: { id: string; time: string } | undefined;
  if (cursor) {
    try {
      after = JSON.parse(cursor);
      if (
        !after ||
        !/^[0-9a-f-]{36}$/i.test(after.id) ||
        !Number.isFinite(Date.parse(after.time))
      )
        throw new Error();
    } catch {
      throw badRequest("Invalid comments cursor.");
    }
  }
  const comments = await orm
    .select({
      id: schema.taleComments.id,
      userId: schema.taleComments.userId,
      body: schema.taleComments.body,
      hidden: schema.taleComments.hidden,
      chapterId: schema.taleComments.chapterId,
      createdAt: schema.taleComments.createdAt,
      cursorTime: sql<string>`to_char(${schema.taleComments.createdAt} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    })
    .from(schema.taleComments)
    .where(
      and(
        eq(schema.taleComments.taleId, story.id),
        isOwner ? undefined : eq(schema.taleComments.hidden, false),
        after
          ? sql`(${schema.taleComments.createdAt},${schema.taleComments.id})<(${after.time}::timestamptz,${after.id}::uuid)`
          : undefined,
      ),
    )
    .orderBy(
      sql`${schema.taleComments.createdAt} DESC,${schema.taleComments.id} DESC`,
    )
    .limit(21);
  const last = comments.slice(0, 20).at(-1);
  return {
    comments: comments.slice(0, 20).map(({ cursorTime: _time, ...c }) => c),
    nextCursor:
      comments.length > 20 && last
        ? JSON.stringify({ id: last.id, time: last.cursorTime })
        : null,
  };
}
export async function appealTale(
  userId: string,
  input: {
    targetType: "story" | "chapter" | "account";
    targetId: string;
    reason: string;
  },
) {
  const limit = await taleSetting("tales_appeal_limit", 3);
  const orm = await getDb();
  return orm.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT id FROM users WHERE id=${userId} FOR NO KEY UPDATE`,
    );
    let version: number;
    if (input.targetType === "story") {
      const [t] = await tx
        .select()
        .from(schema.tales)
        .where(
          and(
            eq(schema.tales.id, input.targetId),
            eq(schema.tales.authorId, userId),
          ),
        );
      if (!t || t.moderation !== "rejected")
        throw forbidden("Only a rejected story can be appealed.");
      version = t.version;
    } else if (input.targetType === "chapter") {
      const [c] = await tx
        .select({
          version: schema.taleChapters.version,
          moderation: schema.taleChapters.moderation,
          author: schema.tales.authorId,
        })
        .from(schema.taleChapters)
        .innerJoin(
          schema.tales,
          eq(schema.tales.id, schema.taleChapters.taleId),
        )
        .where(eq(schema.taleChapters.id, input.targetId));
      if (!c || c.author !== userId || c.moderation !== "rejected")
        throw forbidden("Only your rejected chapter can be appealed.");
      version = c.version;
    } else {
      if (input.targetId !== userId) throw forbidden();
      const [a] = await tx
        .select()
        .from(schema.taleAccountRestrictions)
        .where(eq(schema.taleAccountRestrictions.userId, userId));
      if (!a || a.state === "active")
        throw forbidden("No Tales account restriction to appeal.");
      version = a.version;
    }
    const appeals = await tx
      .select({ status: schema.taleAppeals.status })
      .from(schema.taleAppeals)
      .where(
        and(
          eq(schema.taleAppeals.userId, userId),
          eq(schema.taleAppeals.targetType, input.targetType),
          eq(schema.taleAppeals.targetId, input.targetId),
        ),
      );
    if (appeals.some((a) => a.status === "pending"))
      throw conflict("An appeal is already awaiting review.");
    if (appeals.length >= limit)
      throw forbidden("The appeal limit has been reached.");
    const [appeal] = await tx
      .insert(schema.taleAppeals)
      .values({ ...input, userId, targetVersion: version })
      .returning();
    return appeal;
  });
}
