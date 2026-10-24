import {z} from 'zod';
import {eq,sql} from 'drizzle-orm';
import {getDb,schema,type DbOrTx} from '@/lib/db/drizzle';
import {creditCoins} from '@/lib/economy/coins';
import type {CoinTransactionType} from '@zobia/types';
import {safeAwardXP} from '@/lib/xp/safeAwardXP';
import {enqueueTask,type DurableTask} from './outbox';
const rewardSchema=z.object({family:z.enum(['forum','bbforum','wiki','poll','quiz']),amount:z.number().int().nonnegative().safe(),dailyCap:z.number().int().nonnegative().safe(),type:z.enum(['forum_question_reward','forum_answer_reward','forum_upvote_reward','forum_best_answer_reward','bbforum_thread_reward','bbforum_reply_reward','wiki_contribute_reward','poll_create_reward','quiz_create_reward']),xp:z.number().int().nonnegative().safe(),track:z.enum(['social','knowledge']),source:z.string().max(100),referenceId:z.string().min(1).max(200),description:z.string().max(500)});
export type CommunityReward=z.infer<typeof rewardSchema>;
/** Persist with the originating action: no invocation lifetime dependency. */
export async function reserveCommunityReward(tx:DbOrTx,userId:string,reward:CommunityReward){
 const checked=rewardSchema.parse(reward);
 return enqueueTask(tx,'community_reward',checked.referenceId,userId,checked);
}
export async function deliverCommunityReward(task:DurableTask){
 if(!task.user_id)throw new Error('Reward has no owner');
 const reward=rewardSchema.parse(task.payload),db=await getDb(),userId=task.user_id;
 await db.transaction(async tx=>{
  await tx.select({id:schema.users.id}).from(schema.users).where(eq(schema.users.id,userId)).for('update');
  const history=await tx.execute<{earned:string}>(sql`SELECT COALESCE(SUM(amount),0)::text earned FROM (SELECT amount FROM coin_ledger WHERE user_id=${userId} AND transaction_type LIKE ${reward.family+'_%'} AND amount>0 AND created_at>=NOW()-INTERVAL '24 hours' UNION ALL SELECT amount FROM coin_ledger_archive WHERE user_id=${userId} AND transaction_type LIKE ${reward.family+'_%'} AND amount>0 AND created_at>=NOW()-INTERVAL '24 hours') earned`);
  const already=await tx.execute(sql`SELECT id FROM coin_ledger WHERE user_id=${userId} AND transaction_type=${reward.type} AND reference_id=${reward.referenceId} UNION ALL SELECT id FROM coin_ledger_archive WHERE user_id=${userId} AND transaction_type=${reward.type} AND reference_id=${reward.referenceId}`);
  const headroom=BigInt(reward.dailyCap)-BigInt(history.rows[0].earned);
  const amount=headroom<=0n?0:Math.min(reward.amount,Number(headroom));
  if(amount>0 && !already.rows.length)await creditCoins(userId,amount,reward.type as CoinTransactionType,reward.referenceId,reward.description,{},tx);
  if(reward.xp>0)await safeAwardXP(userId,reward.xp,reward.track,reward.source,reward.referenceId,tx);
 });
}
