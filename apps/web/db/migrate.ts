/// <reference types="node" />
/** PostgreSQL migrations: one final-state baseline, then future numbered changes. */
import fs from "fs";
import path from "path";
import { Client } from "pg";
import { catalogChecksum } from "./catalog";

const directory = path.join(__dirname, "migrations");
const baseline = "0001_consolidated_schema.sql";
const predecessor = JSON.parse(fs.readFileSync(path.join(__dirname, "baselines/2026-10-23.json"), "utf8")) as {
  catalogChecksum: string; predecessors: Record<string,string>;
};
const log = (message: string) => process.stdout.write(`[migrate] ${message}\n`);

/** Preserve the checksum format used by existing migration histories. */
function checksum(content: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) hash = Math.imul(hash ^ content.charCodeAt(i), 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, "0");
}
/** The runner owns the transaction, including its history row. SQL stays directly runnable. */
function migrationBody(content: string): string {
  const start = /^((?:(?:\s+)|(?:--[^\n]*(?:\n|$))|(?:\/\*[\s\S]*?\*\/))*)BEGIN\s*;/i;
  const hasStart = start.test(content), hasEnd = /COMMIT;\s*$/i.test(content);
  if (hasStart !== hasEnd) throw new Error("Migration must have both outer BEGIN/COMMIT or neither");
  return hasStart ? content.replace(start, "$1").replace(/COMMIT;\s*$/i, "") : content;
}
async function history(client: Client): Promise<Map<string,string>> {
  const exists = (await client.query("SELECT to_regclass('public.migrations_log') AS name")).rows[0].name;
  if (!exists) return new Map();
  return new Map((await client.query<{filename:string;checksum:string}>("SELECT filename,checksum FROM public.migrations_log ORDER BY id")).rows.map(r => [r.filename,r.checksum]));
}
async function ensureHistory(client: Client) {
  await client.query(`CREATE TABLE IF NOT EXISTS public.migrations_log (
    id SERIAL PRIMARY KEY, filename TEXT NOT NULL UNIQUE,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), checksum TEXT NOT NULL
  )`);
}
async function record(client: Client, filename: string, digest: string) {
  await client.query("INSERT INTO public.migrations_log(filename,checksum) VALUES($1,$2) ON CONFLICT(filename) DO UPDATE SET checksum=EXCLUDED.checksum", [filename,digest]);
}
async function verifyBaseline(client: Client) {
  if (await catalogChecksum(client) !== predecessor.catalogChecksum) {
    throw new Error("Existing schema does not match the consolidated baseline. No application data was changed. Finish the original migrations from commit 8c20d630 in an isolated checkout, then retry; do not reset the database or mark missing migrations as applied.");
  }
}
async function main() {
  const args = new Set(process.argv.slice(2));
  for (const arg of args) if (!["--status","--seed","--adopt-baseline"].includes(arg)) throw new Error(`Unknown argument: ${arg}`);
  if (args.has("--status") && args.size > 1) throw new Error("--status cannot be combined with write options");
  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Set DIRECT_URL or DATABASE_URL to a direct PostgreSQL connection");
  const files = fs.readdirSync(directory).filter(f => f.endsWith(".sql")).sort();
  const contents = new Map(files.map(f => [f,fs.readFileSync(path.join(directory,f),"utf8")]));
  if (!contents.has(baseline)) throw new Error("Consolidated baseline is missing");
  const client = new Client({connectionString});
  await client.connect();
  try {
    // Serialize deploys before reading history, including a fresh database.
    await client.query("SELECT pg_advisory_lock(hashtextextended('zobia:database:migrations',0))");
    let applied = await history(client);
    const digest = checksum(contents.get(baseline)!);
    const legacy = applied.has(baseline) && applied.get(baseline) !== digest;
    const completePredecessor = Object.entries(predecessor.predecessors).every(([f,c]) => applied.get(f) === c);
    if (args.has("--status")) {
      for (const filename of files) log(`${!applied.has(filename) ? "pending" : checksum(contents.get(filename)!) === applied.get(filename) ? "applied" : "modified/legacy"} ${filename}`);
      if (legacy && completePredecessor) log("Complete predecessor history found; migrate will verify the schema before adopting this baseline.");
      log("Status only; no history or schema changes made.");
      return;
    }
    const existingApp = (await client.query("SELECT to_regclass('public.users') AS name")).rows[0].name;
    if ((legacy && completePredecessor) || args.has("--adopt-baseline")) {
      if (!existingApp) throw new Error("No application schema exists to adopt; run migrate without --adopt-baseline");
      await verifyBaseline(client);
      await client.query("BEGIN");
      try {
        const text = contents.get(baseline)!;
        const start = text.indexOf("\n-- Explicit Data API grants;");
        const end = text.lastIndexOf("\nCOMMIT;");
        if (start < 0 || end <= start) throw new Error("Baseline access section is missing");
        // Adoption must bring permissions to the same state as a fresh install,
        // including removal of inherited client access to private tables.
        await client.query(text.slice(start,end));
        await ensureHistory(client); await record(client,baseline,digest); await client.query("COMMIT");
      }
      catch (error) { await client.query("ROLLBACK"); throw error; }
      log("Verified and adopted the final-state baseline; access rules synchronized; application data and settings were preserved.");
      applied = await history(client);
    } else if (legacy) {
      throw new Error("Incomplete or modified predecessor migration history. Apply the missing original files from commit 8c20d630 before adopting this baseline. No application data was changed.");
    } else if (!applied.has(baseline) && existingApp) {
      throw new Error("An untracked application schema exists. If this file was applied manually, run migrate -- --adopt-baseline to verify it before recording history. The baseline will not rebuild existing tables.");
    }
    for (const [filename,content] of contents) {
      if (applied.has(filename) && applied.get(filename) !== checksum(content)) throw new Error(`Applied migration was modified: ${filename}`);
    }
    await ensureHistory(client);
    for (const [filename,content] of contents) {
      if (applied.has(filename)) continue;
      log(`Applying ${filename}`);
      await client.query("BEGIN");
      try { await client.query(migrationBody(content)); await record(client,filename,checksum(content)); await client.query("COMMIT"); }
      catch (error) { await client.query("ROLLBACK"); throw error; }
    }
    if (args.has("--seed")) {
      log("Applying optional local demo data");
      await client.query("BEGIN");
      try { await client.query(migrationBody(fs.readFileSync(path.join(__dirname,"seed.sql"),"utf8"))); await client.query("COMMIT"); }
      catch (error) { await client.query("ROLLBACK"); throw error; }
    }
    log("Database is up to date.");
  } finally { await client.end(); }
}
main().catch(error => { process.stderr.write(`[migrate] ERROR: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
