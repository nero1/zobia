import {Pool} from 'pg';
import {drizzle} from 'drizzle-orm/node-postgres';
import {randomUUID} from 'crypto';
import {schema} from '@/lib/db/schema';
import {integrationSetup,closeTestPool} from './setup';
import {createUser} from './helpers';
jest.mock('@/lib/db/drizzle',()=>({...jest.requireActual('@/lib/db/drizzle'),getDb:jest.fn()}));
jest.mock('@/lib/manifest',()=>({loadManifest:jest.fn().mockResolvedValue({}),getManifestValue:jest.fn().mockResolvedValue(null)}));
jest.mock('@/lib/alerts/dispatch',()=>({raiseAlert:jest.fn().mockResolvedValue(undefined)}));
jest.mock('@/lib/referrals/commissions',()=>({awardReferralCommissions:jest.fn().mockResolvedValue(undefined),recordFailedCommission:jest.fn().mockResolvedValue(undefined)}));
import {getDb} from '@/lib/db/drizzle';
import {safeAwardXP} from '@/lib/xp/safeAwardXP';
import {creditCoins,debitCoins} from '@/lib/economy/coins';
import {processChargeSuccess,processTransferEvent} from '@/lib/payments/paystackWebhookHandler';
import {issueAdReceipt} from '@/lib/ads/receipts';
import {recordAdEvents} from '@/lib/ads/serve';
import {visibleFeedItems} from '@/lib/feed/visibility';
import {claimCronRun} from '@/lib/cron/lease';
import {wrapPoolWithCircuitBreaker} from '@/lib/db/circuit';
const integration=process.env.TEST_DATABASE_URL?describe:describe.skip;
integration('forensic hardening contracts',()=>{
 const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,max:5});const ids:string[]=[];const campaigns:string[]=[];const payments:string[]=[];
 let uid:string,other:string;
 beforeAll(async()=>{if(!await integrationSetup())throw new Error('Database unavailable');(getDb as jest.Mock).mockResolvedValue(drizzle(pool,{schema}));process.env.JWT_SECRET='hardening-fixture-signing-secret-with-32-characters';
  const c=await pool.connect();try{for(let i=0;i<2;i++)ids.push((await createUser(c,{coinBalance:0})).id);[uid,other]=ids;}finally{c.release();}
 });
 afterAll(async()=>{for(const id of campaigns)await pool.query('DELETE FROM ad_campaigns WHERE id=$1',[id]);for(const id of payments){await pool.query('DELETE FROM crypto_transfer_claims WHERE payment_id=$1',[id]);await pool.query('DELETE FROM payments WHERE id=$1',[id]);}for(const id of ids)await pool.query('DELETE FROM users WHERE id=$1',[id]);await pool.end();await closeTestPool();});
 it('does not replay a credit or debit after its ledger row is archived',async()=>{
  const ref=randomUUID();await creditCoins(uid,100,'admin_grant',ref);await debitCoins(uid,30,'purchase',ref);
  await pool.query('BEGIN');
  try{await pool.query('INSERT INTO coin_ledger_archive SELECT *,NOW() FROM coin_ledger WHERE user_id=$1',[uid]);await pool.query('DELETE FROM coin_ledger WHERE user_id=$1',[uid]);await pool.query('COMMIT');}catch(error){await pool.query('ROLLBACK');throw error;}
  await creditCoins(uid,100,'admin_grant',ref);await debitCoins(uid,30,'purchase',ref);
  expect(Number((await pool.query('SELECT coin_balance FROM users WHERE id=$1',[uid])).rows[0].coin_balance)).toBe(70);
  expect(Number((await pool.query('SELECT SUM(amount) n FROM coin_ledger_history WHERE user_id=$1',[uid])).rows[0].n)).toBe(70);
 });
 it('does not re-award XP after its idempotency reference is archived',async()=>{
  const ref=randomUUID(),db=await getDb();
  await safeAwardXP(uid,5,'main','quest_complete',ref,db);
  const before=Number((await pool.query('SELECT xp_total FROM users WHERE id=$1',[uid])).rows[0].xp_total);
  await pool.query('INSERT INTO xp_ledger_archive SELECT *,NOW() FROM xp_ledger WHERE user_id=$1 AND reference_id=$2',[uid,ref]);
  await pool.query('DELETE FROM xp_ledger WHERE user_id=$1 AND reference_id=$2',[uid,ref]);
  await safeAwardXP(uid,5,'main','quest_complete',ref,db);
  expect(Number((await pool.query('SELECT xp_total FROM users WHERE id=$1',[uid])).rows[0].xp_total)).toBe(before);
 });
 it('keeps payout terminal states monotonic and restores/reclaims only the reserved net amount',async()=>{
  const ref=randomUUID(),code='TRF_'+randomUUID();
  await pool.query('UPDATE users SET available_earnings_kobo=0 WHERE id=$1',[uid]);
  const inserted=await pool.query("INSERT INTO creator_payouts(creator_id,amount_kobo,gross_kobo,net_kobo,provider,payout_method,status,idempotency_key,provider_reference) VALUES($1,1000,1000,800,'paystack','bank_transfer','processing',$2,$3) RETURNING id",[uid,ref,code]);
  const id=inserted.rows[0].id;
  const event=(name:'transfer.success'|'transfer.failed'|'transfer.reversed')=>({event:name,data:{reference:ref,status:name.split('.')[1],transfer_code:code,amount:800}});
  try{
   await processTransferEvent(event('transfer.success'));await processTransferEvent(event('transfer.failed'));
   expect((await pool.query('SELECT status FROM creator_payouts WHERE id=$1',[id])).rows[0].status).toBe('completed');
   await processTransferEvent(event('transfer.reversed'));await processTransferEvent(event('transfer.reversed'));await processTransferEvent(event('transfer.success'));
   expect((await pool.query('SELECT status FROM creator_payouts WHERE id=$1',[id])).rows[0].status).toBe('reversed');
   expect(Number((await pool.query('SELECT available_earnings_kobo n FROM users WHERE id=$1',[uid])).rows[0].n)).toBe(800);
   await pool.query("UPDATE creator_payouts SET status='failed',earnings_restored=true WHERE id=$1",[id]);
   await processTransferEvent(event('transfer.success'));
   expect(Number((await pool.query('SELECT available_earnings_kobo n FROM users WHERE id=$1',[uid])).rows[0].n)).toBe(0);
   expect((await pool.query('SELECT earnings_restored FROM creator_payouts WHERE id=$1',[id])).rows[0].earnings_restored).toBe(false);
  }finally{await pool.query('DELETE FROM creator_payouts WHERE id=$1',[id]);}
 });
 it('reserves a chain transfer for exactly one intent, including concurrent claims',async()=>{
  const created=await pool.query("INSERT INTO payments(user_id,amount_kobo,provider,payment_type,idempotency_key) VALUES($1,100,'crypto','coin_purchase',$2),($1,100,'crypto','coin_purchase',$3) RETURNING id",[uid,randomUUID(),randomUUID()]);payments.push(...created.rows.map(r=>r.id));
  const hash='0x'+'ab'.repeat(32);
  const attempts=await Promise.allSettled(created.rows.map(row=>pool.query("INSERT INTO crypto_transfer_claims(chain,tx_hash,payment_id) VALUES('bsc',$1,$2)",[hash,row.id])));
  expect(attempts.filter(a=>a.status==='fulfilled')).toHaveLength(1);
 });
 it('fulfills the saved quantity once despite a catalog edit, duplicate event and forged provider metadata',async()=>{
  const ref=randomUUID();const initial=Number((await pool.query('SELECT coin_balance FROM users WHERE id=$1',[uid])).rows[0].coin_balance);
  const payment=await pool.query("INSERT INTO payments(user_id,amount_kobo,currency,provider,payment_type,idempotency_key,provider_reference,metadata) VALUES($1,1000,'NGN','paystack','coin_purchase',$2,$2,$3) RETURNING id",[uid,ref,JSON.stringify({userId:uid,itemType:'coin_pack',coinsGranted:75,packName:'Saved quote',packId:randomUUID()})]);payments.push(payment.rows[0].id);
  const event={reference:ref,status:'success' as const,amount:1000,currency:'NGN',metadata:{userId:other,itemType:'coin_pack',coinsGranted:999999,packId:randomUUID(),packName:'Forged'}} as unknown as Parameters<typeof processChargeSuccess>[0];
  await Promise.all([processChargeSuccess(event),processChargeSuccess(event)]);
  expect(Number((await pool.query('SELECT coin_balance FROM users WHERE id=$1',[uid])).rows[0].coin_balance)).toBe(initial+75);
  expect(Number((await pool.query('SELECT coin_balance FROM users WHERE id=$1',[other])).rows[0].coin_balance)).toBe(0);
 });
 it('records underpayment without issuing the saved grant',async()=>{
  const ref=randomUUID();const payment=await pool.query("INSERT INTO payments(user_id,amount_kobo,currency,provider,payment_type,idempotency_key,provider_reference,metadata) VALUES($1,1000,'NGN','paystack','star_purchase',$2,$2,$3) RETURNING id",[uid,ref,JSON.stringify({userId:uid,itemType:'star_pack',starsGranted:20,packName:'Saved stars'})]);payments.push(payment.rows[0].id);
  await processChargeSuccess({reference:ref,status:'success',amount:999,currency:'NGN'} as Parameters<typeof processChargeSuccess>[0]);
  expect((await pool.query('SELECT status FROM payments WHERE id=$1',[payment.rows[0].id])).rows[0].status).toBe('underpaid');
  expect(Number((await pool.query('SELECT star_balance FROM users WHERE id=$1',[uid])).rows[0].star_balance)).toBe(0);
 });
 it('enforces ad serve proof, single consumption and the daily budget atomically',async()=>{
  const placement=(await pool.query('SELECT key FROM ad_placements LIMIT 1')).rows[0].key;
  const campaign=await pool.query("INSERT INTO ad_campaigns(created_by,owner_type,name,status,moderation_status,cpm_credits,total_budget_credits,daily_budget_credits) VALUES($1,'admin','Fixture','active','approved',1000,100,1) RETURNING id",[uid]);campaigns.push(campaign.rows[0].id);
  const creative=await pool.query("INSERT INTO ad_creatives(campaign_id,placement_key,format,size,title) VALUES($1,$2,'text','native','Fixture') RETURNING id",[campaign.rows[0].id,placement]);const creativeId=creative.rows[0].id;
  const fake=await recordAdEvents([{creativeId,placementKey:placement,type:'impression',clientEventId:randomUUID(),receipt:'fake'}],uid);expect(fake.outcomes[0].status).toBe('rejected');
  const events=[1,2].map(()=>({creativeId,placementKey:placement,type:'impression' as const,clientEventId:randomUUID(),receipt:issueAdReceipt(uid,creativeId,placement)}));
  await Promise.all(events.map(event=>recordAdEvents([event],uid)));
  expect(Number((await pool.query('SELECT spent_credits FROM ad_campaigns WHERE id=$1',[campaign.rows[0].id])).rows[0].spent_credits)).toBe(1);
  await recordAdEvents([events[0]],uid);expect(Number((await pool.query('SELECT spent_credits FROM ad_campaigns WHERE id=$1',[campaign.rows[0].id])).rows[0].spent_credits)).toBe(1);
 });
 it('reauthorizes a cached feed card after its author becomes private or blocked',async()=>{
  const tweet=await pool.query("INSERT INTO tweets(user_id,content) VALUES($1,'Fixture') RETURNING id",[other]);
  const card={contentId:tweet.rows[0].id,contentType:'tweet' as const,authorId:other,title:null,excerpt:'Fixture',imageUrl:null,url:'/t/fixture',createdAt:new Date().toISOString(),tags:[],engagementScore:0,isBoosted:false,isInHouseBoosted:false};
  expect(await visibleFeedItems([card],uid)).toHaveLength(1);
  await pool.query('UPDATE users SET profile_private=true WHERE id=$1',[other]);expect(await visibleFeedItems([card],uid)).toHaveLength(0);
  await pool.query('UPDATE users SET profile_private=false WHERE id=$1',[other]);await pool.query('INSERT INTO user_blocks(blocker_id,blocked_id) VALUES($1,$2)',[uid,other]);expect(await visibleFeedItems([card],uid)).toHaveLength(0);
 });
 it('resumes a failed cron without replaying completed steps',async()=>{
  const key='fixture:'+randomUUID(),db=drizzle(pool,{schema});let executions=0;
  const first=await claimCronRun(key,db);expect(first).not.toBeNull();await first!.runStep('done',async()=>{executions++;});await first!.finish(false);
  const next=await claimCronRun(key,db);expect(next).not.toBeNull();await next!.runStep('done',async()=>{executions++;});await next!.finish(true);
  expect(executions).toBe(1);expect(await claimCronRun(key,db)).toBeNull();await pool.query('DELETE FROM cron_job_runs WHERE job_key=$1',[key]);
 });
 it('restricts request-scoped ledger reads after explicitly leaving system context',async()=>{
  await creditCoins(uid,1,'admin_grant',randomUUID());
  await creditCoins(other,7,'admin_grant',randomUUID());
  const role='hardening_'+randomUUID().replaceAll('-','');const client=await pool.connect();
  try{
   await client.query(`CREATE ROLE "${role}" NOLOGIN`);
   await client.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
   await client.query(`GRANT SELECT ON coin_ledger TO "${role}"`);
   await client.query('BEGIN');await client.query(`SET LOCAL ROLE "${role}"`);
   await client.query("SELECT set_config('app.is_system','false',true),set_config('app.user_id',$1,true),set_config('app.current_user_id',$1,true)",[uid]);
   const rows=await client.query('SELECT DISTINCT user_id FROM coin_ledger');
   expect(rows.rows.every(row=>row.user_id===uid)).toBe(true);expect(rows.rows.length).toBeGreaterThan(0);
  }finally{await client.query('ROLLBACK');await client.query(`DROP OWNED BY "${role}"`);await client.query(`DROP ROLE "${role}"`);client.release();}
 });
 it('sets and clears server context for pooled statements and Drizzle transactions',async()=>{
  const contextual=new Pool({connectionString:process.env.TEST_DATABASE_URL,max:1});wrapPoolWithCircuitBreaker(contextual);
  try{expect((await contextual.query("SELECT current_setting('app.is_system',true) value")).rows[0].value).toBe('true');
   await drizzle(contextual).transaction(async tx=>{const result=await tx.execute(require('drizzle-orm').sql`SELECT current_setting('app.is_system',true) value`);expect(result.rows[0].value).toBe('true');});
   const client=await contextual.connect();try{expect((await client.query("SELECT current_setting('app.is_system',true) value")).rows[0].value).not.toBe('true');}finally{client.release();}
  }finally{await contextual.end();}
 });
});
