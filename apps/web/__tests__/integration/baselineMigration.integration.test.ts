import {gunzipSync} from "zlib";
import { Client } from "pg";
import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import os from "os";
import path from "path";
import { catalogChecksum } from "../../db/catalog";
const execute = promisify(execFile);
const integration = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const source = path.resolve(__dirname,"../../db");
const baselineFile = "0001_consolidated_schema.sql";
const sql = fs.readFileSync(path.join(source,"migrations",baselineFile),"utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(source,"baselines/2026-10-23.json"),"utf8"));

integration("final-state database baseline and migration runner", () => {
 const admin = new Client({connectionString:process.env.TEST_DATABASE_URL});
 const databases: string[] = [], temporary: string[] = [];
 beforeAll(async () => { await admin.connect(); });
 afterAll(async () => {
  for (const name of databases) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.end();
  for (const dir of temporary) fs.rmSync(dir,{recursive:true,force:true});
 });
 async function database() {
  const name = `zobia_baseline_it_${randomUUID().replace(/-/g,"")}`;
  await admin.query(`CREATE DATABASE "${name}"`); databases.push(name);
  const url = new URL(process.env.TEST_DATABASE_URL!); url.pathname=`/${name}`;
  const client = new Client({connectionString:url.href}); await client.connect();
  return {client,url:url.href};
 }
 async function run(url:string,args:string[]=[],dir=source) {
  return execute(process.execPath,[require.resolve("tsx/cli"),path.join(dir,"migrate.ts"),...args],{
   env:{...process.env,DIRECT_URL:url,DATABASE_URL:url},cwd:path.resolve(source,".."),maxBuffer:1024*1024,
  });
 }
 async function withDatabase(action:(db:Awaited<ReturnType<typeof database>>)=>Promise<void>) {
  const db = await database(); try { await action(db); } finally { await db.client.end(); }
 }
 function fixture() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"zobia-baseline-"));temporary.push(root);
  fs.cpSync(source,path.join(root,"db"),{recursive:true});
  fs.symlinkSync(path.dirname(path.dirname(require.resolve("pg/package.json"))),path.join(root,"node_modules"),"dir");
  return path.join(root,"db");
 }
 it("reports empty status without creating history, installs once and preserves data on rerun", async () => withDatabase(async ({client,url}) => {
  expect((await run(url,["--status"])).stdout).toContain("pending");
  expect((await client.query("SELECT to_regclass('public.migrations_log') name")).rows[0].name).toBeNull();
  await run(url);
  expect(await catalogChecksum(client)).toBe(manifest.catalogChecksum);
  await client.query("UPDATE x_manifest SET value='operator-value' WHERE key='minimum_age'");
  await run(url);
  expect((await client.query("SELECT value FROM x_manifest WHERE key='minimum_age'")).rows[0].value).toBe("operator-value");
  expect((await client.query("SELECT count(*)::int n FROM migrations_log")).rows[0].n).toBe(1);
 }));
 it("supports a single manual SQL apply and verified adoption without replaying seed defaults", async () => withDatabase(async ({client,url}) => {
  await client.query(sql);
  await client.query("UPDATE x_manifest SET value='manual-setting' WHERE key='minimum_age'");
  await expect(run(url)).rejects.toMatchObject({code:1});
  await run(url,["--adopt-baseline"]);
  expect((await client.query("SELECT value FROM x_manifest WHERE key='minimum_age'")).rows[0].value).toBe("manual-setting");
  await expect(client.query(sql)).rejects.toThrow("empty application schema");
  await client.query("ROLLBACK");
  expect(await catalogChecksum(client)).toBe(manifest.catalogChecksum);
 }));
 it("adopts only the complete verified predecessor history", async () => withDatabase(async ({client,url}) => {
  await client.query(sql);
  await client.query("CREATE TABLE migrations_log(id SERIAL PRIMARY KEY,filename TEXT UNIQUE NOT NULL,checksum TEXT NOT NULL,applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
  for (const [filename,digest] of Object.entries(manifest.predecessors)) await client.query("INSERT INTO migrations_log(filename,checksum) VALUES($1,$2)",[filename,digest]);
  await client.query("UPDATE x_manifest SET value='keep-me' WHERE key='minimum_age'");
  const hasClientRole = !!(await client.query("SELECT 1 FROM pg_roles WHERE rolname='authenticated'")).rowCount;
  if (hasClientRole) await client.query("GRANT SELECT ON users TO authenticated");
  expect((await run(url)).stdout).toContain("Verified and adopted");
  expect((await client.query("SELECT count(*)::int n FROM migrations_log")).rows[0].n).toBe(39);
  if (hasClientRole) expect((await client.query("SELECT has_table_privilege('authenticated','public.users','SELECT') allowed")).rows[0].allowed).toBe(false);
  expect((await client.query("SELECT value FROM x_manifest WHERE key='minimum_age'")).rows[0].value).toBe("keep-me");
 }));
 it("refuses incomplete history and rejects adoption of a structurally incomplete database", async () => withDatabase(async ({client,url}) => {
  await client.query("CREATE TABLE users(id uuid); CREATE TABLE migrations_log(id SERIAL PRIMARY KEY,filename TEXT UNIQUE NOT NULL,checksum TEXT NOT NULL,applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
  await client.query("INSERT INTO migrations_log(filename,checksum) VALUES($1,$2)",[baselineFile,manifest.predecessors[baselineFile]]);
  await expect(run(url)).rejects.toMatchObject({code:1});
  await expect(run(url,["--adopt-baseline"])).rejects.toMatchObject({code:1});
  expect((await client.query("SELECT count(*)::int n FROM migrations_log")).rows[0].n).toBe(1);
 }));
 it("rolls all baseline DDL and seed writes back when history registration fails", async () => withDatabase(async ({client,url}) => {
  await client.query("CREATE TABLE migrations_log(id SERIAL PRIMARY KEY,filename TEXT UNIQUE NOT NULL,checksum TEXT NOT NULL CHECK(checksum='reject'),applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
  await expect(run(url)).rejects.toMatchObject({code:1});
  expect((await client.query("SELECT to_regclass('public.users') name")).rows[0].name).toBeNull();
  expect((await client.query("SELECT count(*)::int n FROM migrations_log")).rows[0].n).toBe(0);
 }));
 it("serializes concurrent first installs", async () => withDatabase(async ({client,url}) => {
  await Promise.all([run(url),run(url)]);
  expect((await client.query("SELECT count(*)::int n FROM migrations_log")).rows[0].n).toBe(1);
  expect(await catalogChecksum(client)).toBe(manifest.catalogChecksum);
 }));
 it("rejects baseline file drift and rolls a failing future migration back", async () => withDatabase(async ({client,url}) => {
  await run(url);const dir=fixture();
  fs.appendFileSync(path.join(dir,"migrations",baselineFile),"\n-- changed after application\n");
  await expect(run(url,[],dir)).rejects.toMatchObject({code:1});
  fs.writeFileSync(path.join(dir,"migrations",baselineFile),sql);
  fs.writeFileSync(path.join(dir,"migrations/0002_failure.sql"),"BEGIN;\nCREATE TABLE should_rollback(id int);\nSELECT 1/0;\nCOMMIT;\n");
  await expect(run(url,[],dir)).rejects.toMatchObject({code:1});
  expect((await client.query("SELECT to_regclass('public.should_rollback') name")).rows[0].name).toBeNull();
  expect((await client.query("SELECT count(*)::int n FROM migrations_log")).rows[0].n).toBe(1);
 }));
 it("upgrades the verified previous baseline atomically and preserves operator data",async()=>withDatabase(async({client,url})=>{
  const previous=gunzipSync(fs.readFileSync(path.resolve(__dirname,"../fixtures/pre-hardening-baseline.sql.gz"))).toString();
  await client.query(previous);
  expect(await catalogChecksum(client)).toBe(manifest.previousCatalogChecksum);
  await client.query("CREATE TABLE migrations_log(id SERIAL PRIMARY KEY,filename TEXT UNIQUE NOT NULL,checksum TEXT NOT NULL,applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
  await client.query("INSERT INTO migrations_log(filename,checksum) VALUES($1,$2)",[baselineFile,manifest.previousBaselineChecksum]);
  await client.query("UPDATE x_manifest SET value='keep-upgrade-setting' WHERE key='minimum_age'");
  const user=await client.query("INSERT INTO users(username,email,display_name,coin_balance) VALUES('upgrade_fixture','upgrade@security.invalid','Upgrade fixture',123) RETURNING id");
  await run(url);
  expect(await catalogChecksum(client)).toBe(manifest.catalogChecksum);
  expect((await client.query("SELECT coin_balance FROM users WHERE id=$1",[user.rows[0].id])).rows[0].coin_balance).toBe('123');
  expect((await client.query("SELECT value FROM x_manifest WHERE key='minimum_age'")).rows[0].value).toBe('keep-upgrade-setting');
  await run(url);expect((await client.query("SELECT count(*)::int n FROM migrations_log")).rows[0].n).toBe(1);
 }));

});
