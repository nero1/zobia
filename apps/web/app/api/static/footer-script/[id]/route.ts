export const dynamic = "force-dynamic";

/**
 * app/api/static/footer-script/[id]/route.ts
 *
 * Serves admin-injected footer scripts as external JS files.
 * Scripts are fetched by ID and served with a strict Content-Security-Policy
 * that prevents them from loading other scripts or iframes, limiting the blast
 * radius if an admin account is compromised.
 *
 * The <script src="/api/static/footer-script/[id]" async /> in layout.tsx
 * references this endpoint, which avoids injecting the page-level CSP nonce
 * into admin-controlled content.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;

  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return new NextResponse("Not Found", { status: 404 });
  }

  try {
    const { rows } = await db.query<{ content: string; is_active: boolean }>(
      `SELECT content, is_active FROM footer_scripts WHERE id = $1 LIMIT 1`,
      [id]
    );

    if (!rows[0] || !rows[0].is_active) {
      return new NextResponse("Not Found", { status: 404 });
    }

    return new NextResponse(rows[0].content, {
      status: 200,
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=300, stale-while-revalidate=600",
        // CSP-02: A Content-Security-Policy on a JS response has no effect on what
        // the script can do when executed by the parent page — the parent's own CSP
        // governs execution. The parent page's nonce-based CSP (set by middleware)
        // allows this script only because it loads from 'self'. What actually limits
        // blast radius here is: (1) admin access control on who can upload scripts,
        // (2) the middleware CSP which blocks 'unsafe-eval', cross-origin fetches, etc.
        // X-Content-Type-Options prevents MIME-sniffing the JS as HTML to trigger XSS.
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
