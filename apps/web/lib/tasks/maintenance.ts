import {z} from 'zod';
import {sql,eq} from 'drizzle-orm';
import {getDb,schema} from '@/lib/db/drizzle';
import {getManifestValue} from '@/lib/manifest';
import {enqueueTask,type DurableTask} from './outbox';
const scans=['personal_subscriptions','business_subscriptions','business_downgrades','streak_referrals'] as const;
type Scan=typeof scans[number];
const daySchema=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const payloadSchema=z.discriminatedUnion('operation',[
 z.object({operation:z.literal('scan'),scan:z.enum(scans),day:daySchema,cursor:z.string().uuid().nullable().default(null)}),
 z.object({operation:z.literal('personal_subscription'),userId:z.string().uuid()}),
 z.object({operation:z.literal('business_subscription'),accountId:z.string().uuid()}),
 z.object({operation:z.literal('business_downgrade'),accountId:z.string().uuid()}),
 z.object({operation:z.literal('streak_referral'),referralId:z.string().uuid()}),
]);
/** Scans enqueue bounded account-sized jobs; account state is the durable progress checkpoint. */
export async function enqueueMaintenanceScan(scan:Scan,day=new Date().toISOString().slice(0,10)){
 const db=await getDb();return db.transaction(tx=>enqueueTask(tx,'maintenance_sweep',`scan:${scan}:${day}:start`,null,{operation:'scan',scan,day,cursor:null}));
}
async function scanPage(input:Extract<z.infer<typeof payloadSchema>,{operation:'scan'}>){
 if(input.scan==='streak_referrals' && !['login_streak_7','both'].includes((await getManifestValue('referral_qualifying_action'))??'coin_purchase'))return;
 const db=await getDb();
 await db.transaction(async tx=>{
  type Row={id:string;user_id:string;version:string};
  const cursor=input.cursor;
  const query=input.scan==='personal_subscriptions'?sql`SELECT id,user_id,CONCAT_WS(':',status,EXTRACT(EPOCH FROM ends_at),EXTRACT(EPOCH FROM grace_period_ends_at)) version FROM subscriptions WHERE (${cursor}::uuid IS NULL OR id>${cursor}::uuid) AND ((status IN ('active','cancelled','trialing') AND ends_at<NOW()) OR (status='grace' AND grace_period_ends_at<NOW())) ORDER BY id LIMIT 101`
   :input.scan==='business_subscriptions'?sql`SELECT id,user_id,CONCAT_WS(':',status,EXTRACT(EPOCH FROM current_period_ends_at),EXTRACT(EPOCH FROM grace_period_ends_at)) version FROM business_accounts WHERE (${cursor}::uuid IS NULL OR id>${cursor}::uuid) AND ((status='active' AND current_period_ends_at<NOW()) OR (status='grace' AND grace_period_ends_at<NOW())) ORDER BY id LIMIT 101`
   :input.scan==='business_downgrades'?sql`SELECT id,user_id,CONCAT_WS(':',downgrade_to_tier,downgrade_account_type_slug,EXTRACT(EPOCH FROM downgrade_effective_at)) version FROM business_accounts WHERE (${cursor}::uuid IS NULL OR id>${cursor}::uuid) AND downgrade_to_tier IS NOT NULL AND downgrade_effective_at<=NOW() ORDER BY id LIMIT 101`
   :sql`SELECT r.id,r.referrer_id user_id,${input.day}::text version FROM referrals r JOIN users u ON u.id=r.referred_id JOIN users referrer ON referrer.id=r.referrer_id WHERE (${cursor}::uuid IS NULL OR r.id>${cursor}::uuid) AND NOT r.qualified AND r.tier=1 AND u.referred_by=r.referrer_id AND (u.login_streak_days>=7 OR u.longest_streak>=7) AND u.deleted_at IS NULL AND NOT u.is_banned AND referrer.deleted_at IS NULL AND NOT referrer.is_banned ORDER BY r.id LIMIT 101`;
  const result=await tx.execute<Row>(query),rows=result.rows.slice(0,100);
  if(rows.length)await tx.insert(schema.transactionalTasks).values(rows.map(row=>({kind:'maintenance_sweep',operationKey:`${input.scan}:${row.id}:${row.user_id}:${row.version}`,userId:row.user_id,payload:input.scan==='personal_subscriptions'?{operation:'personal_subscription',userId:row.user_id}:input.scan==='business_subscriptions'?{operation:'business_subscription',accountId:row.id}:input.scan==='business_downgrades'?{operation:'business_downgrade',accountId:row.id}:{operation:'streak_referral',referralId:row.id}}))).onConflictDoNothing({target:[schema.transactionalTasks.kind,schema.transactionalTasks.operationKey]});
  if(result.rows.length>100)await enqueueTask(tx,'maintenance_sweep',`scan:${input.scan}:${input.day}:after:${rows.at(-1)!.id}`,null,{...input,cursor:rows.at(-1)!.id});
 });
}
async function qualifyReferral(referralId:string,ownerId:string){
 if(!["login_streak_7","both"].includes((await getManifestValue("referral_qualifying_action"))??"coin_purchase"))return;
 const [xpRaw,coinRaw]=await Promise.all([getManifestValue('referral_tier1_xp_bonus'),getManifestValue('referral_tier1_coin_bonus')]);
 const xp=Number(xpRaw??500),coins=Number(coinRaw??100);
 if(![xp,coins].every(value=>Number.isSafeInteger(value)&&value>=0))throw Error('Invalid referral bonus policy');
 const db=await getDb();
 await db.transaction(async tx=>{
  const result=await tx.execute<{id:string;referrer_id:string}>(sql`SELECT r.id,r.referrer_id FROM referrals r JOIN users u ON u.id=r.referred_id JOIN users referrer ON referrer.id=r.referrer_id WHERE r.id=${referralId} AND r.referrer_id=${ownerId} AND r.tier=1 AND NOT r.qualified AND u.referred_by=r.referrer_id AND (u.login_streak_days>=7 OR u.longest_streak>=7) AND u.deleted_at IS NULL AND NOT u.is_banned AND referrer.deleted_at IS NULL AND NOT referrer.is_banned FOR UPDATE OF r`);
  const referral=result.rows[0];if(!referral)return;
  await tx.update(schema.referrals).set({qualified:true,qualifiedAt:new Date(),coinReward:coins,xpReward:xp}).where(eq(schema.referrals.id,referral.id));
  if(coins)await enqueueTask(tx,'coin_credit',`referral-qualified:${referral.id}`,referral.referrer_id,{amount:coins,transactionType:'referral_bonus',referenceId:referral.id,description:'One-time referral bonus (7-day streak)'});
  if(xp)await enqueueTask(tx,'xp_award',`referral-qualified:${referral.id}`,referral.referrer_id,{amount:xp,track:'social',source:'referral_qualified_streak',referenceId:`referral_qualified:${referral.id}`});
 });
}
export async function deliverMaintenanceTask(task:DurableTask){
 const input=payloadSchema.parse(task.payload);
 if(input.operation!=="scan" && !task.user_id)throw Error("Maintenance task has no owner");
 if(input.operation==="personal_subscription" && input.userId!==task.user_id)throw Error("Maintenance task owner mismatch");
 switch(input.operation){
  case 'scan':return scanPage(input);
  case 'personal_subscription':await (await import('@/lib/plans/subscriptionSweep')).sweepSubscriptions({kind:'personal',userId:input.userId});return;
  case 'business_subscription':await (await import('@/lib/plans/subscriptionSweep')).sweepSubscriptions({kind:'business',accountId:input.accountId,expectedUserId:task.user_id!});return;
  case 'business_downgrade':await (await import('@/lib/business/downgradeSweep')).sweepBusinessDowngrades({accountId:input.accountId,expectedUserId:task.user_id!});return;
  case 'streak_referral':return qualifyReferral(input.referralId,task.user_id!);
 }
}
