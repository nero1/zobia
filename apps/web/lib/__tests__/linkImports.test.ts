/**
 * Guard: app code must import Link from "@/components/ui/Link" (intent
 * prefetch), never "next/link" directly. Viewport prefetching made every
 * on-screen link a billed server render (Vercel Active CPU); see the header
 * of components/ui/Link.tsx.
 */
import * as fs from "fs";
import * as path from "path";
import { prefetchTarget } from "@/lib/navigation/prefetchTarget";

const ROOT = path.resolve(__dirname, "../..");
const WRAPPER = path.join(ROOT, "components/ui/Link.tsx");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("Link imports", () => {
  it("no file imports next/link except the shared wrapper", () => {
    const offenders = ["app", "components", "lib", "hooks"]
      .map((d) => path.join(ROOT, d))
      .filter((d) => fs.existsSync(d))
      .flatMap((d) => walk(d))
      .filter((f) => f !== WRAPPER && /from\s+["']next\/link["']/.test(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(ROOT, f));
    expect(offenders).toEqual([]);
  });
});

describe("prefetchTarget", () => {
  it("returns internal paths", () => {
    expect(prefetchTarget("/home")).toBe("/home");
    expect(prefetchTarget({ pathname: "/u/ada", query: { tab: "posts" } })).toBe("/u/ada?tab=posts");
  });

  it("ignores external, protocol-relative and hash-only links", () => {
    expect(prefetchTarget("https://example.com")).toBeNull();
    expect(prefetchTarget("//cdn.example.com/x")).toBeNull();
    expect(prefetchTarget("#top")).toBeNull();
    expect(prefetchTarget("mailto:hi@zobia.app")).toBeNull();
  });
});
