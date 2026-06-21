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
        // Restrict what the script itself can do — no nested script loading, no iframes
        "Content-Security-Policy": "default-src 'none'; script-src 'self'",
      },
    });
  } catch {
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
