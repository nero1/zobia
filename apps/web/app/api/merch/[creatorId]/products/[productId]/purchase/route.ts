export const dynamic='force-dynamic';
import {NextRequest,NextResponse} from 'next/server';
import {withAuth,validateBody} from '@/lib/api/middleware';
import {handleApiError} from '@/lib/api/errors';
import {enforceRateLimit,RATE_LIMITS} from '@/lib/security/rateLimit';
import {requireFeatureEnabled} from '@/lib/manifest';
import {merchPurchaseInput,purchaseMerchWithCredits} from '@/lib/merch/purchase';
export const POST=withAuth(async(req:NextRequest,{params,auth})=>{
 try{
  await requireFeatureEnabled('merchStore');await enforceRateLimit(auth.user.sub,'user',RATE_LIMITS.apiWrite);
  const {creatorId,productId}=await params;
  const input=await validateBody(req,merchPurchaseInput);
  const result=await purchaseMerchWithCredits(auth.user.sub,productId,input,{creatorId});
  return NextResponse.json({success:true,data:result,error:null},{status:result.reused?200:201});
 }catch(error){return handleApiError(error);}
});
