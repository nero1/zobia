export const dynamic='force-dynamic';
import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {withAuth,validateBody} from '@/lib/api/middleware';
import {handleApiError} from '@/lib/api/errors';
import {enforceRateLimit,RATE_LIMITS} from '@/lib/security/rateLimit';
import {updateMerchFulfillment} from '@/lib/merch/fulfillment';
export const PATCH=withAuth(async(req:NextRequest,{params,auth})=>{
 try{
  await enforceRateLimit(auth.user.sub,'user',RATE_LIMITS.apiWrite);
  const {orderId}=await params;
  if(!z.string().uuid().safeParse(orderId).success)return NextResponse.json({error:'Invalid order ID'},{status:400});
  const data=await updateMerchFulfillment(auth.user.sub,orderId,'deliver',{});
  return NextResponse.json({success:true,data,error:null});
 }catch(error){return handleApiError(error);}
});
