import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
async function main() {
  const url = new URL(
    process.env.TEST_ADMIN_DATABASE_URL ??
      "postgresql://zobia@127.0.0.1:5432/postgres",
  );
  if (
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.pathname !== "/postgres"
  )
    throw Error("Local disposable fixtures only");
  const c = new Client({ connectionString: url.href });
  await c.connect();
  const name = "zobia_v3_" + randomUUID().replaceAll("-", "");
  try {
    await c.query(`CREATE DATABASE "${name}"`);
    url.pathname = "/" + name;
    const d = new Client({ connectionString: url.href });
    await d.connect();
    try {
      await d.query(
        readFileSync(
          resolve("db/migrations/0001_consolidated_schema.sql"),
          "utf8",
        ),
      );
    } finally {
      await d.end();
    }
    execFileSync(
      process.execPath,
      [
        resolve("../../node_modules/tsx/dist/cli.mjs"),
        resolve("scripts/check-v3-contract.ts"),
      ],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          DATABASE_URL: url.href,
          DIRECT_URL: url.href,
          NODE_ENV: "test",
          SKIP_ENV_VALIDATION: "0",
          DATABASE_PROVIDER: "railway",
          STORAGE_PROVIDER: "r2",
          REALTIME_PROVIDER: "ably",
          ABLY_API_KEY: "fixture.key:fixture-secret",
          EMAIL_PROVIDER: "mailgun",
          REDIS_PROVIDER: "ioredis",
          REDIS_URL: process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6379",
          JWT_SECRET: "v3-fixture-access-secret-with-32-characters",
          JWT_REFRESH_SECRET: "v3-fixture-refresh-secret-with-32-characters",
          KYC_ENCRYPTION_KEY_V2: "v3-fixture-only-encryption-key-32-chars",
          CRON_SECRET: "v3-fixture-cron-secret-not-for-production",
        },
      },
    );
  } finally {
    await c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await c.end();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
