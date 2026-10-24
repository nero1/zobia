export const dynamic='force-dynamic';
export const maxDuration = 300;
import {NextRequest,NextResponse} from 'next/server';
import {validateCronSecret} from '@/lib/cron/auth';
import {drainTasks} from '@/lib/tasks/outbox';
import {handleApiError} from '@/lib/api/errors';
/** External schedulers may drain concurrently; individual rows have exclusive leases. */
export async function GET(request:NextRequest){
 if(!validateCronSecret(request))return new NextResponse(null,{status:401});
 try{return NextResponse.json({success:true,data:await drainTasks(100,25000)});}catch(error){return handleApiError(error);}
}
export const POST=GET;
