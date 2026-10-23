import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'crypto';
import { schema } from '@/lib/db/schema';
import { createUser } from './helpers';
import { integrationSetup, closeTestPool } from './setup';
jest.mock('@/lib/db/drizzle', () => ({ ...jest.requireActual('@/lib/db/drizzle'), getDb: jest.fn() }));
import { getDb } from '@/lib/db/drizzle';
import { discoverBlogPosts } from '@/lib/blogs/discovery';
import { listBlogs, type BlogTab } from '@/lib/blogs/repo';
const integration = process.env.TEST_DATABASE_URL ? describe : describe.skip;
integration('blog discovery visibility and pagination', () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL }); let owner: string; let blog: string; const marker = randomUUID();
  beforeAll(async () => {
    if (!await integrationSetup()) throw new Error('Integration database unavailable');
    (getDb as jest.Mock).mockResolvedValue(drizzle(pool, { schema }));
    const client = await pool.connect(); try { owner = (await createUser(client)).id; } finally { client.release(); }
    blog = (await pool.query('INSERT INTO blogs(owner_id,title,slug) VALUES($1,$2,$3) RETURNING id',[owner,marker,marker])).rows[0].id;
    for(let n=0;n<15;n++) await pool.query("INSERT INTO blog_posts(blog_id,author_id,title,slug,body_markdown,body_html,status,published_at,view_count) VALUES($1,$2,$3,$4,'SECRET BODY','SECRET BODY',$5,now()-interval '1 day',$6)", [blog,owner,`${marker} ${n}`,randomUUID(),n<13?'published':'draft',n]);
    await pool.query('INSERT INTO blog_subscriptions(blog_id,user_id) VALUES($1,$2)',[blog,owner]);
  });
  afterAll(async()=>{ if(owner) await pool.query('DELETE FROM users WHERE id=$1',[owner]); await pool.end(); await closeTestPool(); });
  it.each(['popular','trending','new','random','subscribed'] as BlogTab[])('paginates %s without drafts, article bodies, or duplicate results',async(tab)=>{
    const ids:string[]=[]; let cursor:string|undefined;
    do { const page=await discoverBlogPosts(owner,tab,cursor,marker); expect(page.posts.length).toBeLessThanOrEqual(6); for(const post of page.posts) { expect(post).not.toHaveProperty('body_html'); expect(post).not.toHaveProperty('body_markdown'); ids.push(post.id); } cursor=page.nextCursor ?? undefined; } while(cursor);
    expect(ids).toHaveLength(13); expect(new Set(ids).size).toBe(13);
  });
  it('does not show posts from an inactive blog',async()=>{
    await pool.query("UPDATE blogs SET status='suspended' WHERE id=$1",[blog]);
    expect((await discoverBlogPosts(owner,'new',undefined,marker)).posts).toHaveLength(0);
    await pool.query("UPDATE blogs SET status='active' WHERE id=$1",[blog]);
  });
  it('rejects cursors reused on another tab',async()=>{
    const page=await discoverBlogPosts(owner,'new',undefined,marker);
    await expect(discoverBlogPosts(owner,'random',page.nextCursor!,marker)).rejects.toMatchObject({code:'BAD_REQUEST'});
  });
  it('uses a valid compound cursor for blog discovery',async()=>{
    for(let n=0;n<3;n++) await pool.query('INSERT INTO blogs(owner_id,title,slug,subscriber_count) VALUES($1,$2,$3,$4)',[owner,marker,randomUUID(),n]);
    const first=await listBlogs('popular',null,2,marker,owner);
    const second=await listBlogs('popular',first.nextCursor,2,marker,owner);
    expect(new Set([...first.blogs,...second.blogs].map((b)=>b.id)).size).toBe(4);
  });
});
