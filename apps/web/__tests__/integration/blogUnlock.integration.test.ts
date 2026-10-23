import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'crypto';
import { schema } from '@/lib/db/schema';
import { createUser } from './helpers';
import { integrationSetup, closeTestPool } from './setup';
jest.mock('@/lib/db/drizzle',()=>({...jest.requireActual('@/lib/db/drizzle'),getDb:jest.fn()}));
jest.mock('@/lib/manifest',()=>({getManifestValue:jest.fn().mockResolvedValue(null),requireFeatureEnabled:jest.fn().mockResolvedValue(undefined),loadManifest:jest.fn().mockResolvedValue({coinToCashRate:100})}));
jest.mock('@/lib/xp/safeAwardXP',()=>({safeAwardXPFireAndForget:jest.fn()}));
jest.mock('@/lib/security/htmlSanitizer',()=>({sanitizeBlogPostHtml:(text:string)=>text,plainTextToBlogPostHtml:(text:string)=>text}));
import { getDb } from '@/lib/db/drizzle';
import { unlockPost } from '@/lib/blogs/service';
const integration=process.env.TEST_DATABASE_URL?describe:describe.skip;
integration('atomic blog paywall unlocks',()=>{
 const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL});const users:string[]=[];let owner:string;let reader:string;let post:string;
 beforeAll(async()=>{if(!await integrationSetup())throw new Error('Integration database unavailable');(getDb as jest.Mock).mockResolvedValue(drizzle(pool,{schema}));const client=await pool.connect();try{owner=(await createUser(client)).id;reader=(await createUser(client,{coinBalance:1000})).id;users.push(owner,reader);}finally{client.release();}const blog=(await pool.query('INSERT INTO blogs(owner_id,title,slug) VALUES($1,$2,$3) RETURNING id',[owner,'Unlock test',randomUUID()])).rows[0].id;post=(await pool.query("INSERT INTO blog_posts(blog_id,author_id,title,slug,body_markdown,body_html,status,published_at,is_paywalled,paywall_credits_cost) VALUES($1,$2,'Paid article',$3,'text','text','published',now(),true,100) RETURNING id",[blog,owner,randomUUID()])).rows[0].id;});
 afterAll(async()=>{for(const id of users)await pool.query('DELETE FROM users WHERE id=$1',[id]);await pool.end();await closeTestPool();});
 it('rejects a price the reader has not confirmed',async()=>{
  await expect(unlockPost(post,reader,'free',50)).rejects.toMatchObject({code:'PRICE_CONFIRMATION_REQUIRED'});
  expect(Number((await pool.query('SELECT coin_balance FROM users WHERE id=$1',[reader])).rows[0].coin_balance)).toBe(1000);
 });
 it('concurrent requests debit once, unlock once, and credit the creator once',async()=>{
  const results=await Promise.all([unlockPost(post,reader,'free',100),unlockPost(post,reader,'free',100)]);
  expect(results.filter((r)=>!r.alreadyUnlocked)).toHaveLength(1);
  expect(Number((await pool.query('SELECT coin_balance FROM users WHERE id=$1',[reader])).rows[0].coin_balance)).toBe(900);
  const earned=(await pool.query('SELECT net_amount_kobo FROM creator_earnings WHERE creator_id=$1',[owner])).rows;
  expect(earned).toHaveLength(1);
  expect(Number((await pool.query('SELECT available_earnings_kobo FROM users WHERE id=$1',[owner])).rows[0].available_earnings_kobo)).toBe(Number(earned[0].net_amount_kobo));
  expect((await pool.query('SELECT unlock_count FROM blog_post_daily_stats WHERE post_id=$1',[post])).rows[0].unlock_count).toBe(1);
  await unlockPost(post,reader,'free',100);
  expect(Number((await pool.query('SELECT available_earnings_kobo FROM users WHERE id=$1',[owner])).rows[0].available_earnings_kobo)).toBe(Number(earned[0].net_amount_kobo));
 });
});
