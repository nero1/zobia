import { NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { listAccountTypes, saveAccountType } from "@/lib/plans/catalog";
export const dynamic = "force-dynamic";
export const GET = withAdminAuth(async () => {
  try { return NextResponse.json({ success: true, data: await listAccountTypes(true) }); }
  catch (error) { return handleApiError(error); }
});
export const POST = withAdminAuth(async (req, { auth }) => {
  try { return NextResponse.json({ success: true, data: await saveAccountType(auth.user.sub, await req.json()) }); }
  catch (error) { return handleApiError(error); }
});
