export const dynamic = 'force-dynamic';
import {NextResponse} from 'next/server';
import {withAuth} from '@/lib/api/middleware';
/** Quest progress is recorded exclusively by verified server-side actions. */
export const POST=withAuth(async()=>NextResponse.json({success:false,error:{code:'SERVER_ACTIVITY_REQUIRED',message:'Quest progress is updated automatically when you perform the required activity.'}},{status:410}));
