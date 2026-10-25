/** Disposable local fixture: reproduce a table-only wipe and recover safely. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { catalogChecksum } from '../db/catalog';
async function main() {
  const url = new URL(process.env.TEST_ADMIN_DATABASE_URL ?? 'postgresql://zobia@127.0.0.1:5432/postgres');
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/postgres') throw Error('Local fixture control database required');
  const control = new Client({ connectionString: url.href }); await control.connect();
  const name = 'zobia_reset_' + randomUUID().replaceAll('-', '');
  let created = false;
  let db: Client | undefined;
  try {
    await control.query(`CREATE DATABASE "${name}"`); created = true;
    url.pathname = '/' + name;
    db = new Client({ connectionString: url.href }); await db.connect();
    const baseline = readFileSync(resolve('db/migrations/0001_consolidated_schema.sql'), 'utf8');
    const cleanup = readFileSync(resolve('db/maintenance/clear-orphaned-baseline-functions.sql'), 'utf8');
    await db.query(baseline);
    const original = await catalogChecksum(db);
    await assert.rejects(db.query(cleanup), /Cleanup refused/);
    await db.query('ROLLBACK');
    assert.equal(await catalogChecksum(db), original);
    await db.query(`DO $$ DECLARE r RECORD; BEGIN
      FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
      END LOOP;
    END $$;`);
    assert.ok((await db.query("SELECT to_regprocedure('public.app_group_member(uuid)') AS name")).rows[0].name);
    await assert.rejects(db.query(baseline), error => (error as {code?: string}).code === '42723');
    await db.query('ROLLBACK');
    await db.query('CREATE FUNCTION public.unrelated_fixture() RETURNS integer LANGUAGE sql AS $$ SELECT 7 $$');
    await db.query(cleanup); await db.query(cleanup);
    assert.equal((await db.query('SELECT public.unrelated_fixture() AS value')).rows[0].value, 7);
    assert.equal((await db.query("SELECT to_regprocedure('public.app_group_member(uuid)') AS name")).rows[0].name, null);
    await db.query('DROP FUNCTION public.unrelated_fixture()');
    await db.query(baseline);
    assert.equal(await catalogChecksum(db), original);
    console.log('PASS table-only wipe reproduces 42723; guarded cleanup refuses live tables, preserves unrelated functions, reruns safely, and permits exact final-schema reinstall');
  } finally {
    await db?.end();
    if (created) await control.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await control.end();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
