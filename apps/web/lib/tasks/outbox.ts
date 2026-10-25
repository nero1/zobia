import {randomUUID} from 'node:crypto';
import {and,eq,sql} from 'drizzle-orm';
import {getDb,schema,type DbOrTx} from '@/lib/db/drizzle';
import {raiseAlert} from '@/lib/alerts/dispatch';
export type TaskKind='tale_notifications'|'sponsored_refund'|'sponsored_maintenance'|'storage_maintenance'|'maintenance_sweep'|'xp_award'|'password_reset_email'|'kyc_review'|'coin_credit'|'community_reward'|'merch_refund';
export interface DurableTask{id:string;kind:TaskKind;operation_key:string;user_id:string|null;payload:Record<string,unknown>;attempts:number}
export class PermanentTaskError extends Error{constructor(public readonly reason:string){super(reason);this.name='PermanentTaskError';}}
export async function enqueueTask(tx:DbOrTx,kind:TaskKind,operationKey:string,userId:string|null,payload:Record<string,unknown>):Promise<string>{
 const [created]=await tx.insert(schema.transactionalTasks).values({kind,operationKey,userId,payload}).onConflictDoNothing({target:[schema.transactionalTasks.kind,schema.transactionalTasks.operationKey]}).returning({id:schema.transactionalTasks.id});
 if(created)return created.id;
 const [existing]=await tx.select({id:schema.transactionalTasks.id,userId:schema.transactionalTasks.userId}).from(schema.transactionalTasks).where(and(eq(schema.transactionalTasks.kind,kind),eq(schema.transactionalTasks.operationKey,operationKey)));
 if(!existing || existing.userId!==userId)throw new Error('Task operation belongs to a different principal');
 return existing.id;
}
async function executeTask(task:DurableTask):Promise<void>{
 switch(task.kind){
  case 'tale_notifications':return (await import('@/lib/tales/notifications')).deliverTaleNotifications(task);
  case 'sponsored_refund':return (await import('@/lib/quests/sponsoredFunding')).deliverSponsoredRefund(task);
  case 'sponsored_maintenance':await (await import('@/lib/quests/sponsoredFunding')).sweepSponsoredFunding(task.id);return;
  case 'storage_maintenance':await (await import('@/lib/storage/deletionQueue')).drainObjectDeletions(undefined,task.id);return;
  case 'maintenance_sweep':return (await import('./maintenance')).deliverMaintenanceTask(task);
  case 'xp_award':return (await import('./xpAward')).deliverXpAward(task);
  case 'community_reward':return (await import('./communityReward')).deliverCommunityReward(task);
  case 'coin_credit':return (await import('./coinCredit')).deliverCoinCredit(task);
  case 'kyc_review':return (await import('@/lib/kyc/service')).runTier1AiReview(String(task.payload.submissionId));
  case 'password_reset_email':return (await import('@/lib/auth/resetMail')).deliverPasswordResetTask(task);
  default:throw new Error('Task handler unavailable');
 }
}
/** Lease just the task row; external delivery never holds a database transaction open. */
export async function processTask(id?:string):Promise<boolean>{
 const db=await getDb(),lease=randomUUID();
 const claim=await db.execute<DurableTask & Record<string,unknown>>(sql`UPDATE transactional_tasks SET status='processing',attempts=attempts+1,lease_token=${lease},lease_until=NOW()+INTERVAL '2 minutes' WHERE id=(SELECT id FROM transactional_tasks WHERE (${id??null}::uuid IS NULL OR id=${id??null}::uuid) AND attempts<8 AND ((status='pending' AND available_at<=NOW()) OR (status='processing' AND lease_until<=NOW())) ORDER BY available_at,id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id,kind,operation_key,user_id,payload,attempts`);
 const task=claim.rows[0];if(!task)return false;
 try{
  await executeTask(task);
  const updated=await db.execute(sql`UPDATE transactional_tasks SET status='completed',completed_at=NOW(),lease_token=NULL,lease_until=NULL,payload='{}'::jsonb WHERE id=${task.id} AND lease_token=${lease} AND lease_until>NOW() RETURNING id`);
  if(!updated.rows.length)throw new Error('Task lease expired before acknowledgement');
 }catch(error){
  const dead=task.attempts>=8 || error instanceof PermanentTaskError;
  const delay=Math.round(Math.min(3600,15*2**task.attempts)*(0.75+Math.random()*.5));
  await db.execute(sql`UPDATE transactional_tasks SET status=${dead?'dead':'pending'},available_at=NOW()+${delay}*INTERVAL '1 second',lease_token=NULL,lease_until=NULL,last_error=${error instanceof PermanentTaskError?`${error.name}:${error.reason}`:error instanceof Error?error.name:'TaskError'} WHERE id=${task.id} AND lease_token=${lease}`);
 }
 return true;
}
export async function drainTasks(maxItems=20,timeBudgetMs=25000){
 const db=await getDb();
 await db.execute(sql`UPDATE transactional_tasks SET status='dead',last_error='FinalLeaseExpired',lease_token=NULL,lease_until=NULL WHERE id IN (SELECT id FROM transactional_tasks WHERE status='processing' AND attempts>=8 AND lease_until<=NOW() LIMIT 100)`);
 const start=Date.now();let attempted=0;
 while(attempted<maxItems && Date.now()-start<timeBudgetMs && await processTask())attempted++;
 await db.execute(sql`DELETE FROM transactional_tasks WHERE id IN (SELECT id FROM transactional_tasks WHERE status='completed' AND completed_at<NOW()-INTERVAL '7 days' ORDER BY completed_at LIMIT 100)`);
 const depth=await db.execute<{pending:string;dead:string}>(sql`SELECT COUNT(*) FILTER(WHERE status IN ('pending','processing'))::text pending,COUNT(*) FILTER(WHERE status='dead')::text dead FROM transactional_tasks`);
 if(BigInt(depth.rows[0].dead)>0n)await raiseAlert(db,{type:'durable_task_dlq',category:'infra',priorityLevel:2,title:'Durable tasks need attention',message:`${depth.rows[0].dead} tasks exhausted delivery retries.`,dedupeKey:'durable-tasks:dead'});
 return {attempted,...depth.rows[0]};
}
