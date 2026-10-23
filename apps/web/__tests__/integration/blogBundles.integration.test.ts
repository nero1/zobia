import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'crypto';
import { schema } from '@/lib/db/schema';
import { createUser } from './helpers';
import { integrationSetup, closeTestPool } from './setup';
jest.mock('@/lib/db/drizzle',()=>({...jest.requireActual('@/lib/db/drizzle'),getDb:jest.fn()}));
jest.mock('@/lib/manifest',()=>({getManifestValue:jest.fn().mockResolvedValue(null)}));
import { getDb } from '@/lib/db/drizzle';
import { buyPostBundle } from '@/lib/blogs/bundles';
const integration=process.env.TEST_DATABASE_URL?describe:describe.skip;
integration('permanent extra blog posts',()=>{
 const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL});const users:string[]=[];let owner:string;let outsider:string;let blog:string;
 beforeAll(async()=>{if(!await integrationSetup())throw new Error('Integration database unavailable');(getDb as jest.Mock).mockResolvedValue(drizzle(pool,{schema}));const client=await pool.connect();try{owner=(await createUser(client,{coinBalance:5000,starBalance:1000})).id;outsider=(await createUser(client)).id;users.push(owner,outsider);}finally{client.release();}blog=(await pool.query('INSERT INTO blogs(owner_id,title,slug) VALUES($1,$2,$3) RETURNING id',[owner,'Bundle test',randomUUID()])).rows[0].id;});
 afterAll(async()=>{for(const id of users)await pool.query('DELETE FROM users WHERE id=$1',[id]);await pool.end();await closeTestPool();});
 it('requires current-price confirmation and ownership',async()=>{
  await expect(buyPostBundle(owner,blog,{requestId:randomUUID(),slots:100,currency:'credits',confirmedCost:1})).rejects.toMatchObject({code:'PRICE_CONFIRMATION_REQUIRED'});
  await expect(buyPostBundle(outsider,blog,{requestId:randomUUID(),slots:100,currency:'credits',confirmedCost:1000})).rejects.toMatchObject({code:'FORBIDDEN'});
  expect((await pool.query('SELECT extra_post_slots FROM blogs WHERE id=$1',[blog])).rows[0].extra_post_slots).toBe(0);
 });
 it('charges once for concurrent retries and retains slots after a downgrade',async()=>{
  const request={requestId:randomUUID(),slots:100,currency:'credits' as const,confirmedCost:1000};
  await Promise.all([buyPostBundle(owner,blog,request),buyPostBundle(owner,blog,request)]);
  expect(Number((await pool.query('SELECT coin_balance FROM users WHERE id=$1',[owner])).rows[0].coin_balance)).toBe(4000);
  await pool.query("UPDATE users SET plan='free' WHERE id=$1",[owner]);
  expect((await pool.query('SELECT extra_post_slots FROM blogs WHERE id=$1',[blog])).rows[0].extra_post_slots).toBe(100);
  await expect(buyPostBundle(owner,blog,{...request,slots:200})).rejects.toMatchObject({code:'CONFLICT'});
 });
 it('supports discounted Stars bundles using the star ledger',async()=>{
  await buyPostBundle(owner,blog,{requestId:randomUUID(),slots:200,currency:'stars',confirmedCost:190});
  expect(Number((await pool.query('SELECT star_balance FROM users WHERE id=$1',[owner])).rows[0].star_balance)).toBe(810);
  expect((await pool.query('SELECT extra_post_slots FROM blogs WHERE id=$1',[blog])).rows[0].extra_post_slots).toBe(300);
 });
});
