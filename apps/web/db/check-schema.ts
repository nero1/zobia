/** Blocking contract check against a migrated disposable PostgreSQL database. */
import {Client} from 'pg';
import {getTableConfig} from 'drizzle-orm/pg-core';
import {schema} from '../lib/db/schema';
import {catalogChecksum} from './catalog';
import baseline from './baselines/2026-10-23.json';
export async function checkSchema(url:string){
 const client=new Client({connectionString:url});await client.connect();
 try{
  const rows=await client.query<{table_name:string;column_name:string;type:string}>(`SELECT c.relname table_name,a.attname column_name,format_type(a.atttypid,a.atttypmod) type FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')`);
  const tables=new Map<string,Map<string,string>>();
  for(const row of rows.rows){if(!tables.has(row.table_name))tables.set(row.table_name,new Map());tables.get(row.table_name)!.set(row.column_name,row.type);}
  const issues:string[]=[],modeled=new Set<string>();
  function normalize(value:string){return value.toLowerCase().replace(/,\s+/g,',').replace(/\s+/g,' ').replace(/^timestamp(\(\d+\))? with time zone$/,'timestamptz').replace(/^timestamp(\(\d+\))?( without time zone)?$/,'timestamp').replace(/^character varying/,'varchar').replace(/^double precision$/,'float8').replace(/^real$/,'float4');}
  for(const value of Object.values(schema)){
   const model=getTableConfig(value),actual=tables.get(model.name);modeled.add(model.name);
   if(!actual){issues.push(`Missing table ${model.name}`);continue;}
   for(const column of model.columns){
    const type=actual.get(column.name);if(!type){issues.push(`Missing column ${model.name}.${column.name}`);continue;}
    const expected=normalize(column.getSQLType()),received=normalize(type);
    if(expected!==received)issues.push(`Type mismatch ${model.name}.${column.name}: model=${expected}, database=${received}`);
   }
  }
  for(const name of tables.keys())if(!modeled.has(name)&&!['migrations_log','_test_applied_migrations'].includes(name))issues.push(`Unmodeled table ${name}`);
  if(issues.length)throw new Error(issues.join('\n'));
  // A name/type match alone misses CHECKs, nullability, defaults, references,
  // uniqueness and RLS. Compare all of those with the verified final baseline.
  if(await catalogChecksum(client)!==baseline.catalogChecksum)throw new Error('Database contract differs from the verified final baseline (constraints, defaults, nullability, relationships, indexes, functions or RLS). Apply the verified upgrade or inspect schema drift.');
  process.stdout.write(`Drizzle contract verified: ${modeled.size} tables and every modeled column/type; full baseline constraints, defaults, relationships and access policies match.\n`);
 }finally{await client.end();}
}
if(require.main===module){const url=process.env.TEST_DATABASE_URL;if(!url)throw new Error('TEST_DATABASE_URL is required');checkSchema(url).catch(error=>{process.stderr.write(String(error)+'\n');process.exitCode=1;});}
