import assert from 'node:assert/strict';
import {Client} from 'pg';
import {randomUUID} from 'node:crypto';
import {enqueueMaintenanceScan,deliverMaintenanceTask} from '../lib/tasks/maintenance';
import {processTask,type DurableTask} from '../lib/tasks/outbox';
import {redis} from '../lib/redis';
import {invalidateManifestCache} from '../lib/manifest';

async function main(){
 if(!/^\/zobia_remediation_[a-f0-9]+$/.test(new URL(process.env.DATABASE_URL??'postgresql://invalid/').pathname))throw Error('Disposable remediation database required');
 const db=new Client({connectionString:process.env.DATABASE_URL});await db.connect();
 const users:string[]=[];
 try{
  // More than one scan page, including one early account which will renew
  // after scan discovery but before its queued cleanup actually runs.
  const batch=await db.query<{id:string}>(`INSERT INTO users(username,email,display_name,plan)
   SELECT 'maintenance_'||v,'maintenance_'||v||'@security.invalid','Fixture','plus'
   FROM (SELECT gen_random_uuid()::text v FROM generate_series(1,101)) s RETURNING id`);
  users.push(...batch.rows.map(row=>row.id));
  await db.query(`INSERT INTO subscriptions(user_id,plan,ends_at) SELECT id,'plus',NOW()-INTERVAL '1 day' FROM users WHERE id=ANY($1::uuid[])`,[users]);
  const scan=await enqueueMaintenanceScan('personal_subscriptions');await processTask(scan);
  const first=await db.query("SELECT id,payload FROM transactional_tasks WHERE kind='maintenance_sweep' AND payload->>'operation'='personal_subscription'");
  assert.equal(first.rowCount,100,'First scan must bound account jobs');
  const continuation=(await db.query("SELECT id FROM transactional_tasks WHERE kind='maintenance_sweep' AND payload->>'operation'='scan' AND payload->>'cursor' IS NOT NULL")).rows[0];
  assert.ok(continuation,'Scan must persist continuation in the same transaction');
  await processTask(continuation.id);
  const all=await db.query("SELECT id,user_id FROM transactional_tasks WHERE kind='maintenance_sweep' AND payload->>'operation'='personal_subscription'");
  assert.equal(all.rowCount,101,'Continuation must discover remaining account');
  await processTask(scan);await processTask(continuation.id);
  assert.equal((await db.query("SELECT count(*)::int n FROM transactional_tasks WHERE kind='maintenance_sweep' AND payload->>'operation'='personal_subscription'")).rows[0].n,101);
  const renewed=all.rows[0];
  await db.query("UPDATE subscriptions SET ends_at=NOW()+INTERVAL '30 days' WHERE user_id=$1",[renewed.user_id]);
  for(const job of all.rows)await processTask(job.id);
  assert.equal((await db.query("SELECT count(*)::int n FROM subscriptions WHERE status='grace'")).rows[0].n,100);
  assert.equal((await db.query('SELECT plan FROM users WHERE id=$1',[renewed.user_id])).rows[0].plan,'plus','Queued expiry must preserve renewal');
  assert.equal((await db.query("SELECT count(*)::int n FROM transactional_tasks WHERE kind='maintenance_sweep' AND status<>'completed'")).rows[0].n,0);
  console.log('PASS bounded 100-account scan, durable continuation, replay and renewal recheck');

  const owner=users[0];
  const account=(await db.query("INSERT INTO business_accounts(user_id,business_name,tier,downgrade_to_tier,downgrade_effective_at,downgrade_account_type_slug) VALUES($1,'Fixture','enterprise','starter',NOW()-INTERVAL '1 day','business_starter') RETURNING id",[owner])).rows[0];
  const task:DurableTask={id:randomUUID(),kind:'maintenance_sweep',operation_key:'fixture',user_id:owner,payload:{operation:'business_downgrade',accountId:account.id},attempts:1};
  await db.query("UPDATE business_accounts SET downgrade_to_tier=NULL,downgrade_effective_at=NULL WHERE id=$1",[account.id]);
  await deliverMaintenanceTask(task);
  assert.equal((await db.query('SELECT tier FROM business_accounts WHERE id=$1',[account.id])).rows[0].tier,'enterprise','Stale queued downgrade must not overwrite upgrade');
  await db.query("UPDATE business_accounts SET downgrade_to_tier='starter',downgrade_effective_at=NOW()-INTERVAL '1 day' WHERE id=$1",[account.id]);
  await deliverMaintenanceTask({...task,user_id:users[1]});
  assert.equal((await db.query('SELECT tier FROM business_accounts WHERE id=$1',[account.id])).rows[0].tier,'enterprise','Task must not mutate account transferred to another owner');
  await deliverMaintenanceTask(task);await deliverMaintenanceTask(task);
  assert.equal((await db.query('SELECT tier FROM business_accounts WHERE id=$1',[account.id])).rows[0].tier,'starter');
  assert.equal((await db.query("SELECT count(*)::int n FROM notifications WHERE user_id=$1 AND type='business_tier_downgraded'",[owner])).rows[0].n,1);
  console.log('PASS scoped downgrade preserves newer upgrades and ownership; repeated delivery changes tier once');
  const previousManifest=await redis.get('app:manifest:kv:v4');
  try{
   await invalidateManifestCache();
   await db.query("INSERT INTO x_manifest(key,value) VALUES('referral_qualifying_action','login_streak_7'),('referral_tier1_coin_bonus','100'),('referral_tier1_xp_bonus','500') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value");
   await db.query('UPDATE users SET referred_by=$1,login_streak_days=7 WHERE id=$2',[owner,users[1]]);
   const referral=(await db.query('INSERT INTO referrals(referrer_id,referred_id) VALUES($1,$2) RETURNING id',[owner,users[1]])).rows[0];
   const referralTask:DurableTask={...task,payload:{operation:'streak_referral',referralId:referral.id}};
   await Promise.all([deliverMaintenanceTask(referralTask),deliverMaintenanceTask(referralTask)]);
   const rewards=await db.query("SELECT id,kind FROM transactional_tasks WHERE operation_key=$1",['referral-qualified:'+referral.id]);
   assert.equal(rewards.rowCount,2,'Qualification must durably persist both rewards once');
   assert.equal((await db.query('SELECT qualified FROM referrals WHERE id=$1',[referral.id])).rows[0].qualified,true);
   const credit=rewards.rows.find(row=>row.kind==='coin_credit')!;
   await db.query('UPDATE users SET coin_balance=1000000000000 WHERE id=$1',[owner]);
   await processTask(credit.id);
   assert.equal((await db.query('SELECT status FROM transactional_tasks WHERE id=$1',[credit.id])).rows[0].status,'pending','Failed credit must retain a retryable reward');
   await db.query('UPDATE users SET coin_balance=0 WHERE id=$1',[owner]);
   await db.query('UPDATE transactional_tasks SET available_at=NOW() WHERE id=$1',[credit.id]);
   await processTask(credit.id);await processTask(credit.id);await deliverMaintenanceTask(referralTask);
   assert.equal((await db.query('SELECT coin_balance::text balance FROM users WHERE id=$1',[owner])).rows[0].balance,'100');
   console.log('PASS concurrent streak qualification commits both reward intents; failed coin settlement recovers exactly once');
  }finally{
   await invalidateManifestCache();
   if(previousManifest)await redis.set('app:manifest:kv:v4',previousManifest,'EX',600);
  }
 }finally{
  await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[users]);await db.end();
 }
}
main().then(()=>process.exit(0)).catch(error=>{console.error(error.message);process.exit(1);});
