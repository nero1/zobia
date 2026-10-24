/** Destructive fixture setup ONLY on a dedicated, empty, local PostgreSQL test cluster. */
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";
import { Client } from "pg";
import { catalogChecksum } from "./catalog";
const quote = (name:string) => `"${name.replace(/"/g,'""')}"`;
async function main() {
  if (process.env.BASELINE_PORTABILITY_TEST !== "1" || !process.env.TEST_DATABASE_URL) throw new Error("Requires BASELINE_PORTABILITY_TEST=1 and TEST_DATABASE_URL on a dedicated disposable local cluster");
  const url = new URL(process.env.TEST_DATABASE_URL);
  if (!["localhost","127.0.0.1","[::1]"].includes(url.hostname) || !url.pathname.endsWith("_test")) throw new Error("Portability fixture requires a local *_test control database");
  const control = new Client({connectionString:url.href}); await control.connect();
  const names:string[] = [], roles:string[] = [], clients:Client[] = [];
  const tag = randomBytes(6).toString("hex");
  try {
    assert.equal((await control.query("SELECT count(*)::int n FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')")).rows[0].n,0,"Use a clean cluster without platform roles");
    assert.equal((await control.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'")).rows[0].n,0,"Control database must be empty");
    const sql = fs.readFileSync(path.join(__dirname,"migrations/0001_consolidated_schema.sql"),"utf8");
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname,"baselines/2026-10-23.json"),"utf8"));
    async function database(suffix:string,owner?:string) {
      const name=`zobia_portability_${tag}_${suffix}`;
      await control.query(`CREATE DATABASE ${quote(name)}${owner ? ` OWNER ${quote(owner)}` : ''}`);names.push(name);
      const target=new URL(url);target.pathname=`/${name}`;
      const client=new Client({connectionString:target.href});await client.connect();clients.push(client);return client;
    }
    const owner=`zobia_portability_owner_${tag}`;
    await control.query(`CREATE ROLE ${quote(owner)} NOLOGIN NOSUPERUSER`);roles.push(owner);
    const plain = await database("plain",owner);
    // Emulate a managed provider that already owns extensions in another schema.
    await plain.query(`CREATE SCHEMA shared_extensions; GRANT USAGE ON SCHEMA shared_extensions TO ${quote(owner)}; CREATE EXTENSION pgcrypto WITH SCHEMA shared_extensions; CREATE EXTENSION "uuid-ossp" WITH SCHEMA shared_extensions; CREATE EXTENSION pg_trgm WITH SCHEMA shared_extensions`);
    await plain.query(`SET ROLE ${quote(owner)}`);
    await plain.query(sql);
    assert.equal(await catalogChecksum(plain),manifest.catalogChecksum);
    for (const [table,count] of Object.entries(manifest.referenceCounts)) assert.equal((await plain.query(`SELECT count(*)::int n FROM public.${quote(table)}`)).rows[0].n,count,table);
    assert.equal((await plain.query("SELECT count(*)::int n FROM pg_extension WHERE extname='pg_stat_statements'")).rows[0].n,0,"Unprivileged installation should tolerate unavailable monitoring extension");
    assert.equal((await control.query("SELECT count(*)::int n FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')")).rows[0].n,0,"Baseline must not create platform roles");
    process.stdout.write("Plain PostgreSQL: final schema and reference data pass under a non-superuser owner, with existing extensions outside public, no Supabase roles and no required monitoring extension.\n");
    for (const role of ['anon','authenticated','service_role']) {
      await control.query(`CREATE ROLE ${quote(role)} NOLOGIN${role==='service_role' ? ' BYPASSRLS' : ''}`);roles.push(role);
    }
    const platform = await database("platform");
    await platform.query("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated");
    await platform.query(sql);
    assert.equal(await catalogChecksum(platform),manifest.catalogChecksum);
    assert.equal((await platform.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'")).rows[0].n,manifest.tableCount??317);
    const missing = await platform.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT (has_table_privilege('service_role',c.oid,'SELECT') AND has_table_privilege('service_role',c.oid,'INSERT') AND has_table_privilege('service_role',c.oid,'UPDATE') AND has_table_privilege('service_role',c.oid,'DELETE'))`);
    assert.equal(missing.rows.length,0,"Every app table needs explicit service-role grants");
    for (const table of ['phone_verification_codes','failed_webhooks','game_progress_tasks','restore_email_tasks','transactional_tasks','object_deletion_tasks','account_restore_uses','crypto_transfer_claims','users','payments','messages','play_purchase_receipts','help_ai_requests','automation_generations','bookmark_folders']) {
      for (const role of ['anon','authenticated']) assert.equal((await platform.query("SELECT has_table_privilege($1,$2,'SELECT') allowed",[role,`public.${table}`])).rows[0].allowed,false,`${role} must not inherit private access to ${table}`);
    }
    await platform.query("SET ROLE anon");
    assert.ok((await platform.query("SELECT count(*)::int n FROM public.portals")).rows[0].n>0);
    await platform.query("RESET ROLE; SET ROLE authenticated");
    await assert.rejects(platform.query("SELECT * FROM public.play_purchase_receipts LIMIT 1"),error => (error as {code?:string}).code==='42501');
    await platform.query("RESET ROLE; SET ROLE service_role");
    await platform.query("SELECT * FROM public.play_purchase_receipts LIMIT 1");
    await platform.query("RESET ROLE");
    process.stdout.write("Supabase-style roles: public portal access passes; private tables stay denied despite broad default privileges; service-role grants cover all application tables.\n");
  } finally {
    await Promise.allSettled(clients.map(client=>client.end()));
    for (const name of names.reverse()) await control.query(`DROP DATABASE ${quote(name)} WITH (FORCE)`);
    for (const role of roles.reverse()) await control.query(`DROP ROLE ${quote(role)}`);
    await control.end();
  }
}
main().catch(error=>{process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);process.exitCode=1;});
