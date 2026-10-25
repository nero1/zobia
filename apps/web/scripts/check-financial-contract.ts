import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {NextRequest} from 'next/server';
import {createSession,invalidateAllSessions} from '../lib/auth/session';
import {verifyAccessToken} from '../lib/auth/jwt';
import {markPinVerified} from '../lib/auth/pinGuard';
import {invalidateManifestCache} from '../lib/manifest';
import {CHAIN_ADAPTERS,MIN_CONFIRMATIONS} from '../lib/payments/crypto/chains';
import {POST as withdraw} from '../app/api/economy/crypto/withdraw/route';
import {POST as approve} from '../app/api/admin/payouts/[payoutId]/approve/route';
import {PATCH as status} from '../app/api/admin/payouts/[payoutId]/status/route';
import {POST as convert} from '../app/api/creator/payouts/route';
import {sendGift,listPublicGiftTiers,getGiftTextReveal} from '../lib/blogs/service';
import {listPublicGiftTiers as repoCatalog} from '../lib/blogs/repo';
import {POST as sendRoom} from '../app/api/rooms/[roomId]/messages/route';
async function main(){
 if(!/^\/zobia_remediation_[a-f0-9]+$/.test(new URL(process.env.DATABASE_URL!).pathname))throw Error('Isolated fixture only');
 globalThis.fetch=async()=>{throw Error('Outbound HTTP is disabled in financial fixture');};
 const db=new Client({connectionString:process.env.DATABASE_URL});await db.connect();
 const users:string[]=[];
 const request=(path:string,token:string,body:unknown,method='POST')=>new NextRequest('http://localhost:3000'+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});
 const ctx=(payoutId:string)=>({params:Promise.resolve({payoutId})});
 async function account(admin=false){const name='financial_'+randomUUID().replaceAll('-','');const user=(await db.query('INSERT INTO users(username,email,display_name,is_admin,is_creator,coin_balance,star_balance,trust_score,onboarding_completed) VALUES($1,$2,$1,$3,true,10000,10000,80,true) RETURNING id,email,username,is_admin',[name,name+'@fixture.invalid',admin])).rows[0];users.push(user.id);const session=await createSession(user,{adminSession:admin});const payload=await verifyAccessToken(session.accessToken);await db.query("INSERT INTO user_pins(user_id,pin_hash) VALUES($1,'fixture-pin')",[user.id]);await markPinVerified(user.id,payload.sid!,'fixture-pin');return {...user,...session};}
 async function setting(key:string,value:string){await db.query('INSERT INTO x_manifest(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value',[key,value]);}
 try{
  for(const [key,value] of Object.entries({crypto_payouts_enabled:'true',crypto_payout_mode:'crypto',crypto_payout_threshold_SOL:'1',feature_blogs:'true',feature_blog_gifts:'true',feature_blog_monetization:'true',feature_moments:'true',moments_min_level:'1',moments_cost_credits:'10',moments_cost_stars:'0',payouts_enabled:'true'}))await setting(key,value);
  await invalidateManifestCache();
  const admin=await account(true),buyer=await account(),seller=await account();
  const wallet='11111111111111111111111111111111';
  await db.query("INSERT INTO user_crypto_wallets(user_id,chain,address) VALUES($1,'solana',$2)",[buyer.id,wallet]);
  await db.query("INSERT INTO creator_crypto_balances(user_id,currency,balance_base_units) VALUES($1,'SOL',500)",[buyer.id]);
  const results=await Promise.all([1,2].map(()=>withdraw(request('/api/economy/crypto/withdraw',buyer.accessToken,{currency:'SOL'}),{params:Promise.resolve({})})));
  assert.equal(results.filter(r=>r.status===200).length,1);
  const payout=(await results.find(r=>r.status===200)!.json()).data.payoutId;
  assert.equal((await db.query('SELECT status,crypto_amount_base_units::text amount FROM creator_payouts WHERE id=$1',[payout])).rows[0].amount,'500');
  const saved=(await db.query('SELECT wallet_address_snapshot FROM creator_payouts WHERE id=$1',[payout])).rows[0].wallet_address_snapshot;
  await db.query("UPDATE creator_payouts SET wallet_address_snapshot='unreadable-wallet' WHERE id=$1",[payout]);assert.equal((await approve(request('/api/admin/payouts/'+payout+'/approve',admin.accessToken,{}),ctx(payout))).status,400);await db.query('UPDATE creator_payouts SET wallet_address_snapshot=$2 WHERE id=$1',[payout,saved]);
  assert.equal((await approve(request('/api/admin/payouts/'+payout+'/approve',admin.accessToken,{}),ctx(payout))).status,200);
  assert.equal((await status(request('/api/admin/payouts/'+payout+'/status',admin.accessToken,{status:'completed'},'PATCH'),ctx(payout))).status,400);
  const failed=await status(request('/api/admin/payouts/'+payout+'/status',admin.accessToken,{status:'failed'},'PATCH'),ctx(payout));assert.equal(failed.status,200);
  assert.equal((await failed.json()).earningsRestored,undefined);
  assert.equal((await db.query("SELECT balance_base_units::text b FROM creator_crypto_balances WHERE user_id=$1 AND currency='SOL'",[buyer.id])).rows[0].b,'500');
  assert.equal((await status(request('/api/admin/payouts/'+payout+'/status',admin.accessToken,{status:'failed'},'PATCH'),ctx(payout))).status,400);
  console.log('PASS concurrent native withdrawal reserves once; approval accepts its snapshot; missing proof fails and terminal failure refunds the original asset once');
  const paid=await withdraw(request('/api/economy/crypto/withdraw',buyer.accessToken,{currency:'SOL'}),{params:Promise.resolve({})});assert.equal(paid.status,200);const paidId=(await paid.json()).data.payoutId;
  assert.equal((await approve(request('/api/admin/payouts/'+paidId+'/approve',admin.accessToken,{}),ctx(paidId))).status,200);
  process.env.CRYPTO_PAYOUT_ADDRESS_SOLANA='22222222222222222222222222222222';
  const old=CHAIN_ADAPTERS.solana;
  CHAIN_ADAPTERS.solana={...old,getTransfer:async(hash)=>({hash,from:process.env.CRYPTO_PAYOUT_ADDRESS_SOLANA!,to:wallet,valueBaseUnits:500n,tokenContract:null,confirmations:MIN_CONFIRMATIONS.solana,status:'success',blockTime:Math.ceil(Date.now()/1000)})};
  try{
   const wrong=CHAIN_ADAPTERS.solana.getTransfer;CHAIN_ADAPTERS.solana.getTransfer=async(...args)=>({...await wrong(...args),valueBaseUnits:499n});
   assert.equal((await status(request('/api/admin/payouts/'+paidId+'/status',admin.accessToken,{status:'completed',txHash:'3'.repeat(88)},'PATCH'),ctx(paidId))).status,400);CHAIN_ADAPTERS.solana.getTransfer=wrong;
   const completed=await status(request('/api/admin/payouts/'+paidId+'/status',admin.accessToken,{status:'completed',txHash:'3'.repeat(88)},'PATCH'),ctx(paidId));assert.equal(completed.status,200);assert.equal((await completed.json()).amountBaseUnits,'500');assert.equal((await db.query("SELECT balance_base_units::text b FROM creator_crypto_balances WHERE user_id=$1 AND currency='SOL'",[buyer.id])).rows[0].b,'0');}finally{CHAIN_ADAPTERS.solana=old;}
  const duplicate=await account();
  await db.query("INSERT INTO user_crypto_wallets(user_id,chain,address) VALUES($1,'solana',$2)",[duplicate.id,wallet]);
  await db.query("INSERT INTO creator_crypto_balances(user_id,currency,balance_base_units) VALUES($1,'SOL',500)",[duplicate.id]);
  const replayWithdrawal=await withdraw(request('/api/economy/crypto/withdraw',duplicate.accessToken,{currency:'SOL'}),{params:Promise.resolve({})});assert.equal(replayWithdrawal.status,200);const duplicateId=(await replayWithdrawal.json()).data.payoutId;
  await db.query('UPDATE users SET is_suspended=true WHERE id=$1',[duplicate.id]);assert.equal((await approve(request('/api/admin/payouts/'+duplicateId+'/approve',admin.accessToken,{}),ctx(duplicateId))).status,400);await db.query('UPDATE users SET is_suspended=false WHERE id=$1',[duplicate.id]);
  assert.equal((await approve(request('/api/admin/payouts/'+duplicateId+'/approve',admin.accessToken,{}),ctx(duplicateId))).status,200);
  CHAIN_ADAPTERS.solana={...old,getTransfer:async(hash)=>({hash,from:process.env.CRYPTO_PAYOUT_ADDRESS_SOLANA!,to:wallet,valueBaseUnits:500n,tokenContract:null,confirmations:MIN_CONFIRMATIONS.solana,status:'success',blockTime:Math.ceil(Date.now()/1000)})};
  try{assert.equal((await status(request('/api/admin/payouts/'+duplicateId+'/status',admin.accessToken,{status:'completed',txHash:'3'.repeat(88)},'PATCH'),ctx(duplicateId))).status,400);}finally{CHAIN_ADAPTERS.solana=old;}
  console.log('PASS native payout completion verifies exact asset, destination, source, amount and confirmation evidence (fixture chain adapter)');
  await db.query("UPDATE users SET available_earnings_kobo=9007199254740993 WHERE id=$1",[seller.id]);
  assert.equal((await convert(request('/api/creator/payouts',seller.accessToken,{method:'coins'}),{params:Promise.resolve({})})).status,400);
  assert.equal((await convert(request('/api/creator/payouts',seller.accessToken,{method:'coins',amountKobo:Number.MAX_SAFE_INTEGER+1}),{params:Promise.resolve({})})).status,400);
  assert.equal((await db.query('SELECT available_earnings_kobo::text amount FROM users WHERE id=$1',[seller.id])).rows[0].amount,'9007199254740993');
  await db.query("UPDATE users SET available_earnings_kobo=10000 WHERE id=$1",[seller.id]);
  await db.query("INSERT INTO creator_payouts(creator_id,amount_kobo,provider,payout_method,status) SELECT $1,1,'internal','coins','completed' FROM generate_series(1,3)",[seller.id]);
  const converted=await convert(request('/api/creator/payouts',seller.accessToken,{method:'coins',amountKobo:1000}),{params:Promise.resolve({})});assert.equal(converted.status,200);const conversion=(await converted.json()).payout;assert.equal(conversion.requiresManualApproval,true);assert.equal(conversion.coinsAwarded,0);
  const review=(await db.query("SELECT id FROM creator_payouts WHERE creator_id=$1 AND status='awaiting_approval'",[seller.id])).rows[0].id;
  assert.equal((await status(request('/api/admin/payouts/'+review+'/status',admin.accessToken,{status:'processing'},'PATCH'),ctx(review))).status,400);
  const reviewed=await Promise.all([1,2].map(()=>approve(request('/api/admin/payouts/'+review+'/approve',admin.accessToken,{}),ctx(review))));assert.equal(reviewed.filter(r=>r.status===200).length,1);
  assert.equal((await db.query("SELECT COUNT(*)::int n FROM coin_ledger WHERE user_id=$1 AND transaction_type='creator_coin_conversion'",[seller.id])).rows[0].n,1);
  console.log('PASS fraud velocity forces coin-conversion review; no coins are spendable until one successful approval');
  const slug='gift-'+randomUUID();const blog=(await db.query("INSERT INTO blogs(owner_id,slug,title,status) VALUES($1,$2,'Financial fixture','active') RETURNING id",[seller.id,slug])).rows[0].id;
  const tier=(await db.query("INSERT INTO blog_gift_tiers(blog_id,name,credits_price,stars_price,benefit_type,benefit_config) VALUES($1,'Gift',100,100,'custom_reward',$2::jsonb) RETURNING id",[blog,JSON.stringify({textInstructions:'buyer-only-marker'})])).rows[0].id;
  assert(!JSON.stringify(await listPublicGiftTiers(blog)).includes('buyer-only-marker'));assert(!JSON.stringify(await repoCatalog(blog)).includes('buyer-only-marker'));assert.equal(await getGiftTextReveal(buyer.id,tier),null);
  const snapshot=async()=> (await db.query('SELECT coin_balance,star_balance,available_earnings_kobo::text earnings FROM users WHERE id=$1',[buyer.id])).rows[0];const before=await snapshot();
  await db.query("CREATE FUNCTION fixture_reject_earnings() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.source_type='blog_gift' THEN RAISE EXCEPTION 'fixture settlement failure'; END IF; RETURN NEW; END $$");await db.query('CREATE TRIGGER fixture_reject_earnings BEFORE INSERT ON creator_earnings FOR EACH ROW EXECUTE FUNCTION fixture_reject_earnings()');
  await assert.rejects(sendGift(buyer.id,tier,'credits'));assert.deepEqual(await snapshot(),before);assert.equal((await db.query('SELECT COUNT(*)::int n FROM blog_gift_purchases WHERE tier_id=$1',[tier])).rows[0].n,0);
  await db.query('DROP TRIGGER fixture_reject_earnings ON creator_earnings');await db.query('DROP FUNCTION fixture_reject_earnings()');
  const blocker=new Client({connectionString:process.env.DATABASE_URL});await blocker.connect();await blocker.query('BEGIN');await blocker.query('SELECT id FROM blog_gift_tiers WHERE id=$1 FOR UPDATE',[tier]);
  const changedPurchase=sendGift(buyer.id,tier,'credits').then(()=>null,error=>error);
  try{
   const deadline=Date.now()+5000;let waiting=false;
   while(Date.now()<deadline){const activity=await db.query("SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'SELECT t.*, b.owner_id%' LIMIT 1");if(activity.rows.length){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,25));}
   assert(waiting,'Purchase did not reach its tier lock');await blocker.query('UPDATE blog_gift_tiers SET credits_price=200 WHERE id=$1',[tier]);await blocker.query('COMMIT');assert.equal((await changedPurchase)?.code,'BLOG_GIFT_CHANGED');assert.deepEqual(await snapshot(),before);
  }finally{await blocker.query('ROLLBACK');await blocker.end();}
  await db.query('UPDATE blog_gift_tiers SET credits_price=100 WHERE id=$1',[tier]);
  const gift=await sendGift(buyer.id,tier,'credits');assert.equal(gift.textInstructions,'buyer-only-marker');assert.equal((await getGiftTextReveal(buyer.id,tier))?.textInstructions,'buyer-only-marker');
  const starBefore=(await db.query('SELECT star_balance FROM users WHERE id=$1',[seller.id])).rows[0].star_balance;await sendGift(buyer.id,tier,'stars');assert((await db.query('SELECT star_balance FROM users WHERE id=$1',[seller.id])).rows[0].star_balance>starBefore);
  await db.query('UPDATE blog_gift_tiers SET benefit_config=$2::jsonb WHERE id=$1',[tier,JSON.stringify({treasuryAmount:100})]);const noPot=await snapshot();await assert.rejects(sendGift(buyer.id,tier,'credits'));assert.deepEqual(await snapshot(),noPot);
  console.log('PASS unpaid gift catalogs exclude fulfillment secrets; buyer debit and seller earnings roll back together on failure; credits/stars settle and unfunded promised rewards cannot charge');
  const room=(await db.query("INSERT INTO rooms(creator_id,name,type,is_active,status,slug) VALUES($1,'Moment fixture','free_open',true,'active',$2) RETURNING id",[buyer.id,'moment-'+randomUUID()])).rows[0].id;
  const key=randomUUID();const send=()=>sendRoom(request('/api/rooms/'+room+'/messages',buyer.accessToken,{content:'A safe Moment fixture',messageType:'moment',currency:'credits',idempotencyKey:key}),{params:Promise.resolve({roomId:room})});
  const messages=await Promise.all([send(),send()]);for(const response of messages)assert([200,201].includes(response.status),JSON.stringify(await response.clone().json()));
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM moments WHERE user_id=$1',[buyer.id])).rows[0].n,1);assert.equal((await db.query('SELECT COUNT(*)::int n FROM room_messages WHERE room_id=$1',[room])).rows[0].n,1);assert.equal((await db.query("SELECT COUNT(*)::int n FROM coin_ledger WHERE user_id=$1 AND transaction_type='moment_created'",[buyer.id])).rows[0].n,1);
  await db.query("CREATE FUNCTION fixture_reject_message() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.message_type='moment' THEN RAISE EXCEPTION 'fixture message failure'; END IF; RETURN NEW; END $$");await db.query('CREATE TRIGGER fixture_reject_message BEFORE INSERT ON room_messages FOR EACH ROW EXECUTE FUNCTION fixture_reject_message()');
  const momentBefore=await snapshot();const rejected=await sendRoom(request('/api/rooms/'+room+'/messages',buyer.accessToken,{content:'Another safe fixture',messageType:'moment',currency:'credits',idempotencyKey:randomUUID()}),{params:Promise.resolve({roomId:room})});assert(rejected.status>=400);assert.deepEqual(await snapshot(),momentBefore);assert.equal((await db.query('SELECT COUNT(*)::int n FROM moments WHERE user_id=$1',[buyer.id])).rows[0].n,1);
  await db.query('DROP TRIGGER fixture_reject_message ON room_messages');await db.query('DROP FUNCTION fixture_reject_message()');
  console.log('PASS simultaneous Room Moment retries create one message, Moment and charge; message failure rolls back Moment and balance');
 }finally{for(const id of users)await invalidateAllSessions(id);await db.end();}
}
main().then(()=>process.exit(0)).catch(error=>{console.error(error.stack);process.exit(1);});
