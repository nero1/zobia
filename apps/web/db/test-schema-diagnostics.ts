import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { inspectSchema, compareCatalogs } from "./schema-diagnostics";
async function main() {
  const url = new URL(
    process.env.TEST_ADMIN_DATABASE_URL ||
      "postgresql://zobia@127.0.0.1:5432/postgres",
  );
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.pathname !== "/postgres"
  )
    throw Error("Local disposable test databases only");
  const control = new Client({ connectionString: url.href });
  await control.connect();
  const name = "zobia_diagnostics_" + randomUUID().replaceAll("-", "");
  let db: Client | undefined;
  try {
    await control.query(`CREATE DATABASE "${name}"`);
    url.pathname = "/" + name;
    db = new Client({ connectionString: url.href });
    await db.connect();
    await db.query(
      fs.readFileSync(
        path.join(__dirname, "migrations/0001_consolidated_schema.sql"),
        "utf8",
      ),
    );
    const expected = await inspectSchema(db);
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "baselines/2026-10-23.json"),
        "utf8",
      ),
    );
    assert.equal(expected.checksum, manifest.catalogChecksum);
    assert(
      Object.values(compareCatalogs(expected.catalog, expected.catalog)).every(
        (v) => v.changes.length === 0,
      ),
    );
    await db.query(
      "ALTER TABLE public.users ADD COLUMN diagnostic_fixture text DEFAULT 'PRIVATE_DEFAULT_MARKER'; CREATE INDEX diagnostic_fixture_idx ON public.users(diagnostic_fixture)",
    );
    const drifted = await inspectSchema(db);
    const changes = compareCatalogs(expected.catalog, drifted.catalog);
    assert(
      changes.columns.changes.some(
        (v) =>
          v.object.startsWith("users.diagnostic_fixture") &&
          v.change === "extra",
      ),
    );
    assert(
      changes.indexes.changes.some(
        (v) =>
          v.object.includes("diagnostic_fixture_idx") && v.change === "extra",
      ),
    );
    assert(!JSON.stringify(changes).includes("PRIVATE_DEFAULT_MARKER"));
    assert.equal(
      (await inspectSchema(db)).checksum,
      drifted.checksum,
      "Inspection must not alter the target schema",
    );
    const transactionProbe = {
      query: async (sql: string) => {
        if (sql.startsWith("SET LOCAL")) throw Error("fixture query failure");
        return { rows: [] };
      },
    };
    const queries: string[] = [];
    const wrapped = {
      query: async (sql: string) => {
        queries.push(sql);
        return transactionProbe.query(sql);
      },
    };
    await assert.rejects(inspectSchema(wrapped as unknown as Client));
    assert.deepEqual(queries, [
      "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
      "SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='5s'",
      "ROLLBACK",
    ]);
    console.log(
      "PASS schema diagnostics match the baseline, identify drift without leaking defaults, preserve target schema and roll back failed read-only inspections",
    );
  } finally {
    await db?.end();
    await control.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await control.end();
  }
}
main().catch(() => {
  console.error("Schema diagnostics fixture failed");
  process.exitCode = 1;
});
