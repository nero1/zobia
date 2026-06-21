export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { loadManifest } from "@/lib/manifest";

export async function GET() {
  try {
    const manifest = await loadManifest();
    return NextResponse.json({
      success: true,
      data: {
        floatingNotifications: manifest.floatingNotifications,
      },
    }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } });
  } catch {
    return NextResponse.json({
      success: true,
      data: {
        floatingNotifications: {
          enabled: true,
          xpThreshold: 100,
          creditsThreshold: 50,
          starsThreshold: 10,
        },
      },
    });
  }
}
