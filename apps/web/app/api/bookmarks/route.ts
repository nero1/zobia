export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { withAuth, validateBody, validateSearchParams } from '@/lib/api/middleware';
import { handleApiError, forbidden } from '@/lib/api/errors';
import { getDb, schema } from '@/lib/db/drizzle';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/security/rateLimit';
import { listBookmarks, saveBookmark } from '@/lib/bookmarks/service';
const contentTypes = ['moment','tweet','blog_post','forum_thread','forum_question','room','wiki_page','game','classroom','business_page_post','poll','quiz'] as const;
const saveSchema = z.object({ contentType: z.enum(contentTypes), contentId: z.string().uuid(), title: z.string().trim().min(1).max(200), folderId: z.string().uuid().nullable().optional() });
export const GET = withAuth(async (req, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, 'user', RATE_LIMITS.apiRead);
    const query = validateSearchParams(req.nextUrl.searchParams, z.object({ folderId: z.string().uuid().optional(), cursor: z.string().max(200).optional() }));
    return NextResponse.json({ success: true, data: await listBookmarks(auth.user.sub, query.folderId, query.cursor), error: null });
  } catch (error) { return handleApiError(error); }
});
export const POST = withAuth(async (req, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, 'user', RATE_LIMITS.apiWrite);
    return NextResponse.json({ success: true, data: await saveBookmark(auth.user.sub, await validateBody(req, saveSchema)), error: null });
  } catch (error) { return handleApiError(error); }
});
export const DELETE = withAuth(async (req, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, 'user', RATE_LIMITS.apiWrite);
    const { id } = await validateBody(req, z.object({ id: z.string().uuid() }));
    const orm = await getDb(); await orm.delete(schema.bookmarks).where(and(eq(schema.bookmarks.id, id), eq(schema.bookmarks.userId, auth.user.sub)));
    return NextResponse.json({ success: true, data: { deleted: true }, error: null });
  } catch (error) { return handleApiError(error); }
});
export const PATCH = withAuth(async (req, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, 'user', RATE_LIMITS.apiWrite);
    const { id, folderId } = await validateBody(req, z.object({ id: z.string().uuid(), folderId: z.string().uuid().nullable() }));
    const orm = await getDb();
    await orm.transaction(async (tx) => {
      if (folderId) {
        const [folder] = await tx.select({ id: schema.bookmarkFolders.id }).from(schema.bookmarkFolders).where(and(eq(schema.bookmarkFolders.id, folderId), eq(schema.bookmarkFolders.userId, auth.user.sub))).for('share').limit(1);
        if (!folder) throw forbidden('Folder not found.');
      }
      await tx.update(schema.bookmarks).set({ folderId }).where(and(eq(schema.bookmarks.id, id), eq(schema.bookmarks.userId, auth.user.sub)));
    });
    return NextResponse.json({ success: true, data: { updated: true }, error: null });
  } catch (error) { return handleApiError(error); }
});
