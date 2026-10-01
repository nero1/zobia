export const dynamic = 'force-dynamic';

/**
 * POST /api/security/csp-report
 *
 * Content Security Policy violation ingest endpoint (STRUC-10).
 * Browsers send reports here when a CSP violation occurs.
 *
 * Supports both:
 *   - report-uri format (legacy): { "csp-report": { ... } }
 *   - report-to format (modern):  [{ "body": { ... }, "type": "csp-violation", ... }]
 *
 * Violations are logged to the system_alerts table for ops review.
 * High-volume/noise violations (extensions, injected scripts) are filtered
 * before persistence to keep the table usable.
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/drizzle";
import { raiseAlert } from "@/lib/alerts/dispatch";

// Patterns that indicate extension or third-party injection — not actionable
const NOISE_PATTERNS = [
  "chrome-extension://",
  "moz-extension://",
  "safari-extension://",
  "about:blank",
  "about:srcdoc",
];

const RECENT_WINDOW_MS = 10 * 60_000;
const MAX_RECENT = 200;
const recent = new Map<string, number>();

/** True if this violation was already recorded by this instance within the window. */
function seenRecently(key: string): boolean {
  const now = Date.now();
  const at = recent.get(key);
  if (at !== undefined && now - at < RECENT_WINDOW_MS) return true;
  if (recent.size >= MAX_RECENT) recent.clear();
  recent.set(key, now);
  return false;
}

function isNoise(report: Record<string, unknown>): boolean {
  const blockedUri = String(report["blocked-uri"] ?? report["blockedURL"] ?? "");
  const sourceFile = String(report["source-file"] ?? report["sourceFile"] ?? "");
  return NOISE_PATTERNS.some((p) => blockedUri.startsWith(p) || sourceFile.startsWith(p));
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    const text = await req.text();
    if (!text) return NextResponse.json({ ok: true });
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ ok: true });
  }

  // Normalise both report-uri and report-to payloads
  const reports: Record<string, unknown>[] = [];

  if (Array.isArray(body)) {
    // report-to format: array of report objects
    for (const item of body) {
      const reportBody = (item as Record<string, unknown>).body;
      if (reportBody && typeof reportBody === "object") {
        reports.push(reportBody as Record<string, unknown>);
      }
    }
  } else if (body && typeof body === "object") {
    // report-uri format: single object with "csp-report" key
    const cspReport = (body as Record<string, unknown>)["csp-report"];
    if (cspReport && typeof cspReport === "object") {
      reports.push(cspReport as Record<string, unknown>);
    }
  }

  if (reports.length > 0) {
    let orm: Awaited<ReturnType<typeof getDb>> | null = null;
    for (const report of reports) {
      if (isNoise(report)) continue;

      const documentUri = String(report["document-uri"] ?? report["documentURL"] ?? "");
      const violatedDirective = String(report["violated-directive"] ?? report["effectiveDirective"] ?? "");
      const blockedUri = String(report["blocked-uri"] ?? report["blockedURL"] ?? "");

      // A blocked resource is usually reported by every page view; once per
      // warm instance per window is enough to raise the alert (which also
      // dedupes in the DB). Skips the DB round-trip, saving Active CPU.
      if (seenRecently(`${violatedDirective}:${blockedUri}`)) continue;
      orm ??= await getDb();

      // Persist to system_alerts (best-effort — never fail the response)
      raiseAlert(orm, {
        type: "csp_violation",
        category: "security",
        priorityLevel: 6,
        title: "CSP violation reported",
        message: `CSP violation: ${violatedDirective} blocked ${blockedUri || "(inline)"}`,
        metadata: { documentUri, violatedDirective, blockedUri, raw: report },
        dedupeKey: `csp_violation:${violatedDirective}:${blockedUri}`,
      }).catch(() => {});
    }
  }

  // Always return 204 — browsers don't need a body
  return new NextResponse(null, { status: 204 });
}
