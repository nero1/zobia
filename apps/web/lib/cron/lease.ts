import {randomUUID} from 'node:crypto';
import {sql} from 'drizzle-orm';
import type {DbOrTx} from '@/lib/db/drizzle';
/** Recoverable job lease. Completion is recorded only after every step succeeds. */
export async function claimCronRun(key:string,db:DbOrTx){
 const token=randomUUID(),day=new Date().toISOString().slice(0,10);
 const claimed=await db.execute(sql`INSERT INTO cron_job_runs(job_key,run_date,lease_token,lease_until) VALUES (${key},${day}::date,${token},NOW()+INTERVAL '6 minutes') ON CONFLICT(job_key,run_date) DO UPDATE SET lease_token=EXCLUDED.lease_token,lease_until=EXCLUDED.lease_until WHERE cron_job_runs.completed_at IS NULL AND cron_job_runs.lease_until<=NOW() RETURNING job_key`);
 if(!claimed.rows.length)return null;
 let failed=false;
 return {
  async runStep(name:string,fn:()=>Promise<void>,successful:()=>boolean=()=>true){
   try {
   const done=await db.execute(sql`SELECT step FROM cron_job_steps WHERE job_key=${key} AND run_date=${day}::date AND step=${name}`);
   if(done.rows.length)return;
   await fn();
   if(!successful()){failed=true;throw new Error(`Cron step ${name} did not complete`);}
   const saved=await db.execute(sql`INSERT INTO cron_job_steps(job_key,run_date,step) SELECT ${key},${day}::date,${name} WHERE EXISTS(SELECT 1 FROM cron_job_runs WHERE job_key=${key} AND run_date=${day}::date AND lease_token=${token} AND lease_until>NOW()) ON CONFLICT DO NOTHING RETURNING step`);
   if(!saved.rows.length)throw new Error('Cron lease expired before checkpoint');
   } catch(error) {failed=true;throw error;}
  },
  async finish(success:boolean){
   const completed=success && !failed;
   const result=await db.execute(sql`UPDATE cron_job_runs SET completed_at=CASE WHEN ${completed} THEN NOW() ELSE NULL END,lease_until=NOW() WHERE job_key=${key} AND run_date=${day}::date AND lease_token=${token} AND lease_until>NOW() RETURNING job_key`);
   if(!result.rows.length)throw new Error('Cron lease expired before completion');
   await db.execute(sql`DELETE FROM cron_job_runs WHERE run_date<CURRENT_DATE-90`);
   return completed;
  }
 };
}
