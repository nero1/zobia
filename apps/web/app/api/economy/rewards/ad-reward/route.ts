export const dynamic='force-dynamic';
import {NextResponse} from 'next/server';
import {randomInt} from 'node:crypto';
import {and,eq,isNull,sql} from 'drizzle-orm';
import {z} from 'zod';
import {getDb,schema} from '@/lib/db/drizzle';
import {withAuth,validateBody} from '@/lib/api/middleware';
import {badRequest,forbidden,handleApiError,ApiError} from '@/lib/api/errors';
import {loadManifest} from '@/lib/manifest';
import {enforceRateLimit} from '@/lib/security/rateLimit';
import {creditCoins} from '@/lib/economy/coins';
import {verifyAdReceipt} from '@/lib/ads/receipts';
import {issueRewardChallenge,verifyRewardChallenge,hasAdmobCompletion} from '@/lib/ads/rewardProof';
const bodySchema=z.discriminatedUnion('provider',[
 z.object({provider:z.literal('in_house'),receipt:z.string().max(1024),creativeId:z.string().uuid(),placementKey:z.literal('rewarded_global')}),
 z.object({provider:z.literal('admob'),challenge:z.string().max(1024)}),
]);
/** Prepare opaque account-bound custom_data for the native SDK's SSV options. */
export const GET=withAuth(async(_request,{auth})=>{
 try{await enforceRateLimit(auth.user.sub,'user',{name:'admob:prepare',limit:10,windowMs:60000,bypassL1:true});const manifest=await loadManifest();if(!manifest.features.rewardedAds || !manifest.ads.admob.rewardedUnitId)throw forbidden('Rewarded ads are unavailable');return NextResponse.json({success:true,data:{challenge:issueRewardChallenge(auth.user.sub)}});}catch(error){return handleApiError(error);}
});
export const POST=withAuth(async(request,{auth})=>{
 try{
  const userId=auth.user.sub;
  await enforceRateLimit(userId,'user',{name:'ads:reward',limit:30,windowMs:60000,globalLimit:10000,bypassL1:true});
  const body=await validateBody(request,bodySchema),manifest=await loadManifest();
  if(!manifest.features.rewardedAds)throw forbidden('Rewarded ads are unavailable');
  let referenceId:string;
  if(body.provider==='in_house'){
   const receipt=verifyAdReceipt(body.receipt,userId,body.creativeId,body.placementKey);
   if(!receipt || Date.now()-(receipt.expires-86400000)<15000)throw badRequest('A completed rewarded ad is required','AD_COMPLETION_REQUIRED');
   referenceId=`rewarded:${receipt.id}`;
  }else{
   const challenge=verifyRewardChallenge(body.challenge);
   if(!challenge || challenge.userId!==userId)throw badRequest('Invalid rewarded-ad challenge','AD_COMPLETION_REQUIRED');
   if(!await hasAdmobCompletion(challenge))return NextResponse.json({success:true,data:{pending:true,coinsAwarded:0}},{status:202});
   referenceId=`admob:${challenge.id}`;
  }
  const minimum=manifest.ads.rewardedCreditsMin,maximum=manifest.ads.rewardedCreditsMax,cap=manifest.ads.rewardedDailyCap;
  if(![minimum,maximum,cap].every(Number.isSafeInteger)||minimum<1||maximum<minimum||maximum>100000||cap<1||cap>100)throw Error('Invalid rewarded-ad policy');
  const db=await getDb();
  const result=await db.transaction(async tx=>{
   const [user]=await tx.select({plan:schema.users.plan}).from(schema.users).where(and(eq(schema.users.id,userId),isNull(schema.users.deletedAt))).for('update');
   if(!user || !['free','plus'].includes(user.plan))throw forbidden('Rewarded ads are available for free and Plus plan users.','PAID_PLAN_INELIGIBLE');
   const prior=await tx.execute<{amount:string}>(sql`SELECT amount::text FROM coin_ledger WHERE user_id=${userId} AND transaction_type='ad_reward' AND reference_id=${referenceId} UNION ALL SELECT amount::text FROM coin_ledger_archive WHERE user_id=${userId} AND transaction_type='ad_reward' AND reference_id=${referenceId}`);
   const counted=await tx.execute<{n:number}>(sql`SELECT COUNT(*)::int n FROM (SELECT id FROM coin_ledger WHERE user_id=${userId} AND transaction_type='ad_reward' AND created_at>=date_trunc('day',NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' UNION ALL SELECT id FROM coin_ledger_archive WHERE user_id=${userId} AND transaction_type='ad_reward' AND created_at>=date_trunc('day',NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') rewards`);
   if(prior.rows[0])return {coinsAwarded:Number(prior.rows[0].amount),remainingToday:Math.max(0,cap-counted.rows[0].n),replayed:true};
   if(counted.rows[0].n>=cap)throw new ApiError(429,'DAILY_LIMIT_REACHED','Your daily rewarded-ad limit has been reached.');
   if(body.provider==='in_house'){
    const receipt=verifyAdReceipt(body.receipt,userId,body.creativeId,body.placementKey)!;
    const impression=await tx.execute(sql`SELECT id FROM ad_events WHERE client_event_id=${receipt.id} AND creative_id=${body.creativeId} AND user_id=${userId} AND placement_key='rewarded_global' AND event_type='impression' LIMIT 1`);
    if(!impression.rows.length)throw badRequest('A recorded rewarded-ad impression is required','AD_COMPLETION_REQUIRED');
   }
   const amount=randomInt(minimum,maximum+1);
   await creditCoins(userId,amount,'ad_reward',referenceId,'Verified rewarded-ad bonus',{provider:body.provider},tx);
   // Credits issued as rewards are not verified fiat revenue.
   return {coinsAwarded:amount,remainingToday:cap-counted.rows[0].n-1,replayed:false};
  });
  return NextResponse.json({success:true,data:result,error:null});
 }catch(error){return handleApiError(error);}
});
