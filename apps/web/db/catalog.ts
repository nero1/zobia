/** Stable application-schema description; excludes extension-owned objects and runner logs. */
import { createHash } from "crypto";
import type { Client } from "pg";

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
const applicationRelation = `n.nspname='public' AND c.relname NOT IN ('migrations_log','_test_applied_migrations') AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e') AND NOT(c.relkind='S' AND EXISTS(SELECT 1 FROM pg_depend d JOIN pg_class parent ON parent.oid=d.refobjid JOIN pg_namespace pn ON pn.oid=parent.relnamespace WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND pn.nspname='public' AND parent.relname IN ('migrations_log','_test_applied_migrations')))`;

export async function readCatalog(client: Client): Promise<Record<string, unknown[]>> {
  const queries: Record<string,string> = {
    relations: `SELECT c.relname AS name,c.relkind AS kind,c.relrowsecurity AS rls,c.relforcerowsecurity AS forced_rls,c.reloptions AS options FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${applicationRelation} AND c.relkind IN ('r','p','v','m','S','f') ORDER BY c.relname`,
    columns: `SELECT c.relname AS relation,a.attname AS name,row_number() OVER (PARTITION BY c.oid ORDER BY a.attnum)::int AS position,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS not_null,pg_get_expr(ad.adbin,ad.adrelid) AS default_value,a.attidentity AS identity,a.attgenerated AS generated,a.attstorage AS storage,a.attcompression AS compression FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef ad ON ad.adrelid=c.oid AND ad.adnum=a.attnum WHERE ${applicationRelation} AND c.relkind IN ('r','p','v','m','f') AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum`,
    constraints: `SELECT c.relname AS relation,k.conname AS name,k.contype AS kind,pg_get_constraintdef(k.oid) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${applicationRelation} ORDER BY c.relname,k.conname`,
    indexes: `SELECT c.relname AS relation,i.relname AS name,pg_get_indexdef(i.oid) AS definition FROM pg_index x JOIN pg_class c ON c.oid=x.indrelid JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${applicationRelation} ORDER BY c.relname,i.relname`,
    triggers: `SELECT c.relname AS relation,t.tgname AS name,pg_get_triggerdef(t.oid) AS definition,t.tgenabled AS enabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${applicationRelation} AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`,
    functions: `SELECT p.proname AS name,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e') ORDER BY p.proname,pg_get_function_identity_arguments(p.oid)`,
    views: `SELECT c.relname AS name,pg_get_viewdef(c.oid) AS definition FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${applicationRelation} AND c.relkind IN ('v','m') ORDER BY c.relname`,
    // Platform-role policies are verified separately, since plain PG lacks those roles.
    policies: `SELECT c.relname AS relation,p.polname AS name,p.polcmd AS command,p.polpermissive AS permissive,pg_get_expr(p.polqual,p.polrelid) AS using_expression,pg_get_expr(p.polwithcheck,p.polrelid) AS check_expression FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${applicationRelation} AND p.polroles='{0}'::oid[] ORDER BY c.relname,p.polname`,
  };
  const result: Record<string,unknown[]> = {};
  for (const [key, sql] of Object.entries(queries)) result[key] = (await client.query(sql)).rows;
  // These extension objects are identical when a managed provider installs
  // them in another namespace. Compare their identity without that placement.
  const schemas = (await client.query("SELECT DISTINCT n.nspname name FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname IN ('pgcrypto','uuid-ossp','pg_trgm')")).rows.map(r => r.name as string);
  const escape = (value:string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expressions = schemas.map(name => new RegExp(`(?:${escape(name)}|${escape('"'+name.replace(/"/g,'""')+'"')})\\.(uuid_generate_v4|gin_trgm_ops|gist_trgm_ops)\\b`, "g"));
  function normalize(value:unknown):unknown {
    if (typeof value === "string") return expressions.reduce((text,pattern) => text.replace(pattern,"$1"),value);
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,normalize(v)]));
    return value;
  }
  return normalize(result) as Record<string,unknown[]>;
}
export async function catalogChecksum(client: Client): Promise<string> {
  return createHash("sha256").update(stableJson(await readCatalog(client))).digest("hex");
}
