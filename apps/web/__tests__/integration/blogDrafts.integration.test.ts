import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'crypto';
import { schema } from '@/lib/db/schema';
import { createUser } from './helpers';
import { integrationSetup, closeTestPool } from './setup';
jest.mock('@/lib/db/drizzle', () => ({ ...jest.requireActual('@/lib/db/drizzle'), getDb: jest.fn() }));
jest.mock('@/lib/manifest', () => ({ getManifestValue: jest.fn().mockResolvedValue(null) }));
jest.mock('@/lib/security/htmlSanitizer', () => ({ sanitizeBlogPostHtml: (text: string) => `<p>${text}</p>`, plainTextToBlogPostHtml: (text: string) => `<p>${text}</p>` }));
jest.mock('@/lib/hashtags/service', () => ({ recordContentHashtags: jest.fn(), removeContentHashtags: jest.fn(), syncContentHashtags: jest.fn() }));
jest.mock('@/lib/forum/service', () => ({ isUserModeratorOrAdmin: jest.fn().mockResolvedValue(false) }));
import { getDb } from '@/lib/db/drizzle';
import { updatePost } from '@/lib/blogs/service';
const integration = process.env.TEST_DATABASE_URL ? describe : describe.skip;
integration('private blog revisions', () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL }); const users: string[] = []; let owner: string; let outsider: string; let blog: string;
  beforeAll(async () => {
    if (!await integrationSetup()) throw new Error('Integration database unavailable');
    (getDb as jest.Mock).mockResolvedValue(drizzle(pool, { schema }));
    const client = await pool.connect();
    try { owner = (await createUser(client)).id; outsider = (await createUser(client)).id; users.push(owner,outsider); }
    finally { client.release(); }
    blog = (await pool.query('INSERT INTO blogs(owner_id,title,slug) VALUES($1,$2,$3) RETURNING id', [owner,'Draft tests',`draft-${randomUUID()}`])).rows[0].id;
  });
  afterAll(async () => { for (const id of users) await pool.query('DELETE FROM users WHERE id=$1', [id]); await pool.end(); await closeTestPool(); });
  async function published(type = 'article') {
    return (await pool.query("INSERT INTO blog_posts(blog_id,author_id,type,title,slug,body_markdown,body_html,status) VALUES($1,$2,$3,'Live title',$4,'Live text','<p>Live text</p>','published') RETURNING id", [blog, owner, type, randomUUID()])).rows[0].id;
  }
  it.each(['article','page'])('keeps a saved %s revision private until explicitly published', async (type) => {
    const id = await published(type);
    await updatePost(id,owner,'free',{ title: 'Edited title', bodyMarkdown: 'Edited text', status: 'published', saveRevision: true });
    const saved = (await pool.query('SELECT title,body_markdown,status,draft_content FROM blog_posts WHERE id=$1', [id])).rows[0];
    expect(saved).toMatchObject({ title: 'Live title', body_markdown: 'Live text', status: 'published', draft_content: { title: 'Edited title', bodyMarkdown: 'Edited text' } });
    await updatePost(id,owner,'free',{ title: 'Edited title', bodyMarkdown: 'Edited text', status: 'published' });
    expect((await pool.query('SELECT title,body_markdown,draft_content FROM blog_posts WHERE id=$1', [id])).rows[0]).toMatchObject({ title: 'Edited title', body_markdown: 'Edited text', draft_content: null });
  });
  it('rejects editing another author’s post', async () => {
    const id = await published(); await expect(updatePost(id,outsider,'free',{ title: 'Hijacked' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
