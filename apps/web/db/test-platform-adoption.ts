import assert from "node:assert/strict";
import { Client } from "pg";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { catalogChecksum, readCatalog } from "./catalog";
import baseline from "./baselines/2026-10-23.json";
import compatibility from "./baselines/platform-compatibility.json";
async function main() {
  const url = new URL(
    process.env.TEST_ADMIN_DATABASE_URL ||
      "postgresql://zobia@127.0.0.1:5432/postgres",
  );
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.pathname !== "/postgres"
  )
    throw Error("Local disposable fixtures only");
  const control = new Client({ connectionString: url.href });
  await control.connect();
  const name = "zobia_platform_" + randomUUID().replaceAll("-", "");
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
    assert.equal(await catalogChecksum(db), baseline.catalogChecksum);
    await db.query(
      `DROP TABLE public_media_references,public_media_assets,sponsored_daily_reservations,sponsored_quest_funding CASCADE; DROP FUNCTION app_track_public_media() CASCADE; DROP INDEX sponsored_quests_admin_active_page_idx,sponsored_quests_admin_page_idx,sponsored_quests_business_page_idx`,
    );
    await db.query(
      "DROP INDEX tales_author_created_page_idx,tale_author_subscriptions_author_page_idx,tales_discovery_idx; CREATE INDEX tales_discovery_idx ON public.tales(status,moderation,published_at DESC,id DESC)",
    );
    const old = await catalogChecksum(db);
    assert.equal(old, baseline.additionalUpgrades[1].fromCatalogChecksum);
    for (const f of (await readCatalog(db)).functions as {
      name: string;
      definition: string;
    }[])
      if (compatibility.editorLineEndingFunctions.includes(f.name))
        await db.query(f.definition.replace(/\n/g, "\r\n"));
    for (const table of compatibility.additionalRlsTables)
      await db.query(`ALTER TABLE public."${table}" ENABLE ROW LEVEL SECURITY`);
    await db.query(
      `CREATE FUNCTION public.rls_auto_enable() RETURNS event_trigger LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$; CREATE EVENT TRIGGER rls_auto_enable ON ddl_command_end WHEN TAG IN ('CREATE TABLE') EXECUTE FUNCTION public.rls_auto_enable()`,
    );
    assert.equal(await catalogChecksum(db), old);
    await db.query(
      `INSERT INTO users(username,email,display_name,coin_balance) VALUES('adoption_fixture','adoption@fixture.invalid','Fixture',12345)`,
    );
    execFileSync(
      process.execPath,
      [
        path.resolve("../../node_modules/tsx/dist/cli.mjs"),
        path.join(__dirname, "migrate.ts"),
        "--adopt-baseline",
      ],
      {
        env: { ...process.env, NODE_ENV: "test", DIRECT_URL: url.href },
        stdio: "pipe",
      },
    );
    assert.equal(await catalogChecksum(db), baseline.catalogChecksum);
    execFileSync(
      process.execPath,
      [
        path.resolve("../../node_modules/tsx/dist/cli.mjs"),
        path.join(__dirname, "migrate.ts"),
      ],
      {
        env: { ...process.env, NODE_ENV: "test", DIRECT_URL: url.href },
        stdio: "pipe",
      },
    );
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM migrations_log")).rows[0].n,
      1,
    );
    assert.equal(
      Number(
        (
          await db.query(
            "SELECT coin_balance FROM users WHERE username='adoption_fixture'",
          )
        ).rows[0].coin_balance,
      ),
      12345,
    );
    assert.equal(
      (
        await db.query(
          "SELECT relrowsecurity FROM pg_class WHERE oid='public.account_appeals'::regclass",
        )
      ).rows[0].relrowsecurity,
      true,
    );
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int n FROM pg_event_trigger WHERE evtname='rls_auto_enable'",
        )
      ).rows[0].n,
      1,
    );
    await db.query("ALTER TABLE users DISABLE ROW LEVEL SECURITY");
    assert.notEqual(await catalogChecksum(db), baseline.catalogChecksum);
    await db.query("ALTER TABLE users ENABLE ROW LEVEL SECURITY");
    await db.query(
      "ALTER TABLE account_appeals ADD COLUMN unrelated_drift text",
    );
    assert.notEqual(await catalogChecksum(db), baseline.catalogChecksum);
    await db.query("ALTER TABLE account_appeals DROP COLUMN unrelated_drift");
    await db.query(
      "ALTER FUNCTION system_alerts_default_priority() SECURITY DEFINER",
    );
    assert.notEqual(await catalogChecksum(db), baseline.catalogChecksum);
    console.log(
      "PASS provider/editor compatibility preserves data and extra RLS while rejecting unrelated drift, missing required RLS and changed functions",
    );
  } finally {
    await db?.end();
    await control.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await control.end();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
