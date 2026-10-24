import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {wrapPoolWithCircuitBreaker} from '../lib/db/circuit';
async function main(){
 if(!/^\/zobia_remediation_[a-f0-9]+$/.test(new URL(process.env.DATABASE_URL??'postgresql://invalid/').pathname))throw Error('Disposable remediation database required');
 const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1});const commands:string[]=[];
 pool.on('connect',client=>{const original=client.query.bind(client);client.query=((...args:unknown[])=>{commands.push(typeof args[0]==='string'?args[0]:(args[0] as {text:string}).text);return (original as(...args:unknown[])=>unknown)(...args);}) as typeof client.query;});
 wrapPoolWithCircuitBreaker(pool);
 try{
  const result=await pool.query("SELECT current_setting('app.is_system') AS system,current_setting('statement_timeout') AS timeout");
  assert.deepEqual(result.rows[0],{system:'true',timeout:'10s'});
  assert.equal(commands.length,3,'Standalone query should use three wire commands rather than four');
  assert.match(commands[0],/^BEGIN;SELECT set_config/);
  const client=await pool.connect();
  try{
   assert.notEqual((await client.query("SELECT current_setting('app.is_system',true) AS system")).rows[0].system,'true','Server context must not survive transaction completion');
   commands.length=0;await client.query('begin');await client.query('SELECT 1');await client.query('COMMIT');assert.equal(commands.length,3);
  }finally{client.release();}
  commands.length=0;await assert.rejects(pool.query('SELECT missing_fixture_column'));
  assert.equal(commands.length,3);assert.equal(commands.at(-1),'ROLLBACK');
  assert.equal((await pool.query('SELECT 42 AS answer')).rows[0].answer,42);
  console.log('PASS combined BEGIN/context reduces wire commands, retains RLS/timeouts, clears local context and rolls back SQL failures');
 }finally{await pool.end();}
}
main().then(()=>process.exit(0)).catch(error=>{console.error(error.message);process.exit(1);});
