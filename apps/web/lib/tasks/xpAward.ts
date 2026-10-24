import {z} from 'zod';
import {getDb} from '@/lib/db/drizzle';
import {safeAwardXP} from '@/lib/xp/safeAwardXP';
import type {DurableTask} from './outbox';
const payloadSchema=z.object({amount:z.number().int().positive().safe(),track:z.enum(['main','social','creator','competitor','generosity','knowledge','explorer','gaming']),source:z.string().min(1).max(100),referenceId:z.string().min(1).max(200)});
export async function deliverXpAward(task:DurableTask){
 if(!task.user_id)throw new Error('XP task has no owner');
 const payload=payloadSchema.parse(task.payload),db=await getDb();
 await db.transaction(tx=>safeAwardXP(task.user_id!,payload.amount,payload.track,payload.source,payload.referenceId,tx));
}
