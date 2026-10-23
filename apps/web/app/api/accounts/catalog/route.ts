import { NextResponse } from "next/server";
import { listAccountTypes } from "@/lib/plans/catalog";
import { handleApiError } from "@/lib/api/errors";
export const dynamic = "force-dynamic";
export async function GET() {
  try { return NextResponse.json({ success: true, data: await listAccountTypes() }, { headers: { "Cache-Control": "public, max-age=15, stale-while-revalidate=30" } }); }
  catch (error) { return handleApiError(error); }
}
