import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db/drizzle';
import { getManifestValue } from '@/lib/manifest';
import { debitCoins } from '@/lib/economy/coins';
import { badRequest, forbidden, conflict } from '@/lib/api/errors';
import { deepLinkPathFor } from '@/lib/feed/deeplink';
import type { FeedContentType } from '@/lib/feed/types';

async function setting(key: string, fallback: number) {
  const n = Number(await getManifestValue(key) ?? fallback);
  return Number.isSafeInteger(n) && n >= 0 && n <= 1000000 ? n : fallback;
}
async function refreshIncludedFolders(userId:string) {
  const orm=await getDb();
  const [user]=await orm.select({plan:schema.users.plan}).from(schema.users).where(eq(schema.users.id,userId));
  const [business]=await orm.select({status:schema.businessAccounts.status}).from(schema.businessAccounts).where(eq(schema.businessAccounts.userId,userId)).limit(1);
  const personal = user?.plan==='plus'?await setting('bookmark_folders_plus',5):user?.plan==='pro'?await setting('bookmark_folders_pro',15):user?.plan==='max'?await setting('bookmark_folders_max',30):0;
  const included=Math.min(1000,Math.max(personal,business && ['active','grace'].includes(business.status)?await setting('bookmark_folders_business',30):0));
  if(included>0) await orm.insert(schema.bookmarkEntitlements).values({userId,includedLimit:included}).onConflictDoUpdate({target:schema.bookmarkEntitlements.userId,set:{includedLimit:sql`GREATEST(${schema.bookmarkEntitlements.includedLimit},${included})`}});
}
export async function bookmarkFolders(userId: string) {
  await refreshIncludedFolders(userId);
  const orm = await getDb();
  const [folders, entitlements, firstCost, extraCost] = await Promise.all([
    orm.select().from(schema.bookmarkFolders).where(eq(schema.bookmarkFolders.userId, userId)).orderBy(schema.bookmarkFolders.createdAt),
    orm.select().from(schema.bookmarkEntitlements).where(eq(schema.bookmarkEntitlements.userId, userId)).limit(1),
    setting('bookmark_folder_first_cost', 100), setting('bookmark_folder_extra_cost', 50),
  ]);
  const entitlement = entitlements[0];
  const limit = (entitlement?.includedLimit ?? 0) + (entitlement?.purchasedSlots ?? 0);
  return { folders, limit, nextCost: folders.length < limit ? 0 : (entitlement?.purchasedSlots ?? 0) > 0 ? extraCost : firstCost };
}
export async function createBookmarkFolder(userId: string, input: { id: string; name: string; confirmedCost?: number }) {
  await refreshIncludedFolders(userId);
  const orm = await getDb();
  const [firstCost, extraCost] = await Promise.all([setting('bookmark_folder_first_cost', 100), setting('bookmark_folder_extra_cost', 50)]);
  return orm.transaction(async (tx) => {
    await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, userId)).for('update');
    const [existing] = await tx.select().from(schema.bookmarkFolders).where(eq(schema.bookmarkFolders.id, input.id)).limit(1);
    if (existing) { if (existing.userId !== userId || existing.name !== input.name) throw conflict('Request ID already used.'); return existing; }
    await tx.insert(schema.bookmarkEntitlements).values({ userId }).onConflictDoNothing();
    const [entitlement] = await tx.select().from(schema.bookmarkEntitlements).where(eq(schema.bookmarkEntitlements.userId, userId)).for('update');
    const [usage] = await tx.select({ count: sql<number>`count(*)::int` }).from(schema.bookmarkFolders).where(eq(schema.bookmarkFolders.userId, userId));
    const paid = usage.count >= entitlement.includedLimit + entitlement.purchasedSlots;
    const cost = entitlement.purchasedSlots ? extraCost : firstCost;
    if (usage.count >= 1000) throw forbidden('Folder safety limit reached.');
    if (paid && input.confirmedCost !== cost) throw forbidden('Confirm the folder price before purchasing.', 'BOOKMARK_FOLDER_PAYMENT_REQUIRED', { cost });
    const [duplicate] = await tx.select({ id: schema.bookmarkFolders.id }).from(schema.bookmarkFolders).where(and(eq(schema.bookmarkFolders.userId, userId), sql`lower(${schema.bookmarkFolders.name}) = lower(${input.name})`)).limit(1);
    if (duplicate) throw conflict('You already have a folder with that name.');
    const [folder] = await tx.insert(schema.bookmarkFolders).values({ id: input.id, userId, name: input.name }).returning();
    if (paid) {
      if (cost > 0) await debitCoins(userId, cost, 'bookmark_folder', `bookmark-folder:${input.id}`, 'Bookmark folder slot', null, tx);
      await tx.update(schema.bookmarkEntitlements).set({ purchasedSlots: entitlement.purchasedSlots + 1 }).where(eq(schema.bookmarkEntitlements.userId, userId));
    }
    return folder;
  });
}
export async function saveBookmark(userId: string, input: { contentType: FeedContentType; contentId: string; title: string; folderId?: string | null }) {
  const orm = await getDb();
  return orm.transaction(async (tx) => {
    if (input.folderId) {
      const [folder] = await tx.select({ id: schema.bookmarkFolders.id }).from(schema.bookmarkFolders).where(and(eq(schema.bookmarkFolders.id, input.folderId), eq(schema.bookmarkFolders.userId, userId))).for('share').limit(1);
      if (!folder) throw forbidden('Folder not found.');
    }
    const [saved] = await tx.insert(schema.bookmarks).values({ userId, ...input, folderId: input.folderId ?? null })
      .onConflictDoUpdate({ target: [schema.bookmarks.userId, schema.bookmarks.contentType, schema.bookmarks.contentId], set: { folderId: input.folderId ?? null, title: input.title } }).returning();
    return saved;
  });
}
export async function listBookmarks(userId: string, folderId?: string, cursor?: string) {
  const orm = await getDb();
  const conditions = [eq(schema.bookmarks.userId, userId)];
  if (folderId) conditions.push(eq(schema.bookmarks.folderId, folderId));
  if (cursor) {
    const [time, id] = cursor.split('|');
    if (!time || !id || !Number.isFinite(Date.parse(time)) || !/^[0-9a-f-]{36}$/i.test(id)) throw badRequest('Invalid cursor.');
    conditions.push(sql`(${schema.bookmarks.createdAt},${schema.bookmarks.id}) < (${time}::timestamptz,${id}::uuid)`);
  }
  const rows = await orm.select({ bookmark: schema.bookmarks, cursorTime: sql<string>`to_char(${schema.bookmarks.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` }).from(schema.bookmarks).where(and(...conditions)).orderBy(desc(schema.bookmarks.createdAt), desc(schema.bookmarks.id)).limit(21);
  const page = rows.slice(0,20); const last = page.at(-1);
  return { items: page.map(({ bookmark }) => ({ ...bookmark, url: deepLinkPathFor(bookmark.contentType as FeedContentType, bookmark.contentId) })), nextCursor: rows.length > 20 && last ? `${last.cursorTime}|${last.bookmark.id}` : null };
}
