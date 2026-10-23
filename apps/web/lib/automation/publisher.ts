import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema, type DbOrTx } from "@/lib/db/drizzle";
import { badRequest, forbidden, notFound } from "@/lib/api/errors";
import { requireFeatureEnabled } from "@/lib/manifest";
import { getMaxBlogPosts, getMaxWordsForPlan } from "@/lib/blogs/limits";
import { getMaxWikiPages } from "@/lib/wiki/limits";
import { sanitizeBlogPostHtml } from "@/lib/security/htmlSanitizer";
import { syncContentHashtags } from "@/lib/hashtags/service";
import { insertNotificationBatch } from "@/lib/notifications/insert";
type Target = { accountId: string; targetType: string; targetId: string };
export async function automationDestination(
  target: Target,
  db?: DbOrTx,
  lock = false,
) {
  const orm = db ?? (await getDb());
  const { targetType, targetId, accountId } = target;
  if (targetType === "forum") {
    let query = orm
      .select()
      .from(schema.bbBoards)
      .where(
        and(
          eq(schema.bbBoards.id, targetId),
          eq(schema.bbBoards.isActive, true),
        ),
      );
    const [board] = await (lock ? query.for("update") : query);
    if (!board) throw notFound("Active public forum board not found.");
    const recent = await orm
      .select({ title: schema.bbThreads.title })
      .from(schema.bbThreads)
      .where(
        and(
          eq(schema.bbThreads.boardId, targetId),
          eq(schema.bbThreads.status, "visible"),
          isNull(schema.bbThreads.deletedAt),
        ),
      )
      .orderBy(sql`${schema.bbThreads.createdAt} DESC`)
      .limit(15);
    return {
      name: board.name,
      description: board.description ?? "",
      recent: recent.map((r) => r.title).join("\n"),
    };
  }
  if (targetType === "blog") {
    const query = orm
      .select()
      .from(schema.blogs)
      .where(
        and(
          eq(schema.blogs.id, targetId),
          eq(schema.blogs.ownerId, accountId),
          eq(schema.blogs.status, "active"),
          isNull(schema.blogs.deletedAt),
        ),
      );
    const [blog] = await (lock ? query.for("update") : query);
    if (!blog)
      throw forbidden("Select an active blog owned by the official account.");
    const recent = await orm
      .select({ title: schema.blogPosts.title, body: schema.blogPosts.excerpt })
      .from(schema.blogPosts)
      .where(
        and(
          eq(schema.blogPosts.blogId, targetId),
          eq(schema.blogPosts.status, "published"),
          isNull(schema.blogPosts.deletedAt),
        ),
      )
      .orderBy(sql`${schema.blogPosts.createdAt} DESC`)
      .limit(15);
    return {
      name: blog.title,
      description: blog.description ?? blog.tagline ?? "",
      recent: recent.map((r) => `${r.title}: ${r.body ?? ""}`).join("\n"),
    };
  }
  if (targetType === "wiki") {
    const query = orm
      .select()
      .from(schema.wikis)
      .where(
        and(
          eq(schema.wikis.id, targetId),
          eq(schema.wikis.ownerId, accountId),
          eq(schema.wikis.status, "active"),
          isNull(schema.wikis.deletedAt),
        ),
      );
    const [wiki] = await (lock ? query.for("update") : query);
    if (!wiki)
      throw forbidden("Select an active wiki owned by the official account.");
    const recent = await orm
      .select({
        title: schema.wikiPages.title,
        body: schema.wikiPages.contentMarkdown,
      })
      .from(schema.wikiPages)
      .where(
        and(
          eq(schema.wikiPages.wikiId, targetId),
          eq(schema.wikiPages.status, "published"),
          isNull(schema.wikiPages.deletedAt),
        ),
      )
      .orderBy(sql`${schema.wikiPages.createdAt} DESC`)
      .limit(10);
    return {
      name: wiki.name,
      description: wiki.description ?? "",
      recent: recent
        .map((r) => `${r.title}: ${r.body.slice(0, 1200)}`)
        .join("\n"),
    };
  }
  if (targetType === "room") {
    const query = orm
      .select()
      .from(schema.rooms)
      .where(
        and(
          eq(schema.rooms.id, targetId),
          eq(schema.rooms.creatorId, accountId),
          eq(schema.rooms.type, "free_open"),
          eq(schema.rooms.isPublic, true),
          eq(schema.rooms.isSuspended, false),
          isNull(schema.rooms.deletedAt),
        ),
      );
    const [room] = await (lock ? query.for("update") : query);
    if (!room)
      throw forbidden(
        "Only a public free-open room owned by the official account is eligible.",
      );
    const recent = await orm
      .select({ body: schema.roomMessages.content })
      .from(schema.roomMessages)
      .where(
        and(
          eq(schema.roomMessages.roomId, targetId),
          eq(schema.roomMessages.isDeleted, false),
        ),
      )
      .orderBy(sql`${schema.roomMessages.createdAt} DESC`)
      .limit(15);
    return {
      name: room.name,
      description: room.description ?? "",
      recent: recent.map((r) => r.body?.slice(0, 300) ?? "").join("\n"),
    };
  }
  throw badRequest("Unknown automated-content destination.");
}
export async function automationPublicationPolicy(target: Target) {
  const feature = {
    forum: "bbforum",
    blog: "blogs",
    wiki: "wiki",
    room: "rooms",
  }[target.targetType];
  if (!feature) throw badRequest("Unknown destination.");
  await requireFeatureEnabled(
    feature as Parameters<typeof requireFeatureEnabled>[0],
  );
  const db = await getDb();
  const [account] = await db
    .select({ user: schema.users, enabled: schema.automationAccounts.enabled })
    .from(schema.automationAccounts)
    .innerJoin(
      schema.users,
      eq(schema.users.id, schema.automationAccounts.userId),
    )
    .where(eq(schema.users.id, target.accountId));
  if (
    !account?.enabled ||
    account.user.deletedAt ||
    account.user.isBanned ||
    (account.user.isSuspended &&
      (!account.user.suspendedUntil ||
        account.user.suspendedUntil > new Date()))
  )
    throw forbidden("Official account is disabled or restricted.");
  const user = account.user;
  return {
    plan: user.plan,
    maxPosts: await getMaxBlogPosts(user.plan),
    maxWords: await getMaxWordsForPlan(user.plan),
    maxPages: await getMaxWikiPages(user.plan),
  };
}
/** Runs within the generation transaction: publishing and its audit state cannot diverge. No XP/quest rewards are issued to automation. */
export async function publishAutomationContent(
  tx: DbOrTx,
  generation: typeof schema.automationGenerations.$inferSelect,
  policy: Awaited<ReturnType<typeof automationPublicationPolicy>>,
) {
  const [account] = await tx
    .select({ user: schema.users, enabled: schema.automationAccounts.enabled })
    .from(schema.automationAccounts)
    .innerJoin(
      schema.users,
      eq(schema.users.id, schema.automationAccounts.userId),
    )
    .where(eq(schema.automationAccounts.userId, generation.accountId))
    .for("no key update");
  if (
    !account?.enabled ||
    account.user.deletedAt ||
    account.user.isBanned ||
    (account.user.isSuspended &&
      (!account.user.suspendedUntil ||
        account.user.suspendedUntil > new Date()))
  )
    throw forbidden("Official account is disabled or restricted.");
  if (account.user.plan !== policy.plan)
    throw forbidden("Account plan changed. Refresh before publishing.");
  await automationDestination(generation, tx, true);
  const id = generation.id;
  const slug = `${
    generation.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 70) || "article"
  }-${id.slice(0, 8)}`;
  const { accountId: authorId, targetId, targetType, title, body } = generation;
  if (targetType === "forum") {
    await tx.insert(schema.bbThreads).values({
      id,
      boardId: targetId,
      authorId,
      title,
      slug,
      contentFormat: "plaintext",
    });
    await tx.insert(schema.bbPosts).values({
      threadId: id,
      authorId,
      body,
      contentFormat: "plaintext",
      isOp: true,
    });
    await tx
      .update(schema.bbBoards)
      .set({
        threadCount: sql`${schema.bbBoards.threadCount}+1`,
        postCount: sql`${schema.bbBoards.postCount}+1`,
        lastPostAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.bbBoards.id, targetId));
    await syncContentHashtags(tx, {
      contentType: "forum_thread",
      contentId: id,
      authorId,
      texts: [title, body],
    });
    return { id, url: `/forum/thread/${slug}` };
  }
  if (targetType === "blog") {
    const [blog] = await tx
      .select({ slug: schema.blogs.slug, extra: schema.blogs.extraPostSlots })
      .from(schema.blogs)
      .where(eq(schema.blogs.id, targetId));
    const [used] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.blogPosts)
      .where(
        and(
          eq(schema.blogPosts.blogId, targetId),
          isNull(schema.blogPosts.deletedAt),
        ),
      );
    const words = body.trim().split(/\s+/).length;
    if (used.count >= policy.maxPosts + blog.extra || words > policy.maxWords)
      throw forbidden("Blog quota or word limit reached.");
    await tx.insert(schema.blogPosts).values({
      id,
      blogId: targetId,
      authorId,
      title,
      slug,
      excerpt: body.slice(0, 250),
      bodyMarkdown: body,
      bodyHtml: sanitizeBlogPostHtml(body),
      status: "published",
      publishedAt: new Date(),
      wordCount: words,
    });
    await tx
      .update(schema.blogs)
      .set({
        postCount: sql`${schema.blogs.postCount}+1`,
        updatedAt: new Date(),
      })
      .where(eq(schema.blogs.id, targetId));
    await syncContentHashtags(tx, {
      contentType: "blog_post",
      contentId: id,
      authorId,
      texts: [title, body],
    });
    const subscribers = await tx
      .select({ id: schema.blogSubscriptions.userId })
      .from(schema.blogSubscriptions)
      .where(eq(schema.blogSubscriptions.blogId, targetId));
    await insertNotificationBatch(
      tx,
      subscribers.map((s) => s.id),
      "blog_new_post",
      title,
      "New article from an official Zobia account.",
      { blogSlug: blog.slug, postSlug: slug },
      `automation:${id}`,
    );
    return { id, url: `/b/${blog.slug}/${slug}` };
  }
  if (targetType === "wiki") {
    const [used] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.wikiPages)
      .where(
        and(
          eq(schema.wikiPages.wikiId, targetId),
          isNull(schema.wikiPages.deletedAt),
        ),
      );
    if (used.count >= policy.maxPages)
      throw forbidden("Wiki page quota reached.");
    const [wiki] = await tx
      .select({ slug: schema.wikis.slug })
      .from(schema.wikis)
      .where(eq(schema.wikis.id, targetId));
    await tx.insert(schema.wikiPages).values({
      id,
      wikiId: targetId,
      slug,
      title,
      contentMarkdown: body,
      contentHtml: sanitizeBlogPostHtml(body),
      createdBy: authorId,
      lastEditedBy: authorId,
    });
    await tx.insert(schema.wikiPageRevisions).values({
      pageId: id,
      revisionNumber: 1,
      title,
      contentMarkdown: body,
      editSummary: "Official evergreen article",
      editedBy: authorId,
    });
    const added = await tx
      .insert(schema.wikiCollaborators)
      .values({
        wikiId: targetId,
        userId: authorId,
        role: "contributor",
        status: "active",
      })
      .onConflictDoNothing()
      .returning({ id: schema.wikiCollaborators.id });
    await tx
      .update(schema.wikiCollaborators)
      .set({
        pageEditCount: sql`${schema.wikiCollaborators.pageEditCount}+1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.wikiCollaborators.wikiId, targetId),
          eq(schema.wikiCollaborators.userId, authorId),
        ),
      );
    if (added.length)
      await tx
        .update(schema.wikis)
        .set({ contributorCount: sql`${schema.wikis.contributorCount}+1` })
        .where(eq(schema.wikis.id, targetId));
    await tx
      .update(schema.wikis)
      .set({
        pageCount: sql`${schema.wikis.pageCount}+1`,
        editCount: sql`${schema.wikis.editCount}+1`,
        updatedAt: new Date(),
      })
      .where(eq(schema.wikis.id, targetId));
    await syncContentHashtags(tx, {
      contentType: "wiki_page",
      contentId: id,
      authorId,
      texts: [title, body],
    });
    return { id, url: `/wiki/${wiki.slug}/${slug}` };
  }
  await tx.insert(schema.roomMessages).values({
    id,
    roomId: targetId,
    senderId: authorId,
    content: body,
    messageType: "text",
    metadata: { official: true },
  });
  return { id, url: `/rooms/${targetId}` };
}
