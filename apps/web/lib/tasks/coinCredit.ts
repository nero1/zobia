import {z} from 'zod';
import {getDb} from '@/lib/db/drizzle';
import {creditCoins} from '@/lib/economy/coins';
import {insertNotification} from '@/lib/notifications/insert';
import type {DurableTask} from './outbox';
const payloadSchema=z.object({amount:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),transactionType:z.enum(['refund','quest_reward','referral_bonus']),referenceId:z.string().min(1).max(200),description:z.string().max(500)});
export async function deliverCoinCredit(task:DurableTask):Promise<void>{
 if(!task.user_id)throw new Error('Credit task has no owner');
 const payload=payloadSchema.parse(task.payload),db=await getDb();
 await db.transaction(async tx=>{
  await creditCoins(task.user_id!,payload.amount,payload.transactionType,payload.referenceId,payload.description,null,tx);
  const refund=payload.transactionType==='refund';
  await insertNotification(tx,task.user_id!,refund?'refund_completed':'reward_credited',refund?'Refund completed':'Reward credited',refund?`${payload.amount} Credits have been returned to your wallet.`:`${payload.amount} reward Credits have been added to your wallet.`,{referenceId:payload.referenceId},payload.referenceId);
 });
}
