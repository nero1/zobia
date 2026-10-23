export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { withAuth, validateBody } from '@/lib/api/middleware';
import { handleApiError, conflict } from '@/lib/api/errors';
import { getDb, schema } from '@/lib/db/drizzle';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/security/rateLimit';
import { bookmarkFolders, createBookmarkFolder } from '@/lib/bookmarks/service';
export const GET = withAuth(async (_req, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, 'user', RATE_LIMITS.apiRead);
    return NextResponse.json({ success: true, data: await bookmarkFolders(auth.user.sub), error: null });
  } catch (error) { return handleApiError(error); }
});
export const POST = withAuth(async (req, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, 'user', RATE_LIMITS.apiWrite);
    const input = await validateBody(req, z.object({ id: z.string().uuid(), name: z.string().trim().min(1).max(80), confirmedCost: z.number().int().nonnegative().optional() }));
    return NextResponse.json({ success: true, data: await createBookmarkFolder(auth.user.sub, input), error: null });
  } catch (error) { return handleApiError(error); }
});
export const PATCH = withAuth(async (req, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, 'user', RATE_LIMITS.apiWrite);
    const input = await validateBody(req, z.object({ id: z.string().uuid(), name: z.string().trim().min(1).max(80) }));
    const orm = await getDb();
    await orm.update(schema.bookmarkFolders).set({ name: input.name }).where(and(eq(schema.bookmarkFolders.id, input.id), eq(schema.bookmarkFolders.userId, auth.user.sub)));
    return NextResponse.json({ success: true, data: { updated: true }, error: null });
  } catch (error) { return handleApiError((error as { code?: string }).code === '23505' ? conflict('A folder with that name already exists.') : error); }
});
export const DELETE = withAuth(async (req, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, 'user', RATE_LIMITS.apiWrite);
    const { id } = await validateBody(req, z.object({ id: z.string().uuid() }));
    const orm = await getDb();
    await orm.delete(schema.bookmarkFolders).where(and(eq(schema.bookmarkFolders.id, id), eq(schema.bookmarkFolders.userId, auth.user.sub)));
    return NextResponse.json({ success: true, data: { deleted: true }, error: null });
  } catch (error) { return handleApiError(error); }
});
