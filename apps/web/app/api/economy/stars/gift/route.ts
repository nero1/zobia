export const dynamic='force-dynamic';
import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {and,eq,gte,isNull,sql} from 'drizzle-orm';
import {getDb,schema} from '@/lib/db/drizzle';
import {withAuth,validateBody} from '@/lib/api/middleware';
import {handleApiError,badRequest,conflict,forbidden} from '@/lib/api/errors';
import {enforceRateLimit,RATE_LIMITS} from '@/lib/security/rateLimit';
import {requirePinVerified} from '@/lib/auth/pinGuard';
import {debitStars,creditStars} from '@/lib/economy/stars';
import {safeAwardXP} from '@/lib/xp/safeAwardXP';
import {insertNotification} from '@/lib/notifications/insert';
const bodySchema=z.object({recipientId:z.string().uuid(),amount:z.number().int().min(1).max(1000),message:z.string().max(200).optional(),idempotencyKey:z.string().uuid().optional()});
export const POST=withAuth(async(req:NextRequest,{auth})=>{
 try{
  const senderId=auth.user.sub;
  await enforceRateLimit(senderId,'user',RATE_LIMITS.apiWrite);
  await enforceRateLimit(senderId,'user',RATE_LIMITS.starGift);
  if(!await requirePinVerified(senderId,auth.user.sid))throw forbidden('Verify your PIN before sending Stars','PIN_REQUIRED');
  const body=await validateBody(req,bodySchema);
  if(body.recipientId===senderId)throw badRequest('Cannot gift Stars to yourself');
  const key=body.idempotencyKey??req.headers.get('Idempotency-Key');
  if(!key || !z.string().uuid().safeParse(key).success)throw badRequest('A UUID idempotency key is required','IDEMPOTENCY_KEY_REQUIRED');
  const reference=`stars:${senderId}:${key}`;
  const db=await getDb();
  const recipient=await db.transaction(async(tx)=>{
   // Every transfer locks its participants in the same global order.
   const accounts=await tx.execute<{id:string;username:string}>(sql`SELECT id,username FROM users WHERE id IN (${senderId}::uuid,${body.recipientId}::uuid) AND deleted_at IS NULL AND NOT COALESCE(is_banned,false) AND NOT(COALESCE(is_suspended,false) AND (suspended_until IS NULL OR suspended_until>NOW())) ORDER BY id FOR UPDATE`);
   if(accounts.rows.length!==2)throw badRequest('An account is unavailable','RECIPIENT_UNAVAILABLE');
   const recipient=accounts.rows.find(row=>row.id===body.recipientId)!;
   const history=await tx.execute<{user_id:string;amount:string;transaction_type:string}>(sql`SELECT user_id,amount::text,transaction_type FROM (SELECT user_id,amount,transaction_type,reference_id FROM star_ledger UNION ALL SELECT user_id,amount,transaction_type,reference_id FROM star_ledger_archive) h WHERE reference_id=${reference}`);
   if(history.rows.length){
    const debit=history.rows.find(row=>row.user_id===senderId && row.transaction_type==='gift_sent');
    const credit=history.rows.find(row=>row.user_id===body.recipientId && row.transaction_type==='gift_received');
    if(!debit || !credit || BigInt(debit.amount)!==-BigInt(body.amount) || BigInt(credit.amount)!==BigInt(body.amount))throw conflict('Idempotency key belongs to a different gift','IDEMPOTENCY_CONFLICT');
    return recipient;
   }
   await debitStars(senderId,body.amount,'gift_sent',reference,`Gift to @${recipient.username}`,tx);
   await creditStars(body.recipientId,body.amount,'gift_received',reference,'Received a Star gift',tx);
   const [earned]=await tx.select({total:sql<string>`COALESCE(SUM(${schema.xpLedger.amount}),0)::text`}).from(schema.xpLedger).where(and(eq(schema.xpLedger.userId,senderId),eq(schema.xpLedger.source,'star_gift'),gte(schema.xpLedger.createdAt,sql`CURRENT_DATE`)));
   const xp=Math.min(body.amount*10,Math.max(0,500-Number(earned?.total??0)));
   if(xp)await safeAwardXP(senderId,xp,'generosity','star_gift',reference,tx);
   await insertNotification(tx,body.recipientId,'gift_received','Star gift received',`You received ${body.amount} Stars.`,{senderId,amount:body.amount,message:body.message},reference);
   return recipient;
  });
  return NextResponse.json({success:true,starsGifted:body.amount,recipient,transferId:reference});
 }catch(error){
  if((error as {code?:string}).code==='INSUFFICIENT_BALANCE')return handleApiError(conflict('Not enough Stars','INSUFFICIENT_BALANCE'));
  return handleApiError(error);
 }
});
