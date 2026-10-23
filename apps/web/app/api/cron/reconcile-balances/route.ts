export const dynamic = 'force-dynamic';
export const maxDuration = 300;

import { NextRequest, NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/drizzle';
import { validateCronSecret } from '@/lib/cron/auth';
import { getManifestValue } from '@/lib/manifest';
import { raiseAlert } from '@/lib/alerts/dispatch';
import { handleApiError } from '@/lib/api/errors';

/** Durable keyset progress; corrections and their audit trail commit together. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!validateCronSecret(req)) return NextResponse.json({error:'Unauthorised'},{status:401});
  try {
    const db = await getDb();
    const rawThreshold=await getManifestValue('reconcileAutoCorrectThreshold');
    const configured = rawThreshold===null?NaN:Number(rawThreshold);
    const threshold = BigInt(Number.isSafeInteger(configured) && configured >= 0 ? configured : 50);
    let scanned=0, discrepanciesFound=0, autoCorrected=0, complete=false;
    const deadline=Date.now()+240_000;
    while(Date.now()<deadline && scanned<10_000) {
      const result=await db.transaction(async tx=>{
        await tx.execute(sql`INSERT INTO cron_state(key,value_text) VALUES ('reconcile_cursor','00000000-0000-0000-0000-000000000000') ON CONFLICT(key) DO NOTHING`);
        const state=await tx.execute<{value_text:string}>(sql`SELECT value_text FROM cron_state WHERE key='reconcile_cursor' FOR UPDATE`);
        const cursor=state.rows[0].value_text;
        const batch=await tx.execute<{id:string;xp_total:string;coin_balance:string;star_balance:string}>(sql`SELECT id,xp_total::text,coin_balance::text,star_balance::text FROM users WHERE deleted_at IS NULL AND id>${cursor}::uuid ORDER BY id LIMIT 50 FOR NO KEY UPDATE`);
        let found=0,corrected=0;
        for(const user of batch.rows) {
          const sums=await tx.execute<{asset:string;total:string}>(sql`
            SELECT 'xp' asset,COALESCE(SUM(amount),0)::text total FROM xp_ledger_history WHERE user_id=${user.id}
            UNION ALL SELECT 'coins',COALESCE(SUM(amount),0)::text FROM coin_ledger_history WHERE user_id=${user.id}
            UNION ALL SELECT 'stars',COALESCE(SUM(amount),0)::text FROM star_ledger_history WHERE user_id=${user.id}`);
          for(const sum of sums.rows) {
            const column=sum.asset==='xp'?'xp_total':sum.asset==='coins'?'coin_balance':'star_balance';
            const balance=BigInt(user[column]), expected=BigInt(sum.total), delta=balance>expected?balance-expected:expected-balance;
            if(delta===0n) continue;
            found++;
            const fix=delta<=threshold && expected>=0n;
            await tx.execute(sql`INSERT INTO audit_discrepancies(user_id,asset_type,ledger_sum,wallet_balance,detected_at,resolved,resolved_at,notes) VALUES (${user.id},${sum.asset},${sum.total},${balance.toString()},NOW(),${fix},CASE WHEN ${fix} THEN NOW() ELSE NULL END,${fix?'Atomically corrected from complete ledger history':'Manual review required'})`);
            if (!fix) await raiseAlert(tx, { type:'balance_reconciliation', category:'financial', priorityLevel:2, title:'Balance discrepancy requires review', message:'Wallet balance differs from complete accounting history.', dedupeKey:`${user.id}:${sum.asset}`, metadata:{userId:user.id,asset:sum.asset,expected:sum.total,actual:balance.toString()} });
            if(fix) {
              await tx.execute(sql`UPDATE users SET ${sql.identifier(column)}=${sum.total}::bigint,updated_at=NOW() WHERE id=${user.id}`);
              corrected++;
            }
          }
        }
        const last=batch.rows.at(-1)?.id ?? '00000000-0000-0000-0000-000000000000';
        await tx.execute(sql`UPDATE cron_state SET value_text=${last},updated_at=NOW() WHERE key='reconcile_cursor'`);
        return {count:batch.rows.length,found,corrected};
      });
      scanned+=result.count;discrepanciesFound+=result.found;autoCorrected+=result.corrected;
      if(result.count===0){complete=true;break;}
    }
    return NextResponse.json({ok:true,complete,scanned,discrepanciesFound,autoCorrected});
  } catch(error){return handleApiError(error);}
}
