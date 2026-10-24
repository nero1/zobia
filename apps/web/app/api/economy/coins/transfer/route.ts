export const dynamic='force-dynamic';
import {NextResponse} from 'next/server';
import {z} from 'zod';
import {and,eq,isNull,sql} from 'drizzle-orm';
import {getDb,schema} from '@/lib/db/drizzle';
import {withAuth,validateBody} from '@/lib/api/middleware';
import {badRequest,notFound,forbidden,handleApiError} from '@/lib/api/errors';
import {transferCoins} from '@/lib/economy/coins';
import {requirePinVerified} from '@/lib/auth/pinGuard';
import {enforceRateLimit,RATE_LIMITS} from '@/lib/security/rateLimit';
import {enqueueTask} from '@/lib/tasks/outbox';
import {calculateFinalXP} from '@/lib/xp/engine';
import type {Plan} from '@zobia/types';
const transferSchema=z.object({expectedSenderId:z.string().uuid(),recipientId:z.string().uuid(),amount:z.number().int().min(10).max(100000),idempotencyKey:z.string().uuid()});
/** Ledger state, never an uncommitted Redis flag, determines a successful replay. */
export const POST=withAuth(async(request,{auth})=>{
 try{
  const senderId=auth.user.sub;
  if(!await requirePinVerified(senderId,auth.user.sid))throw forbidden('PIN verification required','PIN_REQUIRED');
  const body=await validateBody(request,transferSchema);
  if(body.expectedSenderId!==senderId)throw forbidden("The signed-in account changed. Reload the wallet before transferring.","ACCOUNT_CHANGED");
  if(body.recipientId===senderId)throw badRequest('Cannot transfer coins to yourself');
  await enforceRateLimit(senderId,'user',RATE_LIMITS.apiWrite);
  const db=await getDb(),reference=`transfer:${senderId}:${body.idempotencyKey}`;
  const result=await db.transaction(async tx=>{
   for(const id of [senderId,body.recipientId].sort())await tx.select({id:schema.users.id}).from(schema.users).where(eq(schema.users.id,id)).for('no key update');
   const [sender]=await tx.select({plan:schema.users.plan,balance:schema.users.coinBalance}).from(schema.users).where(and(eq(schema.users.id,senderId),isNull(schema.users.deletedAt)));
   const [recipient]=await tx.select({username:schema.users.username,deleted:schema.users.deletedAt,banned:schema.users.isBanned,suspended:schema.users.isSuspended,suspendedUntil:schema.users.suspendedUntil}).from(schema.users).where(eq(schema.users.id,body.recipientId));
   const prior=await tx.execute(sql`SELECT id FROM coin_ledger WHERE user_id=${senderId} AND transaction_type='gift_sent' AND reference_id=${reference+':debit'} UNION ALL SELECT id FROM coin_ledger_archive WHERE user_id=${senderId} AND transaction_type='gift_sent' AND reference_id=${reference+':debit'}`);
   if(!sender || !recipient)throw notFound('Account not found');
   if(!prior.rows.length){
    if(recipient.deleted || recipient.banned || (recipient.suspended && (!recipient.suspendedUntil || recipient.suspendedUntil>new Date())))throw notFound('Recipient user not found');
    const blocked=await tx.execute(sql`SELECT id FROM user_blocks WHERE (blocker_id=${senderId} AND blocked_id=${body.recipientId}) OR (blocker_id=${body.recipientId} AND blocked_id=${senderId}) LIMIT 1`);
    if(blocked.rows.length)throw forbidden('Cannot transfer coins to this user','USER_BLOCKED');
   }
   const transfer=await transferCoins(senderId,body.recipientId,body.amount,reference,5,tx,'gift_sent','gift_received');
   const senderXP=calculateFinalXP('send_gift_message',{plan:sender.plan as Plan,isMessagingAction:true}).finalXp;
   const recipientXP=calculateFinalXP('receive_gift_and_react',{plan:'free',isMessagingAction:false}).finalXp;
   if(senderXP>0)await enqueueTask(tx,'xp_award',reference+':sender',senderId,{amount:senderXP,track:'generosity',source:'coin_transfer_sent',referenceId:reference+':sender'});
   if(recipientXP>0)await enqueueTask(tx,'xp_award',reference+':recipient',body.recipientId,{amount:recipientXP,track:'social',source:'coin_transfer_received',referenceId:reference+':recipient'});
   const [current]=await tx.select({balance:schema.users.coinBalance}).from(schema.users).where(eq(schema.users.id,senderId));
   return {feeCoins:transfer.feeCoins,senderBalance:Number(current.balance),username:recipient.username,replayed:prior.rows.length>0};
  });
  return NextResponse.json({success:true,replayed:result.replayed,transfer:{grossAmount:body.amount,feeCoins:result.feeCoins,netAmount:body.amount-result.feeCoins,recipient:{id:body.recipientId,username:result.username}},senderBalance:result.senderBalance});
 }catch(error){if((error as {code?:string}).code==='INSUFFICIENT_BALANCE')return handleApiError(badRequest('Insufficient coin balance','INSUFFICIENT_BALANCE'));return handleApiError(error);}
});
