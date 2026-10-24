export const dynamic='force-dynamic';
import {NextRequest,NextResponse} from 'next/server';
import {loadManifest} from '@/lib/manifest';
import {verifyAdmobCompletion} from '@/lib/ads/rewardProof';
import {enforceRateLimit,getClientIp} from '@/lib/security/rateLimit';
import {handleApiError} from '@/lib/api/errors';
/** Configure this URL as the AdMob rewarded-unit server-side verification callback. */
export async function GET(request:NextRequest){
 try{
  await enforceRateLimit(getClientIp(request),'ip',{name:'admob:ssv',limit:120,windowMs:60000,globalLimit:10000,bypassL1:true});
  const manifest=await loadManifest();
  if(!manifest.features.rewardedAds || !manifest.ads.admob.rewardedUnitId)return new NextResponse(null,{status:403});
  if(!await verifyAdmobCompletion(request.nextUrl,manifest.ads.admob.rewardedUnitId))return new NextResponse(null,{status:403});
  return NextResponse.json({received:true});
 }catch(error){return handleApiError(error);}
}
