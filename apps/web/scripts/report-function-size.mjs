#!/usr/bin/env node
/**
 * scripts/report-function-size.mjs
 *
 * Estimates how much Vercel "Function Storage" (Deployment Storage) one
 * deployment of this app consumes. Run after `next build`:
 *
 *   npm run analyze:functions          # human-readable report
 *   npm run analyze:functions -- --json
 *
 * How the estimate works: every server route has a `.nft.json` trace listing
 * the files its function needs at runtime. Vercel's Next.js builder packs
 * routes into functions (up to ~250 MB uncompressed each), keeping route
 * handlers and pages apart and only merging routes whose function config
 * (maxDuration, memory, ...) is identical. Every function stores its own
 * copy of the union of its routes' traced files. We do the same greedy
 * packing here so the "estimated deployment storage" tracks what Vercel
 * bills against the 10 GB Hobby allowance (uncompressed; Vercel stores
 * zipped bundles, so the billed number is lower but moves the same way).
 *
 * Use it to catch regressions: a new top-level import of a heavy library in
 * a shared module shows up here as a jump in the per-route median and in
 * the "heaviest packages" list.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SERVER_DIR = path.join(ROOT, ".next", "server");
const GROUP_LIMIT = 250 * 1024 * 1024;
const asJson = process.argv.includes("--json");

if (!fs.existsSync(SERVER_DIR)) {
  console.error("No .next/server directory found. Run `next build` first.");
  process.exit(1);
}

const sizeCache = new Map();
function fileSize(abs) {
  if (sizeCache.has(abs)) return sizeCache.get(abs);
  let size = 0;
  try {
    const st = fs.statSync(abs);
    size = st.isFile() ? st.size : 0;
  } catch {
    size = 0;
  }
  sizeCache.set(abs, size);
  return size;
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else if (entry.name.endsWith(".nft.json")) out.push(abs);
  }
  return out;
}

function packageOf(abs) {
  const idx = abs.lastIndexOf(`${path.sep}node_modules${path.sep}`);
  if (idx === -1) return abs.includes(`${path.sep}.next${path.sep}`) ? "(next build output)" : "(app source)";
  const rest = abs.slice(idx + 14).split(path.sep);
  return rest[0].startsWith("@") ? `${rest[0]}/${rest[1]}` : rest[0];
}

const fnConfigPath = path.join(SERVER_DIR, "functions-config-manifest.json");
const fnConfig = fs.existsSync(fnConfigPath)
  ? JSON.parse(fs.readFileSync(fnConfigPath, "utf8")).functions ?? {}
  : {};

/** "app/api/x/route.js" -> "/api/x"; "app/(app)/feed/page.js" -> "/feed". */
function routeName(rel) {
  return (
    "/" +
    rel
      .replace(/^(app|pages)\//, "")
      .replace(/\.js$/, "")
      .split("/")
      .filter((seg) => !(seg.startsWith("(") && seg.endsWith(")")) && !seg.startsWith("@"))
      .filter((seg, i, arr) => !(i === arr.length - 1 && (seg === "route" || seg === "page")))
      .join("/")
  ).replace(/\/$/, "") || "/";
}

const traces = [];
for (const dir of ["app", "pages"]) {
  const base = path.join(SERVER_DIR, dir);
  if (!fs.existsSync(base)) continue;
  for (const nft of walk(base, [])) {
    const { files = [] } = JSON.parse(fs.readFileSync(nft, "utf8"));
    const routeFile = nft.replace(/\.nft\.json$/, "");
    const set = new Set([routeFile, ...files.map((f) => path.resolve(path.dirname(nft), f))]);
    let bytes = 0;
    for (const f of set) bytes += fileSize(f);
    const rel = path.relative(SERVER_DIR, routeFile);
    const config = fnConfig[routeName(rel)] ?? {};
    const kind = rel.endsWith("/route.js") ? "route-handler" : "page";
    const groupKey = `${kind}|${config.maxDuration ?? "default"}|${config.memory ?? "default"}`;
    traces.push({ route: rel, files: set, bytes, groupKey });
  }
}

// Greedy packing, largest routes first, approximating Vercel's grouping.
const groups = [];
for (const t of [...traces].sort((a, b) => b.bytes - a.bytes)) {
  let placed = false;
  for (const g of groups) {
    if (g.key !== t.groupKey) continue;
    let extra = 0;
    for (const f of t.files) if (!g.files.has(f)) extra += fileSize(f);
    if (g.bytes + extra <= GROUP_LIMIT) {
      for (const f of t.files) g.files.add(f);
      g.bytes += extra;
      g.routes += 1;
      placed = true;
      break;
    }
  }
  if (!placed) groups.push({ key: t.groupKey, files: new Set(t.files), bytes: t.bytes, routes: 1 });
}

const union = new Set();
for (const t of traces) for (const f of t.files) union.add(f);
let unionBytes = 0;
const pkgBytes = new Map();
for (const f of union) {
  const s = fileSize(f);
  unionBytes += s;
  const p = packageOf(f);
  pkgBytes.set(p, (pkgBytes.get(p) ?? 0) + s);
}
const estimated = groups.reduce((n, g) => n + g.bytes, 0);
const sorted = [...traces].sort((a, b) => b.bytes - a.bytes);
const median = sorted.length ? sorted[Math.floor(sorted.length / 2)].bytes : 0;
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;

const report = {
  routes: traces.length,
  functionGroups: groups.length,
  groups: groups.map((g) => ({ key: g.key, routes: g.routes, bytes: g.bytes })),
  uniqueTracedBytes: unionBytes,
  estimatedDeploymentBytes: estimated,
  medianRouteBytes: median,
  heaviestRoutes: sorted.slice(0, 15).map((t) => ({ route: t.route, bytes: t.bytes })),
  heaviestPackages: [...pkgBytes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([name, bytes]) => ({ name, bytes })),
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Routes traced:                 ${report.routes}`);
  console.log(`Function groups (<=250 MB):    ${report.functionGroups}`);
  console.log(`Unique traced files:           ${mb(report.uniqueTracedBytes)}`);
  console.log(`Estimated deployment storage:  ${mb(report.estimatedDeploymentBytes)}`);
  console.log(`Median route trace:            ${mb(report.medianRouteBytes)}`);
  console.log("\nFunction groups (kind|maxDuration|memory):");
  for (const g of report.groups) console.log(`  ${mb(g.bytes).padStart(9)}  ${String(g.routes).padStart(4)} routes  ${g.key}`);
  console.log("\nHeaviest routes:");
  for (const r of report.heaviestRoutes) console.log(`  ${mb(r.bytes).padStart(9)}  ${r.route}`);
  console.log("\nHeaviest packages (unique bytes):");
  for (const p of report.heaviestPackages) console.log(`  ${mb(p.bytes).padStart(9)}  ${p.name}`);
}
