import {Client} from 'pg';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {checkSchema} from '../db/check-schema';
async function main(){
 const admin=process.env.TEST_ADMIN_DATABASE_URL??'postgresql://zobia@127.0.0.1:5432/postgres';
 const url=new URL(admin);
 if(!['127.0.0.1','localhost'].includes(url.hostname) || url.pathname!=='/postgres')throw Error('This fixture runner requires a local PostgreSQL control database');
 const control=new Client({connectionString:admin});await control.connect();
 const name='zobia_remediation_'+randomUUID().replaceAll('-','');
 const target=new URL(admin);target.pathname='/'+name;
 let created=false;
 try{
  await control.query(`CREATE DATABASE "${name}"`);created=true;
  const database=new Client({connectionString:target.href});await database.connect();
  try{await database.query(readFileSync(resolve('db/migrations/0001_consolidated_schema.sql'),'utf8'));}
  finally{await database.end();}
  await checkSchema(target.href);
  if(!process.argv.includes('--financial-only')){
  execFileSync(process.execPath,[resolve('../../node_modules/tsx/dist/cli.mjs'),resolve('scripts/check-db-context-contract.ts')],{stdio:'inherit',env:{...process.env,DATABASE_URL:target.href,DIRECT_URL:target.href}});
  execFileSync(process.execPath,[resolve('../../node_modules/tsx/dist/cli.mjs'),resolve('scripts/check-realtime-contract.ts')],{stdio:'inherit',env:{...process.env,ABLY_API_KEY:'fixture.key:fixture-secret',PUSHER_KEY:'fixture-key',PUSHER_SECRET:'fixture-secret',DATABASE_URL:target.href,DIRECT_URL:target.href}});
  execFileSync(process.execPath,[resolve('../../node_modules/tsx/dist/cli.mjs'),resolve('scripts/check-handoff-contract.ts')],{stdio:'inherit',env:{...process.env,DATABASE_URL:target.href,DIRECT_URL:target.href}});
  execFileSync(process.execPath,[resolve('../../node_modules/tsx/dist/cli.mjs'),resolve('scripts/check-google-account-contract.ts')],{stdio:'inherit',env:{...process.env,DATABASE_URL:target.href,DIRECT_URL:target.href}});
  execFileSync(process.execPath,[resolve('../../node_modules/tsx/dist/cli.mjs'),resolve('scripts/remediation-local-check.ts')],{stdio:'inherit',env:{...process.env,DATABASE_URL:target.href,DIRECT_URL:target.href}});
  execFileSync(process.execPath,[resolve('../../node_modules/tsx/dist/cli.mjs'),resolve('scripts/check-maintenance-contract.ts')],{stdio:'inherit',env:{...process.env,DATABASE_URL:target.href,DIRECT_URL:target.href}});
  execFileSync(process.execPath,[resolve('../../node_modules/tsx/dist/cli.mjs'),resolve('scripts/check-public-contract.ts')],{stdio:'inherit',env:{...process.env,DATABASE_URL:target.href,DIRECT_URL:target.href}});
  execFileSync(process.execPath,[resolve('../../node_modules/tsx/dist/cli.mjs'),resolve('scripts/check-merch-contract.ts')],{stdio:'inherit',env:{...process.env,PAYSTACK_SECRET_KEY:'fixture-no-network',DATABASE_URL:target.href,DIRECT_URL:target.href}});
  }
  execFileSync(process.execPath,[resolve('../../node_modules/tsx/dist/cli.mjs'),resolve('scripts/check-financial-contract.ts')],{stdio:'inherit',env:{...process.env,DATABASE_URL:target.href,DIRECT_URL:target.href}});
 }finally{
  if(created)await control.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await control.end();
 }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
