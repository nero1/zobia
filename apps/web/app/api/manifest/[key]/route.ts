export const dynamic = 'force-dynamic';
import {NextResponse} from 'next/server';
import {withAdminAuth} from '@/lib/api/middleware';
/** Retired document-style writes cannot update the canonical typed settings. */
export const PUT=withAdminAuth(async()=>NextResponse.json({
 error:'This legacy configuration endpoint has been retired. Use /api/admin/config/{key} to update a validated canonical setting.',
 code:'LEGACY_MANIFEST_ENDPOINT_RETIRED',
},{status:410,headers:{Link:'</api/admin/config>; rel="successor-version"','Cache-Control':'no-store'}}));
