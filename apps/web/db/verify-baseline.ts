/** Read-only equivalence check against a clean database built from the predecessor migrations. */
import { Client } from "pg";
import { readCatalog, stableJson } from "./catalog";
const quote = (name: string) => `"${name.replace(/"/g,'""')}"`;
async function main() {
  const reference = process.env.REFERENCE_DATABASE_URL, target = process.env.BASELINE_DATABASE_URL;
  if (!reference || !target) throw new Error("Set REFERENCE_DATABASE_URL and BASELINE_DATABASE_URL to two disposable databases");
  const identity = (url: string) => { const parsed = new URL(url); return `${parsed.hostname}:${parsed.port || '5432'}${parsed.pathname}`; };
  if (identity(reference) === identity(target)) throw new Error("Reference and baseline databases must be distinct");
  const clients = [new Client({connectionString:reference}),new Client({connectionString:target})];
  try {
    for (const client of clients) { await client.connect(); await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"); }
    const [expected,actual] = await Promise.all(clients.map(readCatalog));
    for (const category of Object.keys(expected)) {
      if (stableJson(expected[category]) !== stableJson(actual[category])) throw new Error(`Schema differs: ${category}`);
    }
    let tables = 0, rows = 0;
    for (const table of expected.relations as {name:string;kind:string}[]) {
      if (!["r","p"].includes(table.kind)) continue;
      const results = await Promise.all(clients.map(client => client.query(`SELECT to_jsonb(t) AS row FROM public.${quote(table.name)} t`)));
      const [left,right] = results.map(result => result.rows.map(r => stableJson(r.row)).sort());
      if (stableJson(left) !== stableJson(right)) throw new Error(`Reference data differs: ${table.name}`);
      tables++; rows += left.length;
    }
    if (process.argv.includes("--platform-access")) {
      const policySql = `SELECT c.relname AS relation,p.polname AS name,p.polcmd AS command,p.polpermissive AS permissive,ARRAY(SELECT CASE role_oid WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(role_oid) END FROM unnest(p.polroles) role_oid ORDER BY 1) AS roles,pg_get_expr(p.polqual,p.polrelid) AS using_expression,pg_get_expr(p.polwithcheck,p.polrelid) AS check_expression FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname,p.polname`;
      const policies = await Promise.all(clients.map(client => client.query(policySql)));
      if (stableJson(policies[0].rows) !== stableJson(policies[1].rows)) throw new Error("Platform-role policies differ");
      const names = (expected.relations as {name:string;kind:string}[]).filter(t => ["r","p"].includes(t.kind)).map(t => t.name);
      const grantsSql = `SELECT table_name,role_name,privilege,has_table_privilege(role_name,format('public.%I',table_name),privilege) AS allowed FROM unnest($1::text[]) table_name CROSS JOIN (VALUES ('anon'),('authenticated')) roles(role_name) CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) privileges(privilege) ORDER BY table_name,role_name,privilege`;
      const grants = await Promise.all(clients.map(client => client.query(grantsSql,[names])));
      if (stableJson(grants[0].rows) !== stableJson(grants[1].rows)) throw new Error("Client grants differ, possibly due to inherited default privileges");
      const server = await clients[1].query(`SELECT table_name FROM unnest($1::text[]) table_name WHERE NOT (has_schema_privilege('service_role','public','USAGE') AND has_table_privilege('service_role',format('public.%I',table_name),'SELECT') AND has_table_privilege('service_role',format('public.%I',table_name),'INSERT') AND has_table_privilege('service_role',format('public.%I',table_name),'UPDATE') AND has_table_privilege('service_role',format('public.%I',table_name),'DELETE'))`,[names]);
      if (server.rows.length) throw new Error("Missing explicit service-role grants");
      await clients[1].query("SAVEPOINT client_access; SET LOCAL ROLE anon");
      await clients[1].query("SELECT count(*) FROM public.portals");
      await clients[1].query("ROLLBACK TO SAVEPOINT client_access");
      await clients[1].query("SAVEPOINT private_access; SET LOCAL ROLE authenticated");
      let privateDenied = false;
      try { await clients[1].query("SELECT * FROM public.play_purchase_receipts LIMIT 1"); }
      catch (error) { if ((error as {code?:string}).code !== '42501') throw error; privateDenied = true; }
      await clients[1].query("ROLLBACK TO SAVEPOINT private_access");
      if (!privateDenied) throw new Error("Private purchase receipts were exposed to the client role");
      process.stdout.write("Platform access verified: client grants and all policies preserved; explicit service-role grants cover all app tables; inherited client grants do not expose private receipts.\n");
    }
    process.stdout.write(`Equivalent final schema and data: ${tables} tables, ${rows} reference rows; functions, constraints, indexes, triggers and portable RLS policies match.\nPlatform-specific grants/policies require the separate role-access checks.\n`);
  } finally { await Promise.allSettled(clients.map(client => client.end())); }
}
main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
