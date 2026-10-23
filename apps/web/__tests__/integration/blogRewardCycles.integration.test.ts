import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'crypto';
import { schema } from '@/lib/db/schema';
import { createUser } from './helpers';
import { integrationSetup,closeTestPool } from './setup';
jest.mock('@/lib/db/drizzle',()=>({...jest.requireActual('@/lib/db/drizzle'),getDb:jest.fn()}));
jest.mock('@/lib/manifest',()=>({getManifestValue:jest.fn().mockResolvedValue(null),requireFeatureEnabled:jest.fn().mockResolvedValue(undefined),loadManifest:jest.fn().mockResolvedValue({features:{blogMonetization:true}})}));
jest.mock('@/lib/security/htmlSanitizer',()=>({sanitizeBlogPostHtml:(text:string)=>text,plainTextToBlogPostHtml:(text:string)=>text}));
import { getDb } from '@/lib/db/drizzle';
import { fundPostTreasury,claimTreasuryReward,closePostTreasury } from '@/lib/blogs/service';
const integration=process.env.TEST_DATABASE_URL?describe:describe.skip;
integration('blog reward-pot funding cycles',()=>{
 const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL});const users:string[]=[];let owner:string;let reader:string;let post:string;
 beforeAll(async()=>{if(!await integrationSetup())throw new Error('Integration database unavailable');(getDb as jest.Mock).mockResolvedValue(drizzle(pool,{schema}));const client=await pool.connect();try{owner=(await createUser(client,{coinBalance:1000})).id;reader=(await createUser(client)).id;users.push(owner,reader);}finally{client.release();}const blog=(await pool.query('INSERT INTO blogs(owner_id,title,slug) VALUES($1,$2,$3) RETURNING id',[owner,'Reward cycles',randomUUID()])).rows[0].id;post=(await pool.query("INSERT INTO blog_posts(blog_id,author_id,title,slug,body_markdown,body_html) VALUES($1,$2,'Reward article',$3,'Body','Body') RETURNING id",[blog,owner,randomUUID()])).rows[0].id;});
 afterAll(async()=>{for(const id of users)await pool.query('DELETE FROM users WHERE id=$1',[id]);await pool.end();await closeTestPool();});
 it('pays once per cycle, preserves old claims, and refunds each cycle’s remainder',async()=>{
  for(let generation=0;generation<2;generation++){
   await fundPostTreasury(owner,post,100,2);expect((await claimTreasuryReward(post,reader,'share'))?.amount).toBe(50);expect(await claimTreasuryReward(post,reader,'comment')).toBeNull();await closePostTreasury(owner,post);
  }
  expect(Number((await pool.query('SELECT coin_balance FROM users WHERE id=$1',[owner])).rows[0].coin_balance)).toBe(900);
  expect(Number((await pool.query('SELECT coin_balance FROM users WHERE id=$1',[reader])).rows[0].coin_balance)).toBe(100);
  expect((await pool.query('SELECT c.generation FROM blog_post_treasury_claims c JOIN blog_post_treasuries t ON t.id=c.treasury_id WHERE t.post_id=$1 ORDER BY c.generation',[post])).rows.map(row=>row.generation)).toEqual([0,1]);
 });
});
