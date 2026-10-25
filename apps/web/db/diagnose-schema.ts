/// <reference types="node" />
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { compareCatalogs, inspectSchema } from "./schema-diagnostics";

async function main() {
  const targetUrl = new URL(
    process.env.DIRECT_URL || process.env.DATABASE_URL || "",
  );
  if (
    ["disable", "no-verify"].includes(
      targetUrl.searchParams.get("sslmode") ?? "",
    )
  )
    throw Error("Verified database TLS is required");
  targetUrl.searchParams.delete("sslmode");
  const referenceUrl = new URL(process.env.DIAGNOSTIC_REFERENCE_URL || "");
  if (
    !["localhost", "127.0.0.1"].includes(referenceUrl.hostname) ||
    referenceUrl.pathname !== "/zobia_diagnostic_reference"
  )
    throw Error("A dedicated local diagnostic reference database is required");
  const reference = new Client({
    connectionString: referenceUrl.href,
    connectionTimeoutMillis: 10000,
  });
  const target = new Client({
    connectionString: targetUrl.href,
    connectionTimeoutMillis: 10000,
    ssl: {
      rejectUnauthorized: true,
      ...(process.env.DB_CA_CERT ? { ca: process.env.DB_CA_CERT } : {}),
    },
  });
  try {
    await reference.connect();
    const existing = (
      await reference.query(
        "SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'",
      )
    ).rows[0].n;
    if (existing) throw Error("Diagnostic reference database must be empty");
    // The baseline runs ONLY on the disposable local reference, never the target.
    await reference.query(
      fs.readFileSync(
        path.join(__dirname, "migrations/0001_consolidated_schema.sql"),
        "utf8",
      ),
    );
    const expected = await inspectSchema(reference);
    await target.connect();
    const actual = await inspectSchema(target);
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "baselines/2026-10-23.json"),
        "utf8",
      ),
    );
    if (expected.checksum !== manifest.catalogChecksum)
      throw Error(
        "Reference schema differs from the verified baseline; diagnostic comparison aborted",
      );
    const known = new Set([
      manifest.catalogChecksum,
      manifest.previousCatalogChecksum,
      ...manifest.additionalUpgrades.map(
        (v: { fromCatalogChecksum: string }) => v.fromCatalogChecksum,
      ),
    ]);
    const report = {
      dateTime: new Intl.DateTimeFormat("en-US", {
        timeZone: "Africa/Lagos",
        dateStyle: "long",
        timeStyle: "long",
        hour12: true,
      }).format(new Date()),
      targetPostgresVersion: actual.version,
      referencePostgresVersion: expected.version,
      observedChecksum: actual.checksum,
      expectedChecksum: expected.checksum,
      recognizedSchema: known.has(actual.verifiedChecksum),
      verifiedChecksum: actual.verifiedChecksum,
      comparison:
        "Differences are against the current baseline; older supported versions may legitimately differ. PostgreSQL deparser/version differences also require review. No adoption or repair was attempted.",
      categories: compareCatalogs(expected.catalog, actual.catalog),
      signature: "Codex schema diagnostics — read-only target inspection",
    };
    fs.writeFileSync(
      "schema-diagnostics.json",
      JSON.stringify(report, null, 2) + "\n",
      { mode: 0o600 },
    );
    for (const [name, category] of Object.entries(report.categories))
      console.log(
        `[diagnose] ${name}: ${category.changes.length} differing objects`,
      );
    console.log(
      "[diagnose] Download the schema-diagnostics artifact. No target schema, history, permissions or application data was changed.",
    );
  } finally {
    await Promise.allSettled([reference.end(), target.end()]);
  }
}
main().catch(() => {
  console.error(
    "[diagnose] Inspection failed. Check the connection secrets, certificate and dedicated reference database. No repair or adoption was attempted.",
  );
  process.exitCode = 1;
});
