/**
 * CRON maxDuration consistency guard.
 *
 * Vercel's Next.js builder only packs routes into the same function when
 * their config (maxDuration, memory, ...) is identical, and every function
 * stores its own copy of the shared server runtime. Five different
 * maxDuration values across the CRON routes produced five extra functions
 * per deployment, which counts against the 10 GB Hobby "Function Storage"
 * allowance (see docs/SETUP.md "Vercel Hobby storage").
 *
 * Every CRON route therefore exports the same `maxDuration = 300` (the
 * Hobby maximum with Fluid Compute, which is on by default; billing is for
 * active CPU time, so a higher ceiling costs nothing unless it is used).
 */

import * as fs from "fs";
import * as path from "path";

const CRON_DIR = path.resolve(__dirname, "../../../app/api/cron");
const CRON_MAX_DURATION = 300;

/** The retired monolithic /api/cron/daily only answers 410 Gone. */
const EXEMPT = new Set(["daily"]);

function cronRoutes(): Array<{ name: string; source: string }> {
  return fs
    .readdirSync(CRON_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !EXEMPT.has(d.name))
    .map((d) => ({
      name: d.name,
      source: fs.readFileSync(path.join(CRON_DIR, d.name, "route.ts"), "utf8"),
    }));
}

describe("CRON route maxDuration", () => {
  it("finds the CRON routes", () => {
    expect(cronRoutes().length).toBeGreaterThan(5);
  });

  it.each(cronRoutes().map((r) => [r.name, r.source]))(
    "%s exports maxDuration = 300",
    (_name, source) => {
      const matches = [...source.matchAll(/^export const maxDuration = (\d+);/gm)];
      expect(matches).toHaveLength(1);
      expect(Number(matches[0][1])).toBe(CRON_MAX_DURATION);
    }
  );

  it("no other route sets its own maxDuration (it would split off a new function)", () => {
    const appDir = path.resolve(__dirname, "../../../app");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name) && !full.startsWith(CRON_DIR + path.sep)) {
          if (/^export const maxDuration\b/m.test(fs.readFileSync(full, "utf8"))) offenders.push(path.relative(appDir, full));
        }
      }
    };
    walk(appDir);
    expect(offenders).toEqual([]);
  });
});
