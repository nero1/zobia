import {NextRequest,NextResponse} from 'next/server';
import {authenticateAccessToken} from '@/lib/auth/principal';
import {ACCESS_TOKEN_COOKIE} from '@/lib/auth/session';
import {getDb} from '@/lib/db/drizzle';
import {authorizeRealtimeChannel} from '@/lib/realtime/channelAccess';
import {readProtectedEvents} from '@/lib/realtime/protectedEvents';
import {enforceRateLimit} from '@/lib/security/rateLimit';
import {handleApiError,badRequest,unauthorized} from '@/lib/api/errors';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest) {
 try{
  const bearer=req.headers.get('authorization');
  const token=bearer?.toLowerCase().startsWith('bearer ')?bearer.slice(7).trim():req.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  if(!token)throw unauthorized('Sign in first');
  const {user}=await authenticateAccessToken(token);
  await enforceRateLimit(user.id,'user',{name:'realtime:events',limit:120,windowMs:60000,globalLimit:20000});
  const raw=req.nextUrl.searchParams.get('ids')??'';
  if(raw.length>740)throw badRequest('Too many realtime events');
  const ids=[...new Set(raw.split(','))];
  if(ids.length<1 || ids.length>20 || ids.some(id=>!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id)))throw badRequest('Invalid realtime event identifiers');
  const events=await readProtectedEvents(ids);
  const db=await getDb();
  const channels=[...new Set(events.map(item=>item.channel))];
  const results=await Promise.all(channels.map(async channel=>[channel,await authorizeRealtimeChannel(db,user.id,channel)] as const));
  const permitted=new Set(results.filter(([,result])=>result==='ok').map(([channel])=>channel));
  return NextResponse.json({success:true,data:{events:events.filter(item=>permitted.has(item.channel))}}, {headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
 }catch(error){return handleApiError(error);}
}
