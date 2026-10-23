import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'crypto';
import { schema } from '@/lib/db/schema';
import { integrationSetup, closeTestPool } from './setup';
import { createUser } from './helpers';
jest.mock('@/lib/db/drizzle', () => ({ ...jest.requireActual('@/lib/db/drizzle'), getDb: jest.fn() }));
jest.mock('@/lib/manifest', () => ({ getManifestValue: jest.fn().mockResolvedValue(null) }));
import { getDb } from '@/lib/db/drizzle';
import { createBookmarkFolder, bookmarkFolders, saveBookmark, listBookmarks } from '@/lib/bookmarks/service';
const integration = process.env.TEST_DATABASE_URL ? describe : describe.skip;
integration('bookmark ownership and permanent folder entitlements', () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const users: string[] = [];
  beforeAll(async () => {
    if (!await integrationSetup()) throw new Error('Integration database unavailable');
    (getDb as jest.Mock).mockResolvedValue(drizzle(pool, { schema }));
  });
  afterAll(async () => { for (const id of users) await pool.query('DELETE FROM users WHERE id=$1', [id]); await pool.end(); await closeTestPool(); });
  async function account(plan = 'free') {
    const client = await pool.connect();
    try { const u = await createUser(client, { plan, coinBalance: 1000 }); users.push(u.id); return u.id; } finally { client.release(); }
  }
  it('retains paid entitlements even if the user never opens Bookmarks before downgrading', async () => {
    const user = await account();
    await pool.query("UPDATE users SET plan='pro' WHERE id=$1", [user]);
    await pool.query("UPDATE users SET plan='free' WHERE id=$1", [user]);
    expect((await bookmarkFolders(user)).limit).toBe(15);
    for (let n=0;n<15;n++) await createBookmarkFolder(user, { id: randomUUID(), name: `Folder ${n}` });
    await expect(createBookmarkFolder(user, { id: randomUUID(), name: 'Extra' })).rejects.toMatchObject({ code: 'BOOKMARK_FOLDER_PAYMENT_REQUIRED' });
  });
  it('requires the current price and charges a repeated purchase only once', async () => {
    const user = await account(); const input = { id: randomUUID(), name: 'First folder', confirmedCost: 100 };
    await expect(createBookmarkFolder(user, { ...input, confirmedCost: 1 })).rejects.toMatchObject({ code: 'BOOKMARK_FOLDER_PAYMENT_REQUIRED' });
    await Promise.all([createBookmarkFolder(user, input), createBookmarkFolder(user, input)]);
    expect(Number((await pool.query('SELECT coin_balance FROM users WHERE id=$1', [user])).rows[0].coin_balance)).toBe(900);
    expect((await bookmarkFolders(user)).nextCost).toBe(50);
  });
  it('does not allow saving into another account’s folder and keeps content idempotent', async () => {
    const owner = await account('plus'); const other = await account();
    const folder = await createBookmarkFolder(owner, { id: randomUUID(), name: 'Private folder' });
    const input = { contentType: 'game' as const, contentId: randomUUID(), title: 'A game', folderId: folder.id };
    await expect(saveBookmark(other, input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const first = await saveBookmark(owner, input); const second = await saveBookmark(owner, input);
    expect(first.id).toBe(second.id);
    await pool.query('DELETE FROM bookmark_folders WHERE id=$1', [folder.id]);
    expect((await pool.query('SELECT folder_id FROM bookmarks WHERE id=$1', [first.id])).rows[0].folder_id).toBeNull();
  });
  it('paginates bookmarks without rounding away microseconds',async()=>{
    const user=await account();
    for(let n=0;n<25;n++)await pool.query("INSERT INTO bookmarks(user_id,content_type,content_id,title,created_at) VALUES($1,'blog_post',$2,'Test','2026-01-01T00:00:00.123000Z'::timestamptz+($3*interval '1 microsecond'))",[user,randomUUID(),n]);
    const first=await listBookmarks(user);expect(first.items).toHaveLength(20);
    const second=await listBookmarks(user,undefined,first.nextCursor!);expect(second.items).toHaveLength(5);
    expect(new Set([...first.items,...second.items].map((item)=>item.id)).size).toBe(25);
  });

});
