import {Client} from 'pg';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {checkSchema} from '../db/check-schema';
/** Exercise the actual migration runner against a shipped baseline, with preserved data. */
async function checkUpgrade(manual: boolean){
 const url=new URL(process.env.TEST_ADMIN_DATABASE_URL??'postgresql://zobia@127.0.0.1:5432/postgres');
 if(!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!=='/postgres')throw Error('Local fixture control database required');
 const control=new Client({connectionString:url.href});await control.connect();
 const name='zobia_remediation_'+randomUUID().replaceAll('-',''),target=new URL(url);target.pathname='/'+name;
 let created=false;
 try{
  await control.query(`CREATE DATABASE "${name}"`);created=true;
  const db=new Client({connectionString:target.href});await db.connect();
  try{
   const old=execFileSync('git',['show','35c4e9b1255f4366b2a82baf441a6eb750072e88:apps/web/db/migrations/0001_consolidated_schema.sql'],{cwd:resolve('../..'),encoding:'utf8',maxBuffer:10000000});
   await db.query(old);
   if (!manual) {
   await db.query("CREATE TABLE migrations_log(id serial PRIMARY KEY,filename text NOT NULL UNIQUE,applied_at timestamptz NOT NULL DEFAULT NOW(),checksum text NOT NULL)");
   await db.query("INSERT INTO migrations_log(filename,checksum) VALUES('0001_consolidated_schema.sql','6ed0b86e')");
   }
   if ((await db.query("SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='session_valid_after'")).rowCount) throw Error("Old fixture unexpectedly includes session cutoff");
   await db.query("INSERT INTO users(username,display_name,coin_balance) VALUES('upgrade_preserved','Fixture',12345)");
   await db.query("INSERT INTO users(username,display_name) VALUES('upgrade_ref_a','Fixture'),('upgrade_ref_b','Fixture'),('upgrade_recruit','Fixture')");
   await db.query("UPDATE users SET referred_by=(SELECT id FROM users WHERE username='upgrade_ref_b') WHERE username='upgrade_recruit'");
   await db.query("INSERT INTO referrals(referrer_id,referred_id,tier) SELECT a.id,b.id,1 FROM users a CROSS JOIN users b WHERE a.username IN ('upgrade_ref_a','upgrade_ref_b') AND b.username='upgrade_recruit'");

  }finally{await db.end();}
  const run=()=>execFileSync(process.execPath,[resolve('../../node_modules/tsx/dist/cli.mjs'),resolve('db/migrate.ts'), ...(manual ? ['--adopt-baseline'] : [])],{stdio:'inherit',env:{...process.env,DATABASE_URL:target.href,DIRECT_URL:target.href}});
  run();run();await checkSchema(target.href);
  const result=new Client({connectionString:target.href});await result.connect();
  try{
   if((await result.query("SELECT coin_balance::text balance FROM users WHERE username='upgrade_preserved'")).rows[0]?.balance!=='12345')throw Error('Upgrade changed the existing wallet');
   if((await result.query("SELECT count(*)::int n FROM referrals r JOIN users u ON u.id=r.referred_id WHERE u.username='upgrade_recruit' AND r.referrer_id=u.referred_by AND r.tier=1")).rows[0].n!==1)throw Error('Upgrade lost canonical inviter');
   if((await result.query("SELECT count(*)::int n FROM transactional_tasks WHERE kind='referral_reconciliation' AND status='dead' AND payload->>'referrer_id'=(SELECT id::text FROM users WHERE username='upgrade_ref_a')")).rows[0].n!==1)throw Error('Duplicate referral was not preserved for reconciliation');
  }finally{await result.end();}
  console.log(`PASS ${manual ? 'manual/untracked adoption' : 'tracked upgrade'} adds the session cutoff, preserves wallet data and reruns idempotently`);
 }finally{if(created)await control.query(`DROP DATABASE "${name}" WITH(FORCE)`);await control.end();}
}
async function main(){ await checkUpgrade(false); await checkUpgrade(true); }
main().catch(error=>{console.error(error.message);process.exitCode=1;});
